export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Category = 
  | 'bug' 
  | 'security' 
  | 'style' 
  | 'performance' 
  | 'test_coverage' 
  | 'dead_code' 
  | 'type_safety' 
  | 'documentation' 
  | 'complexity' 
  | 'dependency' 
  | 'error_handling';

export type SessionStatus = 'pending' | 'running' | 'completed' | 'error';

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  line: number;
  title: string;
  description: string;
  suggestion: string;
  confidence: number;
  evidence: string;
  verified: boolean;
}

export interface ExternalAnalysis {
  eslint?: ExternalToolResult[];
  typescript?: ExternalToolResult[];
  security?: ExternalToolResult[];
}

export interface ExternalToolResult {
  rule?: string;
  code?: string;
  vulnerability?: string;
  message: string;
  line: number;
  severity: string;
}

export interface ReviewResult {
  file: string;
  language: string;
  summary: string;
  score: number;
  findings: Finding[];
}

export interface ReviewEvent {
  type: 'started' | 'file_start' | 'file_complete' | 'error' | 'completed' | 'progress';
  timestamp: string;
  data: unknown;
}

export interface ReviewSession {
  id: string;
  rootPath: string;
  status: SessionStatus;
  startedAt: string;
  completedAt?: string;
  files: string[];
  results: Map<string, ReviewResult>;
  events: ReviewEvent[];
  errors: Array<{ file: string; error: string }>;
  totalFiles: number;
  processedFiles: number;
}

export interface FileInfo {
  path: string;
  relativePath: string;
  language: string;
  size: number;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OllamaMessage;
    finish_reason: string;
  }>;
}
