#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REQUIRED_FILES = [
  'docs/specs/spec-vhc-incident-response.md',
  'docs/ops/vhc-incident-response.md',
  'docs/ops/vhc-pager-iphone-setup.md',
  'docs/ops/vhc-codex-responder.md',
  'services/vhc-pager/package.json',
  'services/vhc-pager/src/worker.mjs',
  'services/vhc-pager/src/alert-family.mjs',
  'services/vhc-pager/src/incident-contract.mjs',
  'services/vhc-pager/src/pager-core.mjs',
  'services/vhc-pager/src/github-bridge.mjs',
  'services/vhc-pager/src/web-push.mjs',
  'services/vhc-pager/pwa/index.html',
  'services/vhc-pager/pwa/service-worker.js',
  'tools/scripts/vhc-incident-triage-worker.mjs',
  'tools/scripts/vhc-incident-reviewer.mjs',
  'tools/scripts/vhc-operator-packet-verify.mjs',
  'tools/scripts/vhc-packet-executor.mjs',
  'tools/scripts/vhc-incident-readback-verifier.mjs',
  'tools/scripts/vhc-pager-deadman.mjs',
  'tools/scripts/validate-public-feed-alert-pager-output.mjs',
  'tools/fixtures/incidents/exit69-start-limit.json',
  'tools/fixtures/incidents/exit69-start-limit-v2.json',
  'tools/fixtures/incidents/github-issue-exit69.json',
  'tools/fixtures/incidents/operator-packet-exit69.json',
  'infra/systemd/user/vh-vhc-packet-executor.service',
  'infra/systemd/user/vh-vhc-packet-executor.timer',
  '.github/ISSUE_TEMPLATE/a6-incident.yml',
  '.github/workflows/vhc-pager-deadman.yml',
];

function assertContains(file, pattern, issues, message) {
  const text = readFileSync(file, 'utf8');
  if (!pattern.test(text)) issues.push(`${file}: ${message}`);
}

export function checkVhcIncidentResponse() {
  const issues = [];
  for (const file of REQUIRED_FILES) {
    if (!existsSync(file)) issues.push(`${file}: missing`);
  }
  if (existsSync('tools/scripts/public-feed-alert-watch.mjs')) {
    assertContains(
      'tools/scripts/public-feed-alert-watch.mjs',
      /VH_PUBLIC_FEED_ALERT_WEBHOOK_HMAC_SECRET/,
      issues,
      'missing signed pager webhook support',
    );
    assertContains(
      'tools/scripts/public-feed-alert-watch.test.mjs',
      /x-vhc-alert-signature/,
      issues,
      'missing signed pager webhook test',
    );
  }
  if (existsSync('services/vhc-pager/src/pager-core.mjs')) {
    assertContains(
      'services/vhc-pager/src/pager-core.mjs',
      /VH_PAGER_REQUIRE_SIGNED/,
      issues,
      'missing signed-ingest enforcement',
    );
    assertContains(
      'services/vhc-pager/src/pager-core.mjs',
      /VH_PAGER_DEVICE_TOKEN/,
      issues,
      'missing authenticated device ack',
    );
  }
  if (existsSync('tools/scripts/vhc-operator-packet-verify.mjs')) {
    assertContains(
      'tools/scripts/vhc-operator-packet-verify.mjs',
      /verifyReviewSignature/,
      issues,
      'missing signed reviewer verification',
    );
    assertContains(
      'tools/scripts/vhc-operator-packet-verify.mjs',
      /validateExitClassGuard/,
      issues,
      'missing exit 75 or 78 guard',
    );
  }
  return {
    schemaVersion: 'vhc-incident-response-check-v1',
    status: issues.length === 0 ? 'pass' : 'fail',
    checkedFiles: REQUIRED_FILES.length,
    issues,
  };
}

export async function main() {
  const result = checkVhcIncidentResponse();
  console.info(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:incident-response-check] failed', error);
    process.exit(1);
  });
}
