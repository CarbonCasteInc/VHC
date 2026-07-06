import assert from 'node:assert/strict';
import test from 'node:test';
import { runPagerDeadman } from './vhc-pager-deadman.mjs';

test('pager deadman passes on healthy pager with subscriptions', async () => {
  const result = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        schemaVersion: 'vhc-pager-health-v1',
        status: 'ok',
        activeSubscriptions: 1,
        heartbeat: { missing: false },
      }),
    }),
  });
  assert.equal(result.status, 'pass');
});

test('pager deadman fails on zero subscriptions or stale heartbeat', async () => {
  const result = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: 'degraded',
        activeSubscriptions: 0,
        heartbeat: { missing: true, reason: 'heartbeat_stale:1/2' },
      }),
    }),
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /active_subscriptions_invalid:0/);
  assert.match(result.blockers.join('\n'), /heartbeat_missing/);
});

test('pager deadman fails closed on malformed health payloads', async () => {
  const cases = [
    [{}, /schema_invalid/],
    [{ schemaVersion: 'not-health' }, /schema_invalid/],
    [{ schemaVersion: 'vhc-pager-health-v1', status: 'ok', heartbeat: { missing: false } }, /active_subscriptions_invalid/],
    [{ schemaVersion: 'vhc-pager-health-v1', status: 'ok', activeSubscriptions: 1 }, /heartbeat_missing:shape_missing/],
  ];
  for (const [body, expected] of cases) {
    const result = await runPagerDeadman({
      healthUrl: 'https://pager.example.invalid/api/health',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      }),
    });
    assert.equal(result.status, 'fail');
    assert.match(result.blockers.join('\n'), expected);
  }
});
