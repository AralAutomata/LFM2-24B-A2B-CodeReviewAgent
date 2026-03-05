import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import type { ExternalAnalysis, ExternalToolResult } from './types';

const execAsync = promisify(exec);

export async function analyzeWithExternalTools(
  filePath: string,
  rootPath: string
): Promise<ExternalAnalysis> {
  const results: ExternalAnalysis = {};
  const ext = filePath.split('.').pop()?.toLowerCase();
  const relativePath = relative(rootPath, filePath);

  try {
    if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
      const tsResults = await runTypeScriptCheck(filePath, rootPath);
      if (tsResults.length > 0) {
        results.typescript = tsResults;
      }
    }

    if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') {
      const eslintResults = await runESLint(filePath, rootPath);
      if (eslintResults.length > 0) {
        results.eslint = eslintResults;
      }
    }

    results.security = await runSecurityAudit(relativePath, rootPath);
  } catch (error) {
    console.warn(`External tools analysis failed for ${filePath}:`, error);
  }

  return results;
}

async function runTypeScriptCheck(
  filePath: string,
  rootPath: string
): Promise<ExternalToolResult[]> {
  const results: ExternalToolResult[] = [];
  
  try {
    const { stdout, stderr } = await execAsync(
      `npx tsc --noEmit --skipLibCheck 2>&1`,
      { 
        cwd: rootPath, 
        timeout: 30000,
        maxBuffer: 1024 * 1024
      }
    );

    const output = stdout + stderr;
    const lines = output.split('\n');
    
    for (const line of lines) {
      const match = line.match(/(\d+),(\d+):\s*error\s*(TS\d+):\s*(.+)/);
      if (match) {
        const [, lineNum, , code, message] = match;
        const fileInError = line.match(/\((\d+),(\d+)\):\s*error/);
        
        if (fileInError) {
          results.push({
            code: code,
            message: message,
            line: parseInt(fileInError[1], 10),
            severity: 'high'
          });
        }
      }
    }
  } catch (error: any) {
    if (error.stdout) {
      const lines = error.stdout.toString().split('\n');
      for (const line of lines) {
        const match = line.match(/(\d+),(\d+):\s*error\s*(TS\d+):\s*(.+)/);
        if (match) {
          const [, , , code, message] = match;
          const fileInError = line.match(/\((\d+),(\d+)\)/);
          
          if (fileInError) {
            results.push({
              code: code,
              message: message,
              line: parseInt(fileInError[1], 10),
              severity: 'high'
            });
          }
        }
      }
    }
  }

  return results;
}

async function runESLint(
  filePath: string,
  rootPath: string
): Promise<ExternalToolResult[]> {
  const results: ExternalToolResult[] = [];
  
  try {
    const { stdout, stderr } = await execAsync(
      `npx eslint --format=json "${filePath}" 2>&1`,
      { 
        cwd: rootPath, 
        timeout: 30000,
        maxBuffer: 1024 * 1024
      }
    );

    let eslintOutput = stdout;
    if (!eslintOutput && stderr) {
      eslintOutput = stderr;
    }

    try {
      const parsed = JSON.parse(eslintOutput);
      for (const fileResult of parsed) {
        for (const msg of fileResult.messages) {
          results.push({
            rule: msg.ruleId,
            message: msg.message,
            line: msg.line,
            severity: msg.severity >= 2 ? 'high' : 'medium'
          });
        }
      }
    } catch {
      // Not JSON format, try to parse lines
      const lines = eslintOutput.split('\n');
      for (const line of lines) {
        const match = line.match(/(\d+):(\d+)\s+(\w+)\s+(.+)/);
        if (match) {
          results.push({
            rule: match[3],
            message: match[4],
            line: parseInt(match[1], 10),
            severity: 'medium'
          });
        }
      }
    }
  } catch (error: any) {
    // ESLint might not be configured, return empty
    if (error.message?.includes('No ESLint configuration found')) {
      return [];
    }
    console.warn(`ESLint failed for ${filePath}:`, error.message);
  }

  return results;
}

