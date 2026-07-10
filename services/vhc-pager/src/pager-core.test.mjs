import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKvPagerStore,
  createMemoryPagerStore,
  handleA6Alert,
  handleAck,
  handlePushSubscribe,
  incidentKeyForAlert,
  missingHeartbeatIncident,
  signA6Alert,
} from './pager-core.mjs';

function createFakeKv() {
  const map = new Map();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
    async list({ prefix = '' } = {}) {
      return { keys: [...map.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })) };
    },
  };
}

const baseAlert = {
  schemaVersion: 'vh-public-feed-alert-watch-v1',
  generatedAt: '2026-07-06T00:00:00.000Z',
  alertReason: 'first_failure',
  status: 'fail',
  observedStatus: 'fail',
  severity: 'critical',
  blockers: ['publisher_exit_69_start_limit_parked:failed/failed:start-limit-hit'],
  fingerprint: 'fingerprint-a',
  publisher: {
    status: 'fail',
    failureClass: 'exit_69_start_limit_parked',
    activeState: 'failed',
    subState: 'failed',
    execMainStatus: '69',
    result: 'start-limit-hit',
  },
};

test('incident key correlates exit-69 warning and critical in one issue', () => {
  assert.equal(incidentKeyForAlert(baseAlert), 'a6:public-feed:exit_69');
  assert.equal(incidentKeyForAlert({
    ...baseAlert,
    severity: 'warning',
    publisher: { ...baseAlert.publisher, failureClass: 'exit_69_transport_unavailable' },
  }), 'a6:public-feed:exit_69');
});

test('v1 and v2 producer blockers preserve pager incident-family continuity', () => {
  const cases = [
    {
      expected: 'a6:public-feed:public_feed',
      v1: 'public_feed_status:fail',
      v2: 'public_feed:latest_index_not_fresh',
    },
    {
      expected: 'a6:public-feed:relay_liveness',
      v1: 'relay_liveness_report_missing',
      v2: 'relay_liveness:relay:1:readyz_failed',
    },
    {
      expected: 'a6:public-feed:relay_snapshot',
      v1: 'relay_snapshot_report_missing',
      v2: 'relay_snapshot:newest_entry_stale',
    },
    {
      expected: 'a6:public-feed:watch_closure',
      v1: 'watch_closure_verdict_missing',
      v2: 'watch_closure:archive_sample_failures',
    },
  ];

  for (const { expected, v1, v2 } of cases) {
    const legacyKey = incidentKeyForAlert({
      ...baseAlert,
      schemaVersion: 'vh-public-feed-alert-watch-v1',
      publisher: { failureClass: 'none' },
      blockers: [v1],
    });
    const currentKey = incidentKeyForAlert({
      ...baseAlert,
      schemaVersion: 'vh-public-feed-alert-watch-v2',
      publisher: { failureClass: 'none' },
      blockers: [v2],
    });

    assert.equal(legacyKey, expected);
    assert.equal(currentKey, expected);
  }
});

test('signed ingest persists before returning success and latches unsigned mode off', async () => {
  const store = createMemoryPagerStore();
  const bodyText = JSON.stringify(baseAlert);
  const timestamp = String(Date.parse('2026-07-06T00:00:00.000Z'));
  const nonce = 'nonce-a';
  const signature = await signA6Alert({ secret: 'secret', timestamp, nonce, bodyText });
  const result = await handleA6Alert({
    bodyText,
    headers: {
      'x-vhc-alert-timestamp': timestamp,
      'x-vhc-alert-nonce': nonce,
      'x-vhc-alert-signature': signature,
    },
    env: { VH_PAGER_A6_WEBHOOK_SECRET: 'secret' },
    store,
    nowMs: Date.parse('2026-07-06T00:00:01.000Z'),
  });
  assert.equal(result.status, 202);
  assert.equal(store.state.alerts.length, 1);
  assert.equal(await store.unsignedBootstrapDisabled(), true);
});

