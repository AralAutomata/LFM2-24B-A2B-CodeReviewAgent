import { serve, type ServerWebSocket } from 'bun';
import { sessionManager } from './sessionManager';
import { startReview, getSessionResults } from './reviewEngine';
import { sseHandler, emitEvent, createEvent } from './sseHandler';
import { checkOllamaConnection } from './ollamaClient';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { ReviewEvent } from './types';

const PORT = parseInt(process.env.PORT || '3001');
const CORS_ORIGIN = 'http://localhost:3002';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true'
};

// SSE headers
const sseHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive'
};

console.log('🚀 Starting Code Review Server...');
console.log(`   Port: ${PORT}`);
console.log(`   CORS: ${CORS_ORIGIN}`);

const server = serve({
  port: PORT,
  fetch(request: Request, server) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    // Route: Health check
    if (pathname === '/health' && method === 'GET') {
      return handleHealth();
    }

    // Route: Start review session
    if (pathname === '/api/review/start' && method === 'POST') {
      return handleStartReview(request);
    }

    // Route: Get session status
    const sessionMatch = pathname.match(/^\/api\/review\/([^\/]+)$/);
    if (sessionMatch && method === 'GET') {
      return handleGetSession(sessionMatch[1]);
    }

    // Route: Get session results
    const resultsMatch = pathname.match(/^\/api\/review\/([^\/]+)\/results$/);
    if (resultsMatch && method === 'GET') {
      return handleGetResults(resultsMatch[1]);
    }

    // Route: SSE stream
    const streamMatch = pathname.match(/^\/api\/review\/([^\/]+)\/stream$/);
    if (streamMatch && method === 'GET') {
      return handleStream(request, streamMatch[1]);
    }

    // Route: Not found
    return jsonResponse({ error: 'Not found' }, 404);
  },

  websocket: {
    open(ws: ServerWebSocket<unknown>) {
      const sessionId = (ws.data as any)?.sessionId;
      if (sessionId) {
        const clientId = sseHandler.addClient(sessionId, ws);
        (ws.data as any).clientId = clientId;
        console.log(`[SSE] Client ${clientId} connected to session ${sessionId}`);
      }
    },

    close(ws: ServerWebSocket<unknown>) {
      const clientId = (ws.data as any)?.clientId;
      if (clientId) {
        sseHandler.removeClient(clientId);
        console.log(`[SSE] Client ${clientId} disconnected`);
      }
    },

    message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
      // Handle incoming messages if needed
    }
  }
});

// Health check handler
async function handleHealth(): Promise<Response> {
  const ollamaConnected = await checkOllamaConnection();
  
  return jsonResponse({
    status: 'ok',
    ollama: ollamaConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
}

// Start review handler
async function handleStartReview(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { path?: string };
    const { path: rootPath } = body;

    if (!rootPath || typeof rootPath !== 'string') {
      return jsonResponse({ error: 'Missing or invalid path parameter' }, 400);
    }

    const resolvedPath = resolve(rootPath);
    
    if (!existsSync(resolvedPath)) {
      return jsonResponse({ error: `Path does not exist: ${resolvedPath}` }, 400);
    }

    // Create session
    const session = sessionManager.createSession(resolvedPath);
    
    // Emit started event
    emitReviewEvent(session.id, createEvent('started', {
      sessionId: session.id,
      path: resolvedPath
    }));

    // Start review in background
    runReviewInBackground(session.id);

    return jsonResponse({
      sessionId: session.id,
      path: resolvedPath,
      status: 'started'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: message }, 500);
  }
}

// Get session handler
function handleGetSession(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }

  const stats = sessionManager.getSessionStats(sessionId);

  return jsonResponse({
    id: session.id,
    rootPath: session.rootPath,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    stats
  });
}

// Get results handler
function handleGetResults(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }

  const results = getSessionResults(sessionId);

  return jsonResponse({
    sessionId,
    status: session.status,
    results
  });
}

// Store active SSE controllers
const sseControllers = new Map<string, ReadableStreamDefaultController>();

function handleStream(
  request: Request,
  sessionId: string
): Response {
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }

  const stream = new ReadableStream({
    start(controller) {
      sseControllers.set(sessionId, controller);
      
      // Send initial connection message
      const connectEvent = createEvent('started', {
        message: 'Connected to review stream',
        sessionId,
        status: session.status
      });
      controller.enqueue(formatSSE(connectEvent));

      // Replay previous events
      for (const event of session.events) {
        controller.enqueue(formatSSE(event));
      }
    },

    cancel() {
      sseControllers.delete(sessionId);
    }
  });

  return new Response(stream, { headers: sseHeaders });
}

// Helper to push event to SSE stream
function pushToStream(sessionId: string, event: ReviewEvent) {
  const controller = sseControllers.get(sessionId);
  if (controller) {
    try {
      controller.enqueue(formatSSE(event));
    } catch (e) {
      sseControllers.delete(sessionId);
    }
  }
}

// Emit event to both session storage and live streams
function emitReviewEvent(sessionId: string, event: ReviewEvent) {
  sessionManager.addEvent(sessionId, event);
  pushToStream(sessionId, event);
}

// Helper function to run review in background
async function runReviewInBackground(sessionId: string): Promise<void> {
  try {
    const session = sessionManager.getSession(sessionId);
    if (!session) return;

    // Start review with event emitters
    // reviewEngine will handle file walking
    await startReview(sessionId, {
      delayBetweenFiles: 0,
      onFileStart: (filePath, index, total) => {
        emitReviewEvent(sessionId, createEvent('file_start', {
          file: filePath,
          index,
          total
        }));
      },
      onFileComplete: (filePath, result) => {
        emitReviewEvent(sessionId, createEvent('file_complete', {
          file: filePath,
          language: result.language,
          score: result.score,
          findingsCount: result.findings.length
        }));
      },
      onFileError: (filePath, error) => {
        emitReviewEvent(sessionId, createEvent('error', {
          file: filePath,
          error: error.message
        }));
      },
      onProgress: (processed, total) => {
        emitReviewEvent(sessionId, createEvent('progress', {
          processed,
          total,
          percentage: Math.round((processed / total) * 100)
        }));
      }
    });

    // Emit completed event
    const finalSession = sessionManager.getSession(sessionId);
    const completedEvent = createEvent('completed', {
      status: 'completed',
      totalFiles: finalSession?.totalFiles || 0,
      processedFiles: finalSession?.processedFiles || 0,
      errors: finalSession?.errors.length || 0
    });
    emitReviewEvent(sessionId, completedEvent);
    
    // Close the stream
    const controller = sseControllers.get(sessionId);
    if (controller) {
      try { controller.close(); } catch {}
      sseControllers.delete(sessionId);
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${sessionId}] Review failed:`, message);
    
    sessionManager.setStatus(sessionId, 'error');
    
    emitReviewEvent(sessionId, createEvent('error', {
      type: 'fatal',
      message
    }));
  }
}

// Helper to format SSE message
function formatSSE(event: { type: string; timestamp: string; data: unknown }): string {
  const data = JSON.stringify({
    type: event.type,
    timestamp: event.timestamp,
    data: event.data
  });
  return `event: ${event.type}\ndata: ${data}\n\n`;
}

// Helper for JSON responses
function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

console.log(`✅ Server ready at http://localhost:${PORT}`);
console.log(`   Health: http://localhost:${PORT}/health`);
console.log(`   API: http://localhost:${PORT}/api/review/start`);
