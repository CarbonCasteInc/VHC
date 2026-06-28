import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { phase5ScopeAWatchClosureInternal } from './phase5-scope-a-watch-closure-packet.mjs';

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'vh-phase5-watch-closure-'));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeSample(root, sampleId, generatedAt, relays) {
  const sampleDir = path.join(root, sampleId);
  writeJson(path.join(sampleDir, 'manifest.json'), {
    schemaVersion: 'vh-phase5-scope-a-soak-archive-v1',
    sampleId,
    generatedAt,
    status: 'pass',
    blockers: [],
  });
  writeJson(path.join(sampleDir, 'publisher-liveness.json'), {
    schemaVersion: 'vh-news-publisher-liveness-watch-v1',
    generatedAt,
    status: 'pass',
    blockers: [],
    unit: {
      activeState: 'active',
      subState: 'running',
      execMainStatus: '0',
      nRestarts: 0,
    },
  });
  writeJson(path.join(sampleDir, 'relay-liveness.json'), {
    schemaVersion: 'vh-news-relay-liveness-watch-v1',
    generatedAt,
    status: 'pass',
    blockers: [],
    relays,
  });
  writeJson(path.join(sampleDir, 'relay-snapshot-watch.json'), {
    schemaVersion: 'vh-relay-latest-index-snapshot-watch-v1',
    generatedAt,
    status: 'pass',
    blockers: [],
    snapshots: [{ newestEntryAgeMs: 1000 }],
  });
  writeJson(path.join(sampleDir, 'public-feed-freshness/public-feed-freshness-summary.json'), {
    schemaVersion: 'public-feed-freshness-monitor-v1',
    generatedAt,
    status: 'pass',
    blockers: [],
  });
}

function relay(name, rssBytes, heapUsedBytes) {
  return {
    name,
    status: 'pass',
    blockers: [],
    docker: { restartCount: 0 },
    metrics: {
      rssBytes,
      heapUsedBytes,
      watchdogTrips: 0,
      eventLoopLagP99Ms: 20,
      criticalReadbacksQueued: 0,
    },
  };
}

function baseEnv(root, extras = {}) {
  const storyclusterDir = path.join(root, 'storycluster/openai-failures');
  mkdirSync(storyclusterDir, { recursive: true });
  const diagnosticsFile = path.join(root, 'news-runtime-diagnostics.json');
  writeJson(diagnosticsFile, {
    schemaVersion: 'vh-news-runtime-diagnostics-v1',
    generatedAt: '2026-06-30T00:00:00.000Z',
    runId: 'run-1',
    latest: {
      tick_sequence: 100,
      status: 'completed',
      skipped: false,
      raw_write_attempted_count: 8,
      raw_wrote_count: 8,
      raw_write_failed_count: 0,
      nonfatal_prewrite_failure_count: 0,
    },
    summaries: [],
  });
  return {
    VH_PHASE5_SCOPE_A_WATCH_ARCHIVE_ROOT: path.join(root, 'archive'),
    VH_PHASE5_SCOPE_A_WATCH_RUNTIME_DIAGNOSTICS_FILE: diagnosticsFile,
    VH_PHASE5_SCOPE_A_WATCH_STORYCLUSTER_FAILURE_DIR: storyclusterDir,
    VH_PHASE5_SCOPE_A_WATCH_START_AT: '2026-06-28T00:00:00.000Z',
    VH_PHASE5_SCOPE_A_WATCH_CLEAN_START_AT: '2026-06-28T00:00:00.000Z',
    VH_PHASE5_SCOPE_A_WATCH_TICK_COUNT: '288',
    VH_PHASE5_SCOPE_A_WATCH_FAILED_TICK_COUNT: '0',
    VH_PHASE5_SCOPE_A_WATCH_SKIPPED_TICK_COUNT: '0',
    VH_PHASE5_SCOPE_A_WATCH_RAW_WRITE_ATTEMPTED_COUNT: '2304',
    VH_PHASE5_SCOPE_A_WATCH_RAW_WROTE_COUNT: '2304',
    VH_PHASE5_SCOPE_A_WATCH_RAW_WRITE_FAILED_COUNT: '0',
    VH_PHASE5_SCOPE_A_WATCH_NONFATAL_PREWRITE_FAILURE_COUNT: '0',
    VH_PHASE5_SCOPE_A_WATCH_FIRST_TICK_SEQUENCE: '1',
    VH_PHASE5_SCOPE_A_WATCH_LATEST_TICK_SEQUENCE: '288',
    ...extras,
  };
}

