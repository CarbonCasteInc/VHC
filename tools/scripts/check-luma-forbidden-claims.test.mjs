import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { scanForbiddenClaims, FORBIDDEN_CLAIMS, SCAN_ROOT } from './check-luma-forbidden-claims.mjs';

function makeFixtureRepo(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'luma-forbidden-claims-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(root, SCAN_ROOT, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

test('registry mirrors spec §20 (13 entries, RFC-gated)', () => {
  const expected = [
    'verified-human',
    'one-human-one-vote',
    'sybil-resistant',
    'district-proof',
    'cryptographic-residency',
    'permanently-delete',
    'anonymous',
    'untraceable',
    'reset-identity-deletes',
    'sign-out-removes-data',
    'permanently-deleted-network',
    'fully-anonymous',
    'untraceable-across-devices',
  ];
  assert.deepEqual(FORBIDDEN_CLAIMS.map((claim) => claim.id), expected);
});

test('clean tree passes with zero violations', () => {
  const root = makeFixtureRepo({
    'components/Feed.tsx': 'export const Feed = () => <div>Latest stories</div>;\n',
  });
  try {
    const { violations, scannedFileCount } = scanForbiddenClaims(root);
    assert.equal(scannedFileCount, 1);
    assert.deepEqual(violations, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: forbidden claim copy fails the gate', () => {
  const root = makeFixtureRepo({
    'components/Promo.tsx': "export const promo = 'Every account is a verified human.';\n",
  });
  try {
    const { violations } = scanForbiddenClaims(root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].claim, 'verified-human');
    assert.match(violations[0].file, /Promo\.tsx$/);
    assert.equal(violations[0].line, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: anonymity and deletion claims fail the gate', () => {
  const root = makeFixtureRepo({
    'components/Privacy.tsx': [
      "const a = 'Your posts are fully anonymous.';",
      "const b = 'Reset Identity deletes your activity.';",
      "const c = 'Your history is untraceable across devices.';",
    ].join('\n'),
  });
  try {
    const { violations } = scanForbiddenClaims(root);
    const claimIds = violations.map((violation) => violation.claim);
    assert.ok(claimIds.includes('fully-anonymous'));
    assert.ok(claimIds.includes('reset-identity-deletes'));
    assert.ok(claimIds.includes('untraceable-across-devices'));
    assert.ok(claimIds.includes('untraceable'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('negative bounds and typed denial flags are allowed with reasons', () => {
  const root = makeFixtureRepo({
    'hooks/useProof.ts': 'export const proof = { canClaimSybilResistance: false };\n',
    'routes/compliance.tsx': "const bound = 'Beta surfaces must not be presented as Sybil resistance or one-human-one-vote assurance.';\n",
  });
  try {
    const { violations, allowedHits } = scanForbiddenClaims(root);
    assert.deepEqual(violations, []);
    assert.ok(allowedHits.length >= 3);
    assert.ok(allowedHits.every((hit) => typeof hit.allowReason === 'string' && hit.allowReason.length > 0));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status-enum 'anonymous' literal is allowed; anonymity claim is not", () => {
  const root = makeFixtureRepo({
    'hooks/useThing.ts': "const status = 'anonymous';\n",
    'components/Claim.tsx': 'export const claim = <p>Browsing here keeps you anonymous forever</p>;\n',
  });
  try {
    const { violations, allowedHits } = scanForbiddenClaims(root);
    assert.equal(violations.length, 1);
    assert.match(violations[0].file, /Claim\.tsx$/);
    assert.ok(allowedHits.some((hit) => /useThing\.ts$/.test(hit.file)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown copy inside the app tree is scanned', () => {
  const root = makeFixtureRepo({
    'content/about.md': '# About\nOur network is Sybil-resistant by design.\n',
  });
  try {
    const { violations } = scanForbiddenClaims(root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].claim, 'sybil-resistant');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
