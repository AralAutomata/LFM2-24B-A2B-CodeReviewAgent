import type { ReviewResult, Finding } from './types';

export interface ConsolidatedFinding {
  type: 'single' | 'pattern';
  originalFindings: Array<Finding & { file: string }>;
  title: string;
  category: string;
  severity: string;
  description: string;
  suggestion: string;
  confidence: number;
  evidence: string;
  verified: boolean;
  affectedFiles: string[];
}

export function consolidateFindings(results: ReviewResult[]): ConsolidatedFinding[] {
  const findingMap = new Map<string, ConsolidatedFinding>();
  
  for (const result of results) {
    for (const finding of result.findings) {
      const key = generateFindingKey(finding);
      
      if (!findingMap.has(key)) {
        findingMap.set(key, {
          type: 'single',
          originalFindings: [],
          title: finding.title,
          category: finding.category,
          severity: finding.severity,
          description: finding.description,
          suggestion: finding.suggestion,
          confidence: finding.confidence,
          evidence: finding.evidence,
          verified: finding.verified,
          affectedFiles: []
        });
      }
      
      const consolidated = findingMap.get(key)!;
      consolidated.originalFindings.push({ ...finding, file: result.file });
      consolidated.affectedFiles.push(result.file);
      
      if (consolidated.type === 'single' && consolidated.originalFindings.length > 1) {
        consolidated.type = 'pattern';
        consolidated.severity = adjustSeverityForOccurrence(finding.severity, consolidated.originalFindings.length);
        consolidated.confidence = Math.min(1.0, consolidated.confidence + (consolidated.originalFindings.length * 0.05));
      }
    }
  }
  
  return Array.from(findingMap.values()).sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return severityOrder[a.severity as keyof typeof severityOrder] - severityOrder[b.severity as keyof typeof severityOrder];
  });
}

function generateFindingKey(finding: Finding): string {
  const normalizedTitle = finding.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedCategory = finding.category.toLowerCase();
  return `${normalizedCategory}:${normalizedTitle}`;
}

function adjustSeverityForOccurrence(originalSeverity: string, occurrenceCount: number): string {
  if (occurrenceCount >= 5) {
    if (originalSeverity === 'info') return 'medium';
    if (originalSeverity === 'low') return 'high';
    if (originalSeverity === 'medium') return 'high';
  }
  return originalSeverity;
}

export function generateConsolidatedReport(results: ReviewResult[]): string {
  const consolidated = consolidateFindings(results);
  
  let report = `# Code Review - Consolidated Findings

## Overview

- **Total Files Reviewed**: ${results.length}
- **Total Findings**: ${results.reduce((sum, r) => sum + r.findings.length, 0)}
- **Unique Issues**: ${consolidated.length}
- **Average Score**: ${results.length ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length) : 0}

---

## Critical & High Severity Issues

`;
  
  const criticalHigh = consolidated.filter(f => f.severity === 'critical' || f.severity === 'high');
  for (const finding of criticalHigh) {
    report += generateFindingSection(finding);
  }
  
  report += `
## Medium Severity Issues

`;
  
  const medium = consolidated.filter(f => f.severity === 'medium');
  for (const finding of medium) {
    report += generateFindingSection(finding);
  }
  
  report += `
## Low Severity & Info

`;
  
  const lowInfo = consolidated.filter(f => f.severity === 'low' || f.severity === 'info');
  for (const finding of lowInfo) {
    report += generateFindingSection(finding);
  }
  
  return report;
}

function generateFindingSection(finding: ConsolidatedFinding): string {
  const severityIcon = finding.severity === 'critical' ? '🔴' : finding.severity === 'high' ? '🟠' : finding.severity === 'medium' ? '🟡' : '🔵';
  
  let section = `### ${severityIcon} ${finding.severity.toUpperCase()}: ${finding.title}

**Category**: ${finding.category}
**Confidence**: ${Math.round(finding.confidence * 100)}%
`;
  
  if (finding.type === 'pattern') {
    section += `**Affected Files** (${finding.affectedFiles.length}): ${finding.affectedFiles.join(', ')}\n`;
  } else {
    section += `**File**: ${finding.affectedFiles[0]}\n`;
  }
  
  section += `
${finding.description}

**Suggestion**: ${finding.suggestion}

`;
  
  return section;
}
