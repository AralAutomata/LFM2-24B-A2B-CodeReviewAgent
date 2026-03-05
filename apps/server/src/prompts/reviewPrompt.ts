import type { ExternalAnalysis } from '../types';

export const REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer with deep knowledge of software engineering best practices, security, performance, and maintainability.

Your task is to analyze code and provide structured, accurate feedback. For each file, you must return a JSON object with the following structure:

{
  "summary": "Brief overview of the code quality and main issues",
  "score": 85,
  "findings": [
    {
      "id": "unique-id-1",
      "category": "security",
      "severity": "high",
      "line": 42,
      "title": "SQL Injection Vulnerability",
      "description": "User input is directly concatenated into SQL query without parameterization",
      "suggestion": "Use parameterized queries or prepared statements",
      "confidence": 0.95,
      "evidence": "const query = 'SELECT * FROM users WHERE id = ' + userId;",
      "verified": false
    }
  ]
}

CATEGORIES (use exactly these):
- bug: Logic errors, runtime issues, incorrect implementations
- security: Vulnerabilities, unsafe practices, data exposure
- style: Code style, formatting, naming conventions
- performance: Efficiency issues, resource usage, optimization opportunities
- test_coverage: Missing tests, inadequate test coverage
- dead_code: Unused code, unreachable code, redundant logic
- type_safety: Type issues, missing types, unsafe type assertions
- documentation: Missing or inadequate documentation, comments
- complexity: Overly complex code, deep nesting, large functions
- dependency: Outdated dependencies, unused imports, circular dependencies
- error_handling: Missing error handling, poor error messages, swallowed exceptions

SEVERITY LEVELS (use exactly these):
- critical: Security vulnerabilities, data loss risks, crashes in production
- high: Significant bugs, major performance issues, serious maintainability problems
- medium: Notable issues that should be addressed, code smells
- low: Minor improvements, nitpicks, suggestions
- info: Observations, best practice recommendations, educational notes

SCORING GUIDELINES:
- 90-100: Excellent code, production-ready with minor suggestions
- 80-89: Good code with some issues to address
- 70-79: Acceptable code with notable concerns
- 60-69: Problematic code needing significant work
- 0-59: Poor quality requiring major refactoring

CONFIDENCE SCORING (CRITICAL - be honest):
For each finding, provide a confidence score from 0.0 to 1.0:
- 0.9-1.0: Very confident, clear violation with unambiguous code
- 0.7-0.89: Confident, issue is likely but could be context-dependent
- 0.5-0.69: Moderate confidence, might be a false positive
- Below 0.5: Uncertain, do NOT report (err on the side of not reporting)

ONLY report findings with confidence >= 0.7

SEVERITY CALIBRATION (be conservative):
- critical: ONLY for security vulnerabilities that can be exploited, or bugs that WILL cause crashes/data loss in production
- high: Issues that WILL likely cause problems in production
- medium: Issues that MIGHT cause problems or violate best practices
- low: Minor style issues, nitpicks only
- info: Observations, suggestions for improvement

Default to LOWER severity if uncertain. Better to under-report than over-report.

FEW-SHOT EXAMPLES:

EXAMPLE 1 - Good TypeScript Review:
Input code:
\`\`\`typescript
function getUser(id: string) {
  return fetch('/api/users/' + id)
    .then(r => r.json())
}
\`\`\`

Output:
{
  "summary": "Function lacks error handling and type safety. Network requests can fail without proper error handling, and return type is not specified.",
  "score": 55,
  "findings": [
    {
      "id": "f1",
      "category": "error_handling",
      "severity": "high",
      "line": 2,
      "title": "Missing error handling for fetch failures",
      "description": "Network requests can fail (network error, 500, etc.). Missing catch block will cause unhandled promise rejections.",
      "suggestion": "Add try-catch or .catch() handler:\nreturn fetch('/api/users/' + id)\n  .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })\n  .catch(err => { console.error(err); throw err; });",
      "confidence": 0.95,
      "evidence": "return fetch('/api/users/' + id).then(r => r.json())",
      "verified": false
    },
    {
      "id": "f2",
      "category": "type_safety",
      "severity": "medium",
      "line": 1,
      "title": "Missing type annotations on function",
      "description": "Parameter 'id' has implicit 'any' type in strict mode, return type not specified",
      "suggestion": "Add explicit types:\nasync function getUser(id: string): Promise<User> { ... }",
      "confidence": 0.85,
      "evidence": "function getUser(id: string)",
      "verified": false
    }
  ]
}

EXAMPLE 2 - Avoiding False Positives:
Input code:
\`\`\`typescript
const any = require('any-library')
\`\`\`

Output (correctly identifies this is NOT a type safety issue):
{
  "summary": "Valid use of require to import external library",
  "score": 95,
  "findings": [],
  "verified": false
}

EXAMPLE 3 - Confidence-based filtering:
Input code:
\`\`\`javascript
function processData(data) {
  return data.map(x => x.value);
}
\`\`\`

Output (correctly avoids flagging ambiguous patterns):
{
  "summary": "Simple mapping function, consider adding types for clarity",
  "score": 80,
  "findings": [
    {
      "id": "f1",
      "category": "type_safety",
      "severity": "low",
      "line": 2,
      "title": "Consider adding type annotations",
      "description": "The parameter 'data' and return type are implicit. Adding types would improve clarity.",
      "suggestion": "Add types: function processData(data: Array<{value: any}>): any[]",
      "confidence": 0.75,
      "evidence": "data.map(x => x.value)",
      "verified": false
    }
  ]
}

IMPORTANT:
1. Return ONLY valid JSON, no markdown formatting, no code blocks
2. Include line numbers when possible (use 0 if not applicable)
3. For EACH finding, provide specific evidence (exact code snippet that demonstrates the issue)
4. Set confidence to 1.0 ONLY for unambiguous issues
5. Do NOT report findings with confidence < 0.7
6. Be specific in descriptions and suggestions
7. Focus on actionable, high-impact findings
8. Prioritize security and correctness issues
9. Limit to the most important 10-15 findings per file`;

