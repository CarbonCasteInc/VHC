import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runNewsRelayLivenessWatch } from './news-relay-liveness-watch.mjs';

const NOW = Date.now();

function makeTempState() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-relay-liveness-'));
  const stateFile = path.join(root, 'state.json');
  const outputFile = path.join(root, 'latest.json');
  return { root, stateFile, outputFile };
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function baseEnv(paths) {
  return {
    VH_RELAY_LIVENESS_TARGETS: 'vhc-relay-a=http://127.0.0.1:8765,vhc-relay-b=http://127.0.0.1:8766',
    VH_RELAY_LIVENESS_STATE_FILE: paths.stateFile,
    VH_RELAY_LIVENESS_OUTPUT_FILE: paths.outputFile,
    VH_RELAY_LIVENESS_SYSLOG: 'false',
  };
}

function metrics({
  rss = 120_000_000,
  heap = 80_000_000,
  lagP99 = 25,
  queued = 0,
  watchdogTrips = 0,
  graph = false,
  graphTruncated = 0,
  earlyHeapSnapshot = null,
} = {}) {
  const rows = [
    `vh_relay_process_rss_bytes ${rss}`,
    `vh_relay_process_heap_used_bytes ${heap}`,
    `vh_relay_event_loop_lag_p99_ms ${lagP99}`,
    'vh_relay_event_loop_lag_max_ms 40',
    'vh_relay_critical_write_readbacks_active 0',
    `vh_relay_critical_write_readbacks_queued ${queued}`,
    `vh_relay_resource_watchdog_trips_total{reason="rss_bytes"} ${watchdogTrips}`,
  ];
  if (graph) {
    rows.push(
      'vh_relay_gun_graph_scan_enabled 1',
      'vh_relay_gun_graph_scan_running 0',
      'vh_relay_gun_graph_scan_successes_total 3',
      'vh_relay_gun_graph_scan_errors_total 0',
      `vh_relay_gun_graph_scan_truncated ${graphTruncated}`,
      `vh_relay_gun_graph_scan_truncated_total ${graphTruncated}`,
      'vh_relay_gun_graph_scan_duration_ms 42',
      'vh_relay_gun_graph_scan_age_ms 1000',
      'vh_relay_gun_graph_scan_scanned_souls 19',
      'vh_relay_gun_graph_souls_total{namespace="news_story",state="live"} 10',
      'vh_relay_gun_graph_souls_total{namespace="news_story",state="tombstoned"} 2',
      'vh_relay_gun_graph_user_fields_total{namespace="news_story",state="live"} 80',
      'vh_relay_gun_graph_user_fields_total{namespace="news_story",state="tombstoned"} 14',
      'vh_relay_gun_graph_user_value_bytes{namespace="news_story",state="live"} 12000',
      'vh_relay_gun_graph_user_value_bytes{namespace="news_story",state="tombstoned"} 0',
      'vh_relay_gun_graph_souls_total{namespace="news_latest_index",state="live"} 4',
      'vh_relay_gun_graph_user_fields_total{namespace="news_latest_index",state="live"} 20',
      'vh_relay_gun_graph_user_value_bytes{namespace="news_latest_index",state="live"} 3000',
      'vh_relay_gun_graph_souls_total{namespace="other",state="link_only"} 3',
      'vh_relay_gun_graph_user_fields_total{namespace="other",state="link_only"} 0',
      'vh_relay_gun_graph_user_value_bytes{namespace="other",state="link_only"} 0',
    );
  }
  if (earlyHeapSnapshot) {
    const {
      enabled = 1,
      inFlight = 0,
      thresholds = [{ thresholdIndex: 1, thresholdBytes: 500_000_000, captured: false }],
    } = earlyHeapSnapshot;
    rows.push(
      `vh_relay_watchdog_early_heap_snapshot_enabled ${enabled}`,
      `vh_relay_watchdog_early_heap_snapshot_in_flight ${inFlight}`,
    );
    for (const threshold of thresholds) {
      rows.push(
        `vh_relay_watchdog_early_heap_snapshot_threshold_bytes{threshold_index="${threshold.thresholdIndex}",threshold_bytes="${threshold.thresholdBytes}"} ${threshold.thresholdBytes}`,
        `vh_relay_watchdog_early_heap_snapshot_captured{threshold_index="${threshold.thresholdIndex}",threshold_bytes="${threshold.thresholdBytes}"} ${threshold.captured ? 1 : 0}`,
      );
      if (threshold.captureStatus) {
        rows.push(`vh_relay_watchdog_early_heap_snapshot_captures_total{threshold_index="${threshold.thresholdIndex}",threshold_bytes="${threshold.thresholdBytes}",status="${threshold.captureStatus}"} 1`);
      }
    }
  }
  rows.push('');
  return rows.join('\n');
}

