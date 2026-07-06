import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryPagerStore } from './pager-core.mjs';
import { dispatchPushWakeups, safeNotificationPayload, vapidJwt } from './web-push.mjs';

async function vapidFixture() {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await globalThis.crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await globalThis.crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    publicKey: `${publicJwk.x}.${publicJwk.y}`,
    privateJwk,
  };
}

test('safe notification payload contains no raw detail beyond class and issue link', () => {
  const payload = safeNotificationPayload({
    incidentKey: 'a6:public-feed:exit_78',
    severity: 'critical',
    alertClass: 'exit_78_fail_closed',
    issueUrl: 'https://github.com/CarbonCasteInc/VHC/issues/722',
  });
  assert.equal(payload.title, '[VHC A6] critical: exit_78_fail_closed');
  assert.equal(payload.data.issueUrl, 'https://github.com/CarbonCasteInc/VHC/issues/722');
});

test('vapid jwt is audience-bound to the push endpoint origin', async () => {
  const vapid = await vapidFixture();
  const result = await vapidJwt({
    endpoint: 'https://push.example.invalid/send/abc',
    subject: 'mailto:ops@example.invalid',
    publicKey: vapid.publicKey,
    privateJwk: vapid.privateJwk,
    nowSeconds: 1_800_000_000,
  });
  const [, payload] = result.jwt.split('.');
  const decoded = JSON.parse(Buffer.from(payload.replaceAll('-', '+').replaceAll('_', '/'), 'base64url').toString('utf8'));
  assert.equal(decoded.aud, 'https://push.example.invalid');
  assert.equal(decoded.sub, 'mailto:ops@example.invalid');
});

test('dead subscriptions are marked and zero-active alarm can be raised', async () => {
  const store = createMemoryPagerStore();
  const vapid = await vapidFixture();
  await store.saveSubscription({ id: 'sub-a', endpoint: 'https://push.example.invalid/send/a', keys: {} });
  const result = await dispatchPushWakeups({
    subscriptions: [{ id: 'sub-a', endpoint: 'https://push.example.invalid/send/a' }],
    vapid: {
      subject: 'mailto:ops@example.invalid',
      publicKey: vapid.publicKey,
      privateJwk: vapid.privateJwk,
    },
    store,
    fetchImpl: async () => ({ ok: false, status: 410 }),
  });
  assert.equal(result.results[0].status, 'dead_subscription');
  assert.equal(result.activeCount, 0);
  assert.equal(result.zeroActiveSubscriptions, true);
});
