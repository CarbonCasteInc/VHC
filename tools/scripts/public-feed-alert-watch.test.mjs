#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publicFeedAlertWatchInternal } from './public-feed-alert-watch.mjs';

function tempRoot() {
  return mkdtempSync(path.join(os.tmpdir(), 'vh-public-feed-alert-'));
}

function activeSystemctl() {
  return [
    'ActiveState=active',
    'SubState=running',
    'NRestarts=0',
    'ExecMainStatus=0',
    'Result=success',
    '',
  ].join('\n');
}

function exit78Systemctl() {
  return [
    'ActiveState=failed',
    'SubState=failed',
    'NRestarts=0',
    'ExecMainStatus=78',
    'Result=exit-code',
    '',
  ].join('\n');
}

function exit69Systemctl({
  activeState = 'activating',
  subState = 'auto-restart',
  nRestarts = 1,
  result = 'exit-code',
} = {}) {
  return [
    `ActiveState=${activeState}`,
    `SubState=${subState}`,
    `NRestarts=${nRestarts}`,
    'ExecMainStatus=69',
    `Result=${result}`,
    '',
  ].join('\n');
}

function exit75Systemctl({
  activeState = 'failed',
  subState = 'failed',
  nRestarts = 0,
  result = 'exit-code',
} = {}) {
  return [
    `ActiveState=${activeState}`,
    `SubState=${subState}`,
    `NRestarts=${nRestarts}`,
    'ExecMainStatus=75',
    `Result=${result}`,
    '',
  ].join('\n');
}

function freshnessSummary(overrides = {}) {
  const now = overrides.now ?? Date.parse('2026-07-02T18:00:00.000Z');
  return {
    schemaVersion: 'public-feed-freshness-monitor-v1',
    generatedAt: new Date(now).toISOString(),
    status: 'pass',
    blockers: [],
    config: {
      origins: ['https://venn.carboncaste.io/', 'https://gun-a.carboncaste.io/'],
      maxAgeMs: 21_600_000,
    },
    latestIndexReadbacks: [
      {
        origin: 'https://venn.carboncaste.io/',
        status: 'pass',
        recordCount: 80,
        newestAgeMs: 120_000,
        maxAgeMs: 21_600_000,
        failures: [],
        storyIds: ['story-body-not-copied'],
      },
    ],
    ...overrides,
  };
}

function staleFreshnessSummary({
  now = Date.parse('2026-07-02T18:00:00.000Z'),
  newestAgeMs = 30_000_000,
  origin = 'https://venn.carboncaste.io/secret-path',
} = {}) {
  return freshnessSummary({
    now,
    status: 'fail',
    blockers: [`latest_index_not_fresh:${origin}:latest_index_stale:${newestAgeMs}/21600000`],
    latestIndexReadbacks: [
      {
        origin,
        status: 'fail',
        recordCount: 80,
        newestAgeMs,
        maxAgeMs: 21_600_000,
        failures: [`latest_index_stale:${newestAgeMs}/21600000`],
        storyIds: ['story-body-not-copied'],
      },
    ],
  });
}

