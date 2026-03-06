import { serve } from 'bun';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { startCommitExplanation, getCommitExplanationResult } from './commitExplainer';
import { consolidateFindings } from './findingConsolidator';
import { checkOllamaConnection, OLLAMA_MODEL } from './ollamaClient';
import { startReview, getSessionResults } from './reviewEngine';
import { sessionManager } from './sessionManager';
import type {
  AgentMode,
  CommitExplanationResult,
  ReviewEvent,
  ReviewResult,
  ReviewSession
} from './types';

const PORT = parseInt(process.env.PORT || '3001');
const CORS_ORIGIN = 'http://localhost:3002';

const corsHeaders = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true'
};

const sseHeaders = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive'
};

const sseControllers = new Map<string, ReadableStreamDefaultController>();

console.log('🚀 Starting Code Review Server...');
console.log(`   Port: ${PORT}`);
console.log(`   CORS: ${CORS_ORIGIN}`);

serve({
  port: PORT,
  fetch(request: Request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    if (pathname === '/health' && method === 'GET') {
      return handleHealth();
    }

    if (pathname === '/api/review/start' && method === 'POST') {
      return handleStartSession(request, 'review');
    }

    if (pathname === '/api/commit-explainer/start' && method === 'POST') {
      return handleStartSession(request, 'commit_explainer');
    }

    const reviewSessionMatch = pathname.match(/^\/api\/review\/([^\/]+)$/);
    if (reviewSessionMatch && method === 'GET') {
      return handleGetSession(reviewSessionMatch[1]);
    }

    const reviewResultsMatch = pathname.match(/^\/api\/review\/([^\/]+)\/results$/);
    if (reviewResultsMatch && method === 'GET') {
      return handleGetReviewResults(reviewResultsMatch[1]);
    }

    const reviewConsolidatedMatch = pathname.match(/^\/api\/review\/([^\/]+)\/results\/consolidated$/);
    if (reviewConsolidatedMatch && method === 'GET') {
      return handleGetConsolidatedResults(reviewConsolidatedMatch[1]);
    }

    const reviewJsonMatch = pathname.match(/^\/api\/review\/([^\/]+)\/download\/json$/);
    if (reviewJsonMatch && method === 'GET') {
      return handleDownloadReviewJSON(reviewJsonMatch[1]);
    }

    const reviewMarkdownMatch = pathname.match(/^\/api\/review\/([^\/]+)\/download\/markdown$/);
    if (reviewMarkdownMatch && method === 'GET') {
      return handleDownloadReviewMarkdown(reviewMarkdownMatch[1]);
    }

    const reviewStreamMatch = pathname.match(/^\/api\/review\/([^\/]+)\/stream$/);
    if (reviewStreamMatch && method === 'GET') {
      return handleStream(reviewStreamMatch[1]);
    }

    const commitSessionMatch = pathname.match(/^\/api\/commit-explainer\/([^\/]+)$/);
    if (commitSessionMatch && method === 'GET') {
      return handleGetSession(commitSessionMatch[1]);
    }

    const commitResultsMatch = pathname.match(/^\/api\/commit-explainer\/([^\/]+)\/results$/);
    if (commitResultsMatch && method === 'GET') {
      return handleGetCommitResults(commitResultsMatch[1]);
    }

    const commitJsonMatch = pathname.match(/^\/api\/commit-explainer\/([^\/]+)\/download\/json$/);
    if (commitJsonMatch && method === 'GET') {
      return handleDownloadCommitJSON(commitJsonMatch[1]);
    }

    const commitMarkdownMatch = pathname.match(/^\/api\/commit-explainer\/([^\/]+)\/download\/markdown$/);
    if (commitMarkdownMatch && method === 'GET') {
      return handleDownloadCommitMarkdown(commitMarkdownMatch[1]);
    }

    const commitStreamMatch = pathname.match(/^\/api\/commit-explainer\/([^\/]+)\/stream$/);
    if (commitStreamMatch && method === 'GET') {
      return handleStream(commitStreamMatch[1]);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
});

async function handleHealth(): Promise<Response> {
  const ollamaConnected = await checkOllamaConnection();

  return jsonResponse({
    status: 'ok',
    ollama: ollamaConnected ? 'connected' : 'disconnected',
    model: OLLAMA_MODEL.replace(':latest', ''),
    timestamp: new Date().toISOString()
  });
}

async function handleStartSession(request: Request, mode: AgentMode): Promise<Response> {
  try {
    const body = await request.json() as { path?: string };
    const rootPath = body.path;

    if (!rootPath || typeof rootPath !== 'string') {
      return jsonResponse({ error: 'Missing or invalid path parameter' }, 400);
    }

    const resolvedPath = resolve(rootPath);
    if (!existsSync(resolvedPath)) {
      return jsonResponse({ error: `Path does not exist: ${resolvedPath}` }, 400);
    }

    const session = sessionManager.createSession(resolvedPath, mode);
    emitSessionEvent(session.id, createEvent('started', {
      sessionId: session.id,
      path: resolvedPath,
      mode
    }));

    if (mode === 'review') {
      runReviewInBackground(session.id);
    } else {
      runCommitExplainerInBackground(session.id);
    }

    return jsonResponse({
      sessionId: session.id,
      path: resolvedPath,
      mode,
      status: 'started'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: message }, 500);
  }
}

function handleGetSession(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }

  return jsonResponse({
    id: session.id,
    mode: session.mode,
    rootPath: session.rootPath,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    stats: sessionManager.getSessionStats(sessionId),
    errors: session.errors
  });
}

function handleGetReviewResults(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  if (!session || session.mode !== 'review') {
    return jsonResponse({ error: 'Review session not found' }, 404);
  }

  return jsonResponse({
    sessionId,
    mode: session.mode,
    status: session.status,
    results: getSessionResults(sessionId)
  });
}

function handleGetCommitResults(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  if (!session || session.mode !== 'commit_explainer') {
    return jsonResponse({ error: 'Commit explainer session not found' }, 404);
  }

  return jsonResponse({
    sessionId,
    mode: session.mode,
    status: session.status,
    result: getCommitExplanationResult(sessionId)
  });
}

function handleGetConsolidatedResults(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  if (!session || session.mode !== 'review') {
    return jsonResponse({ error: 'Review session not found' }, 404);
  }

  const results = getSessionResults(sessionId);
  const consolidated = consolidateFindings(results);

  return jsonResponse({
    sessionId,
    mode: session.mode,
    status: session.status,
    consolidatedFindings: consolidated,
    summary: {
      totalFiles: results.length,
      totalFindings: results.reduce((sum, result) => sum + result.findings.length, 0),
      uniqueIssues: consolidated.length,
      avgScore: results.length
        ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length)
        : 0
    }
  });
}

