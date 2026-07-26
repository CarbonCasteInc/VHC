import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  evaluatePublicBetaDocsFreshness,
  PUBLIC_BETA_DOCS_FRESHNESS_FILES,
  PUBLIC_BETA_OPERATIONAL_STATE_PATH,
} from './check-public-beta-docs-freshness.mjs';

function loadSnapshot() {
  return new Map(
    PUBLIC_BETA_DOCS_FRESHNESS_FILES.map((file) => [
      file,
      readFileSync(file, 'utf8'),
    ]),
  );
}

function evaluateSnapshot(snapshot) {
  return evaluatePublicBetaDocsFreshness({
    fileExists: (file) => snapshot.has(file),
    readText: (file) => {
      if (!snapshot.has(file)) throw new Error(`missing ${file}`);
      return snapshot.get(file);
    },
  });
}

test('current public-beta documentation routes to one fail-closed owner', () => {
  const result = evaluateSnapshot(loadSnapshot());
  assert.equal(result.status, 'pass', result.issues.join('\n'));
  assert.equal(result.checkedFiles, PUBLIC_BETA_DOCS_FRESHNESS_FILES.length);
});

test('freshness guard rejects a missing custody verdict', () => {
  const snapshot = loadSnapshot();
  snapshot.set(
    PUBLIC_BETA_OPERATIONAL_STATE_PATH,
    snapshot
      .get(PUBLIC_BETA_OPERATIONAL_STATE_PATH)
      .replace('`NO_GO_BLOCKED_EXTERNAL_LOST_CUSTODY`', '`GO`'),
  );
  const result = evaluateSnapshot(snapshot);
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((issue) => issue.includes('NO_GO_BLOCKED_EXTERNAL_LOST_CUSTODY')));
});

test('freshness guard rejects a dated handoff presented without its historical banner', () => {
  const snapshot = loadSnapshot();
  const file = 'docs/plans/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md';
  snapshot.set(
    file,
    snapshot.get(file).replace(
      'Historical snapshot: superseded for current operational truth',
      'Current execution handoff',
    ),
  );
  const result = evaluateSnapshot(snapshot);
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((issue) => issue.startsWith(`${file}:`)));
});

test('freshness guard rejects removal from the normal docs check', () => {
  const snapshot = loadSnapshot();
  const packageJson = JSON.parse(snapshot.get('package.json'));
  packageJson.scripts['docs:check'] = 'node tools/scripts/check-docs-governance.mjs';
  snapshot.set('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
  const result = evaluateSnapshot(snapshot);
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((issue) => issue.includes('docs:check')));
});

for (const file of [
  'docs/ops/vhc-incident-response.md',
  'docs/ops/vhc-codex-responder.md',
]) {
  for (const [label, claim] of [
    [
      'canonical wording',
      'Current live A6 state: recovery is complete and launch may proceed.',
    ],
    ['common synonyms', 'Recovery has completed; launch can proceed.'],
  ]) {
    test(`freshness guard rejects a current-live recovery overclaim using ${label} in ${file}`, () => {
      const snapshot = loadSnapshot();
      snapshot.set(file, `${snapshot.get(file)}\n${claim}\n`);
      const result = evaluateSnapshot(snapshot);
      assert.equal(result.status, 'fail');
      assert.ok(
        result.issues.some(
          (issue) => issue.startsWith(`${file}:`) && issue.includes('current-live assertion'),
        ),
        result.issues.join('\n'),
      );
    });
  }
}

test('freshness guard rejects an unbalanced historical live-snapshot block', () => {
  const snapshot = loadSnapshot();
  const file = 'docs/ops/vhc-incident-response.md';
  snapshot.set(
    file,
    snapshot
      .get(file)
      .replace('<!-- PUBLIC_BETA_HISTORICAL_LIVE_SNAPSHOT_END -->', ''),
  );
  const result = evaluateSnapshot(snapshot);
  assert.equal(result.status, 'fail');
  assert.ok(result.issues.some((issue) => issue.includes('balanced historical live-snapshot')));
});
