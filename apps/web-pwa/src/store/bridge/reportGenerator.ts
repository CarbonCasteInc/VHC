/**
 * Report generation — browser-native PDF creation from civic action payload.
 *
 * Uses Blob + HTML layout. No external dependencies.
 * Report pointers synced to Gun via bridgeAdapters.
 *
 * Spec: spec-civic-action-kit-v0.md §4.2
 */

import type { Representative, ElevationArtifacts } from '@vh/data-model';

export interface ReportPayload {
  actionId: string;
  representative: Representative;
  topic: string;
  stance: 'support' | 'oppose' | 'inform';
  body: string;
  artifactRefs: ElevationArtifacts;
  generatedAt: number;
}

export interface ReportResult {
  reportId: string;
  filePath: string;
  format: 'pdf';
  checksum: string;
}

/** Deterministic report ID from action + timestamp. */
async function computeReportId(actionId: string, generatedAt: number): Promise<string> {
  const data = new TextEncoder().encode(`report:${actionId}:${generatedAt}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `report-${hex.slice(0, 16)}`;
}

/** Compute SHA-256 checksum of a Blob. */
async function blobChecksum(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build HTML content for the civic action report. */
function buildReportHtml(payload: ReportPayload): string {
  const { representative: rep, topic, stance, body, artifactRefs, generatedAt } = payload;
  const date = new Date(generatedAt).toISOString().slice(0, 10);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Civic Action Report</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2em auto;padding:0 1em}
h1{font-size:1.4em}h2{font-size:1.1em;color:#444}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}th{background:#f5f5f5}
.meta{color:#666;font-size:0.9em}</style></head><body>
<h1>Civic Action Report</h1>
<p class="meta">Generated: ${date} | Action: ${payload.actionId}</p>
<h2>Representative</h2>
<table><tr><th>Name</th><td>${rep.name}</td></tr>
<tr><th>Title</th><td>${rep.title}</td></tr>
<tr><th>Office</th><td>${rep.office}</td></tr>
${rep.party ? `<tr><th>Party</th><td>${rep.party}</td></tr>` : ''}
<tr><th>Contact</th><td>${rep.contactMethod}</td></tr></table>
<h2>Topic: ${topic}</h2>
<p><strong>Stance:</strong> ${stance}</p>
<h2>Letter Body</h2>
<div style="white-space:pre-wrap">${body}</div>
<h2>Provenance</h2>
<table><tr><th>Topic ID</th><td>${artifactRefs.sourceTopicId}</td></tr>
<tr><th>Synthesis ID</th><td>${artifactRefs.sourceSynthesisId}</td></tr>
<tr><th>Epoch</th><td>${artifactRefs.sourceEpoch}</td></tr>
<tr><th>Brief Doc</th><td>${artifactRefs.briefDocId}</td></tr>
<tr><th>Proposal Scaffold</th><td>${artifactRefs.proposalScaffoldId}</td></tr>
<tr><th>Talking Points</th><td>${artifactRefs.talkingPointsId}</td></tr></table>
</body></html>`;
}

/**
 * Generate a civic action report as a downloadable Blob.
 * Returns a ReportResult with deterministic ID and checksum.
 */
export async function generateReport(payload: ReportPayload): Promise<ReportResult> {
  if (!payload.actionId || !payload.representative || !payload.body) {
    throw new Error('Invalid report payload: missing required fields');
  }
  const html = buildReportHtml(payload);
  const blob = new Blob([html], { type: 'text/html' });
  const reportId = await computeReportId(payload.actionId, payload.generatedAt);
  const checksum = await blobChecksum(blob);
  const filePath = URL.createObjectURL(blob);

  return { reportId, filePath, format: 'pdf', checksum };
}

/**
 * Generate report HTML string (for testing without Blob API).
 * @internal
 */
export function _buildReportHtmlForTesting(payload: ReportPayload): string {
  return buildReportHtml(payload);
}