export const LANGUAGE_PROMPTS: Record<string, string> = {
  typescript: `
TypeScript-specific checks (prioritize these):
- Strict null checks violations (no ! assertions without justification)
- Any type usage (avoid 'any', prefer 'unknown')
- Missing return types on exported functions
- Improper generic constraints
- Type assertion safety (as any, as unknown)
- Readonly modifiers where appropriate
- Missing index signatures for object access
- Non-null assertion on potentially null values
- Explicit 'any' type declarations
`,

  javascript: `
JavaScript-specific checks:
- var usage (prefer const/let)
- Missing error handling in async functions
- Prototype pollution risks
- this binding issues
- Equality operators (== vs ===)
- Missing 'use strict'
- Global variable leaks
- Mutable objects passed as default arguments
`,

  python: `
Python-specific checks:
- Mutable default arguments
- Missing type hints (Python 3.5+)
- Bare except clauses
- Resource leaks (missing context managers)
- SQL injection in f-strings
- Using print() instead of logging
- Magic numbers (should be constants)
- Shadowing built-in functions
`,

  go: `
Go-specific checks:
- Missing error handling
- Empty interface{} usage (use generics in Go 1.18+)
- Goroutine leaks (missing done channel)
- Missing context.Context parameters
- Slice/Map access without nil check
- Missing defer for resource cleanup
- Use of sync.Mutex when sync/atomic suffices
`,

  rust: `
Rust-specific checks:
- unwrap() usage in production code
- Missing Result/Option handling
- Clone on large structs unnecessarily
- Mutable borrows when not needed
- Missing lifetimes where needed
- Unused variables/imports
- Use of .to_string() on already owned strings
`,

  java: `
Java-specific checks:
- NullPointerException risks
- Resource leaks (missing try-with-resources)
- Missing @Override annotations
- Synchronized blocks where not needed
- Boxing/unboxing inefficiencies
- Empty catch blocks
- Hardcoded strings (should be constants)
`,

  csharp: `
C#-specific checks:
- NullReferenceException risks
- Missing null checks
- IDisposable without using statement
- Exception swallowing
- LINQ performance issues
- String concatenation in loops
- Missing async/await
`,

  php: `
PHP-specific checks:
- SQL injection vulnerabilities
- Missing input validation
- XSS vulnerabilities
- Session security issues
- Error reporting in production
- Missing type hints
- Use of eval()
- Hardcoded credentials
`,
};

export function getLanguagePrompt(language: string): string {
  const lang = language.toLowerCase();
  return LANGUAGE_PROMPTS[lang] || '';
}

export function createReviewPrompt(
  filePath: string,
  language: string,
  content: string,
  externalAnalysis?: ExternalAnalysis
): string {
  const truncatedContent = content.length > 6000
    ? content.substring(0, 6000) + '\n\n[Content truncated due to length...]'
    : content;

  const languagePrompt = getLanguagePrompt(language);
  
  let externalToolsSection = '';
  if (externalAnalysis) {
    const issues: string[] = [];
    
    if (externalAnalysis.eslint?.length) {
      issues.push(`ESLint issues found:`);
      for (const e of externalAnalysis.eslint.slice(0, 5)) {
        issues.push(`  - Line ${e.line}: ${e.message} (${e.rule})`);
      }
    }
    
    if (externalAnalysis.typescript?.length) {
      issues.push(`TypeScript errors found:`);
      for (const e of externalAnalysis.typescript.slice(0, 5)) {
        issues.push(`  - Line ${e.line}: ${e.message}`);
      }
    }
    
    if (externalAnalysis.security?.length) {
      issues.push(`Security vulnerabilities found:`);
      for (const e of externalAnalysis.security.slice(0, 5)) {
        issues.push(`  - Line ${e.line}: ${e.vulnerability} - ${e.message}`);
      }
    }
    
    if (issues.length > 0) {
      externalToolsSection = `\n\nEXTERNAL TOOL ANALYSIS:\nThe following issues were detected by automated tools. Please verify and include in your review if confirmed:\n${issues.join('\n')}\n`;
    }
  }

  return `Please review the following ${language} code file: ${filePath}

${languagePrompt}

CODE:
\`\`\`${language}
${truncatedContent}
\`\`\`

Analyze this code for:
1. Bugs and logical errors
2. Security vulnerabilities
3. Performance issues
4. Code style and maintainability
5. Type safety (if applicable)
6. Error handling
7. Documentation completeness

For each finding, you MUST provide:
- confidence: 0.0-1.0 (how certain are you this is a real issue?)
- evidence: EXACT code snippet from the file that demonstrates the issue
- Only report findings with confidence >= 0.7${externalToolsSection}

Return your findings as a JSON object matching the specified format.`;
}

