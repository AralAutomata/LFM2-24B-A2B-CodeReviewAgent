import { execFile } from 'child_process';
import { promisify } from 'util';
import { getLanguage } from './fileWalker';
import type { CommitFileStatus, CommitMetadata, DiffStats } from './types';

const execFileAsync = promisify(execFile);

export const MAX_COMMIT_FILES = 50;
export const MAX_FILE_DIFF_CHARS = 16000;

export interface LatestCommitFile {
  file: string;
  status: CommitFileStatus;
  language: string;
  diffStats: DiffStats;
}

export interface LatestCommitDiff {
  diff: string;
  truncated: boolean;
  skippedReason?: string;
}

export async function ensureGitRepository(rootPath: string): Promise<void> {
  const output = await runGit(rootPath, ['rev-parse', '--is-inside-work-tree']);
  if (output.trim() !== 'true') {
    throw new Error(`Path is not a Git repository: ${rootPath}`);
  }
}

export async function getLatestCommitMetadata(rootPath: string): Promise<CommitMetadata> {
  const metadataOutput = await runGit(rootPath, [
    'show',
    '--quiet',
    '--format=%H%n%h%n%an%n%aI%n%s%n%b',
    'HEAD'
  ]);
  const statusOutput = await runGit(rootPath, ['diff-tree', '--no-commit-id', '--name-status', '-r', 'HEAD']);
  const statsOutput = await runGit(rootPath, ['show', '--numstat', '--format=', 'HEAD']);
  const parsedStats = parseNumstat(statsOutput);
  const eligibleFiles = statusOutput
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseNameStatusLine)
    .filter((entry): entry is { status: CommitFileStatus; file: string } => entry !== null);
  const eligibleStats = eligibleFiles
    .map(file => parsedStats.get(file.file))
    .filter((stat): stat is { diffStats: DiffStats; binary: boolean } => Boolean(stat));
  const lines = metadataOutput.split('\n');

  return {
    hash: lines[0]?.trim() || '',
    shortHash: lines[1]?.trim() || '',
    author: lines[2]?.trim() || 'Unknown',
    date: lines[3]?.trim() || new Date().toISOString(),
    title: lines[4]?.trim() || 'Latest Commit',
    body: lines.slice(5).join('\n').trim(),
    filesChanged: eligibleStats.length,
    insertions: eligibleStats.reduce((sum, stat) => sum + stat.diffStats.additions, 0),
    deletions: eligibleStats.reduce((sum, stat) => sum + stat.diffStats.deletions, 0)
  };
}

export async function getLatestCommitFiles(rootPath: string): Promise<LatestCommitFile[]> {
  const statusOutput = await runGit(rootPath, ['diff-tree', '--no-commit-id', '--name-status', '-r', 'HEAD']);
  const statsOutput = await runGit(rootPath, ['show', '--numstat', '--format=', 'HEAD']);
  const statsMap = parseNumstat(statsOutput);

  const files = statusOutput
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseNameStatusLine)
    .filter((entry): entry is { status: CommitFileStatus; file: string } => entry !== null)
    .slice(0, MAX_COMMIT_FILES)
    .map(entry => ({
      file: entry.file,
      status: entry.status,
      language: getLanguage(entry.file),
      diffStats: statsMap.get(entry.file)?.diffStats || { additions: 0, deletions: 0 }
    }));

  return files;
}

export async function getLatestCommitDiff(rootPath: string, filePath: string): Promise<LatestCommitDiff> {
  const numstatOutput = await runGit(rootPath, ['show', '--numstat', '--format=', 'HEAD', '--', filePath]);
  const stat = parseNumstat(numstatOutput).get(filePath);

  if (stat?.binary) {
    return {
      diff: '',
      truncated: false,
      skippedReason: 'Binary diff detected; skipped for lightweight textual explanation.'
    };
  }

  const diff = await runGit(rootPath, [
    'show',
    '--format=',
    '--unified=3',
    '--no-ext-diff',
    '--no-renames',
    'HEAD',
    '--',
    filePath
  ]);

  if (!diff.trim()) {
    return {
      diff: '',
      truncated: false,
      skippedReason: 'No textual diff available for this file.'
    };
  }

  if (diff.includes('Binary files')) {
    return {
      diff: '',
      truncated: false,
      skippedReason: 'Binary diff detected; skipped for lightweight textual explanation.'
    };
  }

  if (diff.length > MAX_FILE_DIFF_CHARS) {
    return {
      diff: truncateDiff(diff, MAX_FILE_DIFF_CHARS),
      truncated: true
    };
  }

  return {
    diff,
    truncated: false
  };
}

async function runGit(rootPath: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: rootPath,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024
    });

    if (stderr && stderr.trim().length > 0) {
      return `${stdout}${stderr}`;
    }

    return stdout;
  } catch (error: any) {
    const message = error?.stderr || error?.stdout || error?.message || 'Git command failed';
    if (String(message).includes('not a git repository')) {
      throw new Error(`Path is not a Git repository: ${rootPath}`);
    }
    if (String(message).includes('bad revision') || String(message).includes('does not have any commits yet')) {
      throw new Error(`Repository has no readable HEAD commit: ${rootPath}`);
    }
    throw new Error(`Git command failed (${args.join(' ')}): ${String(message).trim()}`);
  }
}

function parseNameStatusLine(line: string): { status: CommitFileStatus; file: string } | null {
  const [rawStatus, ...parts] = line.split('\t');
  const file = parts[0];

  if (!rawStatus || !file) {
    return null;
  }

  if (rawStatus === 'A') {
    return { status: 'added', file };
  }

  if (rawStatus === 'M') {
    return { status: 'modified', file };
  }

  return null;
}

function parseNumstat(output: string): Map<string, { diffStats: DiffStats; binary: boolean }> {
  const map = new Map<string, { diffStats: DiffStats; binary: boolean }>();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
    if (!match) continue;

    const additionsRaw = match[1];
    const deletionsRaw = match[2];
    const file = match[3];
    const binary = additionsRaw === '-' || deletionsRaw === '-';

    map.set(file, {
      diffStats: {
        additions: binary ? 0 : parseInt(additionsRaw, 10),
        deletions: binary ? 0 : parseInt(deletionsRaw, 10)
      },
      binary
    });
  }

  return map;
}

function truncateDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) {
    return diff;
  }

  const headLength = Math.floor(maxChars * 0.65);
  const tailLength = Math.floor(maxChars * 0.25);

  return [
    diff.slice(0, headLength).trimEnd(),
    '',
    '... [diff truncated for size] ...',
    '',
    diff.slice(diff.length - tailLength).trimStart()
  ].join('\n');
}
