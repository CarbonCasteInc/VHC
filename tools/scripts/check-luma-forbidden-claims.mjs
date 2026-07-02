#!/usr/bin/env node
/**
 * check:luma-forbidden-claims — M1.D build-time forbidden-claims gate.
 *
 * Greps `apps/web-pwa/src/**\/*.{ts,tsx,md}` against the normative
 * forbidden-claims registry in docs/specs/spec-luma-service-v0.md §20.
 * The registry is Protocol-RFC-gated: adding or removing an entry here
 * requires the matching spec §20 change in the same PR.
 *
 * A match fails the gate unless the line matches one of the entry's
 * documented allow-contexts. Allow-contexts exist because the compliance
 * surface intentionally renders NEGATIVE bounds ("this beta is not a
 * verified-human system") and identity code uses `'anonymous'` as a
 * status-enum literal. Each allow-context names its reason; an allowed
 * hit is still counted and reported for reviewer visibility.
 *
 * This gate scans source strings. It cannot judge semantics ("close
 * paraphrases" per spec §20 remain a review responsibility), and it is
 * not the runtime `<TrustClaim>` defense (deferred with M1.E telemetry).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export const SCAN_ROOT = 'apps/web-pwa/src';
export const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.md']);

/**
 * Registry source: docs/specs/spec-luma-service-v0.md §20 (13 entries).
 * `pattern` is the detection regex (case-insensitive, hyphen/space
 * tolerant). `allow` entries are line-level regexes with reasons; a line
 * matching any allow regex for that entry is reported but not fatal.
 */
export const FORBIDDEN_CLAIMS = [
  {
    id: 'verified-human',
    registryPhrase: 'verified human',
    pattern: /verified[- ]human/i,
    allow: [
      {
        line: /is not a[\s\S]*verified-human system|not\.toContain\(|must not be presented as/i,
        reason: 'compliance surface renders the negative bound ("is not a verified-human system") and its test asserts the negation',
      },
      {
        line: /not verified-human/i,
        reason: 'doc comment stating the surface must NOT use verified-human language',
      },
    ],
  },
  {
    id: 'one-human-one-vote',
    registryPhrase: 'one-human-one-vote',
    pattern: /one[- ]human[,]?[- ]one[- ]vote/i,
    allow: [
      {
        line: /must not be presented as|not\.toContain\(/i,
        reason: 'compliance surface negative bound and its negation test',
      },
    ],
  },
  {
    id: 'sybil-resistant',
    registryPhrase: 'Sybil-resistant',
    pattern: /sybil[- ]?resist/i,
    allow: [
      {
        line: /canClaimSybilResistance/,
        reason: 'typed denial flag; the identity surface asserts canClaimSybilResistance: false',
      },
      {
        line: /must not be presented as|not verified-human/i,
        reason: 'compliance surface negative bound / doc comment negation',
      },
    ],
  },
  {
    id: 'district-proof',
    registryPhrase: 'district-proof',
    pattern: /district[- ]proof/i,
    allow: [
      {
        line: /not verified-human, district-proof/i,
        reason: 'doc comment stating the surface must NOT use district-proof language',
      },
      {
        line: /must not include/i,
        reason: 'compliance surface negative bound forbidding district proof payloads in public aggregates',
      },
    ],
  },
  {
    id: 'cryptographic-residency',
    registryPhrase: 'cryptographic residency',
    pattern: /cryptographic residency/i,
    allow: [
      {
        line: /not cryptographic residency/i,
        reason: 'test title asserting the beta-local label is NOT cryptographic residency proof',
      },
    ],
  },
  {
    id: 'permanently-delete',
    registryPhrase: 'permanently delete',
    pattern: /permanently delete/i,
    allow: [],
  },
  {
    id: 'anonymous',
    registryPhrase: 'anonymous',
    pattern: /\banonymous\b/i,
    allow: [
      {
        line: /['"`]anonymous['"`]/,
        reason: "IdentityStatus enum literal ('anonymous' = signed-out state), not an anonymity claim",
      },
      {
        line: /@anonymous/,
        reason: 'IDChip placeholder handle for a user without a published handle, not an anonymity claim',
      },
      {
        line: /displayName/,
        reason: "collab-editor presence placeholder name ('Anonymous') for a user without a handle, not an anonymity claim",
      },
      {
        line: /\b(?:to|in|resolves? to|transitions? to|state is|status|anonymous state|anonymous when|anonymous without)\b/i,
        reason: 'comment/test prose describing the anonymous status state machine',
      },
    ],
  },
  {
    id: 'untraceable',
    registryPhrase: 'untraceable',
    pattern: /\buntraceable\b/i,
    allow: [],
  },
  {
    id: 'reset-identity-deletes',
    registryPhrase: 'Reset Identity deletes your activity',
    pattern: /reset identity deletes/i,
    allow: [],
  },
  {
    id: 'sign-out-removes-data',
    registryPhrase: 'Sign Out removes your data from the network',
    pattern: /sign[- ]?out removes your data/i,
    allow: [],
  },
  {
    id: 'permanently-deleted-network',
    registryPhrase: 'permanently deleted from the network',
    pattern: /permanently deleted from the network/i,
    allow: [],
  },
  {
    id: 'fully-anonymous',
    registryPhrase: 'fully anonymous',
    pattern: /fully anonymous/i,
    allow: [],
  },
  {
    id: 'untraceable-across-devices',
    registryPhrase: 'untraceable across devices',
    pattern: /untraceable across devices/i,
    allow: [],
  },
];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, files);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

export function scanForbiddenClaims(repoRoot = REPO_ROOT) {
  const scanDir = path.join(repoRoot, SCAN_ROOT);
  const violations = [];
  const allowedHits = [];
  const files = walk(scanDir);
  for (const file of files) {
    const relPath = path.relative(repoRoot, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((lineText, index) => {
      for (const claim of FORBIDDEN_CLAIMS) {
        if (!claim.pattern.test(lineText)) continue;
        const allowMatch = claim.allow.find((rule) => rule.line.test(lineText));
        const hit = {
          claim: claim.id,
          registryPhrase: claim.registryPhrase,
          file: relPath,
          line: index + 1,
          text: lineText.trim().slice(0, 200),
        };
        if (allowMatch) {
          allowedHits.push({ ...hit, allowReason: allowMatch.reason });
        } else {
          violations.push(hit);
        }
      }
    });
  }
  return { scannedFileCount: files.length, violations, allowedHits };
}

function main() {
  const { scannedFileCount, violations, allowedHits } = scanForbiddenClaims();
  console.log(`luma-forbidden-claims: scanned ${scannedFileCount} files under ${SCAN_ROOT}`);
  console.log(`luma-forbidden-claims: registry entries ${FORBIDDEN_CLAIMS.length} (spec-luma-service-v0.md §20)`);
  if (allowedHits.length > 0) {
    console.log(`luma-forbidden-claims: ${allowedHits.length} allowed hit(s) via documented allow-contexts:`);
    for (const hit of allowedHits) {
      console.log(`  allowed [${hit.claim}] ${hit.file}:${hit.line} — ${hit.allowReason}`);
    }
  }
  if (violations.length > 0) {
    console.error(`luma-forbidden-claims: FAIL — ${violations.length} violation(s):`);
    for (const violation of violations) {
      console.error(`  [${violation.claim}] ${violation.file}:${violation.line}: ${violation.text}`);
    }
    console.error('Forbidden-claims registry is normative (spec §20). Remove the phrase, or if the line is a genuine negative bound, add a documented allow-context in the same PR as a reviewed change.');
    process.exit(1);
  }
  console.log('luma-forbidden-claims: PASS');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
