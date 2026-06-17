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

test('publisher preflight fails closed when news relay REST write-first lacks daemon token', async () => {
  const result = await runNewsAggregatorPublisherPreflight({
    env: baseEnv({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: 'https://gun-a.example.test',
      VH_RELAY_DAEMON_TOKEN: '',
      VH_BUNDLE_SYNTHESIS_ENABLED: '',
    }),
    fetchFn: async () => new Response('{}'),
  });

  assert.equal(result.status, 'fail');
  assert.match(result.failures.join('\n'), /relay_rest_news_token:missing/);
  assert.equal(result.relay_rest_news_publication.write_first, true);
  assert.equal(result.relay_rest_news_publication.origin_count, 1);
  assert.equal(result.relay_rest_news_publication.daemon_token_present, false);
});

test('publisher preflight checks relay health with redacted pass output', async () => {
  const calls = [];
  const result = await runNewsAggregatorPublisherPreflight({
    env: baseEnv({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: 'https://gun-a.example.test,https://gun-b.example.test',
    }),
    fetchFn: async (input, init) => {
      calls.push({ origin: input.origin, pathname: input.pathname, method: init.method, headers: init.headers });
      if (init.method === 'POST') {
        assert.equal(input.pathname, '/vh/news/story');
        assert.equal(init.body, '{}');
        assert.equal(init.headers.authorization, 'Bearer relay-token-redacted');
        return new Response(JSON.stringify({ ok: false, error: 'news-story-record-required' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      assert.equal(init.method, 'GET');
      assert.deepEqual(init.headers, { accept: 'application/json' });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(result.status, 'pass');
  assert.deepEqual(calls.map(({ origin, pathname, method }) => ({ origin, pathname, method })), [
    { origin: 'https://gun-a.example.test', pathname: '/healthz', method: 'GET' },
    { origin: 'https://gun-b.example.test', pathname: '/healthz', method: 'GET' },
    { origin: 'https://gun-a.example.test', pathname: '/vh/news/story', method: 'POST' },
    { origin: 'https://gun-b.example.test', pathname: '/vh/news/story', method: 'POST' },
  ]);
  assert.deepEqual(result.relay_health_results, [
    { origin: 'https://gun-a.example.test', status: 200, ok: true },
    { origin: 'https://gun-b.example.test', status: 200, ok: true },
  ]);
  assert.equal(JSON.stringify(result).includes('relay-token-redacted'), false);
  assert.equal(JSON.stringify(result).includes('storycluster-token-redacted'), false);
  assert.equal(JSON.stringify(result).includes('private-material-redacted'), false);
  assert.deepEqual(result.relay_rest_news_publication, {
    write_first: true,
    origin_count: 2,
    require_all: true,
    daemon_token_present: true,
    auth_probe_results: [
      {
        origin: 'https://gun-a.example.test',
        status: 400,
        authenticated: true,
        error: 'news-story-record-required',
      },
      {
        origin: 'https://gun-b.example.test',
        status: 400,
        authenticated: true,
        error: 'news-story-record-required',
      },
    ],
  });
});

test('publisher preflight fails closed when relay REST news auth rejects the daemon token', async () => {
  const result = await runNewsAggregatorPublisherPreflight({
    env: baseEnv({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: 'https://gun-a.example.test',
    }),
    fetchFn: async (input, init) => {
      if (init.method === 'POST') {
        return new Response(JSON.stringify({ ok: false, error: 'daemon-token-required' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.equal(result.status, 'fail');
  assert.match(result.failures.join('\n'), /relay_rest_news_auth:https:\/\/gun-a\.example\.test:http_401/);
  assert.deepEqual(result.relay_rest_news_publication.auth_probe_results, [
    {
      origin: 'https://gun-a.example.test',
      status: 401,
      authenticated: false,
      error: 'daemon-token-required',
    },
  ]);
  assert.equal(JSON.stringify(result).includes('relay-token-redacted'), false);
});

test('publisher preflight derives health URLs from Gun peers', () => {
  assert.equal(
    newsAggregatorPublisherPreflightInternal.relayHealthUrlFromPeer('wss://gun-a.example.test/gun', []),
    'https://gun-a.example.test/healthz',
  );
});

test('publisher preflight derives news write auth probe URLs from relay origins', () => {
  assert.equal(
    newsAggregatorPublisherPreflightInternal.relayRestWriteUrlFromOrigin(
      'wss://gun-a.example.test/gun',
      '/vh/news/story',
      'relay_rest_news_origin',
      [],
    ),
    'https://gun-a.example.test/vh/news/story',
  );
});
