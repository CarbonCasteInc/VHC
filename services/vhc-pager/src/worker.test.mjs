import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryPagerStore, signA6Alert } from './pager-core.mjs';
import { handleRequest } from './worker.mjs';

async function signedRequest({ body, secret = 'secret', nonce = 'nonce-1', timestamp = Date.now() }) {
  const bodyText = JSON.stringify(body);
  return new Request('https://pager.example.invalid/api/a6-alert', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-vhc-alert-timestamp': String(timestamp),
      'x-vhc-alert-nonce': nonce,
      'x-vhc-alert-signature': await signA6Alert({ secret, timestamp: String(timestamp), nonce, bodyText }),
    },
    body: bodyText,
  });
}

test('worker accepts signed A6 alert and rejects unauthenticated ack', async () => {
  const store = createMemoryPagerStore();
  const env = {
    __TEST_STORE: store,
    VH_PAGER_A6_WEBHOOK_SECRET: 'secret',
    VH_PAGER_DEVICE_TOKEN: 'device-token',
  };
  const alert = {
    schemaVersion: 'vh-public-feed-alert-watch-v1',
    generatedAt: '2026-07-06T10:00:00.000Z',
    status: 'fail',
    severity: 'critical',
    publisher: { failureClass: 'exit_78_fail_closed' },
    blockers: ['publisher:exit_78_fail_closed'],
    fingerprint: 'fp-1',
  };

  const accepted = await handleRequest(await signedRequest({ body: alert, timestamp: Date.now() }), env);
  assert.equal(accepted.status, 202);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.incidentKey, 'a6:public-feed:exit_78');

  const rejectedAck = await handleRequest(new Request(`https://pager.example.invalid/api/ack/${encodeURIComponent(acceptedBody.incidentKey)}`, {
    method: 'POST',
  }), env);
  assert.equal(rejectedAck.status, 401);

  const acked = await handleRequest(new Request(`https://pager.example.invalid/api/ack/${encodeURIComponent(acceptedBody.incidentKey)}`, {
    method: 'POST',
    headers: { authorization: 'Bearer device-token' },
  }), env);
  assert.equal(acked.status, 200);
});

test('worker requires device token for incident readback', async () => {
  const store = createMemoryPagerStore();
  const env = {
    __TEST_STORE: store,
    VH_PAGER_A6_WEBHOOK_SECRET: 'secret',
    VH_PAGER_DEVICE_TOKEN: 'device-token',
  };
  await handleRequest(await signedRequest({
    body: {
      schemaVersion: 'vh-public-feed-alert-watch-v1',
      generatedAt: '2026-07-06T10:00:00.000Z',
      status: 'fail',
      severity: 'warning',
      publisher: { failureClass: 'exit_69_transport_unavailable' },
      blockers: ['publisher:exit_69_transport_unavailable'],
      fingerprint: 'fp-2',
    },
    nonce: 'nonce-2',
    timestamp: Date.now(),
  }), env);

  const unauthenticated = await handleRequest(new Request('https://pager.example.invalid/api/incidents/a6%3Apublic-feed%3Aexit_69'), env);
  assert.equal(unauthenticated.status, 401);

  const authenticated = await handleRequest(new Request('https://pager.example.invalid/api/incidents/a6%3Apublic-feed%3Aexit_69', {
    headers: { authorization: 'Bearer device-token' },
  }), env);
  assert.equal(authenticated.status, 200);
  const body = await authenticated.json();
  assert.equal(body.incident.alert.alertClass, 'exit_69_transport_unavailable');
});

test('worker fails closed without durable store outside tests', async () => {
  const health = await handleRequest(new Request('https://pager.example.invalid/api/health'), {});
  assert.equal(health.status, 503);
  assert.equal((await health.json()).reason, 'durable_store_required');
});

test('worker rejects oversized alert body before core handling', async () => {
  const store = createMemoryPagerStore();
  const response = await handleRequest(new Request('https://pager.example.invalid/api/a6-alert', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '20',
    },
    body: '{"too":"large"}',
  }), {
    __TEST_STORE: store,
    VH_PAGER_MAX_BODY_BYTES: '4',
    VH_PAGER_A6_WEBHOOK_SECRET: 'secret',
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).reason, 'request_body_too_large');
});