function baseEnv(root, extra = {}) {
  return {
    HOME: root,
    VH_PUBLIC_FEED_ALERT_STATE_FILE: path.join(root, 'state.json'),
    VH_PUBLIC_FEED_ALERT_OUTPUT_FILE: path.join(root, 'latest.json'),
    ...extra,
  };
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function relayLivenessReport(overrides = {}) {
  return {
    schemaVersion: 'vh-news-relay-liveness-watch-v1',
    generatedAt: '2026-07-02T17:58:00.000Z',
    status: 'pass',
    blockers: [],
    relays: [
      {
        name: 'vhc-relay-a',
        origin: 'http://127.0.0.1:8765',
        status: 'pass',
        blockers: [],
        docker: { restartCount: 0 },
        metrics: {
          rssBytes: 420_000_000,
          heapUsedBytes: 320_000_000,
          watchdogTrips: 0,
          eventLoopLagP99Ms: 20,
          criticalReadbacksQueued: 0,
        },
      },
    ],
    ...overrides,
  };
}

function relaySnapshotReport(overrides = {}) {
  const file = '/home/humble/.local/share/vhc/vhc-relay-a/data/news-latest-index-snapshot.json';
  return {
    schemaVersion: 'vh-relay-latest-index-snapshot-watch-v1',
    generatedAt: '2026-07-02T17:58:00.000Z',
    status: 'pass',
    blockers: [],
    snapshots: [
      {
        file,
        status: 'pass',
        failures: [],
        entryCount: 80,
        cachedAgeMs: 60_000,
        newestEntryAgeMs: 120_000,
        freshnessFailures: [],
      },
    ],
    ...overrides,
  };
}

function watchClosureVerdict(overrides = {}) {
  return {
    schemaVersion: 'vh-phase5-scope-a-watch-closure-verdict-v1',
    generatedAt: '2026-07-02T17:58:00.000Z',
    status: 'in_progress',
    severity: 'info',
    blockers: ['window_short:10.00/24'],
    window: {
      startAt: '2026-07-02T08:00:00.000Z',
      cleanStartAt: '2026-07-02T08:00:00.000Z',
      hoursObserved: 10,
    },
    thresholds: {
      twentyFourHour: { thresholdHours: 24, status: 'not_ready', blockers: ['window_short:10.00/24'] },
      fortyEightHour: { thresholdHours: 48, status: 'not_ready', blockers: ['window_short:10.00/48'] },
    },
    relayMemory: {
      status: 'pass',
      heapPlateauVerdict: 'heap_driver_unknown',
      heapLimitSource: 'VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES',
      rssLimitSource: 'VH_RELAY_WATCHDOG_MAX_RSS_BYTES',
      relays: [
        {
          name: 'vhc-relay-a',
          trendStatus: 'pass',
          heapPlateauVerdict: 'heap_driver_unknown',
          heapLimitSource: 'VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES',
          shortestProjectedLimitHours: null,
        },
      ],
    },
    ...overrides,
  };
}

function writeAuxReports(root, {
  relay = relayLivenessReport(),
  snapshot = relaySnapshotReport(),
  closure = watchClosureVerdict(),
} = {}) {
  const relayFile = path.join(root, 'relay-liveness/latest.json');
  const snapshotFile = path.join(root, 'relay-snapshot/latest.json');
  const closureFile = path.join(root, 'watch-closure/verdict.json');
  writeJson(relayFile, relay);
  writeJson(snapshotFile, snapshot);
  writeJson(closureFile, closure);
  return {
    VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_LIVENESS: '1',
    VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_FILE: relayFile,
    VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_SNAPSHOT: '1',
    VH_PUBLIC_FEED_ALERT_RELAY_SNAPSHOT_FILE: snapshotFile,
    VH_PUBLIC_FEED_ALERT_REQUIRE_WATCH_CLOSURE: '1',
    VH_PUBLIC_FEED_ALERT_WATCH_CLOSURE_VERDICT_FILE: closureFile,
  };
}

test('passing feed and active publisher do not require an alert channel', async () => {
  const root = tempRoot();
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
    });

    assert.equal(summary.status, 'pass');
    assert.equal(summary.observedStatus, 'pass');
    assert.equal(summary.severity, 'none');
    assert.equal(summary.delivery.status, 'suppressed');
    assert.equal(summary.blockers.includes('alert_delivery_missing_channel'), false);
    assert.equal(summary.freshness.latestIndexReadbacks[0].storyIds, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('required relay, snapshot, and watch-closure reports pass without an alert channel', async () => {
  const root = tempRoot();
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, writeAuxReports(root)),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
    });

    assert.equal(summary.status, 'pass');
    assert.equal(summary.severity, 'none');
    assert.equal(summary.relayLiveness.status, 'pass');
    assert.equal(summary.relaySnapshot.status, 'pass');
    assert.equal(summary.watchClosure.status, 'pass');
    assert.equal(summary.watchClosure.verdictStatus, 'in_progress');
    assert.equal(summary.delivery.status, 'suppressed');
    assert.equal(JSON.stringify(summary).includes('127.0.0.1'), false);
    assert.equal(JSON.stringify(summary).includes('/home/humble'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay liveness failures page through the existing alert delivery path', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const env = baseEnv(root, {
      ...writeAuxReports(root, {
        relay: relayLivenessReport({
          status: 'fail',
          blockers: ['vhc-relay-b:readyz_failed:fetch failed'],
          relays: [
            {
              name: 'vhc-relay-b',
              origin: 'http://127.0.0.1:8766/private',
              status: 'fail',
              blockers: ['readyz_failed:fetch failed'],
              docker: { restartCount: 1 },
              metrics: {
                rssBytes: 1_200_000_000,
                heapUsedBytes: 920_000_000,
                watchdogTrips: 1,
                eventLoopLagP99Ms: 30,
                criticalReadbacksQueued: 0,
              },
            },
          ],
        }),
      }),
      VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token',
    });
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env,
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.severity, 'critical');
    assert.match(summary.blockers.join('\n'), /relay_liveness:vhc-relay-b:readyz_failed/);
    assert.equal(summary.delivery.status, 'sent');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.relayLiveness.status, 'fail');
    assert.equal(body.relayLiveness.relays[0].name, 'vhc-relay-b');
    assert.equal(body.relayLiveness.relays[0].origin, undefined);
    assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay snapshot failures redact absolute snapshot paths', async () => {
  const root = tempRoot();
  const calls = [];
  const snapshotPath = '/home/humble/.local/share/vhc/vhc-relay-a/data/news-latest-index-snapshot.json';
  try {
    const env = baseEnv(root, {
      ...writeAuxReports(root, {
        snapshot: relaySnapshotReport({
          status: 'fail',
          blockers: [`${snapshotPath}:newest_entry_stale:30000000/21600000`],
          snapshots: [
            {
              file: snapshotPath,
              status: 'fail',
              failures: ['newest_entry_stale:30000000/21600000'],
              entryCount: 80,
              cachedAgeMs: 60_000,
              newestEntryAgeMs: 30_000_000,
              freshnessFailures: ['newest_entry_stale:30000000/21600000'],
            },
          ],
        }),
      }),
      VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token',
    });
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env,
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.severity, 'warning');
    assert.equal(summary.relaySnapshot.status, 'fail');
    assert.equal(summary.relaySnapshot.severity, 'warning');
    assert.match(summary.blockers.join('\n'), /snapshot_file_hash:/);
    assert.equal(JSON.stringify(summary).includes(snapshotPath), false);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.relaySnapshot.snapshots[0].fileHash.length, 16);
    assert.equal(body.relaySnapshot.snapshots[0].relay, 'vhc-relay-a');
    assert.equal(JSON.stringify(body).includes('/home/humble'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stale auxiliary report output is warning severity and dedupes across age drift', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const env = baseEnv(root, {
      ...writeAuxReports(root, {
        relay: relayLivenessReport({ generatedAt: '2026-07-02T17:20:00.000Z' }),
      }),
      VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_MAX_AGE_MS: '600000',
      VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token',
    });
    const options = {
      env,
      repoRoot: root,
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    };
    const first = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
    });
    const second = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:05:00.000Z'),
    });

    assert.equal(first.status, 'fail');
    assert.equal(first.severity, 'warning');
    assert.equal(first.relayLiveness.severity, 'warning');
    assert.match(first.blockers.join('\n'), /relay_liveness_output_stale:/);
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(second.delivery.status, 'suppressed');
    assert.equal(calls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('watch-closure fail verdict pages as warning with threshold provenance', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const env = baseEnv(root, {
      ...writeAuxReports(root, {
        closure: watchClosureVerdict({
          status: 'fail',
          severity: 'critical',
          blockers: ['relay_memory_trend_fail'],
          thresholds: {
            twentyFourHour: { thresholdHours: 24, status: 'pass', blockers: [] },
            fortyEightHour: { thresholdHours: 48, status: 'fail', blockers: ['relay_memory_trend_fail'] },
          },
          relayMemory: {
            status: 'fail',
            heapPlateauVerdict: 'heap_still_linear',
            relays: [
              {
                name: 'vhc-relay-c',
                trendStatus: 'fail',
                heapPlateauVerdict: 'heap_still_linear',
                shortestProjectedLimitHours: 18,
              },
            ],
          },
        }),
      }),
      VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token',
    });
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env,
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.severity, 'warning');
    assert.equal(summary.watchClosure.status, 'fail');
    assert.equal(summary.watchClosure.severity, 'warning');
    assert.match(summary.blockers.join('\n'), /watch_closure:relay_memory_trend_fail/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.severity, 'warning');
    assert.equal(body.watchClosure.thresholds.fortyEightHour.status, 'fail');
    assert.equal(body.watchClosure.relayMemory.heapPlateauVerdict, 'heap_still_linear');
    assert.equal(body.watchClosure.relayMemory.relays[0].name, 'vhc-relay-c');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('watch-closure default heap limit provenance pages as warning', async () => {
  const root = tempRoot();
  try {
    const env = baseEnv(root, {
      ...writeAuxReports(root, {
        closure: watchClosureVerdict({
          relayMemory: {
            status: 'pass',
            heapPlateauVerdict: 'heap_plateau_observed',
            heapLimitSource: 'default:public-beta-compose',
            rssLimitSource: 'VH_RELAY_WATCHDOG_MAX_RSS_BYTES',
            relays: [
              {
                name: 'vhc-relay-a',
                trendStatus: 'pass',
                heapPlateauVerdict: 'heap_plateau_observed',
                heapLimitSource: 'default:public-beta-compose:relay-a',
                shortestProjectedLimitHours: 240,
              },
            ],
          },
        }),
      }),
      VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token',
    });
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env,
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async () => ({ ok: true, status: 204 }),
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.severity, 'warning');
    assert.equal(summary.watchClosure.severity, 'warning');
    assert.match(summary.blockers.join('\n'), /watch_closure_heap_limit_source_default:aggregate/);
    assert.match(summary.blockers.join('\n'), /watch_closure_heap_limit_source_default:vhc-relay-a/);
    assert.equal(summary.watchClosure.relayMemory.heapLimitSource, 'default:public-beta-compose');
    assert.equal(summary.watchClosure.relayMemory.relays[0].heapLimitSource, 'default:public-beta-compose:relay-a');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('state schema migration redelivers an unchanged failure once', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const env = baseEnv(root, {
      ...writeAuxReports(root, {
        snapshot: relaySnapshotReport({
          status: 'fail',
          blockers: ['newest_entry_stale:30000000/21600000'],
        }),
      }),
      VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token',
    });
    const options = {
      env,
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    };

    const first = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch(options);
    const state = JSON.parse(readFileSync(path.join(root, 'state.json'), 'utf8'));
    assert.equal(state.schemaVersion, 'vh-public-feed-alert-state-v2');
    assert.deepEqual(state.sourceStatuses, {
      publisher: 'pass',
      freshness: 'pass',
      relayLiveness: 'pass',
      relaySnapshot: 'fail',
      watchClosure: 'pass',
    });
    writeJson(path.join(root, 'state.json'), {
      ...state,
      schemaVersion: 'vh-public-feed-alert-state-v1',
    });

    const second = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch(options);

    assert.equal(first.fingerprint, second.fingerprint);
    assert.equal(second.delivery.status, 'sent');
    assert.equal(second.delivery.reason, 'state_changed');
    assert.equal(calls.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing required auxiliary reports fail closed before alert timer enablement', async () => {
  const root = tempRoot();
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, {
        VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_LIVENESS: '1',
        VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_SNAPSHOT: '1',
        VH_PUBLIC_FEED_ALERT_REQUIRE_WATCH_CLOSURE: '1',
        VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token',
      }),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async () => ({ ok: true, status: 204 }),
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.severity, 'critical');
    assert.deepEqual(summary.blockers.filter((blocker) => blocker.endsWith('_missing')).sort(), [
      'relay_liveness_report_missing',
      'relay_snapshot_report_missing',
      'watch_closure_verdict_missing',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('explicit auxiliary require false overrides configured default file paths', async () => {
  const root = tempRoot();
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, {
        VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_LIVENESS: 'false',
        VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_FILE: path.join(root, 'missing-relay.json'),
        VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_SNAPSHOT: 'false',
        VH_PUBLIC_FEED_ALERT_RELAY_SNAPSHOT_FILE: path.join(root, 'missing-snapshot.json'),
        VH_PUBLIC_FEED_ALERT_REQUIRE_WATCH_CLOSURE: 'false',
        VH_PUBLIC_FEED_ALERT_WATCH_CLOSURE_VERDICT_FILE: path.join(root, 'missing-verdict.json'),
      }),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
    });

    assert.equal(summary.status, 'pass');
    assert.equal(summary.relayLiveness.status, 'skipped');
    assert.equal(summary.relaySnapshot.status, 'skipped');
    assert.equal(summary.watchClosure.status, 'skipped');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stale feed sends a webhook on state change with secret-safe aggregate payload', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, { VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token' }),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => staleFreshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.delivery.status, 'sent');
    assert.equal(summary.delivery.reason, 'first_failure');
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.alertReason, 'first_failure');
    assert.equal(body.severity, 'critical');
    assert.equal(body.blockers.some((blocker) => blocker.includes('url_hash:')), true);
    assert.equal(body.freshness.latestIndexReadbacks[0].origin, undefined);
    assert.equal(body.freshness.latestIndexReadbacks[0].originHash.length, 16);
    assert.equal(JSON.stringify(body).includes('story-body-not-copied'), false);
    assert.equal(JSON.stringify(body).includes('venn.carboncaste.io'), false);
    assert.equal(JSON.stringify(body).includes('secret-path'), false);
    assert.equal(JSON.stringify(body).includes('hooks.example.invalid'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('same stale-feed class suppresses repeat delivery even as monitor ages advance', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    let run = 0;
    const options = {
      env: baseEnv(root, { VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token' }),
      repoRoot: root,
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => {
        run += 1;
        return staleFreshnessSummary({
          now: Date.parse('2026-07-02T18:00:00.000Z') + (run - 1) * 300_000,
          newestAgeMs: 30_000_000 + (run - 1) * 300_000,
        });
      },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    };
    const first = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
    });
    const second = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:05:00.000Z'),
    });

    assert.equal(first.delivery.status, 'sent');
    assert.equal(second.delivery.status, 'suppressed');
    assert.equal(second.delivery.reason, 'unchanged_suppressed');
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(calls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed delivery is retried for the same observed failure until one channel succeeds', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const options = {
      env: baseEnv(root, { VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token' }),
      repoRoot: root,
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => staleFreshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return calls.length === 1
          ? { ok: false, status: 503 }
          : { ok: true, status: 204 };
      },
    };

    const first = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
    });
    const second = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:05:00.000Z'),
    });

    assert.equal(first.delivery.status, 'failed');
    assert.equal(first.status, 'fail');
    assert.equal(second.delivery.status, 'sent');
    assert.equal(second.delivery.reason, 'retry_failed_delivery');
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(calls.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('heartbeat interval can resend an unchanged state', async () => {
  const root = tempRoot();
  const calls = [];
  const stale = freshnessSummary({
    status: 'fail',
    blockers: ['latest_index_not_fresh:origin:latest_index_stale:30000000/21600000'],
  });
  try {
    const options = {
      env: baseEnv(root, {
        VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token',
        VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS: '600000',
      }),
      repoRoot: root,
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => stale,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    };
    await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
    });
    const second = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:11:00.000Z'),
    });

    assert.equal(second.delivery.status, 'sent');
    assert.equal(second.delivery.reason, 'heartbeat_due');
    assert.equal(calls.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publisher exit 78 is a fail-close alert and can deliver through sendmail', async () => {
  const root = tempRoot();
  const mail = [];
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, {
        VH_PUBLIC_FEED_ALERT_EMAIL_TO: 'operator@example.invalid',
        VH_PUBLIC_FEED_ALERT_SENDMAIL: '/usr/sbin/sendmail',
      }),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: exit78Systemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      spawnSyncImpl: (command, args, options) => {
        mail.push({ command, args, input: options.input });
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.severity, 'critical');
    assert.equal(summary.publisher.failureClass, 'exit_78_fail_closed');
    assert.equal(summary.publisher.severity, 'critical');
    assert.equal(summary.publisher.recoveryHint, 'operator_required');
    assert.match(summary.blockers.join('\n'), /publisher_exit_78/);
    assert.equal(summary.delivery.status, 'sent');
    assert.equal(mail.length, 1);
    assert.match(mail[0].input, /operator@example\.invalid/);
    assert.match(mail[0].input, /exit_78_fail_closed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publisher exit 69 is a warning transport alert distinct from exit 78', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, { VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token' }),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: exit69Systemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.severity, 'warning');
    assert.equal(summary.publisher.failureClass, 'exit_69_transport_unavailable');
    assert.equal(summary.publisher.severity, 'warning');
    assert.equal(summary.publisher.recoveryHint, 'bounded_systemd_restart_in_progress');
    assert.match(summary.blockers.join('\n'), /publisher_exit_69_transport_unavailable:activating\/auto-restart/);
    assert.doesNotMatch(summary.blockers.join('\n'), /publisher_exit_78/);
    assert.equal(summary.delivery.status, 'sent');
    assert.equal(summary.delivery.reason, 'first_failure');
    assert.equal(calls.length, 1);

    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.publisher.failureClass, 'exit_69_transport_unavailable');
    assert.equal(body.severity, 'warning');
    assert.equal(body.publisher.severity, 'warning');
    assert.equal(body.publisher.recoveryHint, 'bounded_systemd_restart_in_progress');
    assert.equal(JSON.stringify(body).includes('exit_78_fail_closed'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publisher exit 69 parked by start limit is critical and not self-recovering', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, { VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token' }),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: exit69Systemctl({
        activeState: 'failed',
        subState: 'failed',
        nRestarts: 3,
        result: 'start-limit-hit',
      }),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.severity, 'critical');
    assert.equal(summary.publisher.failureClass, 'exit_69_start_limit_parked');
    assert.equal(summary.publisher.severity, 'critical');
    assert.equal(summary.publisher.recoveryHint, 'start_limit_exhausted_operator_restart_required');
    assert.match(summary.blockers.join('\n'), /publisher_exit_69_start_limit_parked:failed\/failed:start-limit-hit/);
    assert.doesNotMatch(summary.blockers.join('\n'), /publisher_exit_78/);
    assert.equal(summary.delivery.status, 'sent');
    assert.equal(calls.length, 1);

    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.severity, 'critical');
    assert.equal(body.publisher.failureClass, 'exit_69_start_limit_parked');
    assert.equal(body.publisher.recoveryHint, 'start_limit_exhausted_operator_restart_required');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publisher exit 69 with start-limit result is critical even if substate still says auto-restart', () => {
  const publisher = publicFeedAlertWatchInternal.inspectPublisherUnit({
    env: {},
    systemctlShowText: exit69Systemctl({
      activeState: 'activating',
      subState: 'auto-restart',
      nRestarts: 3,
      result: 'start-limit-hit',
    }),
  });

  assert.equal(publisher.status, 'fail');
  assert.equal(publisher.failureClass, 'exit_69_start_limit_parked');
  assert.equal(publisher.severity, 'critical');
  assert.equal(publisher.recoveryHint, 'start_limit_exhausted_operator_restart_required');
  assert.match(publisher.blockers.join('\n'), /publisher_exit_69_start_limit_parked/);
});

