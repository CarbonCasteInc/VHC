#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC_BETA_OPERATIONAL_STATE_PATH =
  'docs/ops/public-beta-operational-state.md';

export const PUBLIC_BETA_DOCS_FRESHNESS_FILES = [
  PUBLIC_BETA_OPERATIONAL_STATE_PATH,
  'docs/README.md',
  'docs/CANON_MAP.md',
  'docs/foundational/STATUS.md',
  'docs/plans/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md',
  'docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md',
  'docs/reports/state-of-play-docs-alignment-audit-2026-07-08.md',
  'docs/ops/public-beta-launch-control-2026-07-09.md',
  'docs/ops/public-beta-distribution-packet-2026-07-09.md',
  'docs/ops/public-beta-launch-readiness-closeout.md',
  'docs/ops/news-aggregator-production-service.md',
  'docs/ops/public-feed-freshness-monitor.md',
  'docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md',
  'docs/ops/vhc-incident-response.md',
  'docs/ops/vhc-codex-responder.md',
  'docs/sprints/PUBLIC_BETA_RECOVERY_BLOCKED_SPRINT_2026-07-25.md',
  'tools/scripts/check-public-beta-launch-closeout.mjs',
  'package.json',
];

function requireText(readText, file, needles, issues) {
  let text;
  try {
    text = readText(file);
  } catch {
    issues.push(`${file}: missing or unreadable`);
    return;
  }
  for (const needle of needles) {
    if (!text.includes(needle)) {
      issues.push(`${file}: missing required current-state marker ${JSON.stringify(needle)}`);
    }
  }
}

