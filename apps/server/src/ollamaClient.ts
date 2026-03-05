import type { OllamaMessage, OllamaResponse, Finding, Severity, Category, ExternalAnalysis } from './types';
import { REVIEW_SYSTEM_PROMPT, createReviewPrompt, parseReviewResponse, createVerificationPrompt } from './prompts/reviewPrompt';
import { analyzeWithExternalTools, validateFindingWithCode } from './externalTools';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'lfm2:latest';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const ENABLE_VERIFICATION = true;
const CONFIDENCE_THRESHOLD = 0.5;
const ENABLE_EVIDENCE_VALIDATION = false;

interface ReviewResponse {
  summary: string;
  score: number;
  findings: Finding[];
}

export async function reviewFile(
  filePath: string,
  language: string,
  content: string,
  rootPath?: string
): Promise<ReviewResponse> {
  let externalAnalysis: ExternalAnalysis | undefined;

  if (rootPath && (language.toLowerCase() === 'typescript' || language.toLowerCase() === 'javascript' ||
      language.toLowerCase() === 'tsx' || language.toLowerCase() === 'jsx')) {
    try {
      externalAnalysis = await analyzeWithExternalTools(filePath, rootPath);
    } catch (error) {
      console.warn(`External tool analysis failed for ${filePath}:`, error);
    }
  }

  const messages: OllamaMessage[] = [
    { role: 'system', content: REVIEW_SYSTEM_PROMPT },
    { role: 'user', content: createReviewPrompt(filePath, language, content, externalAnalysis) }
  ];

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await callOllama(messages);
      const parsed = parseReviewResponse(response);

      let findings: Finding[] = parsed.findings
        .filter((f: any) => f && typeof f === 'object')
        .map((f: any, index: number) => ({
          id: f.id || `finding-${index}-${Date.now()}`,
          category: validateCategory(f.category),
          severity: validateSeverity(f.severity),
          line: typeof f.line === 'number' ? f.line : 0,
          title: String(f.title || 'Untitled Finding'),
          description: String(f.description || 'No description provided'),
          suggestion: String(f.suggestion || 'No suggestion provided'),
          confidence: typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : CONFIDENCE_THRESHOLD,
          evidence: String(f.evidence || ''),
          verified: false
        }));

      if (ENABLE_VERIFICATION && findings.length > 0) {
        findings = await verifyFindings(filePath, language, content, findings);
      }

      const validatedFindings = findings.filter(f => {
        if (f.confidence < CONFIDENCE_THRESHOLD) {
          console.warn(`Filtered out "${f.title}" due to low confidence: ${f.confidence}`);
          return false;
        }
        
        if (ENABLE_EVIDENCE_VALIDATION) {
          const validation = validateFindingWithCode(f, content);
          if (!validation.valid) {
            console.warn(`Filtered out finding "${f.title}" for ${filePath}: ${validation.note}`);
            return false;
          }
          
          if (validation.correctedLine && validation.correctedLine !== f.line) {
            console.log(`Corrected line number for "${f.title}" in ${filePath}: ${f.line} -> ${validation.correctedLine}`);
            f.line = validation.correctedLine;
          }
        }
        
        return true;
      });

      return {
        summary: parsed.summary,
        score: Math.max(0, Math.min(100, parsed.score)),
        findings: validatedFindings
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

async function verifyFindings(
  filePath: string,
  language: string,
  content: string,
  findings: Finding[]
): Promise<Finding[]> {
  if (findings.length === 0) {
    return findings;
  }

  const verificationFindings = findings.map(f => ({
    id: f.id,
    title: f.title,
    description: f.description,
    line: f.line,
    severity: f.severity,
    category: f.category,
    evidence: f.evidence
  }));

  const verificationMessages: OllamaMessage[] = [
    { role: 'system', content: REVIEW_SYSTEM_PROMPT },
    { role: 'user', content: createVerificationPrompt(content, verificationFindings) }
  ];

  try {
    const response = await callOllama(verificationMessages);
    const parsed = parseVerificationResponse(response, findings);
    
    if (parsed.verifiedIds.size > 0) {
      const verifiedFindings = findings.map(f => {
        const verified = parsed.verifiedIds.has(f.id);
        if (!verified) {
          return null;
        }
        
        const correction = parsed.corrections.get(f.id);
        if (correction) {
          if (correction.line && Math.abs(correction.line - f.line) > 2) {
            f.line = correction.line;
          }
          if (correction.severity) {
            f.severity = validateSeverity(correction.severity);
          }
        }
        
        return {
          ...f,
          verified: true,
          confidence: Math.min(1.0, f.confidence + 0.1)
        };
      }).filter((f): f is Finding => f !== null);
      
      console.log(`Verified ${verifiedFindings.length}/${findings.length} findings for ${filePath}`);
      return verifiedFindings;
    }
  } catch (error) {
    console.warn(`Verification failed for ${filePath}:`, error);
  }

  return findings.map(f => ({ ...f, verified: false }));
}

function parseVerificationResponse(
  content: string,
  originalFindings: Finding[]
): { verifiedIds: Set<string>; corrections: Map<string, { line?: number; severity?: string }> } {
  const verifiedIds = new Set<string>();
  const corrections = new Map<string, { line?: number; severity?: string }>();

  try {
    const parsed = JSON.parse(content);
    
    if (parsed.verified_findings && Array.isArray(parsed.verified_findings)) {
      for (const vf of parsed.verified_findings) {
        if (vf.verified === true || vf.verified === 'true') {
          verifiedIds.add(vf.original_id);
          
          if (vf.corrected_line || vf.corrected_severity) {
            corrections.set(vf.original_id, {
              line: vf.corrected_line,
              severity: vf.corrected_severity
            });
          }
        }
      }
    }
  } catch {
    for (const f of originalFindings) {
      verifiedIds.add(f.id);
    }
  }

  return { verifiedIds, corrections };
}

async function callOllama(messages: OllamaMessage[]): Promise<string> {
  const url = `${OLLAMA_BASE_URL}/v1/chat/completions`;

  const body = {
    model: OLLAMA_MODEL,
    messages,
    temperature: 0.2,
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
