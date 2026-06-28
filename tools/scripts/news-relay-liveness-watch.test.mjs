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
} = {}) {
  return [
    `vh_relay_process_rss_bytes ${rss}`,
    `vh_relay_process_heap_used_bytes ${heap}`,
    `vh_relay_event_loop_lag_p99_ms ${lagP99}`,
    'vh_relay_event_loop_lag_max_ms 40',
    'vh_relay_critical_write_readbacks_active 0',
    `vh_relay_critical_write_readbacks_queued ${queued}`,
    `vh_relay_resource_watchdog_trips_total{reason="rss_bytes"} ${watchdogTrips}`,
    '',
  ].join('\n');
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

test('relay liveness defaults heap threshold to the public-beta watchdog ceiling', async () => {
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
    assert.match(summary.blockers.join('\n'), /vhc-relay-a:heap_hot:1200000000\/1100000000/);
    assert.equal(summary.config.maxHeapUsedBytes, 1_100_000_000);
    assert.equal(summary.config.maxHeapUsedBytesSource, 'default:public-beta-compose');
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