test('replayed nonce is refused', async () => {
  const store = createMemoryPagerStore();
  const bodyText = JSON.stringify(baseAlert);
  const timestamp = String(Date.parse('2026-07-06T00:00:00.000Z'));
  const nonce = 'nonce-a';
  const signature = await signA6Alert({ secret: 'secret', timestamp, nonce, bodyText });
  const args = {
    bodyText,
    headers: {
      'x-vhc-alert-timestamp': timestamp,
      'x-vhc-alert-nonce': nonce,
      'x-vhc-alert-signature': signature,
    },
    env: { VH_PAGER_A6_WEBHOOK_SECRET: 'secret' },
    store,
    nowMs: Date.parse('2026-07-06T00:00:01.000Z'),
  };
  assert.equal((await handleA6Alert(args)).status, 202);
  assert.equal((await handleA6Alert(args)).body.reason, 'signature_nonce_replay');
});

test('kv pager store persists replay nonce and unsigned bootstrap latch', async () => {
  const kv = createFakeKv();
  const bodyText = JSON.stringify(baseAlert);
  const timestamp = String(Date.parse('2026-07-06T00:00:00.000Z'));
  const nonce = 'nonce-kv';
  const signature = await signA6Alert({ secret: 'secret', timestamp, nonce, bodyText });
  const args = {
    bodyText,
    headers: {
      'x-vhc-alert-timestamp': timestamp,
      'x-vhc-alert-nonce': nonce,
      'x-vhc-alert-signature': signature,
    },
    env: { VH_PAGER_A6_WEBHOOK_SECRET: 'secret' },
    nowMs: Date.parse('2026-07-06T00:00:01.000Z'),
  };
  assert.equal((await handleA6Alert({ ...args, store: createKvPagerStore(kv) })).status, 202);
  const replay = await handleA6Alert({ ...args, store: createKvPagerStore(kv) });
  assert.equal(replay.body.reason, 'signature_nonce_replay');
  const unsigned = await handleA6Alert({
    bodyText,
    headers: { 'x-vhc-bootstrap-secret': 'bootstrap' },
    env: { VH_PAGER_UNSIGNED_BOOTSTRAP_SECRET: 'bootstrap' },
    store: createKvPagerStore(kv),
  });
  assert.equal(unsigned.body.reason, 'signed_ingest_required');
});

test('unsigned bootstrap works only with enrollment secret before signed latch', async () => {
  const store = createMemoryPagerStore();
  const result = await handleA6Alert({
    bodyText: JSON.stringify(baseAlert),
    headers: { 'x-vhc-bootstrap-secret': 'bootstrap' },
    env: { VH_PAGER_UNSIGNED_BOOTSTRAP_SECRET: 'bootstrap' },
    store,
  });
  assert.equal(result.status, 202);
  await store.setUnsignedBootstrapDisabled(true);
  const rejected = await handleA6Alert({
    bodyText: JSON.stringify(baseAlert),
    headers: { 'x-vhc-bootstrap-secret': 'bootstrap' },
    env: { VH_PAGER_UNSIGNED_BOOTSTRAP_SECRET: 'bootstrap' },
    store,
  });
  assert.equal(rejected.body.reason, 'signed_ingest_required');
});

test('fanout failure after durable persist still returns accepted with explicit status', async () => {
  const store = createMemoryPagerStore();
  store.state.fanoutFailure = true;
  const result = await handleA6Alert({
    bodyText: JSON.stringify(baseAlert),
    headers: { 'x-vhc-bootstrap-secret': 'bootstrap' },
    env: { VH_PAGER_UNSIGNED_BOOTSTRAP_SECRET: 'bootstrap' },
    store,
  });
  assert.equal(result.status, 202);
  assert.equal(store.state.alerts.length, 1);
  assert.match(result.body.fanout, /^failed_after_persist/);
});

