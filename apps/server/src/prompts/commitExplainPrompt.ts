import type {
  CommitFileExplanation,
  CommitMetadata,
  CommitSummary,
  CommitFileStatus,
  DiffStats
} from '../types';

export const COMMIT_EXPLAIN_SYSTEM_PROMPT = `You are an expert engineering assistant that explains Git commits accurately and concisely.

Your job is to explain what changed in a commit by reading Git diff text.

Rules:
1. Explain only the changes shown in the diff.
2. Do not perform code review or speculate about bugs unless the diff clearly shows risk.
3. Focus on behavior, structure, data flow, UX, API, and configuration changes.
4. Be concrete and file-aware.
5. Return valid JSON only. No markdown, no code fences, no extra commentary.`;

export function createCommitFilePrompt(
  commit: CommitMetadata,
  filePath: string,
  status: CommitFileStatus,
  diffStats: DiffStats,
  diff: string,
  truncated: boolean
): string {
  return `Explain the changes in this single file from the latest commit.

Return JSON with exactly this structure:
{
  "summary": "1-3 sentence explanation of what changed in this file",
  "change_types": ["list", "of", "short labels"],
  "details": [
    "specific behavioral or structural change",
    "specific data flow, UI, API, or configuration change"
  ]
}

Constraints:
- Keep change_types to 2-5 short labels
- Keep details to 2-6 bullets
- Prefer plain-English explanations of behavior and intent
- If the diff is truncated, mention uncertainty briefly in the summary

Commit title: ${commit.title}
Commit body: ${commit.body || '(none)'}
File: ${filePath}
Status: ${status}
Additions: ${diffStats.additions}
Deletions: ${diffStats.deletions}
Diff truncated: ${truncated ? 'yes' : 'no'}

Git diff:
${diff}`;
}

export function createCommitSummaryPrompt(
  commit: CommitMetadata,
  fileSummaries: CommitFileExplanation[]
): string {
  const summaryInput = fileSummaries.map(file => ({
    file: file.file,
    status: file.status,
    summary: file.summary,
    change_types: file.changeTypes,
    details: file.details.slice(0, 3)
  }));

  return `Explain the latest commit as a whole using the compact per-file summaries below.

Return JSON with exactly this structure:
{
  "headline": "short headline for the overall commit",
  "overview": "2-4 sentence whole-commit explanation",
  "themes": ["main theme 1", "main theme 2"],
  "risks": ["potential follow-up or uncertainty", "another risk if clearly relevant"],
  "notable_files": ["path/one", "path/two"]
}

Constraints:
- Themes: 2-5 entries
- Risks: 0-3 entries, keep empty if none are evident
- notable_files: 1-5 entries
- Ground the explanation in the provided file summaries only

Commit metadata:
Hash: ${commit.shortHash}
Title: ${commit.title}
Body: ${commit.body || '(none)'}
Files changed: ${commit.filesChanged}
Insertions: ${commit.insertions}
Deletions: ${commit.deletions}

Per-file summaries:
${JSON.stringify(summaryInput, null, 2)}`;
}

export function parseCommitFileResponse(content: string): Pick<CommitFileExplanation, 'summary' | 'changeTypes' | 'details'> {
  const parsed = parseJson(content);

  return {
    summary: String(parsed.summary || 'Updated this file in the latest commit.'),
    changeTypes: normalizeStringArray(parsed.change_types, ['implementation']),
    details: normalizeStringArray(parsed.details, ['See the diff for the concrete line-level changes.'])
  };
}

export function parseCommitSummaryResponse(content: string): CommitSummary {
  const parsed = parseJson(content);

  return {
    headline: String(parsed.headline || 'Latest commit changes'),
    overview: String(parsed.overview || 'This commit updates multiple files in the repository.'),
    themes: normalizeStringArray(parsed.themes, ['Code changes']),
    risks: normalizeStringArray(parsed.risks, []),
    notableFiles: normalizeStringArray(parsed.notable_files, [])
  };
}

function parseJson(content: string): any {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(fenced);
    } catch {
      const start = fenced.indexOf('{');
      const end = fenced.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(fenced.slice(start, end + 1));
      }
      throw new Error('Failed to parse commit explanation response as JSON');
    }
  }
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map(item => String(item || '').trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : fallback;
}
