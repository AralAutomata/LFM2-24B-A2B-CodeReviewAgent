'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

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

interface Session {
  id: string;
  rootPath: string;
  status: string;
  stats: {
    totalFiles: number;
    processedFiles: number;
    progress: number;
    totalFindings: number;
  };
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'badge-critical',
  high: 'badge-high',
  medium: 'badge-medium',
  low: 'badge-low',
  info: 'badge-info',
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
  error_handling: 'Errors',
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

export default function Home() {
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [health, setHealth] = useState<string>('checking');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);

  const API = 'http://localhost:3001';

  const pollResults = useCallback(() => {
    if (!session?.id) return;
    Promise.all([
      fetch(`${API}/api/review/${session.id}`).then(r => r.json()),
      fetch(`${API}/api/review/${session.id}/results`).then(r => r.json())
    ])
      .then(([sessData, resultsData]) => {
        setSession(sessData);
        if (resultsData.results) setResults(resultsData.results);
      })
      .catch(() => {});
  }, [session?.id]);

  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(d => setHealth(d.ollama))
      .catch(() => setHealth('disconnected'));
  }, []);

  useEffect(() => {
    return () => {
      esRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Poll for updates if SSE fails
  useEffect(() => {
    if (session?.status === 'running' && !connected) {
      pollRef.current = window.setInterval(pollResults, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [session?.status, connected, pollResults]);

  const handleEvent = useCallback((e: MessageEvent) => {
    const event = parseEvent(e.data);
    if (!event) return;

    setConnected(true);

    if (event.type === 'file_complete') {
      const data = event.data as { file: string; language: string; score: number; findingsCount: number };
      setResults(prev => {
        if (prev.some(r => r.file === data.file)) return prev;
        return [...prev, { file: data.file, language: data.language, score: data.score, summary: '', findings: [] }];
      });
      // Also poll to get full results
      pollResults();
    }

    if (event.type === 'progress') {
      pollResults();
    }

    if (event.type === 'completed' || event.type === 'error') {
      pollResults();
      setConnected(false);
    }
  }, [pollResults]);

  const startReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;

    setLoading(true);
    setError(null);
    setResults([]);
    setSelectedFile(null);
    setConnected(false);

    try {
      const { sessionId } = await fetch(`${API}/api/review/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }).then(r => r.json());

      const sess = await fetch(`${API}/api/review/${sessionId}`).then(r => r.json());
      setSession(sess);

      esRef.current?.close();
      const es = new EventSource(`${API}/api/review/${sessionId}/stream`);
      esRef.current = es;

      es.onmessage = handleEvent;
      es.onerror = () => {
        setConnected(false);
        // Fallback to polling
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setLoading(false);
    }
  };

  const filteredResults = results.map(r => ({
    ...r,
    findings: r.findings.filter(f => {
      if (severityFilter && f.severity !== severityFilter) return false;
      if (categoryFilter && f.category !== categoryFilter) return false;
      if (search && !f.title.toLowerCase().includes(search.toLowerCase()) && 
          !f.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
  })).filter(r => r.findings.length > 0 || !selectedFile);

  const selectedResult = selectedFile ? results.find(r => r.file === selectedFile) : null;
  const allFindings = results.flatMap(r => r.findings);
  const avgScore = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;

  const getFilteredFindings = () => {
    if (selectedFile) {
      return selectedResult?.findings || [];
    }
    return allFindings.filter(f => {
      if (severityFilter && f.severity !== severityFilter) return false;
      if (categoryFilter && f.category !== categoryFilter) return false;
      if (search && !f.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  };

  const displayFindings = getFilteredFindings().sort((a, b) => {
    const order = ['critical', 'high', 'medium', 'low', 'info'];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });

  return (
    <>
      <header className="header">
        <div className="container header-content">
          <div className="logo">
            <div className="logo-icon">⚡</div>
            <span>Code Review</span>
          </div>
          <div className="status-indicator">
            <span className={`status-dot ${health === 'connected' ? 'connected' : 'disconnected'}`}></span>
            <span>Ollama: {health}</span>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">
          {!session ? (
            <div className="landing">
              <h1>AI-Powered Code Review</h1>
              <p>Enter a local codebase path to analyze your code with AI. Get instant feedback on bugs, security, performance, and more.</p>
              
              <form onSubmit={startReview} style={{ width: '100%', maxWidth: 600 }}>
                <div className="input-wrapper" style={{ marginBottom: 16 }}>
                  <span className="input-icon">📁</span>
                  <input
                    type="text"
                    className="path-input"
                    placeholder="/path/to/your/project"
                    value={path}
                    onChange={e => setPath(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={loading || !path.trim()} style={{ width: '100%' }}>
                  {loading ? <><span className="spinner"></span> Starting...</> : 'Start Review'}
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
                        <div className="stat-value">{session.stats.processedFiles}</div>
                        <div className="stat-label">Files</div>
                      </div>
                      <div className="stat">
                        <div className={`stat-value ${getScoreClass(avgScore)}`}>{avgScore}</div>
                        <div className="stat-label">Avg Score</div>
                      </div>
                    </div>
                  </div>
                  <div className="progress-wrapper">
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${session.stats.progress}%` }}></div>
                    </div>
                    <div className="progress-text">
                      <span>{session.stats.progress}%</span>
                      <span>{session.stats.totalFindings} findings</span>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <span className="card-title">Files ({results.length})</span>
                  </div>
                  <div className="file-list">
                    {results.length === 0 && session.status === 'running' ? (
                      <div className="empty-state" style={{ padding: '2rem' }}>
                        <div className="spinner" style={{ margin: '0 auto' }}></div>
                        <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>Analyzing files...</p>
                      </div>
                    ) : (
                      results.map(r => (
                        <div
                          key={r.file}
                          className={`file-item ${selectedFile === r.file ? 'active' : ''}`}
                          onClick={() => setSelectedFile(selectedFile === r.file ? null : r.file)}
                        >
                          <div className="file-info">
                            <div className="file-name">{r.file.split('/').pop()}</div>
                            <div className="file-meta">{r.findings.length} issues</div>
                          </div>
                          <span className={`file-score ${getScoreClass(r.score)}`}>{r.score}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="content">
                {selectedResult && (
                  <div className="card summary-card">
                    <div className="card-body">
                      <div className="summary-header">
                        <span className="summary-file">{selectedResult.file}</span>
                        <span className="summary-lang">{selectedResult.language}</span>
                        <span className={`summary-score ${getScoreClass(selectedResult.score)}`}>{selectedResult.score}</span>
                      </div>
                      {selectedResult.summary && <p className="summary-text">{selectedResult.summary}</p>}
                    </div>
                  </div>
                )}

                <div className="filter-bar">
                  <input
                    type="text"
                    className="filter-input"
                    placeholder="Search findings..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
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
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  {(severityFilter || categoryFilter || search) && (
                    <button className="btn btn-ghost" onClick={() => { setSeverityFilter(''); setCategoryFilter(''); setSearch(''); }}>
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
                  displayFindings.map((finding, idx) => (
                    <div key={finding.id || idx} className="finding-card">
                      <div className="finding-meta">
                        <span className={`badge ${SEVERITY_CLASS[finding.severity]}`}>{finding.severity}</span>
                        <span className="badge badge-category">{CATEGORY_LABELS[finding.category] || finding.category}</span>
                        {finding.line > 0 && <span className="badge badge-info">Line {finding.line}</span>}
                        {!selectedFile && <span className="badge badge-info">{finding.file?.split('/').pop()}</span>}
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
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
