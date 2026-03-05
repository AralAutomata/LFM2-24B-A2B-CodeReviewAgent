import { stat, readdir, readFile, lstat } from 'fs/promises';
import { join, relative, extname, resolve } from 'path';
import type { FileInfo } from './types';

const INCLUDE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.scala',
  '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
  '.cs', '.swift', '.rb', '.php', '.sh', '.bash',
  '.zsh', '.fish', '.ps1', '.sql', '.graphql',
  '.yaml', '.yml', '.json', '.toml', '.ini',
  '.md', '.mdx', '.vue', '.svelte'
]);

const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /dist/,
  /build/,
  /\.next/,
  /out/,
  /vendor/,
  /\.min\./,
  /\.bundle\./,
  /coverage/,
  /\.cache/,
  /\.turbo/,
  /\.vercel/,
  /\.vscode/,
  /\.idea/,
  /__pycache__/,
  /\.pytest_cache/,
  /target\//,  // Rust
  /bin\//,     // Go
  /pkg\//,     // Go
  /\.gradle/,
  /\.mvn/,
];

const MAX_FILE_SIZE = 500 * 1024; // 500KB

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.rb': 'ruby',
  '.php': 'php',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.toml': 'toml',
  '.ini': 'ini',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.vue': 'vue',
  '.svelte': 'svelte'
};

export function shouldExcludeFile(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath));
}

export function shouldIncludeFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return INCLUDE_EXTENSIONS.has(ext);
}

export function getLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext] || 'text';
}

export async function walkDirectory(
  rootPath: string,
  onProgress?: (count: number) => void
): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  const queue: string[] = [rootPath];
  const visitedPaths = new Set<string>();
  const resolvedRoot = resolve(rootPath);
  let processedCount = 0;

  while (queue.length > 0) {
    const currentPath = queue.shift()!;
    const resolvedPath = resolve(currentPath);

    // Prevent circular symlinks and duplicate processing
    if (visitedPaths.has(resolvedPath)) {
      continue;
    }
    visitedPaths.add(resolvedPath);

    // Prevent path traversal outside root
    if (!resolvedPath.startsWith(resolvedRoot)) {
      console.warn(`Skipping path outside root: ${currentPath}`);
      continue;
    }

    try {
      // Use lstat to detect symlinks
      const stats = await lstat(currentPath);

      // Skip symlinks to prevent circular references and traversal
      if (stats.isSymbolicLink()) {
        continue;
      }

      if (stats.isDirectory()) {
        if (shouldExcludeFile(currentPath)) {
          continue;
        }

        const entries = await readdir(currentPath);
        for (const entry of entries) {
          queue.push(join(currentPath, entry));
        }
      } else if (stats.isFile()) {
        if (shouldExcludeFile(currentPath) || !shouldIncludeFile(currentPath)) {
          continue;
        }

        if (stats.size > MAX_FILE_SIZE) {
          console.warn(`Skipping large file: ${currentPath} (${(stats.size / 1024).toFixed(1)}KB)`);
          continue;
        }

        files.push({
          path: currentPath,
          relativePath: relative(rootPath, currentPath),
          language: getLanguage(currentPath),
          size: stats.size
        });

        processedCount++;
        if (processedCount % 100 === 0 && onProgress) {
          onProgress(processedCount);
        }
      }
    } catch (error) {
      console.error(`Error accessing ${currentPath}:`, error);
    }
  }

  return files;
}

export async function readFileContent(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`);
  }
}