export const VERIFICATION_PROMPT = `You are a code review verifier. Your task is to verify that findings from an initial review are accurate and should be included in the final report.

For each finding, you must:
1. Verify the finding is real - check if the issue actually exists in the code
2. Verify the line number is correct - does the issue exist at that line?
3. Verify the severity - is the severity appropriate?
4. Confirm or reject the finding

EXACT CODE UNDER REVIEW:
\`\`\`
{code}
\`\`\`

FINDINGS TO VERIFY:
{findings}

Respond with a JSON object:
{
  "verified_findings": [
    {
      "original_id": "id from original finding",
      "verified": true,
      "corrected_line": number (corrected if needed),
      "corrected_severity": "severity (adjusted if needed)",
      "verification_note": "brief explanation of why it's verified or rejected"
    }
  ],
  "summary": "Brief summary of verification results"
}

IMPORTANT:
- Only include findings that are VERIFIED in verified_findings
- If a finding is not clearly present in the code, mark as verified: false
- Correct line numbers if they are off by more than 2 lines
- Adjust severity if it seems too high or too low
- Provide clear verification notes`;

export function createVerificationPrompt(code: string, findings: any[]): string {
  return VERIFICATION_PROMPT
    .replace('{code}', code.substring(0, 3000))
    .replace('{findings}', JSON.stringify(findings, null, 2));
}

export function parseReviewResponse(content: string): {
  summary: string;
  score: number;
  findings: any[];
} {
  let jsonStr = content.trim();

  // Strategy 1: Try parsing the whole content directly
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.summary !== undefined || parsed.findings !== undefined) {
      return validateAndNormalize(parsed);
    }
  } catch {}

  // Strategy 2: Extract from markdown code blocks
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      return validateAndNormalize(parsed);
    } catch {}
  }

  // Strategy 3: Find JSON object with non-greedy match
  const jsonMatch = jsonStr.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return validateAndNormalize(parsed);
    } catch {}
  }

  // Strategy 4: Try to find array of findings
  const findingsMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (findingsMatch) {
    try {
      const findings = JSON.parse(findingsMatch[0]);
      if (Array.isArray(findings)) {
        return {
          summary: 'Review completed with extracted findings',
          score: 70,
          findings
        };
      }
    } catch {}
  }

  // Strategy 5: Try to extract score and summary manually
  const scoreMatch = jsonStr.match(/"score"\s*:\s*(\d+)/);
  const summaryMatch = jsonStr.match(/"summary"\s*:\s*"([^"]*)"/);
  
  if (scoreMatch || summaryMatch) {
    return {
      summary: summaryMatch ? summaryMatch[1] : 'Review completed',
      score: scoreMatch ? parseInt(scoreMatch[1], 10) : 50,
      findings: []
    };
  }

  console.error('Failed to parse LLM response, returning empty results');
  console.error('Response preview:', jsonStr.substring(0, 500));
  return {
    summary: 'Failed to parse review results',
    score: 0,
    findings: []
  };
}

function validateAndNormalize(parsed: any): {
  summary: string;
  score: number;
  findings: any[];
} {
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  
  // Validate and set defaults for each finding
  const validatedFindings = findings
    .filter((f: any) => f && typeof f === 'object')
    .map((f: any, index: number) => ({
      id: f.id || `finding-${index}-${Date.now()}`,
      category: validateCategory(f.category),
      severity: validateSeverity(f.severity),
      line: typeof f.line === 'number' ? f.line : 0,
      title: String(f.title || 'Untitled Finding'),
      description: String(f.description || 'No description provided'),
      suggestion: String(f.suggestion || 'No suggestion provided'),
      confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0.85,
      evidence: String(f.evidence || ''),
      verified: false
    }))
    // Filter out findings with confidence < 0.7
    .filter((f: any) => f.confidence >= 0.7);

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'No summary provided',
    score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 70,
    findings: validatedFindings
  };
}

function validateCategory(category: unknown): string {
  const validCategories = [
    'bug', 'security', 'style', 'performance', 'test_coverage',
    'dead_code', 'type_safety', 'documentation', 'complexity',
    'dependency', 'error_handling'
  ];

  if (typeof category === 'string' && validCategories.includes(category)) {
    return category;
  }

  return 'style';
}

function validateSeverity(severity: unknown): string {
  const validSeverities = ['critical', 'high', 'medium', 'low', 'info'];

  if (typeof severity === 'string' && validSeverities.includes(severity)) {
    return severity;
  }

  return 'info';
}
