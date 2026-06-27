import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { phase5ScopeASoakArchiveInternal } from './archive-phase5-scope-a-soak-sample.mjs';

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'vh-phase5-soak-archive-'));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

test('archives host-local liveness reports plus a public freshness summary', async () => {
  const root = tmpDir();
  const repoRoot = path.join(root, 'repo');
  mkdirSync(repoRoot, { recursive: true });
  const publisher = path.join(root, 'publisher/latest.json');
  const relay = path.join(root, 'relay/latest.json');
  const snapshot = path.join(root, 'snapshot/latest.json');
  writeJson(publisher, { generatedAt: '2026-06-25T00:00:00.000Z', status: 'pass' });
  writeJson(relay, { generatedAt: '2026-06-25T00:01:00.000Z', status: 'pass' });
  writeJson(snapshot, { generatedAt: '2026-06-25T00:02:00.000Z', status: 'pass' });

  const env = {
    HOME: path.join(root, 'home'),
    VH_PHASE5_SCOPE_A_SOAK_ARCHIVE_ROOT: path.join(root, 'archive'),
    VH_PHASE5_SOAK_PUBLISHER_LIVENESS_FILE: publisher,
    VH_PHASE5_SOAK_RELAY_LIVENESS_FILE: relay,
    VH_PHASE5_SOAK_RELAY_SNAPSHOT_WATCH_FILE: snapshot,
  };
  const spawnCalls = [];
  const spawnSyncImpl = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    writeJson(path.join(options.env.VH_PUBLIC_FEED_FRESHNESS_ARTIFACT_DIR, 'public-feed-freshness-summary.json'), {
      generatedAt: '2026-06-25T00:03:00.000Z',
      status: 'pass',
      blockers: [],
    });
    return { status: 0, signal: null, stdout: 'ok', stderr: '' };
  };

  const manifest = await phase5ScopeASoakArchiveInternal.runPhase5ScopeASoakArchive({
    env,
    repoRoot,
    now: new Date('2026-06-25T00:04:05.006Z'),
    spawnSyncImpl,
  });

  assert.equal(manifest.status, 'pass');
  assert.equal(manifest.sampleId, '20260625T000405Z');
  assert.equal(manifest.copiedReports.length, 3);
  assert.deepEqual(manifest.copiedReports.map((entry) => entry.status), ['copied', 'copied', 'copied']);
  assert.equal(manifest.publicFreshness.status, 'completed');
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].options.env.VH_PUBLIC_FEED_FRESHNESS_ARTIFACT_DIR, path.join(manifest.archiveDir, 'public-feed-freshness'));

  assert.equal(readJson(path.join(manifest.archiveDir, 'publisher-liveness.json')).status, 'pass');
  assert.equal(readJson(path.join(manifest.archiveDir, 'relay-liveness.json')).status, 'pass');
  assert.equal(readJson(path.join(manifest.archiveDir, 'relay-snapshot-watch.json')).status, 'pass');
  assert.equal(readJson(path.join(manifest.archiveDir, 'manifest.json')).status, 'pass');
});

test('fails the archive sample when a required latest report is missing', async () => {
  const root = tmpDir();
  const repoRoot = path.join(root, 'repo');
  mkdirSync(repoRoot, { recursive: true });
  const publisher = path.join(root, 'publisher/latest.json');
  const relay = path.join(root, 'relay/latest.json');
  writeJson(publisher, { generatedAt: '2026-06-25T00:00:00.000Z', status: 'pass' });
  writeJson(relay, { generatedAt: '2026-06-25T00:01:00.000Z', status: 'pass' });

  const manifest = await phase5ScopeASoakArchiveInternal.runPhase5ScopeASoakArchive({
    env: {
      HOME: path.join(root, 'home'),
      VH_PHASE5_SCOPE_A_SOAK_ARCHIVE_ROOT: path.join(root, 'archive'),
      VH_PHASE5_SOAK_PUBLISHER_LIVENESS_FILE: publisher,
      VH_PHASE5_SOAK_RELAY_LIVENESS_FILE: relay,
      VH_PHASE5_SOAK_RELAY_SNAPSHOT_WATCH_FILE: path.join(root, 'missing/latest.json'),
      VH_PHASE5_SCOPE_A_SOAK_RUN_PUBLIC_MONITOR: '0',
    },
    repoRoot,
    now: new Date('2026-06-25T00:04:05.006Z'),
  });

  assert.equal(manifest.status, 'fail');
  assert.match(manifest.blockers.join('\n'), /relay_snapshot_watch:missing:/);
  assert.equal(manifest.publicFreshness.status, 'skipped');
  assert.equal(readJson(path.join(manifest.archiveDir, 'manifest.json')).status, 'fail');
});

test('fails the archive sample when a copied latest report is non-pass', async () => {
  const root = tmpDir();
  const repoRoot = path.join(root, 'repo');
  mkdirSync(repoRoot, { recursive: true });
  const publisher = path.join(root, 'publisher/latest.json');
  const relay = path.join(root, 'relay/latest.json');
  const snapshot = path.join(root, 'snapshot/latest.json');
  writeJson(publisher, { generatedAt: '2026-06-25T00:00:00.000Z', status: 'pass' });
  writeJson(relay, { generatedAt: '2026-06-25T00:01:00.000Z', status: 'fail' });
  writeJson(snapshot, { generatedAt: '2026-06-25T00:02:00.000Z', status: 'pass' });

  const manifest = await phase5ScopeASoakArchiveInternal.runPhase5ScopeASoakArchive({
    env: {
      HOME: path.join(root, 'home'),
      VH_PHASE5_SCOPE_A_SOAK_ARCHIVE_ROOT: path.join(root, 'archive'),
      VH_PHASE5_SOAK_PUBLISHER_LIVENESS_FILE: publisher,
      VH_PHASE5_SOAK_RELAY_LIVENESS_FILE: relay,
      VH_PHASE5_SOAK_RELAY_SNAPSHOT_WATCH_FILE: snapshot,
      VH_PHASE5_SCOPE_A_SOAK_RUN_PUBLIC_MONITOR: '0',
    },
    repoRoot,
    now: new Date('2026-06-25T00:04:05.006Z'),
  });

  assert.equal(manifest.status, 'fail');
  assert.match(manifest.blockers.join('\n'), /relay_liveness:status_fail/);
  assert.equal(manifest.copiedReports.find((entry) => entry.key === 'relay_liveness')?.status, 'copied_non_pass');
});
