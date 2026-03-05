import type { ServerWebSocket } from 'bun';
import { sessionManager } from './sessionManager';
import type { ReviewEvent } from './types';

interface SSEClient {
  id: string;
  sessionId: string;
  socket: ServerWebSocket<unknown>;
}

class SSEHandler {
  private clients: Map<string, SSEClient> = new Map();

  addClient(sessionId: string, socket: ServerWebSocket<unknown>): string {
    const clientId = generateClientId();
    this.clients.set(clientId, {
      id: clientId,
      sessionId,
      socket
    });
    return clientId;
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  broadcastToSession(sessionId: string, event: ReviewEvent): void {
    const message = formatSSEMessage(event);

    for (const [clientId, client] of this.clients) {
      if (client.sessionId === sessionId) {
        try {
          client.socket.send(message);
        } catch (error) {
          console.error(`Failed to send to client ${clientId}:`, error);
          this.removeClient(clientId);
        }
      }
    }
  }

  getClientCount(sessionId?: string): number {
    if (sessionId) {
      return Array.from(this.clients.values()).filter(c => c.sessionId === sessionId).length;
    }
    return this.clients.size;
  }
}

function generateClientId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function formatSSEMessage(event: ReviewEvent): string {
  const data = JSON.stringify({
    type: event.type,
    timestamp: event.timestamp,
    data: event.data
  });

  return `event: ${event.type}\ndata: ${data}\n\n`;
}

export const sseHandler = new SSEHandler();

export function emitEvent(sessionId: string, event: ReviewEvent): void {
  // Store event in session
  sessionManager.addEvent(sessionId, event);
  
  // Broadcast to connected clients
  sseHandler.broadcastToSession(sessionId, event);
}

export function createEvent(
  type: ReviewEvent['type'],
  data: unknown
): ReviewEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    data
  };
}
