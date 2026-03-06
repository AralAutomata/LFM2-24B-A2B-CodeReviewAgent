import { sessionManager } from './sessionManager';
import { callOllama } from './ollamaClient';
import {
  COMMIT_EXPLAIN_SYSTEM_PROMPT,
  createCommitFilePrompt,
  createCommitSummaryPrompt,
  parseCommitFileResponse,
  parseCommitSummaryResponse
} from './prompts/commitExplainPrompt';
import {
  ensureGitRepository,
  getLatestCommitDiff,
  getLatestCommitFiles,
  getLatestCommitMetadata
} from './gitCommitReader';
import type {
  CommitExplanationResult,
  CommitFileExplanation,
  CommitSummary
} from './types';

const MAX_COMMIT_SUMMARY_INPUT_CHARS = 20000;

export interface CommitExplainerOptions {
  onFileStart?: (filePath: string, index: number, total: number) => void;
  onFileComplete?: (filePath: string, result: CommitFileExplanation) => void;
  onFileError?: (filePath: string, error: Error) => void;
  onProgress?: (processed: number, total: number) => void;
}

export async function startCommitExplanation(
  sessionId: string,
  options: CommitExplainerOptions = {}
): Promise<void> {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const {
    onFileStart,
    onFileComplete,
    onFileError,
    onProgress
  } = options;

  sessionManager.setStatus(sessionId, 'running');
  await ensureGitRepository(session.rootPath);

  const commit = await getLatestCommitMetadata(session.rootPath);
  const files = await getLatestCommitFiles(session.rootPath);

  if (files.length === 0) {
    sessionManager.setStatus(sessionId, 'error');
    throw new Error('Latest commit has no added or modified files to explain');
  }

  sessionManager.setFiles(sessionId, files.map(file => file.file));
  sessionManager.initializeCommitResult(sessionId, commit);

  for (let i = 0; i < files.length; i++) {
    const fileInfo = files[i];

    if (onFileStart) {
      onFileStart(fileInfo.file, i, files.length);
    }

    try {
      const diffData = await getLatestCommitDiff(session.rootPath, fileInfo.file);
      let fileExplanation: CommitFileExplanation;

      if (diffData.skippedReason) {
        fileExplanation = createSkippedExplanation(fileInfo, diffData.skippedReason);
      } else {
        const response = await callOllama([
          { role: 'system', content: COMMIT_EXPLAIN_SYSTEM_PROMPT },
          {
            role: 'user',
            content: createCommitFilePrompt(
              commit,
              fileInfo.file,
              fileInfo.status,
              fileInfo.diffStats,
              diffData.diff,
              diffData.truncated
            )
          }
        ]);
        const parsed = parseCommitFileResponse(response);
        fileExplanation = {
          file: fileInfo.file,
          status: fileInfo.status,
          language: fileInfo.language,
          diffStats: fileInfo.diffStats,
          summary: parsed.summary,
          changeTypes: parsed.changeTypes,
          details: parsed.details
        };
      }

      sessionManager.addCommitFileExplanation(sessionId, fileExplanation);

      if (onFileComplete) {
        onFileComplete(fileInfo.file, fileExplanation);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackExplanation = createSkippedExplanation(
        fileInfo,
        `Unable to generate explanation: ${message}`
      );

      sessionManager.recordError(sessionId, fileInfo.file, message, false);
      sessionManager.addCommitFileExplanation(sessionId, fallbackExplanation);

      if (onFileError) {
        onFileError(fileInfo.file, error instanceof Error ? error : new Error(message));
      }

      if (onFileComplete) {
        onFileComplete(fileInfo.file, fallbackExplanation);
      }
    }

    if (onProgress) {
      onProgress(i + 1, files.length);
    }
  }

  const commitResult = sessionManager.getCommitResult(sessionId);
  if (!commitResult) {
    throw new Error(`Commit result missing for session ${sessionId}`);
  }

  try {
    const summarySource = selectFilesForCommitSummary(commitResult.files);
    const response = await callOllama([
      { role: 'system', content: COMMIT_EXPLAIN_SYSTEM_PROMPT },
      { role: 'user', content: createCommitSummaryPrompt(commit, summarySource) }
    ]);
    sessionManager.setCommitSummary(sessionId, parseCommitSummaryResponse(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sessionManager.recordError(sessionId, 'commit_summary', message, false);
    sessionManager.setCommitSummary(sessionId, createFallbackSummary(commitResult));
  }

  sessionManager.setStatus(sessionId, 'completed');
}

export function getCommitExplanationResult(sessionId: string): CommitExplanationResult | null {
  return sessionManager.getCommitResult(sessionId);
}

function createSkippedExplanation(
  fileInfo: { file: string; status: 'added' | 'modified'; language: string; diffStats: { additions: number; deletions: number } },
  reason: string
): CommitFileExplanation {
  return {
    file: fileInfo.file,
    status: fileInfo.status,
    language: fileInfo.language,
    diffStats: fileInfo.diffStats,
    summary: reason,
    changeTypes: ['skipped'],
    details: [reason],
    skipped: true,
    skippedReason: reason
  };
}

function selectFilesForCommitSummary(files: CommitFileExplanation[]): CommitFileExplanation[] {
  const selected: CommitFileExplanation[] = [];
  let usedChars = 0;

  for (const file of files) {
    const candidate = JSON.stringify({
      file: file.file,
      status: file.status,
      summary: file.summary,
      changeTypes: file.changeTypes,
      details: file.details.slice(0, 3)
    });

    if (selected.length > 0 && usedChars + candidate.length > MAX_COMMIT_SUMMARY_INPUT_CHARS) {
      break;
    }

    usedChars += candidate.length;
    selected.push({
      ...file,
      details: file.details.slice(0, 3)
    });
  }

  return selected.length > 0 ? selected : files.slice(0, 1);
}

function createFallbackSummary(result: CommitExplanationResult): CommitSummary {
  return {
    headline: result.commit.title || 'Latest commit changes',
    overview: `This commit changes ${result.files.length} file${result.files.length === 1 ? '' : 's'} with ${result.commit.insertions} insertion${result.commit.insertions === 1 ? '' : 's'} and ${result.commit.deletions} deletion${result.commit.deletions === 1 ? '' : 's'}.`,
    themes: Array.from(new Set(result.files.flatMap(file => file.changeTypes))).slice(0, 4),
    risks: ['Whole-commit AI summary could not be generated; file-level explanations are still available.'],
    notableFiles: result.files.slice(0, 5).map(file => file.file)
  };
}