test('passes the 48h threshold when archive, runtime, StoryCluster, and relay trend are clean', () => {
  const root = tmpDir();
  const archiveRoot = path.join(root, 'archive');
  makeSample(archiveRoot, '20260628T000000Z', '2026-06-28T00:00:00.000Z', [
    relay('vhc-relay-a', 420_000_000, 320_000_000),
    relay('vhc-relay-b', 430_000_000, 330_000_000),
  ]);
  makeSample(archiveRoot, '20260629T000000Z', '2026-06-29T00:00:00.000Z', [
    relay('vhc-relay-a', 421_000_000, 321_000_000),
    relay('vhc-relay-b', 431_000_000, 331_000_000),
  ]);
  makeSample(archiveRoot, '20260630T010000Z', '2026-06-30T01:00:00.000Z', [
    relay('vhc-relay-a', 422_000_000, 322_000_000),
    relay('vhc-relay-b', 432_000_000, 332_000_000),
  ]);

  const packet = phase5ScopeAWatchClosureInternal.buildPhase5ScopeAWatchClosurePacket({
    env: baseEnv(root),
    now: new Date('2026-06-30T01:00:00.000Z'),
  });

  assert.equal(packet.thresholds.twentyFourHour.status, 'pass');
  assert.equal(packet.thresholds.fortyEightHour.status, 'pass');
  assert.equal(packet.status, 'pass');
});

test('blocks the 48h threshold when relay heap trend projects below the safe horizon', () => {
  const root = tmpDir();
  const archiveRoot = path.join(root, 'archive');
  makeSample(archiveRoot, '20260628T000000Z', '2026-06-28T00:00:00.000Z', [
    relay('vhc-relay-a', 500_000_000, 400_000_000),
  ]);
  makeSample(archiveRoot, '20260629T000000Z', '2026-06-29T00:00:00.000Z', [
    relay('vhc-relay-a', 1_000_000_000, 900_000_000),
  ]);
  makeSample(archiveRoot, '20260630T010000Z', '2026-06-30T01:00:00.000Z', [
    relay('vhc-relay-a', 1_250_000_000, 1_200_000_000),
  ]);

  const packet = phase5ScopeAWatchClosureInternal.buildPhase5ScopeAWatchClosurePacket({
    env: baseEnv(root),
    now: new Date('2026-06-30T01:00:00.000Z'),
  });

  assert.equal(packet.thresholds.twentyFourHour.status, 'pass');
  assert.equal(packet.relayMemory.status, 'fail');
  assert.equal(packet.thresholds.fortyEightHour.status, 'fail');
  assert.deepEqual(packet.thresholds.fortyEightHour.blockers, ['relay_memory_trend_fail']);
});

test('keeps the packet in progress before the 24h threshold elapses', () => {
  const root = tmpDir();
  const archiveRoot = path.join(root, 'archive');
  makeSample(archiveRoot, '20260628T000000Z', '2026-06-28T00:00:00.000Z', [
    relay('vhc-relay-a', 420_000_000, 320_000_000),
  ]);

  const packet = phase5ScopeAWatchClosureInternal.buildPhase5ScopeAWatchClosurePacket({
    env: baseEnv(root),
    now: new Date('2026-06-28T10:00:00.000Z'),
  });

  assert.equal(packet.status, 'in_progress');
  assert.equal(packet.thresholds.twentyFourHour.status, 'not_ready');
  assert.equal(packet.thresholds.twentyFourHour.blockers[0], 'window_short:10.00/24');
});