function makeFetch(responses) {
  return async (url) => {
    const text = responses.get(String(url));
    if (text === undefined) {
      return new Response('missing', { status: 404 });
    }
    return new Response(text, {
      status: 200,
      headers: { 'content-type': String(url).endsWith('/metrics') ? 'text/plain' : 'application/json' },
    });
  };
}

function makeSpawn(restarts = {}, calls = [], restartFailures = {}) {
  return (command, args) => {
    calls.push({ command, args: [...args] });
    if (command === 'docker' && args[0] === 'inspect') {
      return {
        status: 0,
        stdout: `${restarts[args[1]] ?? 0}\n`,
        stderr: '',
      };
    }
    if (command === 'docker' && args[0] === 'restart') {
      if (restartFailures[args[1]]) {
        return { status: 1, stdout: '', stderr: restartFailures[args[1]] };
      }
      return { status: 0, stdout: `${args[1]}\n`, stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

test('relay liveness passes for healthy readyz, metrics, and stable restart counts', async () => {
  const paths = makeTempState();
  try {
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics()],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics()],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn({ 'vhc-relay-a': 0, 'vhc-relay-b': 0 }),
    });

    assert.equal(summary.status, 'pass');
    assert.equal(summary.relays.length, 2);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness captures cached graph metrics without making them blockers', async () => {
  const paths = makeTempState();
  try {
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({ graph: true, graphTruncated: 1 })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics()],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn({ 'vhc-relay-a': 0, 'vhc-relay-b': 0 }),
    });

    assert.equal(summary.status, 'pass');
    const graphScan = summary.relays[0].metrics.graphScan;
    assert.equal(graphScan.enabled, true);
    assert.equal(graphScan.truncated, true);
    assert.equal(graphScan.totalSouls, 19);
    assert.equal(graphScan.liveUserValueBytes, 15_000);
    assert.equal(graphScan.tombstonedSouls, 2);
    assert.equal(graphScan.namespaceLiveUserValueBytes.news_story, 12_000);
    assert.equal(graphScan.namespaceLiveUserValueBytes.news_latest_index, 3_000);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness fails hot metrics even when readyz is healthy', async () => {
  const paths = makeTempState();
  try {
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({ rss: 2_000_000_000, lagP99: 3_000 })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics()],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn(),
    });

    assert.equal(summary.status, 'fail');
    assert.match(summary.blockers.join('\n'), /vhc-relay-a:rss_hot:/);
    assert.match(summary.blockers.join('\n'), /vhc-relay-a:event_loop_lag_hot:/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness fails when heap crosses early-capture threshold before a capture', async () => {
  const paths = makeTempState();
  try {
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({
        heap: 550_000_000,
        earlyHeapSnapshot: {
          thresholds: [
            { thresholdIndex: 1, thresholdBytes: 500_000_000, captured: false },
            { thresholdIndex: 2, thresholdBytes: 700_000_000, captured: false },
          ],
        },
      })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics()],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn(),
    });

    assert.equal(summary.status, 'fail');
    assert.match(summary.blockers.join('\n'), /vhc-relay-a:early_heap_snapshot_missing:550000000\/500000000/);
    assert.deepEqual(summary.relays[0].metrics.earlyHeapSnapshot.thresholds, [
      { thresholdIndex: 1, thresholdBytes: 500_000_000, captured: false },
      { thresholdIndex: 2, thresholdBytes: 700_000_000, captured: false },
    ]);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness passes early-capture threshold once the first capture is recorded', async () => {
  const paths = makeTempState();
  try {
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({
        heap: 550_000_000,
        earlyHeapSnapshot: {
          thresholds: [
            { thresholdIndex: 1, thresholdBytes: 500_000_000, captured: true, captureStatus: 'success' },
            { thresholdIndex: 2, thresholdBytes: 700_000_000, captured: false },
          ],
        },
      })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics()],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn(),
    });

    assert.equal(summary.status, 'pass');
    assert.deepEqual(summary.relays[0].metrics.earlyHeapSnapshot.captureTotals, [
      { thresholdIndex: 1, thresholdBytes: 500_000_000, status: 'success', count: 1 },
    ]);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness defaults heap threshold to the public-beta per-relay watchdog ceilings', async () => {
  const paths = makeTempState();
  try {
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({ heap: 1_200_000_000 })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics()],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn(),
    });

    assert.equal(summary.status, 'fail');
    assert.match(summary.blockers.join('\n'), /vhc-relay-a:heap_hot:1200000000\/850000000/);
    assert.equal(summary.config.maxHeapUsedBytes, 1_100_000_000);
    assert.equal(summary.config.maxHeapUsedBytesSource, 'default:public-beta-compose');
    assert.deepEqual(summary.config.perRelayMaxHeapUsedBytes, {
      'vhc-relay-a': 850_000_000,
      'vhc-relay-b': 1_000_000_000,
    });
    assert.deepEqual(summary.config.perRelayMaxHeapUsedBytesSource, {
      'vhc-relay-a': 'default:public-beta-compose:relay-a',
      'vhc-relay-b': 'default:public-beta-compose:relay-b',
    });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness uses deployed watchdog threshold env before its default ceiling', async () => {
  const paths = makeTempState();
  try {
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({ heap: 1_200_000_000 })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics()],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: {
        ...baseEnv(paths),
        VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES: '1300000000',
      },
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn(),
    });

    assert.equal(summary.status, 'pass');
    assert.equal(summary.config.maxHeapUsedBytes, 1_300_000_000);
    assert.equal(summary.config.maxHeapUsedBytesSource, 'VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES');
    assert.deepEqual(summary.config.perRelayMaxHeapUsedBytes, {
      'vhc-relay-a': 1_300_000_000,
      'vhc-relay-b': 1_300_000_000,
    });
    assert.deepEqual(summary.config.perRelayMaxHeapUsedBytesSource, {
      'vhc-relay-a': 'VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES',
      'vhc-relay-b': 'VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES',
    });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness uses per-relay watchdog threshold env before shared watchdog env', async () => {
  const paths = makeTempState();
  try {
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({ heap: 900_000_000 })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics({ heap: 1_200_000_000 })],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: {
        ...baseEnv(paths),
        VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES: '2000000000',
        VH_RELAY_A_WATCHDOG_MAX_HEAP_USED_BYTES: '850000000',
        VH_RELAY_B_WATCHDOG_MAX_HEAP_USED_BYTES: '1300000000',
      },
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn(),
    });

    assert.equal(summary.status, 'fail');
    assert.deepEqual(summary.blockers, ['vhc-relay-a:heap_hot:900000000/850000000']);
    assert.deepEqual(summary.config.perRelayMaxHeapUsedBytes, {
      'vhc-relay-a': 850_000_000,
      'vhc-relay-b': 1_300_000_000,
    });
    assert.deepEqual(summary.config.perRelayMaxHeapUsedBytesSource, {
      'vhc-relay-a': 'VH_RELAY_A_WATCHDOG_MAX_HEAP_USED_BYTES',
      'vhc-relay-b': 'VH_RELAY_B_WATCHDOG_MAX_HEAP_USED_BYTES',
    });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness fails restart and watchdog-trip increases from baseline', async () => {
  const paths = makeTempState();
  try {
    writeJson(paths.stateFile, {
      schemaVersion: 'vh-news-relay-liveness-watch-state-v1',
      generatedAt: new Date(NOW - 60_000).toISOString(),
      relays: [
        { name: 'vhc-relay-a', restartCount: 1, watchdogTrips: 0 },
        { name: 'vhc-relay-b', restartCount: 0, watchdogTrips: 0 },
      ],
    });
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({ watchdogTrips: 1 })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics()],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn({ 'vhc-relay-a': 2, 'vhc-relay-b': 0 }),
    });

    assert.equal(summary.status, 'fail');
    assert.match(summary.blockers.join('\n'), /vhc-relay-a:restart_count_increased:1\/2/);
    assert.match(summary.blockers.join('\n'), /vhc-relay-a:watchdog_trips_increased:0\/1/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness restarts at most one eligible hot relay when remediation is enabled', async () => {
  const paths = makeTempState();
  try {
    const calls = [];
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({ rss: 2_000_000_000 })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics({ lagP99: 3_000 })],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: {
        ...baseEnv(paths),
        VH_RELAY_LIVENESS_RESTART_ON_FAIL: 'true',
        VH_RELAY_LIVENESS_RESTART_MAX_PER_RUN: '1',
      },
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn({ 'vhc-relay-a': 0, 'vhc-relay-b': 0 }, calls),
    });

    assert.equal(summary.status, 'fail');
    assert.deepEqual(
      calls.filter((call) => call.command === 'docker' && call.args[0] === 'restart').map((call) => call.args),
      [['restart', 'vhc-relay-a']],
    );
    assert.equal(summary.remediations.find((entry) => entry.relay === 'vhc-relay-a')?.status, 'started');
    assert.equal(summary.remediations.find((entry) => entry.relay === 'vhc-relay-b')?.status, 'skipped_max_per_run');
    const state = JSON.parse(readFileSync(paths.stateFile, 'utf8'));
    assert.equal(state.relays.find((entry) => entry.name === 'vhc-relay-a')?.lastRemediationAtMs, NOW);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness remediation observes cooldown and ignores restart evidence alone', async () => {
  const paths = makeTempState();
  try {
    writeJson(paths.stateFile, {
      schemaVersion: 'vh-news-relay-liveness-watch-state-v1',
      generatedAt: new Date(NOW - 60_000).toISOString(),
      relays: [
        { name: 'vhc-relay-a', restartCount: 0, watchdogTrips: 0, lastRemediationAtMs: NOW - 30_000 },
        { name: 'vhc-relay-b', restartCount: 0, watchdogTrips: 0, lastRemediationAtMs: null },
      ],
    });
    const calls = [];
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({ rss: 2_000_000_000 })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics({ watchdogTrips: 1 })],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: {
        ...baseEnv(paths),
        VH_RELAY_LIVENESS_RESTART_ON_FAIL: 'true',
        VH_RELAY_LIVENESS_RESTART_MIN_INTERVAL_MS: '600000',
      },
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn({ 'vhc-relay-a': 0, 'vhc-relay-b': 1 }, calls),
    });

    assert.equal(summary.status, 'fail');
    assert.deepEqual(
      calls.filter((call) => call.command === 'docker' && call.args[0] === 'restart'),
      [],
    );
    assert.equal(summary.remediations.find((entry) => entry.relay === 'vhc-relay-a')?.status, 'skipped_cooldown');
    assert.equal(summary.remediations.find((entry) => entry.relay === 'vhc-relay-b'), undefined);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('relay liveness does not attempt a second relay restart after a failed restart command', async () => {
  const paths = makeTempState();
  try {
    const calls = [];
    const responses = new Map([
      ['http://127.0.0.1:8765/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8765/metrics', metrics({ rss: 2_000_000_000 })],
      ['http://127.0.0.1:8766/readyz', JSON.stringify({ ok: true })],
      ['http://127.0.0.1:8766/metrics', metrics({ heap: 1_400_000_000 })],
    ]);
    const summary = await runNewsRelayLivenessWatch({
      now: NOW,
      env: {
        ...baseEnv(paths),
        VH_RELAY_LIVENESS_RESTART_ON_FAIL: 'true',
        VH_RELAY_LIVENESS_RESTART_MAX_PER_RUN: '1',
      },
      fetchImpl: makeFetch(responses),
      spawnSyncImpl: makeSpawn(
        { 'vhc-relay-a': 0, 'vhc-relay-b': 0 },
        calls,
        { 'vhc-relay-a': 'permission denied' },
      ),
    });

    assert.equal(summary.status, 'fail');
    assert.deepEqual(
      calls.filter((call) => call.command === 'docker' && call.args[0] === 'restart').map((call) => call.args),
      [['restart', 'vhc-relay-a']],
    );
    assert.equal(summary.remediations.find((entry) => entry.relay === 'vhc-relay-a')?.status, 'failed');
    assert.equal(summary.remediations.find((entry) => entry.relay === 'vhc-relay-b')?.status, 'skipped_max_per_run');
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});
