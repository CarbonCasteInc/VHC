#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    assert.equal(summary.delivery.status, 'suppressed');
    assert.equal(summary.blockers.includes('alert_delivery_missing_channel'), false);
    assert.equal(summary.freshness.latestIndexReadbacks[0].storyIds, undefined);
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
    assert.equal(summary.publisher.failureClass, 'exit_78_fail_closed');
    assert.match(summary.blockers.join('\n'), /publisher_exit_78/);
    assert.equal(summary.delivery.status, 'sent');
    assert.equal(mail.length, 1);
    assert.match(mail[0].input, /operator@example\.invalid/);
    assert.match(mail[0].input, /exit_78_fail_closed/);
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