export function evaluatePublicBetaDocsFreshness({
  readText = (file) => readFileSync(path.resolve(process.cwd(), file), 'utf8'),
  fileExists = (file) => existsSync(path.resolve(process.cwd(), file)),
} = {}) {
  const issues = [];

  for (const file of PUBLIC_BETA_DOCS_FRESHNESS_FILES) {
    if (!fileExists(file)) issues.push(`${file}: missing`);
  }

  requireText(
    readText,
    PUBLIC_BETA_OPERATIONAL_STATE_PATH,
    [
      '> Status: Current Operational Truth',
      '> Last Reviewed: 2026-07-25',
      '`NO_GO_BLOCKED_EXTERNAL_LOST_CUSTODY`',
      '`RESTORE_EXACT_OR_AUTHORIZE_FRESH_SUCCESSOR`',
      '`BLOCKED_EXTERNAL`',
      'PR #771',
      'PR #772',
      'PR #773',
      'Gate P',
      'Gate R',
      'Gate I',
      'Gate L',
      'Gate M',
      'S1A / S1B',
      'S2',
      'No workflow dispatch',
      'this file wins',
    ],
    issues,
  );

  requireText(
    readText,
    'docs/README.md',
    [
      '## Start Here Now - Public Beta',
      PUBLIC_BETA_OPERATIONAL_STATE_PATH,
      'Dated plans, handoffs, audits, packets, and reports are historical',
    ],
    issues,
  );
  requireText(
    readText,
    'docs/CANON_MAP.md',
    [
      'Public-beta current operational verdict, recovery authority boundary, and gate ordering',
      `| \`${PUBLIC_BETA_OPERATIONAL_STATE_PATH}\` | VHC Launch Ops + VHC Core Engineering |`,
      '| 2026-07-25 |',
    ],
    issues,
  );
  requireText(
    readText,
    'docs/foundational/STATUS.md',
    [
      '> Last Reviewed: 2026-07-25',
      '**Current operational override:** `NO_GO_BLOCKED_EXTERNAL_LOST_CUSTODY`',
      PUBLIC_BETA_OPERATIONAL_STATE_PATH,
      '## Quick Summary - Dated Implementation Snapshot',
    ],
    issues,
  );
  requireText(
    readText,
    'docs/plans/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md',
    ['Historical snapshot: superseded for current operational truth', PUBLIC_BETA_OPERATIONAL_STATE_PATH],
    issues,
  );
  requireText(
    readText,
    'docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md',
    ['Historical execution contract: current operational status and authority are', PUBLIC_BETA_OPERATIONAL_STATE_PATH],
    issues,
  );
  requireText(
    readText,
    'docs/reports/state-of-play-docs-alignment-audit-2026-07-08.md',
    ['> Status: Historical documentation audit', PUBLIC_BETA_OPERATIONAL_STATE_PATH],
    issues,
  );

  for (const file of [
    'docs/ops/public-beta-launch-control-2026-07-09.md',
    'docs/ops/public-beta-distribution-packet-2026-07-09.md',
    'docs/ops/public-beta-launch-readiness-closeout.md',
    'docs/ops/news-aggregator-production-service.md',
    'docs/ops/public-feed-freshness-monitor.md',
    'docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md',
    'docs/ops/vhc-incident-response.md',
    'docs/ops/vhc-codex-responder.md',
  ]) {
    requireText(
      readText,
      file,
      ['> Last Reviewed: 2026-07-25', PUBLIC_BETA_OPERATIONAL_STATE_PATH],
      issues,
    );
  }
  requireText(
    readText,
    'docs/ops/news-aggregator-production-service.md',
    ['## Dated Launch State', 'not confirmed-current live state'],
    issues,
  );
  requireText(
    readText,
    'docs/ops/public-feed-freshness-monitor.md',
    ['did not', 'dispatch this workflow or run a real-key preflight'],
    issues,
  );
  requireText(
    readText,
    'docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md',
    ['this packet is historical and remains non-executable'],
    issues,
  );
  requireText(
    readText,
    'docs/ops/vhc-codex-responder.md',
    ['The July 10', 'incident readback below is historical'],
    issues,
  );

  requireText(
    readText,
    'docs/sprints/PUBLIC_BETA_RECOVERY_BLOCKED_SPRINT_2026-07-25.md',
    [
      '> Status: Non-authoritative execution queue',
      PUBLIC_BETA_OPERATIONAL_STATE_PATH,
      '`RESTORE_EXACT`',
      '`AUTHORIZE_FRESH_SUCCESSOR`',
      '`BLOCKED_EXTERNAL`',
    ],
    issues,
  );
  requireText(
    readText,
    'tools/scripts/check-public-beta-launch-closeout.mjs',
    [
      "'docs:check': 'node tools/scripts/check-docs-governance.mjs && node tools/scripts/check-public-beta-docs-freshness.mjs'",
    ],
    issues,
  );

  try {
    const packageJson = JSON.parse(readText('package.json'));
    const expectedDocsCheck =
      'node tools/scripts/check-docs-governance.mjs && node tools/scripts/check-public-beta-docs-freshness.mjs';
    const expectedFreshnessCheck =
      'node --test tools/scripts/check-public-beta-docs-freshness.test.mjs && node tools/scripts/check-public-beta-docs-freshness.mjs';
    if (packageJson.scripts?.['docs:check'] !== expectedDocsCheck) {
      issues.push('package.json: docs:check must include the public-beta freshness guard');
    }
    if (packageJson.scripts?.['check:public-beta-docs-freshness'] !== expectedFreshnessCheck) {
      issues.push('package.json: missing exact check:public-beta-docs-freshness script');
    }
  } catch {
    issues.push('package.json: invalid JSON');
  }

  for (const file of [
    PUBLIC_BETA_OPERATIONAL_STATE_PATH,
    'docs/README.md',
    'docs/foundational/STATUS.md',
  ]) {
    try {
      if (readText(file).includes('PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md')) {
        issues.push(`${file}: references a nonexistent current sprint`);
      }
    } catch {
      // The missing/unreadable issue is already recorded above.
    }
  }

  return {
    schemaVersion: 'public-beta-docs-freshness-v1',
    status: issues.length === 0 ? 'pass' : 'fail',
    checkedFiles: PUBLIC_BETA_DOCS_FRESHNESS_FILES.length,
    issues,
  };
}

export async function main() {
  const result = evaluatePublicBetaDocsFreshness();
  console.info(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[public-beta-docs-freshness] failed', error);
    process.exit(1);
  });
}
