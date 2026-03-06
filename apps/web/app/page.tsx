'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type AgentMode = 'review' | 'commit_explainer';

interface Finding {
  id: string;
  category: string;
  severity: string;
  line: number;
  title: string;
  description: string;
  suggestion: string;
  file?: string;
}

interface ReviewResult {
  file: string;
  language: string;
  summary: string;
  score: number;
  findings: Finding[];
}

interface CommitFileExplanation {
  file: string;
  status: 'added' | 'modified';
  language: string;
  diffStats: {
    additions: number;
    deletions: number;
  };
  summary: string;
  changeTypes: string[];
  details: string[];
  skipped?: boolean;
  skippedReason?: string;
}

interface CommitSummary {
  headline: string;
  overview: string;
  themes: string[];
  risks: string[];
  notableFiles: string[];
}

interface CommitResult {
  commit: {
    hash: string;
    shortHash: string;
    author: string;
    date: string;
    title: string;
    body: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  summary: CommitSummary | null;
  files: CommitFileExplanation[];
}

interface Session {
  id: string;
  mode: AgentMode;
  rootPath: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  errors?: Array<{ file: string; error: string }>;
  stats: {
    totalFiles: number;
    processedFiles: number;
    progress: number;
    totalFindings: number;
  } | null;
}

interface HealthStatus {
  ollama: string;
  model: string;
  status: string;
}

const API = 'http://localhost:3001';

const MODE_COPY: Record<AgentMode, { title: string; subtitle: string; cta: string }> = {
  review: {
    title: 'Code Review Agent',
    subtitle: 'Inspect a local codebase for bugs, security issues, and maintainability concerns.',
    cta: 'Start Review'
  },
  commit_explainer: {
    title: 'Commit Explanation Agent',
    subtitle: 'Explain the latest commit at both whole-commit scale and per-file scale from its Git diff.',
    cta: 'Explain Latest Commit'
  }
};

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'badge-critical',
  high: 'badge-high',
  medium: 'badge-medium',
  low: 'badge-low',
  info: 'badge-info'
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug',
  security: 'Security',
  style: 'Style',
  performance: 'Performance',
  test_coverage: 'Tests',
  dead_code: 'Dead Code',
  type_safety: 'Types',
  documentation: 'Docs',
  complexity: 'Complexity',
  dependency: 'Deps',
  error_handling: 'Errors'
};

function getScoreClass(score: number): string {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

function parseEvent(data: string) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data as T;
}

function getSessionBasePath(mode: AgentMode): string {
  return mode === 'review' ? '/api/review' : '/api/commit-explainer';
}

function formatDate(date: string): string {
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
}

