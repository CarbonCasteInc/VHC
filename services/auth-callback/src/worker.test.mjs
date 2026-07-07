import assert from 'node:assert/strict';
import test from 'node:test';
import { computeS256Challenge, createMemoryAuthStore } from './auth-core.mjs';
import { handleRequest } from './worker.mjs';

const ORIGIN = 'https://beta.vennhub.example';
const CODE_VERIFIER = 'verifier-verifier-verifier-verifier-verifier-1~';

async function generateApplePem() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(pkcs8).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
}

function makeIdToken(claims) {
  const seg = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${seg({ alg: 'RS256' })}.${seg(claims)}.${Buffer.from('sig').toString('base64url')}`;
}

async function baseEnv() {
  return {
    __TEST_STORE: createMemoryAuthStore(),
    VH_AUTH_STATE_SECRET: 'worker-test-state-secret-0123456789',
    VH_AUTH_ALLOWED_ORIGINS: ORIGIN,
    VH_AUTH_GOOGLE_CLIENT_ID: 'google-client-id.apps.example',
    VH_AUTH_GOOGLE_CLIENT_SECRET: 'google-client-secret-value',
    VH_AUTH_GOOGLE_REDIRECT_URI: `${ORIGIN}/auth/google/return`,
    VH_AUTH_APPLE_CLIENT_ID: 'com.example.vhc.signin',
    VH_AUTH_APPLE_TEAM_ID: 'TEAM123456',
    VH_AUTH_APPLE_KEY_ID: 'KEYID12345',
    VH_AUTH_APPLE_PRIVATE_KEY: await generateApplePem(),
    VH_AUTH_APPLE_REDIRECT_URI: `${ORIGIN}/auth/apple/return`,
    VH_AUTH_X_CLIENT_ID: 'x-client-id',
    VH_AUTH_X_CLIENT_SECRET: 'x-client-secret-value',
    VH_AUTH_X_REDIRECT_URI: `${ORIGIN}/auth/x/return`,
  };
}

function secretsOf(env) {
  return [
    env.VH_AUTH_STATE_SECRET,
    env.VH_AUTH_GOOGLE_CLIENT_SECRET,
    env.VH_AUTH_APPLE_PRIVATE_KEY,
    env.VH_AUTH_X_CLIENT_SECRET,
  ];
}

function assertNoSecrets(text, env) {
  for (const secret of secretsOf(env)) {
    assert.ok(!text.includes(secret), 'response must not contain secret material');
  }
}

function startRequest(provider, codeChallenge, { origin = ORIGIN } = {}) {
  return new Request(`https://auth.example.invalid/auth/${provider}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ codeChallenge }),
  });
}

