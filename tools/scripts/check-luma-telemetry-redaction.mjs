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
// Structural presence checks — same safe category as the null/undefined
// exemption. A `typeof x === '<primitive>'` or `x.length === <n>` inspects the
// shape of a value, never its secret contents, so it cannot leak or act as a
// literal-guess oracle. Applied CLAUSE-scoped (see scanLineForSecretEquality):
// a structural guard in one clause must not exempt a secret-value comparison
// in a sibling clause on the same line.
const STRUCTURAL_GUARD_PATTERN = /\btypeof\b|\.length\s*(?:===|!==)/;
// Explicit, auditable suppression for vetted comparisons that the automated
// rule cannot distinguish from a leak (e.g. a vault compartment
// preserve-check comparing two in-memory field values, never logged). The
// marker must carry a reason so every exemption is reviewable.
//
// Deliberately LINE-scoped (unlike the nullish/structural exemptions): the
// marker is a human-reviewed suppression, and it exempts the ENTIRE line it
// sits on — including any second comparison sharing that line. Reviewers
// must vet the whole line when approving a marker.
const REDACTION_SAFE_MARKER = /\/\/\s*redaction-safe:/;
// Quoted string contents (single/double/template). Blanked before clause
// analysis so a secret *key-name* literal (`normalizedKey(k) === 'districthash'`,
// a detection idiom in the privacy guards themselves) never reads as a secret
// *value* comparison.
const QUOTED_STRING_PATTERN = /'[^']*'|"[^"]*"|`[^`]*`/g;
// Clause boundaries for expression-scoped exemption checks: boolean
// operators, ternary branches, and argument/element separators.
const CLAUSE_BOUNDARY_PATTERN = /&&|\|\||[?:,]/;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs']);

export const SCAN_TARGETS = Object.freeze([
  { kind: 'file', path: 'apps/web-pwa/src/hooks/useIdentity.ts' },
  { kind: 'dir', path: 'apps/web-pwa/src/hooks/identity', optional: true },
  // Account/sign-in shell (Lane C): provider subjects, display labels, and
  // session material must stay redaction-disciplined here too.
  { kind: 'file', path: 'apps/web-pwa/src/hooks/useSignIn.ts', optional: true },
  { kind: 'dir', path: 'apps/web-pwa/src/auth', optional: true },
  { kind: 'file', path: 'apps/web-pwa/src/store/signInAccount.ts', optional: true },
  { kind: 'dir', path: 'apps/web-pwa/src/components/account', optional: true },
  { kind: 'dir', path: 'packages/identity-vault/src' },
  { kind: 'dir', path: 'packages/gun-client/src' },
  { kind: 'dir', path: 'packages/luma-sdk/src' },
  // Account-provider callback boundary (Slice C0): the only place provider
  // client secrets exist. Provider tokens/subjects must stay
  // redaction-disciplined here too (.mjs sources).
  { kind: 'dir', path: 'services/auth-callback/src' },
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
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry)) && !/\.(test|spec)\.(tsx?|mjs)$/.test(entry)) {
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
  // Cheap line-level prefilters: no comparison operator or no secret-like
  // identifier anywhere on the line means nothing to analyze.
  if (!SECRET_EQUALITY_PATTERN.test(lineText) || !SECRET_IDENTIFIER_PATTERN.test(lineText)) {
    return;
  }
  // Explicit reviewed suppression — LINE-scoped by design (see the marker's
  // definition comment).
  if (REDACTION_SAFE_MARKER.test(lineText)) {
    return;
  }
  // Blank quoted-string contents first so string literals (secret *key-name*
  // detections) never count as secret identifiers. This subsumes the older
  // whole-line key-name exemption.
  const stripped = lineText.replace(QUOTED_STRING_PATTERN, "''");
  // A line is flagged when EITHER rule fires (union — at-least-as-strict as both
  // the original whole-line rule AND clause scoping):
  //
  // 1. Whole-line rule: a secret comparison anywhere on the line, exempt only
  //    when the WHOLE line carries a nullish or structural guard. This catches
  //    a secret separated from its operator by a boundary char — a call arg
  //    comma `deriveMac(refreshToken, salt) === x`, an optional chain
  //    `sessionToken?.value === x`, a parenthesized `(sessionToken || f) === x`
  //    — that clause splitting alone would break apart and miss.
  const wholeLineFlagged = SECRET_EQUALITY_PATTERN.test(stripped)
    && SECRET_IDENTIFIER_PATTERN.test(stripped)
    && !NULLISH_PATTERN.test(stripped)
    && !STRUCTURAL_GUARD_PATTERN.test(stripped);
  // 2. Clause rule: a nullish or structural guard exempts ONLY the clause it
  //    appears in, so a guard in one clause cannot exempt a secret comparison
  //    in a sibling clause — `typeof x === 'string' && sessionToken === u` or a
  //    `|| y === null` / ternary tail. The whole-line rule misses these (the
  //    guard token sits on the line); the clause rule catches them.
  const clauseFlagged = stripped.split(CLAUSE_BOUNDARY_PATTERN).some((clause) => (
    SECRET_EQUALITY_PATTERN.test(clause)
    && SECRET_IDENTIFIER_PATTERN.test(clause)
    && !NULLISH_PATTERN.test(clause)
    && !STRUCTURAL_GUARD_PATTERN.test(clause)
  ));
  if (!wholeLineFlagged && !clauseFlagged) {
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