test('publisher exit 75 wrapper refusal is critical', async () => {
  const root = tempRoot();
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, { VH_PUBLIC_FEED_ALERT_EMAIL_TO: 'operator@example.invalid' }),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: exit75Systemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      spawnSyncImpl: () => ({ status: 0, stdout: '', stderr: '' }),
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.severity, 'critical');
    assert.equal(summary.publisher.failureClass, 'exit_75_wrapper_refusal');
    assert.equal(summary.publisher.severity, 'critical');
    assert.equal(summary.publisher.recoveryHint, 'operator_required');
    assert.match(summary.blockers.join('\n'), /publisher_exit_75_wrapper_refusal:failed\/failed:exit-code/);
    assert.equal(summary.delivery.status, 'sent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publisher recovery after parked exit 69 sends a state-changed pass alert', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const options = {
      env: baseEnv(root, { VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token' }),
      repoRoot: root,
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    };
    const first = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: exit69Systemctl({ activeState: 'failed', subState: 'failed', nRestarts: 3 }),
    });
    const second = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      ...options,
      now: Date.parse('2026-07-02T18:05:00.000Z'),
      systemctlShowText: activeSystemctl(),
    });

    assert.equal(first.status, 'fail');
    assert.equal(first.publisher.failureClass, 'exit_69_start_limit_parked');
    assert.equal(second.status, 'pass');
    assert.equal(second.observedStatus, 'pass');
    assert.equal(second.publisher.failureClass, 'none');
    assert.equal(second.publisher.severity, 'none');
    assert.equal(second.publisher.recoveryHint, 'none');
    assert.equal(second.delivery.status, 'sent');
    assert.equal(second.delivery.reason, 'state_changed');
    assert.equal(calls.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publisher restart churn is warning severity and dedupes by class', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const env = baseEnv(root, { VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token' });
    const first = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env,
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async () => ({ ok: true, status: 204 }),
    });
    assert.equal(first.status, 'pass');

    const second = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env,
      repoRoot: root,
      now: Date.parse('2026-07-02T18:05:00.000Z'),
      systemctlShowText: [
        'ActiveState=active',
        'SubState=running',
        'NRestarts=1',
        'ExecMainStatus=0',
        'Result=success',
        '',
      ].join('\n'),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });
    const third = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env,
      repoRoot: root,
      now: Date.parse('2026-07-02T18:10:00.000Z'),
      systemctlShowText: [
        'ActiveState=active',
        'SubState=running',
        'NRestarts=9',
        'ExecMainStatus=0',
        'Result=success',
        '',
      ].join('\n'),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });

    assert.equal(second.status, 'fail');
    assert.equal(second.observedStatus, 'fail');
    assert.equal(second.severity, 'warning');
    assert.deepEqual(second.blockers, ['publisher_restart_churn:0/1']);
    assert.equal(second.delivery.status, 'sent');
    assert.equal(second.delivery.reason, 'state_changed');
    assert.equal(third.status, 'fail');
    assert.equal(third.severity, 'warning');
    assert.deepEqual(third.blockers, ['publisher_restart_churn:1/9']);
    assert.equal(third.fingerprint, second.fingerprint);
    assert.equal(third.delivery.status, 'suppressed');
    assert.equal(calls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('webhook delivery errors redact configured webhook URL from output', async () => {
  const root = tempRoot();
  const webhookUrl = 'not-a-url-secret-token';
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, { VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: webhookUrl }),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: exit78Systemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async () => {
        throw new TypeError(`Failed to parse URL from ${webhookUrl}`);
      },
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.delivery.status, 'failed');
    assert.match(summary.delivery.error, /value_hash:/);
    assert.equal(summary.delivery.error.includes(webhookUrl), false);

    const output = readFileSync(path.join(root, 'latest.json'), 'utf8');
    assert.equal(output.includes(webhookUrl), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('test-fire sends a pass heartbeat without changing observed status', async () => {
  const root = tempRoot();
  const calls = [];
  try {
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: baseEnv(root, {
        VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token',
        VH_PUBLIC_FEED_ALERT_TEST_FIRE: '1',
      }),
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 204 };
      },
    });

    assert.equal(summary.observedStatus, 'pass');
    assert.equal(summary.status, 'pass');
    assert.equal(summary.delivery.status, 'sent');
    assert.equal(summary.delivery.reason, 'test_fire');
    assert.equal(calls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('alert output and state files are persisted for operator inspection', async () => {
  const root = tempRoot();
  try {
    const env = baseEnv(root, { VH_PUBLIC_FEED_ALERT_WEBHOOK_URL: 'https://hooks.example.invalid/token' });
    const summary = await publicFeedAlertWatchInternal.runPublicFeedAlertWatch({
      env: {
        ...env,
        VH_PUBLIC_FEED_ALERT_TEST_FIRE: '1',
      },
      repoRoot: root,
      now: Date.parse('2026-07-02T18:00:00.000Z'),
      systemctlShowText: activeSystemctl(),
      freshnessMonitorImpl: async () => freshnessSummary(),
      fetchImpl: async () => ({ ok: true, status: 204 }),
    });

    const output = JSON.parse(readFileSync(env.VH_PUBLIC_FEED_ALERT_OUTPUT_FILE, 'utf8'));
    const state = JSON.parse(readFileSync(env.VH_PUBLIC_FEED_ALERT_STATE_FILE, 'utf8'));
    assert.equal(output.fingerprint, summary.fingerprint);
    assert.equal(state.lastObservedFingerprint, summary.fingerprint);
    assert.equal(state.lastDeliveredFingerprint, summary.fingerprint);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