export default function Home() {
  const [mode, setMode] = useState<AgentMode>('review');
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [reviewResults, setReviewResults] = useState<ReviewResult[]>([]);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [health, setHealth] = useState<string>('checking');
  const [severityFilter, setSeverityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [reviewSearch, setReviewSearch] = useState('');
  const [commitSearch, setCommitSearch] = useState('');
  const [connected, setConnected] = useState(false);
  const [modelName, setModelName] = useState('');
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);

  const fetchSessionData = useCallback(async (sessionId: string, sessionMode: AgentMode) => {
    const basePath = getSessionBasePath(sessionMode);
    const [sessionData, resultsData] = await Promise.all([
      fetchJson<Session>(`${API}${basePath}/${sessionId}`),
      fetchJson<{ results?: ReviewResult[]; result?: CommitResult | null }>(`${API}${basePath}/${sessionId}/results`)
    ]);

    setSession(sessionData);

    if (sessionMode === 'review') {
      setReviewResults(resultsData.results || []);
    } else {
      setCommitResult(resultsData.result || null);
    }
  }, []);

  const pollResults = useCallback(() => {
    if (!session?.id) return;

    fetchSessionData(session.id, session.mode).catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to refresh session');
    });
  }, [fetchSessionData, session?.id, session?.mode]);

  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then((data: HealthStatus) => {
        setHealth(data.ollama);
        setModelName(data.model || '');
      })
      .catch(() => setHealth('disconnected'));
  }, []);

  useEffect(() => {
    return () => {
      esRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (session?.status === 'running' && !connected) {
      pollRef.current = window.setInterval(pollResults, 3000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connected, pollResults, session?.status]);

  useEffect(() => {
    if (session?.mode === 'commit_explainer' && !selectedFile && commitResult?.files.length) {
      setSelectedFile(commitResult.files[0].file);
    }
  }, [commitResult, selectedFile, session?.mode]);

  const resetSession = useCallback(() => {
    esRef.current?.close();
    if (pollRef.current) clearInterval(pollRef.current);
    setSession(null);
    setReviewResults([]);
    setCommitResult(null);
    setSelectedFile(null);
    setError(null);
    setConnected(false);
    setSeverityFilter('');
    setCategoryFilter('');
    setReviewSearch('');
    setCommitSearch('');
  }, []);

  const handleEvent = useCallback((event: MessageEvent) => {
    const parsed = parseEvent(event.data);
    if (!parsed) return;

    setConnected(true);

    if (parsed.type === 'file_complete' || parsed.type === 'progress') {
      pollResults();
    }

    if (parsed.type === 'completed' || parsed.type === 'error') {
      pollResults();
      setConnected(false);
    }
  }, [pollResults]);

  const startAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;

    setLoading(true);
    setError(null);
    setReviewResults([]);
    setCommitResult(null);
    setSelectedFile(null);
    setConnected(false);

    try {
      const startResponse = await fetchJson<{ sessionId: string }>(
        `${API}${getSessionBasePath(mode)}/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        }
      );

      await fetchSessionData(startResponse.sessionId, mode);

      esRef.current?.close();
      const eventSource = new EventSource(`${API}${getSessionBasePath(mode)}/${startResponse.sessionId}/stream`);
      esRef.current = eventSource;
      eventSource.onmessage = handleEvent;
      eventSource.onerror = () => {
        setConnected(false);
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start analysis');
    } finally {
      setLoading(false);
    }
  };

  const selectedReviewResult = selectedFile
    ? reviewResults.find(result => result.file === selectedFile) || null
    : null;
  const reviewAverageScore = reviewResults.length
    ? Math.round(reviewResults.reduce((sum, result) => sum + result.score, 0) / reviewResults.length)
    : 0;
  const allFindings = reviewResults.flatMap(result =>
    result.findings.map(finding => ({ ...finding, file: result.file }))
  );
  const displayFindings = (selectedFile ? selectedReviewResult?.findings || [] : allFindings)
    .filter(finding => {
      if (severityFilter && finding.severity !== severityFilter) return false;
      if (categoryFilter && finding.category !== categoryFilter) return false;
      if (
        reviewSearch &&
        !finding.title.toLowerCase().includes(reviewSearch.toLowerCase()) &&
        !finding.description.toLowerCase().includes(reviewSearch.toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const order = ['critical', 'high', 'medium', 'low', 'info'];
      return order.indexOf(a.severity) - order.indexOf(b.severity);
    });

  const visibleCommitFiles = (commitResult?.files || []).filter(file => {
    if (!commitSearch) return true;
    const query = commitSearch.toLowerCase();
    return (
      file.file.toLowerCase().includes(query) ||
      file.summary.toLowerCase().includes(query) ||
      file.changeTypes.some(change => change.toLowerCase().includes(query))
    );
  });
  const selectedCommitFile = selectedFile
    ? commitResult?.files.find(file => file.file === selectedFile) || null
    : null;
  const downloadBase = session ? `${API}${getSessionBasePath(session.mode)}/${session.id}/download` : '';

  return (
    <>
      <header className="header">
        <div className="container header-content">
          <div className="logo">
            <div className="logo-icon">⚡</div>
            <span>AI Code Analysis</span>
          </div>
          <div className="header-right">
            {session && <span className="badge badge-category">{session.mode === 'review' ? 'Code Review' : 'Commit Explainer'}</span>}
            <div className="status-indicator">
              <span className={`status-dot ${health === 'connected' ? 'connected' : 'disconnected'}`}></span>
              <span className="status-text">
                {health === 'connected' ? (
                  <>
                    {modelName && <span className="model-badge">{modelName.replace(':latest', '')}</span>}
                    {session?.status === 'running' && <span className="running-indicator">Running</span>}
                  </>
                ) : (
                  'Ollama: disconnected'
                )}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">
          {!session ? (
            <div className="landing">
              <div className="powered-by">Powered With LFM2-24B-A2B Model by Liquid AI</div>
              <h1>Review code or explain the latest commit</h1>
              <p>Choose an agent, point it at a local repository, and get either issue-focused review output or a file-by-file commit walkthrough.</p>

              <div className="mode-selector">
                <button
                  type="button"
                  className={`mode-card ${mode === 'review' ? 'active' : ''}`}
                  onClick={() => setMode('review')}
                >
                  <span className="mode-title">{MODE_COPY.review.title}</span>
                  <span className="mode-text">{MODE_COPY.review.subtitle}</span>
                </button>
                <button
                  type="button"
                  className={`mode-card ${mode === 'commit_explainer' ? 'active' : ''}`}
                  onClick={() => setMode('commit_explainer')}
                >
                  <span className="mode-title">{MODE_COPY.commit_explainer.title}</span>
                  <span className="mode-text">{MODE_COPY.commit_explainer.subtitle}</span>
                </button>
              </div>

              <form onSubmit={startAnalysis} style={{ width: '100%', maxWidth: 720 }}>
                <div className="input-wrapper" style={{ marginBottom: 16 }}>
                  <span className="input-icon">📁</span>
                  <input
                    type="text"
                    className="path-input"
                    placeholder="/path/to/your/git/repository"
                    value={path}
                    onChange={e => setPath(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading || !path.trim()} style={{ width: '100%' }}>
                  {loading ? <><span className="spinner"></span> Starting...</> : MODE_COPY[mode].cta}
                </button>
                {error && <div className="error-msg">{error}</div>}
              </form>
            </div>
          ) : (
            <div className="dashboard">
              <div className="sidebar">
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Session</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {session.status === 'running' && (
                        <span style={{ fontSize: '0.75rem', color: connected ? 'var(--success)' : 'var(--warning)' }}>
                          {connected ? '● Live' : '○ Polling'}
                        </span>
                      )}
                      <span className={`badge ${session.status === 'completed' ? 'badge-high' : session.status === 'running' ? 'badge-medium' : 'badge-info'}`}>
                        {session.status}
                      </span>
                    </div>
                  </div>
                  <div className="card-body">
                    <div className="stats-grid">
                      <div className="stat">
                        <div className="stat-value">{session.stats?.processedFiles || 0}</div>
                        <div className="stat-label">Processed</div>
                      </div>
                      {session.mode === 'review' ? (
                        <div className="stat">
                          <div className={`stat-value ${getScoreClass(reviewAverageScore)}`}>{reviewAverageScore}</div>
                          <div className="stat-label">Avg Score</div>
                        </div>
                      ) : (
                        <div className="stat">
                          <div className="stat-value success">{commitResult?.commit.shortHash || '--'}</div>
                          <div className="stat-label">Commit</div>
                        </div>
                      )}
                    </div>
                    <div className="session-actions">
                      <button type="button" className="btn btn-ghost" onClick={resetSession}>
                        New Run
                      </button>
                    </div>
                  </div>
                  <div className="progress-wrapper">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${session.stats?.progress || 0}%` }}></div>
                    </div>
                    <div className="progress-text">
                      <span>{session.stats?.progress || 0}%</span>
                      <span>
                        {session.mode === 'review'
                          ? `${session.stats?.totalFindings || 0} findings`
                          : `${commitResult?.files.length || 0} files explained`}
                      </span>
                    </div>
                  </div>
                  {session.status === 'completed' && (
                    <div className="download-row">
                      <a href={`${downloadBase}/json`} download className="btn btn-ghost">
                        JSON
                      </a>
                      <a href={`${downloadBase}/markdown`} download className="btn btn-ghost">
                        Markdown
                      </a>
                    </div>
                  )}
                </div>

                {session.mode === 'commit_explainer' && commitResult && (
                  <div className="card">
                    <div className="card-header">
                      <span className="card-title">Commit Metadata</span>
                    </div>
                    <div className="card-body">
                      <div className="commit-meta-grid">
                        <div className="meta-chip">
                          <span className="meta-label">Hash</span>
                          <span className="meta-value mono">{commitResult.commit.shortHash}</span>
                        </div>
                        <div className="meta-chip">
                          <span className="meta-label">Author</span>
                          <span className="meta-value">{commitResult.commit.author}</span>
                        </div>
                        <div className="meta-chip">
                          <span className="meta-label">Date</span>
                          <span className="meta-value">{formatDate(commitResult.commit.date)}</span>
                        </div>
                        <div className="meta-chip">
                          <span className="meta-label">Diff</span>
                          <span className="meta-value">+{commitResult.commit.insertions} / -{commitResult.commit.deletions}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="card">
                  <div className="card-header">
                    <span className="card-title">
                      {session.mode === 'review' ? `Files (${reviewResults.length})` : `Changed Files (${visibleCommitFiles.length})`}
                    </span>
                  </div>

                  {session.mode === 'review' ? (
                    <div className="file-list">
                      {reviewResults.length === 0 && session.status === 'running' ? (
                        <div className="empty-state" style={{ padding: '2rem' }}>
                          <div className="spinner" style={{ margin: '0 auto' }}></div>
                          <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>Analyzing files...</p>
                        </div>
                      ) : (
                        reviewResults.map(result => (
                          <div
                            key={result.file}
                            className={`file-item ${selectedFile === result.file ? 'active' : ''}`}
                            onClick={() => setSelectedFile(selectedFile === result.file ? null : result.file)}
                          >
                            <div className="file-info">
                              <div className="file-name">{result.file.split('/').pop()}</div>
                              <div className="file-meta">{result.findings.length} issues</div>
                            </div>
                            <span className={`file-score ${getScoreClass(result.score)}`}>{result.score}</span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="card-body" style={{ paddingBottom: 0 }}>
                        <div className="filter-input-wrapper">
                          <span className="search-icon">🔍</span>
                          <input
                            type="text"
                            className="filter-input"
                            placeholder="Search changed files..."
                            value={commitSearch}
                            onChange={e => setCommitSearch(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="file-list">
                        {visibleCommitFiles.map(file => (
                          <div
                            key={file.file}
                            className={`file-item ${selectedFile === file.file ? 'active' : ''}`}
                            onClick={() => setSelectedFile(file.file)}
                          >
                            <div className="file-info">
                              <div className="file-name">{file.file.split('/').pop()}</div>
                              <div className="file-meta">{file.status} · +{file.diffStats.additions} / -{file.diffStats.deletions}</div>
                            </div>
                            <span className={`badge ${file.skipped ? 'badge-info' : 'badge-low'}`}>{file.skipped ? 'Skipped' : file.status}</span>
                          </div>
                        ))}
                        {visibleCommitFiles.length === 0 && (
                          <div className="empty-state" style={{ padding: '2rem' }}>
                            <div className="empty-icon">🧭</div>
                            <div className="empty-text">No changed files match that search.</div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="content">
                {session.mode === 'review' ? (
                  <>
                    {selectedReviewResult && (
                      <div className="card summary-card">
                        <div className="card-body">
                          <div className="summary-header">
                            <span className="summary-file">{selectedReviewResult.file}</span>
                            <span className="summary-lang">{selectedReviewResult.language}</span>
                            <span className={`summary-score ${getScoreClass(selectedReviewResult.score)}`}>{selectedReviewResult.score}</span>
                          </div>
                          {selectedReviewResult.summary && <p className="summary-text">{selectedReviewResult.summary}</p>}
                        </div>
                      </div>
                    )}

                    <div className="filter-bar">
                      <div className="filter-input-wrapper">
                        <span className="search-icon">🔍</span>
                        <input
                          type="text"
                          className="filter-input"
                          placeholder="Search findings..."
                          value={reviewSearch}
                          onChange={e => setReviewSearch(e.target.value)}
                        />
                      </div>
                      <select className="filter-select" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}>
                        <option value="">All Severities</option>
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                        <option value="info">Info</option>
                      </select>
                      <select className="filter-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                        <option value="">All Categories</option>
                        {Object.entries(CATEGORY_LABELS).map(([key, value]) => (
                          <option key={key} value={key}>{value}</option>
                        ))}
                      </select>
                      {(severityFilter || categoryFilter || reviewSearch) && (
                        <button className="btn btn-ghost" onClick={() => { setSeverityFilter(''); setCategoryFilter(''); setReviewSearch(''); }}>
                          Clear
                        </button>
                      )}
                    </div>

                    {displayFindings.length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-icon">📋</div>
                        <div className="empty-title">No findings</div>
                        <div className="empty-text">
                          {selectedFile ? 'No issues found in this file' : 'No issues match your filters'}
                        </div>
                      </div>
                    ) : (
                      displayFindings.map((finding, index) => (
                        <div key={finding.id || index} className="finding-card">
                          <div className="finding-meta">
                            <span className={`badge ${SEVERITY_CLASS[finding.severity]}`}>{finding.severity}</span>
                            <span className="badge badge-category">{CATEGORY_LABELS[finding.category] || finding.category}</span>
                            {finding.line > 0 && <span className="badge badge-info">Line {finding.line}</span>}
                            {!selectedFile && finding.file && <span className="badge badge-info">{finding.file.split('/').pop()}</span>}
                          </div>
                          <div className="finding-title">{finding.title}</div>
                          <div className="finding-desc">{finding.description}</div>
                          {finding.suggestion && (
                            <div className="finding-suggestion">
                              💡 {finding.suggestion}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </>
                ) : (
                  <>
                    {commitResult ? (
                      <>
                        <div className="card summary-card">
                          <div className="card-body">
                            <div className="summary-header">
                              <span className="summary-file">{commitResult.commit.title}</span>
                              <span className="summary-lang">{commitResult.commit.shortHash}</span>
                              <span className="summary-pill">Latest commit</span>
                            </div>
                            <p className="summary-text">
                              {commitResult.summary?.overview || 'Building a whole-commit explanation...'}
                            </p>
                            {commitResult.summary && (
                              <div className="pill-row">
                                {commitResult.summary.themes.map(theme => (
                                  <span key={theme} className="badge badge-category">{theme}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {selectedCommitFile ? (
                          <div className="card">
                            <div className="card-body">
                              <div className="summary-header">
                                <span className="summary-file">{selectedCommitFile.file}</span>
                                <span className="summary-lang">{selectedCommitFile.language}</span>
                                <span className={`badge ${selectedCommitFile.skipped ? 'badge-info' : 'badge-low'}`}>{selectedCommitFile.status}</span>
                              </div>
                              <p className="summary-text">{selectedCommitFile.summary}</p>

                              <div className="pill-row">
                                {selectedCommitFile.changeTypes.map(change => (
                                  <span key={change} className="badge badge-category">{change}</span>
                                ))}
                              </div>

                              <div className="detail-section">
                                <div className="detail-heading">Detailed explanation</div>
                                <ul className="detail-list">
                                  {selectedCommitFile.details.map(detail => (
                                    <li key={detail}>{detail}</li>
                                  ))}
                                </ul>
                              </div>

                              {selectedCommitFile.skippedReason && (
                                <div className="finding-suggestion" style={{ marginTop: '1rem' }}>
                                  {selectedCommitFile.skippedReason}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="empty-state">
                            <div className="empty-icon">🧾</div>
                            <div className="empty-title">Select a changed file</div>
                            <div className="empty-text">Choose a file on the left to read its detailed commit explanation.</div>
                          </div>
                        )}

                        {commitResult.summary?.risks && commitResult.summary.risks.length > 0 && (
                          <div className="card" style={{ marginTop: '1rem' }}>
                            <div className="card-body">
                              <div className="detail-heading">Risks / follow-ups</div>
                              <ul className="detail-list">
                                {commitResult.summary.risks.map(risk => (
                                  <li key={risk}>{risk}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">🧠</div>
                        <div className="empty-title">Preparing commit explanation</div>
                        <div className="empty-text">The latest commit is being read and explained.</div>
                      </div>
                    )}
                  </>
                )}

                {session.errors && session.errors.length > 0 && (
                  <div className="card" style={{ marginTop: '1rem' }}>
                    <div className="card-body">
                      <div className="detail-heading">Run notes</div>
                      <ul className="detail-list">
                        {session.errors.slice(0, 5).map((item, index) => (
                          <li key={`${item.file}-${index}`}>
                            <strong>{item.file}:</strong> {item.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