async function runSecurityAudit(
  filePath: string,
  rootPath: string
): Promise<ExternalToolResult[]> {
  const results: ExternalToolResult[] = [];
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  if (ext !== 'js' && ext !== 'ts' && ext !== 'jsx' && ext !== 'tsx') {
    return results;
  }

  try {
    const content = readFileSync(join(filePath), 'utf-8');
    
    const dangerousPatterns = [
      { pattern: /eval\s*\(/, vulnerability: 'Code injection via eval()', severity: 'critical' },
      { pattern: /dangerouslySetInnerHTML/, vulnerability: 'XSS vulnerability', severity: 'high' },
      { pattern: /innerHTML\s*=/, vulnerability: 'Potential XSS', severity: 'high' },
      { pattern: /exec\s*\(/, vulnerability: 'Command injection', severity: 'critical' },
      { pattern: /spawn\s*\(/, vulnerability: 'Command injection risk', severity: 'high' },
      { pattern: /child_process/, vulnerability: 'Shell command execution', severity: 'medium' },
      { pattern: /process\.env\[.*\]\s*\+|\+\s*process\.env/, vulnerability: 'Environment variable injection', severity: 'high' },
      { pattern: /crypto\.createHash\s*\(\s*['"]md5['"]/, vulnerability: 'Weak cryptographic hash (MD5)', severity: 'medium' },
      { pattern: /password\s*=\s*['"][^'"]+['"]|passwd\s*=\s*['"][^'"]+['"]/, vulnerability: 'Hardcoded password', severity: 'high' },
      { pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]|apikey\s*=\s*['"][^'"]+['"]/, vulnerability: 'Hardcoded API key', severity: 'high' },
      { pattern: /AWS_ACCESS_KEY|AWS_SECRET/, vulnerability: 'Hardcoded AWS credentials', severity: 'critical' },
      { pattern: /INSERT\s+INTO.*\+|SELECT.*\+|UPDATE.*SET.*\+|DELETE\s+FROM.+\+/i, vulnerability: 'Potential SQL injection', severity: 'critical' },
      { pattern: /require\s*\(\s*['"]fs['"]\s*\).*\.readFileSync|readFile\s*\(/, vulnerability: 'Uncontrolled file read', severity: 'medium' },
      { pattern: /\.chmod\s*\(\s*0o777/, vulnerability: 'Insecure file permissions', severity: 'high' },
    ];

    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      
      for (const { pattern, vulnerability, severity } of dangerousPatterns) {
        if (pattern.test(line)) {
          results.push({
            vulnerability,
            message: vulnerability,
            line: lineNum,
            severity
          });
        }
      }
    }
  } catch (error) {
    console.warn(`Security audit failed for ${filePath}:`, error);
  }

  return results;
}

export function validateFindingWithCode(
  finding: any,
  fileContent: string
): { valid: boolean; correctedLine?: number; note?: string } {
  const lines = fileContent.split('\n');
  
  if (finding.line < 1 || finding.line > lines.length) {
    return { valid: false, note: 'Invalid line number' };
  }

  const actualLine = lines[finding.line - 1];
  
  if (!actualLine.trim()) {
    return { valid: false, note: 'Empty line' };
  }

  if (finding.evidence && !actualLine.includes(finding.evidence.trim())) {
    const searchWindow = 3;
    let found = false;
    const startLine = Math.max(0, finding.line - searchWindow - 1);
    const endLine = Math.min(lines.length, finding.line + searchWindow);
    
    for (let i = startLine; i < endLine; i++) {
      if (lines[i].includes(finding.evidence.trim())) {
        return { 
          valid: true, 
          correctedLine: i + 1,
          note: `Line corrected from ${finding.line} to ${i + 1}`
        };
      }
    }
    
    return { valid: false, note: 'Evidence not found near specified line' };
  }

  return { valid: true };
}