function handleDownloadReviewJSON(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  if (!session || session.mode !== 'review') {
    return jsonResponse({ error: 'Review session not found' }, 404);
  }

  const data = {
    sessionId,
    mode: session.mode,
    rootPath: session.rootPath,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    stats: sessionManager.getSessionStats(sessionId),
    results: getSessionResults(sessionId)
  };

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="code-review-${sessionId}.json"`
    }
  });
}

function handleDownloadReviewMarkdown(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  if (!session || session.mode !== 'review') {
    return jsonResponse({ error: 'Review session not found' }, 404);
  }

  return new Response(buildReviewMarkdown(session, getSessionResults(sessionId)), {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="code-review-${sessionId}.md"`
    }
  });
}

function handleDownloadCommitJSON(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  const result = getCommitExplanationResult(sessionId);

  if (!session || session.mode !== 'commit_explainer' || !result) {
    return jsonResponse({ error: 'Commit explainer session not found' }, 404);
  }

  const data = {
    sessionId,
    mode: session.mode,
    rootPath: session.rootPath,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    stats: sessionManager.getSessionStats(sessionId),
    errors: session.errors,
    result
  };

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="commit-explanation-${sessionId}.json"`
    }
  });
}

function handleDownloadCommitMarkdown(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  const result = getCommitExplanationResult(sessionId);

  if (!session || session.mode !== 'commit_explainer' || !result) {
    return jsonResponse({ error: 'Commit explainer session not found' }, 404);
  }

  return new Response(buildCommitMarkdown(session, result), {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="commit-explanation-${sessionId}.md"`
    }
  });
}

