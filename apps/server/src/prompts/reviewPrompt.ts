export const REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer with deep knowledge of software engineering best practices, security, performance, and maintainability.

Your task is to analyze code and provide structured feedback. For each file, you must return a JSON object with the following structure:

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
      "suggestion": "Use parameterized queries or prepared statements"
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

IMPORTANT:
1. Return ONLY valid JSON, no markdown formatting, no code blocks
2. Include line numbers when possible (use 0 if not applicable)
3. Be specific in descriptions and suggestions
4. Focus on actionable, high-impact findings
5. Prioritize security and correctness issues
6. Limit to the most important 10-15 findings per file`;

export function createReviewPrompt(filePath: string, language: string, content: string): string {
  const truncatedContent = content.length > 8000 
    ? content.substring(0, 8000) + '\n\n[Content truncated due to length...]'
    : content;

  return `Please review the following ${language} code file: ${filePath}

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

Return your findings as a JSON object matching the specified format.`;
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
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'No summary provided',
    score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 70,
    findings: Array.isArray(parsed.findings) ? parsed.findings : []
  };
}
