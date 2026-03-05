import type { OllamaMessage, OllamaResponse, Finding, Severity, Category } from './types';
import { REVIEW_SYSTEM_PROMPT, createReviewPrompt, parseReviewResponse } from './prompts/reviewPrompt';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'lfm2:latest';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

interface ReviewResponse {
  summary: string;
  score: number;
  findings: Finding[];
}

export async function reviewFile(
  filePath: string,
  language: string,
  content: string
): Promise<ReviewResponse> {
  const messages: OllamaMessage[] = [
    { role: 'system', content: REVIEW_SYSTEM_PROMPT },
    { role: 'user', content: createReviewPrompt(filePath, language, content) }
  ];

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await callOllama(messages);
      const parsed = parseReviewResponse(response);

      // Validate and normalize findings
      const findings: Finding[] = parsed.findings
        .filter((f: any) => f && typeof f === 'object')
        .map((f: any, index: number) => ({
          id: f.id || `finding-${index}-${Date.now()}`,
          category: validateCategory(f.category),
          severity: validateSeverity(f.severity),
          line: typeof f.line === 'number' ? f.line : 0,
          title: String(f.title || 'Untitled Finding'),
          description: String(f.description || 'No description provided'),
          suggestion: String(f.suggestion || 'No suggestion provided')
        }));

      return {
        summary: parsed.summary,
        score: Math.max(0, Math.min(100, parsed.score)),
        findings
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Attempt ${attempt}/${MAX_RETRIES} failed for ${filePath}:`, lastError.message);

      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY * attempt);
      }
    }
  }

  throw new Error(`Failed to review file after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function callOllama(messages: OllamaMessage[]): Promise<string> {
  const url = `${OLLAMA_BASE_URL}/v1/chat/completions`;

  const body = {
    model: OLLAMA_MODEL,
    messages,
    temperature: 0.3,
    max_tokens: 4000,
    stream: false
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as OllamaResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No choices returned from Ollama');
    }

    return data.choices[0].message.content;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Cannot connect to Ollama at ${OLLAMA_BASE_URL}. Is Ollama running?`);
    }
    throw error;
  }
}

function validateCategory(category: unknown): Category {
  const validCategories: Category[] = [
    'bug', 'security', 'style', 'performance', 'test_coverage',
    'dead_code', 'type_safety', 'documentation', 'complexity',
    'dependency', 'error_handling'
  ];

  if (typeof category === 'string' && validCategories.includes(category as Category)) {
    return category as Category;
  }

  return 'style';
}

function validateSeverity(severity: unknown): Severity {
  const validSeverities: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

  if (typeof severity === 'string' && validSeverities.includes(severity as Severity)) {
    return severity as Severity;
  }

  return 'info';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function checkOllamaConnection(): Promise<boolean> {
  return fetch(`${OLLAMA_BASE_URL}/v1/models`)
    .then(() => true)
    .catch(() => false);
}