function handleStream(sessionId: string): Response {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return jsonResponse({ error: 'Session not found' }, 404);
  }

  const stream = new ReadableStream({
    start(controller) {
      sseControllers.set(sessionId, controller);

      controller.enqueue(formatSSE(createEvent('started', {
        message: `Connected to ${session.mode} stream`,
        sessionId,
        mode: session.mode,
        status: session.status
      })));

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

function pushToStream(sessionId: string, event: ReviewEvent): void {
  const controller = sseControllers.get(sessionId);
  if (controller) {
    try {
      controller.enqueue(formatSSE(event));
    } catch {
      sseControllers.delete(sessionId);
    }
  }
}

function emitSessionEvent(sessionId: string, event: ReviewEvent): void {
  sessionManager.addEvent(sessionId, event);
  pushToStream(sessionId, event);
}

async function runReviewInBackground(sessionId: string): Promise<void> {
  try {
    await startReview(sessionId, {
      delayBetweenFiles: 0,
      onFileStart: (filePath, index, total) => {
        emitSessionEvent(sessionId, createEvent('file_start', {
          file: filePath,
          index,
          total,
          mode: 'review'
        }));
      },
      onFileComplete: (filePath, result) => {
        emitSessionEvent(sessionId, createEvent('file_complete', {
          file: filePath,
          language: result.language,
          score: result.score,
          findingsCount: result.findings.length,
          mode: 'review'
        }));
      },
      onFileError: (filePath, error) => {
        emitSessionEvent(sessionId, createEvent('error', {
          file: filePath,
          error: error.message,
          mode: 'review'
        }));
      },
      onProgress: (processed, total) => {
        emitSessionEvent(sessionId, createEvent('progress', {
          processed,
          total,
          percentage: Math.round((processed / total) * 100),
          mode: 'review'
        }));
      }
    });

    finalizeSuccessfulRun(sessionId);
  } catch (error) {
    handleFatalRunError(sessionId, error);
  }
}

async function runCommitExplainerInBackground(sessionId: string): Promise<void> {
  try {
    await startCommitExplanation(sessionId, {
      onFileStart: (filePath, index, total) => {
        emitSessionEvent(sessionId, createEvent('file_start', {
          file: filePath,
          index,
          total,
          mode: 'commit_explainer'
        }));
      },
      onFileComplete: (filePath, result) => {
        emitSessionEvent(sessionId, createEvent('file_complete', {
          file: filePath,
          status: result.status,
          summary: result.summary,
          skipped: result.skipped || false,
          mode: 'commit_explainer'
        }));
      },
      onFileError: (filePath, error) => {
        emitSessionEvent(sessionId, createEvent('error', {
          file: filePath,
          error: error.message,
          mode: 'commit_explainer'
        }));
      },
      onProgress: (processed, total) => {
        emitSessionEvent(sessionId, createEvent('progress', {
          processed,
          total,
          percentage: Math.round((processed / total) * 100),
          mode: 'commit_explainer'
        }));
      }
    });

    finalizeSuccessfulRun(sessionId);
  } catch (error) {
    handleFatalRunError(sessionId, error);
  }
}

function finalizeSuccessfulRun(sessionId: string): void {
  const session = sessionManager.getSession(sessionId);
  emitSessionEvent(sessionId, createEvent('completed', {
    status: 'completed',
    mode: session?.mode,
    totalFiles: session?.totalFiles || 0,
    processedFiles: session?.processedFiles || 0,
    errors: session?.errors.length || 0
  }));
  closeStream(sessionId);
}

function handleFatalRunError(sessionId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[${sessionId}] Run failed:`, message);

  sessionManager.setStatus(sessionId, 'error');
  emitSessionEvent(sessionId, createEvent('error', {
    type: 'fatal',
    message
  }));
  closeStream(sessionId);
}

function closeStream(sessionId: string): void {
  const controller = sseControllers.get(sessionId);
  if (controller) {
    try {
      controller.close();
    } catch {}
    sseControllers.delete(sessionId);
  }
}

function buildReviewMarkdown(session: ReviewSession, results: ReviewResult[]): string {
  const stats = sessionManager.getSessionStats(session.id);

  let md = `# Code Review Report

## Summary

- **Session ID**: ${session.id}
- **Root Path**: ${session.rootPath}
- **Started**: ${session.startedAt}
- **Completed**: ${session.completedAt || 'N/A'}
- **Total Files**: ${stats?.totalFiles || 0}
- **Processed Files**: ${stats?.processedFiles || 0}
- **Total Findings**: ${stats?.totalFindings || 0}
- **Avg Score**: ${results.length ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length) : 0}

---

## Files Reviewed

`;

  for (const result of results) {
    md += `### ${result.file} (${result.language})\n\n`;
    md += `**Score**: ${result.score}/100\n\n`;
    if (result.summary) {
      md += `${result.summary}\n\n`;
    }
    if (result.findings.length > 0) {
      md += `#### Findings (${result.findings.length})\n\n`;
      for (const finding of result.findings) {
        const severityIcon = finding.severity === 'critical'
          ? '🔴'
          : finding.severity === 'high'
            ? '🟠'
            : finding.severity === 'medium'
              ? '🟡'
              : finding.severity === 'low'
                ? '🔵'
                : '⚪';
        md += `##### ${severityIcon} ${finding.severity.toUpperCase()}: ${finding.title}\n\n`;
        md += `- **Category**: ${finding.category}\n`;
        if (finding.line > 0) md += `- **Line**: ${finding.line}\n`;
        md += `- **Description**: ${finding.description}\n`;
        if (finding.suggestion) md += `- **Suggestion**: ${finding.suggestion}\n`;
        md += '\n';
      }
    } else {
      md += `_No issues found_\n\n`;
    }
    md += '---\n\n';
  }

  return md;
}

function buildCommitMarkdown(session: ReviewSession, result: CommitExplanationResult): string {
  let md = `# Commit Explanation Report

## Commit

- **Session ID**: ${session.id}
- **Root Path**: ${session.rootPath}
- **Commit**: ${result.commit.shortHash}
- **Author**: ${result.commit.author}
- **Date**: ${result.commit.date}
- **Title**: ${result.commit.title}
- **Files Explained**: ${result.files.length}
- **Insertions**: ${result.commit.insertions}
- **Deletions**: ${result.commit.deletions}

`;

  if (result.commit.body) {
    md += `### Commit Message Body\n\n${result.commit.body}\n\n`;
  }

  if (result.summary) {
    md += `## Whole Commit Summary\n\n`;
    md += `### ${result.summary.headline}\n\n`;
    md += `${result.summary.overview}\n\n`;

    if (result.summary.themes.length > 0) {
      md += `**Themes**\n\n`;
      for (const theme of result.summary.themes) {
        md += `- ${theme}\n`;
      }
      md += '\n';
    }

    if (result.summary.risks.length > 0) {
      md += `**Risks / Follow-ups**\n\n`;
      for (const risk of result.summary.risks) {
        md += `- ${risk}\n`;
      }
      md += '\n';
    }
  }

  md += `## File Explanations\n\n`;

  for (const file of result.files) {
    md += `### ${file.file}\n\n`;
    md += `- **Status**: ${file.status}\n`;
    md += `- **Language**: ${file.language}\n`;
    md += `- **Additions**: ${file.diffStats.additions}\n`;
    md += `- **Deletions**: ${file.diffStats.deletions}\n`;
    if (file.skippedReason) {
      md += `- **Skipped**: ${file.skippedReason}\n`;
    }
    md += `\n${file.summary}\n\n`;

    if (file.changeTypes.length > 0) {
      md += `**Change Types**\n\n`;
      for (const changeType of file.changeTypes) {
        md += `- ${changeType}\n`;
      }
      md += '\n';
    }

    if (file.details.length > 0) {
      md += `**Details**\n\n`;
      for (const detail of file.details) {
        md += `- ${detail}\n`;
      }
      md += '\n';
    }

    md += '---\n\n';
  }

  return md;
}

function createEvent(type: ReviewEvent['type'], data: unknown): ReviewEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    data
  };
}

function formatSSE(event: { type: string; timestamp: string; data: unknown }): string {
  const data = JSON.stringify({
    type: event.type,
    timestamp: event.timestamp,
    data: event.data
  });
  return `event: ${event.type}\ndata: ${data}\n\n`;
}

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
console.log(`   Review API: http://localhost:${PORT}/api/review/start`);
console.log(`   Commit API: http://localhost:${PORT}/api/commit-explainer/start`);