function callbackRequest(provider, body, { origin = ORIGIN } = {}) {
  return new Request(`https://auth.example.invalid/auth/${provider}/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}

function providerFetchStub(env, { subject, tokenExtra = {} } = {}) {
  return async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = String(init.body);
      assert.ok(body.includes('client_secret=google-client-secret-value'));
      return new Response(JSON.stringify({
        access_token: 'google-access-token-secret',
        id_token: makeIdToken({
          iss: 'https://accounts.google.com',
          aud: env.VH_AUTH_GOOGLE_CLIENT_ID,
          sub: subject ?? 'google-sub-1',
          email: 'person@example.com',
        }),
        expires_in: 3600,
        ...tokenExtra,
      }), { status: 200 });
    }
    if (url === 'https://appleid.apple.com/auth/token') {
      const body = String(init.body);
      assert.ok(/client_secret=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(decodeURIComponent(body)));
      return new Response(JSON.stringify({
        access_token: 'apple-access-token-secret',
        id_token: makeIdToken({
          iss: 'https://appleid.apple.com',
          aud: env.VH_AUTH_APPLE_CLIENT_ID,
          sub: subject ?? 'apple-sub-1',
          email: 'relay@privaterelay.appleid.com',
        }),
        expires_in: 300,
        ...tokenExtra,
      }), { status: 200 });
    }
    if (url === 'https://api.x.com/2/oauth2/token') {
      assert.equal(init.headers.authorization, `Basic ${Buffer.from('x-client-id:x-client-secret-value').toString('base64')}`);
      return new Response(JSON.stringify({ access_token: 'x-access-token-secret', expires_in: 7200 }), { status: 200 });
    }
    if (url === 'https://api.x.com/2/users/me') {
      assert.equal(init.headers.authorization, 'Bearer x-access-token-secret');
      return new Response(JSON.stringify({ data: { id: subject ?? 'x-sub-1', username: 'venn_user' } }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
}

async function runStart(env, provider) {
  const challenge = await computeS256Challenge(CODE_VERIFIER);
  const response = await handleRequest(startRequest(provider, challenge), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  return body;
}

for (const provider of ['apple', 'google', 'x']) {
  test(`happy path start -> callback -> session for ${provider}`, async () => {
    const env = await baseEnv();
    env.__TEST_FETCH = providerFetchStub(env, {});

    const start = await runStart(env, provider);
    assert.equal(start.parameters.code_challenge_method, 'S256');
    assert.ok(start.parameters.state.length > 0);
    assertNoSecrets(JSON.stringify(start), env);

    const response = await handleRequest(callbackRequest(provider, {
      code: 'provider-auth-code',
      state: start.parameters.state,
      codeVerifier: CODE_VERIFIER,
    }), env);
    assert.equal(response.status, 200);
    const text = await response.text();
    assertNoSecrets(text, env);
    assert.ok(!text.includes('access_token'));
    assert.ok(!text.includes('-access-token-secret'));
    assert.ok(!text.includes('refresh'));

    const body = JSON.parse(text);
    assert.equal(body.status, 'ok');
    assert.equal(body.session.schemaVersion, 'vh-auth-session-v1');
    assert.equal(body.session.providerId, provider);
    assert.equal(body.session.providerSubject, `${provider}-sub-1`);
    assert.ok(Number.isFinite(body.session.expiresAt));
  });
}

test('state is single-use: replay of a consumed state is rejected', async () => {
  const env = await baseEnv();
  env.__TEST_FETCH = providerFetchStub(env, {});
  const start = await runStart(env, 'google');
  const payload = { code: 'code-1', state: start.parameters.state, codeVerifier: CODE_VERIFIER };

  const first = await handleRequest(callbackRequest('google', payload), env);
  assert.equal(first.status, 200);

  const replay = await handleRequest(callbackRequest('google', payload), env);
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).reason, 'state_replayed');
});

test('expired state is rejected without contacting the provider', async () => {
  const env = await baseEnv();
  env.VH_AUTH_STATE_TTL_MS = '1000';
  let fetchCalls = 0;
  env.__TEST_FETCH = async () => { fetchCalls += 1; throw new Error('must not be called'); };

  env.__TEST_NOW_MS = '1750000000000';
  const start = await runStart(env, 'google');

  env.__TEST_NOW_MS = '1750000002000';
  const response = await handleRequest(callbackRequest('google', {
    code: 'code-1', state: start.parameters.state, codeVerifier: CODE_VERIFIER,
  }), env);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).reason, 'state_expired');
  assert.equal(fetchCalls, 0);
});

test('code verifier must match the challenge bound at start', async () => {
  const env = await baseEnv();
  let fetchCalls = 0;
  env.__TEST_FETCH = async () => { fetchCalls += 1; throw new Error('must not be called'); };
  const start = await runStart(env, 'google');

  const response = await handleRequest(callbackRequest('google', {
    code: 'code-1',
    state: start.parameters.state,
    codeVerifier: 'different-verifier-different-verifier-differs1',
  }), env);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).reason, 'code_verifier_mismatch');
  assert.equal(fetchCalls, 0);
});

test('unknown providers are rejected with 404 on both endpoints', async () => {
  const env = await baseEnv();
  const challenge = await computeS256Challenge(CODE_VERIFIER);

  const start = await handleRequest(startRequest('reddit', challenge), env);
  assert.equal(start.status, 404);
  assert.equal((await start.json()).reason, 'unknown_provider');

  const callback = await handleRequest(callbackRequest('facebook', { code: 'c', state: 's', codeVerifier: CODE_VERIFIER }), env);
  assert.equal(callback.status, 404);
  assert.equal((await callback.json()).reason, 'unknown_provider');
});

test('provider exchange failure is a clean rejection with no partial session and no secrets', async () => {
  const env = await baseEnv();
  env.__TEST_FETCH = async () => new Response(JSON.stringify({
    error: 'invalid_grant',
    error_description: `leaky description ${env.VH_AUTH_GOOGLE_CLIENT_SECRET}`,
  }), { status: 400 });

  const start = await runStart(env, 'google');
  const response = await handleRequest(callbackRequest('google', {
    code: 'bad-code', state: start.parameters.state, codeVerifier: CODE_VERIFIER,
  }), env);

  assert.equal(response.status, 502);
  const text = await response.text();
  assertNoSecrets(text, env);
  const body = JSON.parse(text);
  assert.equal(body.status, 'rejected');
  assert.equal(body.reason, 'provider_exchange_failed');
  assert.equal(body.providerError, 'invalid_grant');
  assert.equal(body.session, undefined);
});

test('origin allowlist gates start, callback POST, and preflight', async () => {
  const env = await baseEnv();
  const challenge = await computeS256Challenge(CODE_VERIFIER);

  const evilStart = await handleRequest(startRequest('google', challenge, { origin: 'https://evil.example' }), env);
  assert.equal(evilStart.status, 403);

  const noOriginStart = await handleRequest(startRequest('google', challenge, { origin: null }), env);
  assert.equal(noOriginStart.status, 403);

  const evilCallback = await handleRequest(callbackRequest('google', { code: 'c', state: 's', codeVerifier: CODE_VERIFIER }, { origin: 'https://evil.example' }), env);
  assert.equal(evilCallback.status, 403);

  const preflight = await handleRequest(new Request('https://auth.example.invalid/auth/google/start', {
    method: 'OPTIONS',
    headers: { origin: ORIGIN },
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);

  const evilPreflight = await handleRequest(new Request('https://auth.example.invalid/auth/google/start', {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example' },
  }), env);
  assert.equal(evilPreflight.status, 403);
});

test('method and body-size guards', async () => {
  const env = await baseEnv();

  const wrongMethod = await handleRequest(new Request('https://auth.example.invalid/auth/google/start', {
    method: 'GET',
    headers: { origin: ORIGIN },
  }), env);
  assert.equal(wrongMethod.status, 405);

  const wrongCallbackMethod = await handleRequest(new Request('https://auth.example.invalid/auth/google/callback', {
    method: 'DELETE',
    headers: { origin: ORIGIN },
  }), env);
  assert.equal(wrongCallbackMethod.status, 405);

  const oversized = await handleRequest(new Request('https://auth.example.invalid/auth/google/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'content-length': '32' },
    body: JSON.stringify({ codeChallenge: 'x'.repeat(16) }),
  }), { ...env, VH_AUTH_MAX_BODY_BYTES: '8' });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).reason, 'request_body_too_large');

  const invalidJson = await handleRequest(new Request('https://auth.example.invalid/auth/google/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: 'not json',
  }), env);
  assert.equal(invalidJson.status, 400);
  assert.equal((await invalidJson.json()).reason, 'invalid_json');
});

test('GET callback accepts query parameters (state+PKCE protected)', async () => {
  const env = await baseEnv();
  env.__TEST_FETCH = providerFetchStub(env, {});
  const start = await runStart(env, 'google');

  const url = new URL('https://auth.example.invalid/auth/google/callback');
  url.searchParams.set('code', 'provider-auth-code');
  url.searchParams.set('state', start.parameters.state);
  url.searchParams.set('code_verifier', CODE_VERIFIER);

  const response = await handleRequest(new Request(url, { method: 'GET' }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.session.providerId, 'google');
});

test('fails closed without a durable store outside tests', async () => {
  const env = await baseEnv();
  delete env.__TEST_STORE;
  const challenge = await computeS256Challenge(CODE_VERIFIER);
  const response = await handleRequest(startRequest('google', challenge), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'durable_store_required');
});

test('health endpoint reports configuration booleans only', async () => {
  const env = await baseEnv();
  const response = await handleRequest(new Request('https://auth.example.invalid/api/health'), env);
  assert.equal(response.status, 200);
  const text = await response.text();
  assertNoSecrets(text, env);
  const body = JSON.parse(text);
  assert.deepEqual(body.providersConfigured, { apple: true, google: true, x: true });
  assert.equal(body.durableStore, true);

  const partial = await handleRequest(new Request('https://auth.example.invalid/api/health'), {
    VH_AUTH_GOOGLE_CLIENT_ID: 'id-only',
  });
  const partialBody = await partial.json();
  assert.deepEqual(partialBody.providersConfigured, { apple: false, google: false, x: false });
  assert.equal(partialBody.durableStore, false);
});

test('unknown routes are 404', async () => {
  const env = await baseEnv();
  const response = await handleRequest(new Request('https://auth.example.invalid/nope'), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).reason, 'route_not_found');
});
