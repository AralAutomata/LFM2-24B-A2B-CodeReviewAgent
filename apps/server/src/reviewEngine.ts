import { walkDirectory, readFileContent } from './fileWalker';
import { reviewFile } from './ollamaClient';
import { sessionManager } from './sessionManager';
import type { ReviewResult, FileInfo } from './types';

export interface ReviewEngineOptions {
  delayBetweenFiles?: number;
  onFileStart?: (filePath: string, index: number, total: number) => void;
  onFileComplete?: (filePath: string, result: ReviewResult) => void;
  onFileError?: (filePath: string, error: Error) => void;
  onProgress?: (processed: number, total: number) => void;
}

export async function startReview(
  sessionId: string,
  options: ReviewEngineOptions = {}
): Promise<void> {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const {
    delayBetweenFiles = 100,
    onFileStart,
    onFileComplete,
    onFileError,
    onProgress
  } = options;

  sessionManager.setStatus(sessionId, 'running');

  // Walk directory to discover files
  console.log(`[${sessionId}] Walking directory: ${session.rootPath}`);
  let files: FileInfo[];
  
  try {
    files = await walkDirectory(session.rootPath, (count) => {
      console.log(`[${sessionId}] Discovered ${count} files...`);
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    sessionManager.setStatus(sessionId, 'error');
    throw new Error(`Failed to walk directory: ${errorMsg}`);
  }

  console.log(`[${sessionId}] Found ${files.length} files to review`);
  sessionManager.setFiles(sessionId, files.map(f => f.path));

  // Process files sequentially to avoid race conditions
  for (let i = 0; i < files.length; i++) {
    const fileInfo = files[i];
    
    if (onFileStart) {
      onFileStart(fileInfo.path, i, files.length);
    }

    try {
      // Read file content
      const content = await readFileContent(fileInfo.path);
      
      // Review the file
      const reviewResponse = await reviewFile(
        fileInfo.relativePath,
        fileInfo.language,
        content,
        session.rootPath
      );

      // Create result
      const result: ReviewResult = {
        file: fileInfo.relativePath,
        language: fileInfo.language,
        summary: reviewResponse.summary,
        score: reviewResponse.score,
        findings: reviewResponse.findings
      };

      // Store result
      sessionManager.addResult(sessionId, fileInfo.path, result);

      if (onFileComplete) {
        onFileComplete(fileInfo.path, result);
      }

      console.log(`[${sessionId}] ✓ Reviewed: ${fileInfo.relativePath} (Score: ${result.score})`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      sessionManager.addError(sessionId, fileInfo.path, errorMsg);
      
      if (onFileError) {
        onFileError(fileInfo.path, error instanceof Error ? error : new Error(errorMsg));
      }

      console.error(`[${sessionId}] ✗ Error reviewing ${fileInfo.relativePath}: ${errorMsg}`);
    }

    if (onProgress) {
      onProgress(i + 1, files.length);
    }

    // Delay between files to avoid overwhelming the LLM
    if (i < files.length - 1) {
      await delay(delayBetweenFiles);
    }
  }

  // Mark session as completed
  sessionManager.setStatus(sessionId, 'completed');
  console.log(`[${sessionId}] Review completed. Processed ${files.length} files`);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getSessionResults(sessionId: string): ReviewResult[] {
  return sessionManager.getResults(sessionId);
}
