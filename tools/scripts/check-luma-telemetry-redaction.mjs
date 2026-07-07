#!/usr/bin/env node
/**
 * check:luma-telemetry-redaction — M1.E telemetry guard.
 *
 * Locks source-discipline rules from spec §16:
 *  1. The LUMA event registry mirrors spec §16.1.
 *  2. Identity/vault/gun-client/LUMA SDK code does not call console.*
 *     directly; logs go through lumaLog so redaction is centralized.
 *  3. Typed secret-like values are not compared with === / !== in the
 *     guarded namespaces. Null/undefined presence checks are allowed.
 *
 * Runtime redaction behavior is covered by packages/luma-sdk/src/telemetry.test.ts.
 * packages/luma-sdk/src/telemetryReplayFixture.test.ts adds a fixture replay
 * harness and red tests. The full spec §21.4 recorded product replay remains
 * deferred until product emit sites and a capture/regeneration path exist.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export const EXPECTED_LUMA_EVENT_TYPES = Object.freeze([
  'luma_session_created',
  'luma_session_expired',
  'luma_session_re_attested',
  'luma_session_revoked',
  'luma_session_revoked_by_bulletin',
  'luma_policy_blocked',
  'luma_envelope_rejected',
  'luma_tombstone_attempted',
  'luma_evidence_capture_started',
  'luma_evidence_capture_succeeded',
  'luma_evidence_capture_failed',
  'luma_forbidden_claim_rendered',
  'luma_safety_bulletin_fetched',
  'luma_vault_migrated_v1_to_v2',
]);

const DIRECT_CONSOLE_PATTERN = /\bconsole\.(?:log|info|warn|error|debug)\s*\(/;
const SECRET_IDENTIFIER_PATTERN = /\b(?:nullifier|deviceCredential|sessionToken|rawSignatureBytes|rawEnvelopeJson|vaultMasterKey|privateKey|secretKey|districtHash|regionCode|access_?token|refresh_?token|id_?token|provider_?subject|provider_?label|display_?label|client_?secret|oauth_?code)\b/i;
const SECRET_EQUALITY_PATTERN = /(?:===|!==)/;
const NULLISH_PATTERN = /\b(?:null|undefined)\b/;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

export const SCAN_TARGETS = Object.freeze([
  { kind: 'file', path: 'apps/web-pwa/src/hooks/useIdentity.ts' },
  { kind: 'dir', path: 'apps/web-pwa/src/hooks/identity', optional: true },
  { kind: 'dir', path: 'packages/identity-vault/src' },
  { kind: 'dir', path: 'packages/gun-client/src' },
  { kind: 'dir', path: 'packages/luma-sdk/src' },
]);

export const DIRECT_CONSOLE_ALLOWLIST = new Set([
  'packages/luma-sdk/src/telemetry.ts',
]);

function walkSourceFiles(root, files = []) {
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (entry === 'dist' || entry === 'node_modules') continue;
      walkSourceFiles(full, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry)) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function resolveScanFiles(repoRoot, failures) {
  const files = [];
  for (const target of SCAN_TARGETS) {
    const full = path.join(repoRoot, target.path);
    if (!existsSync(full)) {
      if (!target.optional) {
        failures.push(`${target.path}: guarded telemetry target missing`);
      }
      continue;
    }
    if (target.kind === 'file') {
      files.push(full);
    } else {
      walkSourceFiles(full, files);
    }
  }
  return [...new Set(files)].sort();
}

function parseRegistryTypes(source) {
  const match = source.match(/LUMA_TELEMETRY_EVENT_TYPES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\s*as const\)/);
  if (!match) {
    return null;
  }
  const body = match[1] ?? '';
  return [...body.matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function scanLineForDirectConsole(relPath, lineText, lineNumber, violations) {
  if (!DIRECT_CONSOLE_PATTERN.test(lineText)) {
    return;
  }
  if (DIRECT_CONSOLE_ALLOWLIST.has(relPath)) {
    return;
  }
  violations.push({
    type: 'direct-console',
    file: relPath,
    line: lineNumber,
    text: lineText.trim(),
  });
}

function scanLineForSecretEquality(relPath, lineText, lineNumber, violations) {
  if (!SECRET_EQUALITY_PATTERN.test(lineText) || !SECRET_IDENTIFIER_PATTERN.test(lineText)) {
    return;
  }
  if (NULLISH_PATTERN.test(lineText)) {
    return;
  }
  violations.push({
    type: 'secret-equality',
    file: relPath,
    line: lineNumber,
    text: lineText.trim(),
  });
}

export function runTelemetryRedactionChecks(repoRoot = REPO_ROOT) {
  const failures = [];
  const violations = [];
  const files = resolveScanFiles(repoRoot, failures);
  const telemetryPath = path.join(repoRoot, 'packages/luma-sdk/src/telemetry.ts');
  if (!existsSync(telemetryPath)) {
    failures.push('packages/luma-sdk/src/telemetry.ts: telemetry core missing');
  } else {
    const registry = parseRegistryTypes(readFileSync(telemetryPath, 'utf8'));
    if (!registry) {
      failures.push('packages/luma-sdk/src/telemetry.ts: LUMA_TELEMETRY_EVENT_TYPES registry missing');
    } else if (JSON.stringify(registry) !== JSON.stringify(EXPECTED_LUMA_EVENT_TYPES)) {
      failures.push(
        `packages/luma-sdk/src/telemetry.ts: event registry drifted from spec §16.1 (expected ${EXPECTED_LUMA_EVENT_TYPES.length}, found ${registry.length})`,
      );
    }
  }

  for (const file of files) {
    const relPath = path.relative(repoRoot, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((lineText, index) => {
      scanLineForDirectConsole(relPath, lineText, index + 1, violations);
      scanLineForSecretEquality(relPath, lineText, index + 1, violations);
    });
  }

  return { scannedFileCount: files.length, failures, violations };
}

function main() {
  const { scannedFileCount, failures, violations } = runTelemetryRedactionChecks();
  console.log(`luma-telemetry-redaction: scanned ${scannedFileCount} guarded source files`);
  if (failures.length > 0 || violations.length > 0) {
    console.error(`luma-telemetry-redaction: FAIL — ${failures.length + violations.length} issue(s):`);
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    for (const violation of violations) {
      console.error(`  [${violation.type}] ${violation.file}:${violation.line}: ${violation.text}`);
    }
    process.exit(1);
  }
  console.log('luma-telemetry-redaction: PASS');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
