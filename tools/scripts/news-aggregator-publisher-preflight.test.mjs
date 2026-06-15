import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newsAggregatorPublisherPreflightInternal,
  runNewsAggregatorPublisherPreflight,
} from './news-aggregator-publisher-preflight.mjs';

function baseEnv(overrides = {}) {
  return {
    VH_NEWS_SYSTEM_WRITER_ID: 'system-writer',
    VH_NEWS_SYSTEM_WRITER_PIN_JSON: '{"pinVersion":1}',
    VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL: 'private-material-redacted',
    VH_STORYCLUSTER_REMOTE_URL: 'http://127.0.0.1:4310/cluster',
    VH_STORYCLUSTER_REMOTE_HEALTH_URL: 'http://127.0.0.1:4310/ready',
    VH_STORYCLUSTER_REMOTE_AUTH_TOKEN: 'storycluster-token-redacted',
    VH_GUN_PEERS: 'wss://gun-a.example.test/gun,wss://gun-b.example.test/gun',
    VH_BUNDLE_SYNTHESIS_ENABLED: '1',
    VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST: '1',
    VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS: 'https://gun-a.example.test,https://gun-b.example.test',
    VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted',
    ...overrides,
  };
}

test('publisher preflight reports missing raw publication readiness inputs without fetching relays', async () => {
  let fetchCalled = false;
  const result = await runNewsAggregatorPublisherPreflight({
    env: {},
    fetchFn: async () => {
      fetchCalled = true;
      return new Response('{}');
    },
  });

  assert.equal(result.status, 'fail');
  assert.equal(fetchCalled, false);
  assert.match(result.failures.join('\n'), /system_writer_id:missing/);
  assert.match(result.failures.join('\n'), /system_writer_private_key:missing/);
  assert.match(result.failures.join('\n'), /gun_peers:missing/);
  assert.equal(result.signer_material.private_key_present, false);
});

test('publisher preflight fails closed when synthesis is enabled without relay REST config', async () => {
  const result = await runNewsAggregatorPublisherPreflight({
    env: baseEnv({
      VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST: '',
      VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS: '',
      VH_RELAY_DAEMON_TOKEN: '',
    }),
    fetchFn: async () => new Response('{}'),
  });

  assert.equal(result.status, 'fail');
  assert.match(result.failures.join('\n'), /relay_rest_synthesis:disabled_while_synthesis_enabled/);
  assert.match(result.failures.join('\n'), /relay_rest_synthesis_origins:missing/);
  assert.match(result.failures.join('\n'), /relay_rest_synthesis_token:missing/);
});

test('publisher preflight checks relay health with redacted pass output', async () => {
  const origins = [];
  const result = await runNewsAggregatorPublisherPreflight({
    env: baseEnv(),
    fetchFn: async (input, init) => {
      assert.equal(init.method, 'GET');
      assert.deepEqual(init.headers, { accept: 'application/json' });
      origins.push(input.origin);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(result.status, 'pass');
  assert.deepEqual(origins, ['https://gun-a.example.test', 'https://gun-b.example.test']);
  assert.deepEqual(result.relay_health_results, [
    { origin: 'https://gun-a.example.test', status: 200, ok: true },
    { origin: 'https://gun-b.example.test', status: 200, ok: true },
  ]);
  assert.equal(JSON.stringify(result).includes('relay-token-redacted'), false);
  assert.equal(JSON.stringify(result).includes('storycluster-token-redacted'), false);
  assert.equal(JSON.stringify(result).includes('private-material-redacted'), false);
});

test('publisher preflight derives health URLs from Gun peers', () => {
  assert.equal(
    newsAggregatorPublisherPreflightInternal.relayHealthUrlFromPeer('wss://gun-a.example.test/gun', []),
    'https://gun-a.example.test/healthz',
  );
});
