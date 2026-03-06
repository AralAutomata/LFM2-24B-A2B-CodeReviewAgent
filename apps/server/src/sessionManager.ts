import type {
  AgentMode,
  CommitExplanationResult,
  CommitFileExplanation,
  CommitMetadata,
  CommitSummary,
  ReviewResult,
  ReviewEvent,
  ReviewSession,
  SessionStatus
} from './types';

class SessionManager {
  private sessions: Map<string, ReviewSession> = new Map();

  createSession(rootPath: string, mode: AgentMode = 'review'): ReviewSession {
    const id = generateSessionId();
    const session: ReviewSession = {
      id,
      mode,
      rootPath,
      status: 'pending',
      startedAt: new Date().toISOString(),
      files: [],
      results: new Map(),
      events: [],
      errors: [],
      totalFiles: 0,
      processedFiles: 0
    };

    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): ReviewSession | undefined {
    return this.sessions.get(id);
  }

  updateSession(id: string, updates: Partial<ReviewSession>): ReviewSession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    Object.assign(session, updates);
    return session;
  }

  setFiles(id: string, files: string[]): void {
    const session = this.sessions.get(id);
    if (session) {
      session.files = files;
      session.totalFiles = files.length;
    }
  }

  addResult(id: string, filePath: string, result: ReviewResult): void {
    const session = this.sessions.get(id);
    if (session) {
      session.results.set(filePath, result);
      session.processedFiles++;
    }
  }

  initializeCommitResult(id: string, commit: CommitMetadata): void {
    const session = this.sessions.get(id);
    if (!session) return;

    session.commitResult = {
      commit,
      summary: null,
      files: []
    };
  }

  addCommitFileExplanation(id: string, fileExplanation: CommitFileExplanation): void {
    const session = this.sessions.get(id);
    if (!session) return;

    if (!session.commitResult) {
      throw new Error(`Commit result not initialized for session ${id}`);
    }

    session.commitResult.files.push(fileExplanation);
    session.processedFiles++;
  }

  setCommitSummary(id: string, summary: CommitSummary | null): void {
    const session = this.sessions.get(id);
    if (session?.commitResult) {
      session.commitResult.summary = summary;
    }
  }

  getCommitResult(id: string): CommitExplanationResult | null {
    return this.sessions.get(id)?.commitResult || null;
  }

  addError(id: string, filePath: string, error: string): void {
    this.recordError(id, filePath, error);
  }

  recordError(id: string, filePath: string, error: string, incrementProcessed: boolean = true): void {
    const session = this.sessions.get(id);
    if (session) {
      session.errors.push({ file: filePath, error });
      if (incrementProcessed) {
        session.processedFiles++;
      }
    }
  }

  addEvent(id: string, event: ReviewEvent): void {
    const session = this.sessions.get(id);
    if (session) {
      session.events.push(event);
    }
  }

  setStatus(id: string, status: SessionStatus): void {
    const session = this.sessions.get(id);
    if (session) {
      session.status = status;
      if (status === 'completed' || status === 'error') {
        session.completedAt = new Date().toISOString();
      }
    }
  }

  getResults(id: string): ReviewResult[] {
    const session = this.sessions.get(id);
    if (!session) return [];
    return Array.from(session.results.values());
  }

  getSessionStats(id: string): {
    totalFiles: number;
    processedFiles: number;
    progress: number;
    status: SessionStatus;
    totalFindings: number;
    criticalCount: number;
    highCount: number;
  } | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    const results = Array.from(session.results.values());
    const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
    const criticalCount = results.reduce(
      (sum, r) => sum + r.findings.filter(f => f.severity === 'critical').length, 0
    );
    const highCount = results.reduce(
      (sum, r) => sum + r.findings.filter(f => f.severity === 'high').length, 0
    );

    return {
      totalFiles: session.totalFiles,
      processedFiles: session.processedFiles,
      progress: session.totalFiles > 0
        ? Math.round((session.processedFiles / session.totalFiles) * 100)
        : 0,
      status: session.status,
      totalFindings,
      criticalCount,
      highCount
    };
  }

  deleteSession(id: string): boolean {
    return this.sessions.delete(id);
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  cleanupOldSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [id, session] of this.sessions) {
      const sessionTime = new Date(session.startedAt).getTime();
      if (now - sessionTime > maxAgeMs) {
        this.sessions.delete(id);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export const sessionManager = new SessionManager();