test('ack and subscription endpoints require device or enrollment auth', async () => {
  const store = createMemoryPagerStore();
  await handleA6Alert({
    bodyText: JSON.stringify(baseAlert),
    headers: { 'x-vhc-bootstrap-secret': 'bootstrap' },
    env: { VH_PAGER_UNSIGNED_BOOTSTRAP_SECRET: 'bootstrap' },
    store,
  });
  assert.equal((await handleAck({
    incidentKey: 'a6:public-feed:exit_69',
    headers: {},
    env: { VH_PAGER_DEVICE_TOKEN: 'device' },
    store,
  })).status, 401);
  assert.equal((await handleAck({
    incidentKey: 'a6:public-feed:exit_69',
    headers: { authorization: 'Bearer device' },
    env: { VH_PAGER_DEVICE_TOKEN: 'device' },
    store,
  })).status, 200);
  assert.equal((await handlePushSubscribe({
    bodyText: JSON.stringify({ endpoint: 'https://push.example.invalid/a', keys: {} }),
    headers: {},
    env: { VH_PAGER_ENROLLMENT_SECRET: 'enroll' },
    store,
  })).status, 401);
  assert.equal((await handlePushSubscribe({
    bodyText: JSON.stringify({ endpoint: 'https://push.example.invalid/a', keys: {} }),
    headers: { 'x-vhc-enrollment-secret': 'enroll' },
    env: { VH_PAGER_ENROLLMENT_SECRET: 'enroll' },
    store,
  })).status, 201);
});

test('push subscription enrollment rejects unsafe endpoints', async () => {
  const store = createMemoryPagerStore();
  const env = { VH_PAGER_ENROLLMENT_SECRET: 'enroll' };
  assert.equal((await handlePushSubscribe({
    bodyText: JSON.stringify({ endpoint: 'http://push.example.invalid/a', keys: {} }),
    headers: { 'x-vhc-enrollment-secret': 'enroll' },
    env,
    store,
  })).body.reason, 'push_endpoint_https_required');
  assert.equal((await handlePushSubscribe({
    bodyText: JSON.stringify({ endpoint: 'https://127.0.0.1/push', keys: {} }),
    headers: { 'x-vhc-enrollment-secret': 'enroll' },
    env,
    store,
  })).body.reason, 'push_endpoint_private_host_forbidden');
  assert.equal((await handlePushSubscribe({
    bodyText: JSON.stringify({ endpoint: 'https://push.example.invalid/a', keys: {} }),
    headers: { 'x-vhc-enrollment-secret': 'enroll' },
    env: { ...env, VH_PAGER_PUSH_ENDPOINT_HOST_ALLOWLIST: 'web.push.apple.com *.push.apple.com' },
    store,
  })).body.reason, 'push_endpoint_host_not_allowed');
  assert.equal((await handlePushSubscribe({
    bodyText: JSON.stringify({ endpoint: 'https://user:pass@web.push.apple.com/a', keys: {} }),
    headers: { 'x-vhc-enrollment-secret': 'enroll' },
    env: { ...env, VH_PAGER_PUSH_ENDPOINT_HOST_ALLOWLIST: 'web.push.apple.com *.push.apple.com' },
    store,
  })).body.reason, 'push_endpoint_credentials_forbidden');
  assert.equal((await handlePushSubscribe({
    bodyText: JSON.stringify({ endpoint: 'https://device.web.push.apple.com/a', keys: {} }),
    headers: { 'x-vhc-enrollment-secret': 'enroll' },
    env: { ...env, VH_PAGER_PUSH_ENDPOINT_HOST_ALLOWLIST: 'web.push.apple.com *.push.apple.com' },
    store,
  })).status, 201);
});

test('missing heartbeat uses max of two heartbeats and 35 minute floor', () => {
  const nowMs = Date.parse('2026-07-06T01:00:00.000Z');
  assert.equal(missingHeartbeatIncident({
    latestHeartbeatAt: '2026-07-06T00:20:00.000Z',
    heartbeatMs: 15 * 60 * 1000,
    nowMs,
  }).missing, true);
  assert.equal(missingHeartbeatIncident({
    latestHeartbeatAt: '2026-07-06T00:40:00.000Z',
    heartbeatMs: 15 * 60 * 1000,
    nowMs,
  }).missing, false);
});
