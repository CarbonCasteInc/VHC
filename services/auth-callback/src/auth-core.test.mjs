import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeS256Challenge,
  createKvAuthStore,
  createMemoryAuthStore,
  decodeJwtPayloadUnsafe,
  exchangeAuthorizationCode,
  handleStart,
  isAllowedOrigin,
  isSignInProvider,
  isValidCodeChallenge,
  isValidCodeVerifier,
  issueState,
  providerConfig,
  sessionFromTokenResponse,
  stateSecret,
  verifyAndConsumeState,
} from './auth-core.mjs';

const STATE_SECRET = 'test-state-secret-0123456789abcdef';

const GOOGLE_ENV = {
  VH_AUTH_STATE_SECRET: STATE_SECRET,
  VH_AUTH_ALLOWED_ORIGINS: 'https://beta.vennhub.example, http://localhost:5173',
  VH_AUTH_GOOGLE_CLIENT_ID: 'google-client-id.apps.example',
  VH_AUTH_GOOGLE_CLIENT_SECRET: 'google-client-secret-value',
  VH_AUTH_GOOGLE_REDIRECT_URI: 'https://beta.vennhub.example/auth/google/return',
};

const CODE_VERIFIER = 'v'.repeat(43);

test('provider enum is a closed set', () => {
  assert.equal(isSignInProvider('apple'), true);
  assert.equal(isSignInProvider('google'), true);
  assert.equal(isSignInProvider('x'), true);
  assert.equal(isSignInProvider('reddit'), false);
  assert.equal(isSignInProvider('facebook'), false);
  assert.equal(providerConfig('reddit', GOOGLE_ENV).reason, 'unknown_provider');
});

test('providerConfig requires complete env per provider', () => {
  assert.equal(providerConfig('google', GOOGLE_ENV).ok, true);
  assert.equal(providerConfig('google', {}).reason, 'provider_not_configured');
  assert.equal(providerConfig('apple', { VH_AUTH_APPLE_CLIENT_ID: 'only-id' }).reason, 'provider_not_configured');
  assert.equal(providerConfig('x', { VH_AUTH_X_CLIENT_ID: 'only-id' }).reason, 'provider_not_configured');

  const x = providerConfig('x', {
    VH_AUTH_X_CLIENT_ID: 'x-id',
    VH_AUTH_X_CLIENT_SECRET: 'x-secret',
    VH_AUTH_X_REDIRECT_URI: 'https://beta.vennhub.example/auth/x/return',
  });
  assert.equal(x.ok, true);
  assert.equal(x.config.userinfoEndpoint, 'https://api.x.com/2/users/me');
});

test('origin allowlist is exact-match', () => {
  assert.equal(isAllowedOrigin('https://beta.vennhub.example', GOOGLE_ENV), true);
  assert.equal(isAllowedOrigin('http://localhost:5173', GOOGLE_ENV), true);
  assert.equal(isAllowedOrigin('https://evil.example', GOOGLE_ENV), false);
  assert.equal(isAllowedOrigin('', GOOGLE_ENV), false);
  assert.equal(isAllowedOrigin(null, GOOGLE_ENV), false);
});

test('PKCE input validators enforce RFC 7636 shapes', async () => {
  const challenge = await computeS256Challenge(CODE_VERIFIER);
  assert.equal(isValidCodeChallenge(challenge), true);
  assert.equal(isValidCodeChallenge('short'), false);
  assert.equal(isValidCodeChallenge(`${challenge}+`), false);
  assert.equal(isValidCodeVerifier(CODE_VERIFIER), true);
  assert.equal(isValidCodeVerifier('too-short'), false);
  assert.equal(isValidCodeVerifier('!'.repeat(50)), false);
});

test('state secret must be configured and non-trivial', () => {
  assert.equal(stateSecret({}), null);
  assert.equal(stateSecret({ VH_AUTH_STATE_SECRET: 'short' }), null);
  assert.equal(stateSecret(GOOGLE_ENV), STATE_SECRET);
});

test('state round-trips, is single-use, and expires', async () => {
  const store = createMemoryAuthStore();
  const challenge = await computeS256Challenge(CODE_VERIFIER);
  const nowMs = 1_750_000_000_000;
  const { state } = await issueState({
    provider: 'google',
    codeChallenge: challenge,
    secret: STATE_SECRET,
    nowMs,
    ttlMs: 60_000,
  });

  const verified = await verifyAndConsumeState({ state, provider: 'google', secret: STATE_SECRET, store, nowMs: nowMs + 1_000 });
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.codeChallenge, challenge);

  const replayed = await verifyAndConsumeState({ state, provider: 'google', secret: STATE_SECRET, store, nowMs: nowMs + 2_000 });
  assert.deepEqual(replayed, { ok: false, reason: 'state_replayed' });

  const { state: expiring } = await issueState({
    provider: 'google', codeChallenge: challenge, secret: STATE_SECRET, nowMs, ttlMs: 60_000,
  });
  const expired = await verifyAndConsumeState({ state: expiring, provider: 'google', secret: STATE_SECRET, store, nowMs: nowMs + 60_001 });
  assert.deepEqual(expired, { ok: false, reason: 'state_expired' });
});

test('state rejects tampering, provider mismatch, and malformed values', async () => {
  const store = createMemoryAuthStore();
  const challenge = await computeS256Challenge(CODE_VERIFIER);
  const { state } = await issueState({ provider: 'google', codeChallenge: challenge, secret: STATE_SECRET, ttlMs: 60_000 });

  const [encoded, signature] = state.split('.');
  assert.equal((await verifyAndConsumeState({ state: `${encoded}.${'0'.repeat(signature.length)}`, provider: 'google', secret: STATE_SECRET, store })).reason, 'state_signature_mismatch');
  assert.equal((await verifyAndConsumeState({ state, provider: 'apple', secret: STATE_SECRET, store })).reason, 'state_provider_mismatch');
  assert.equal((await verifyAndConsumeState({ state: 'no-dot-here', provider: 'google', secret: STATE_SECRET, store })).reason, 'state_invalid');
  assert.equal((await verifyAndConsumeState({ state: '', provider: 'google', secret: STATE_SECRET, store })).reason, 'state_invalid');
  assert.equal((await verifyAndConsumeState({ state: 42, provider: 'google', secret: STATE_SECRET, store })).reason, 'state_invalid');

  // Signed-but-not-JSON payloads fail closed as invalid state.
  const bogus = Buffer.from('not json').toString('base64url');
  const { hmacSha256Hex } = await import('./auth-core.mjs');
  const bogusSigned = `${bogus}.${await hmacSha256Hex(STATE_SECRET, bogus)}`;
  assert.equal((await verifyAndConsumeState({ state: bogusSigned, provider: 'google', secret: STATE_SECRET, store })).reason, 'state_invalid');
});

test('kv-backed auth store remembers nonces with expiry', async () => {
  const kvData = new Map();
  const kv = {
    async get(key) { return kvData.get(key) ?? null; },
    async put(key, value) { kvData.set(key, value); },
  };
  const store = createKvAuthStore(kv);
  assert.equal(await store.hasNonce('n1', 100), false);
  await store.rememberNonce('n1', 200);
  assert.equal(await store.hasNonce('n1', 100), true);
  assert.equal(await store.hasNonce('n1', 201), false);
  kvData.set('nonce:broken', 'not-json');
  assert.equal(await store.hasNonce('broken', 100), false);
});

test('handleStart issues authorize parameters without any secret material', async () => {
  const challenge = await computeS256Challenge(CODE_VERIFIER);
  const result = await handleStart({ provider: 'google', codeChallenge: challenge, env: GOOGLE_ENV, nowMs: 1_750_000_000_000 });

  assert.equal(result.status, 200);
  assert.equal(result.body.parameters.response_type, 'code');
  assert.equal(result.body.parameters.client_id, GOOGLE_ENV.VH_AUTH_GOOGLE_CLIENT_ID);
  assert.equal(result.body.parameters.code_challenge, challenge);
  assert.equal(result.body.parameters.code_challenge_method, 'S256');
  assert.ok(result.body.authorizeUrl.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.ok(!JSON.stringify(result.body).includes(GOOGLE_ENV.VH_AUTH_GOOGLE_CLIENT_SECRET));

  const badChallenge = await handleStart({ provider: 'google', codeChallenge: 'nope', env: GOOGLE_ENV });
  assert.equal(badChallenge.status, 400);
  assert.equal(badChallenge.body.reason, 'code_challenge_invalid');

  const unknown = await handleStart({ provider: 'reddit', codeChallenge: challenge, env: GOOGLE_ENV });
  assert.equal(unknown.status, 404);

  const unconfigured = await handleStart({ provider: 'apple', codeChallenge: challenge, env: GOOGLE_ENV });
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.body.reason, 'provider_not_configured');

  const noSecret = await handleStart({ provider: 'google', codeChallenge: challenge, env: { ...GOOGLE_ENV, VH_AUTH_STATE_SECRET: undefined } });
  assert.equal(noSecret.status, 503);
  assert.equal(noSecret.body.reason, 'state_secret_unconfigured');
});

test('apple start requests form_post response mode when scopes are set', async () => {
  const env = {
    ...GOOGLE_ENV,
    VH_AUTH_APPLE_CLIENT_ID: 'com.example.vhc.signin',
    VH_AUTH_APPLE_TEAM_ID: 'TEAM123456',
    VH_AUTH_APPLE_KEY_ID: 'KEYID12345',
    VH_AUTH_APPLE_PRIVATE_KEY: 'pem-placeholder-not-used-at-start',
    VH_AUTH_APPLE_REDIRECT_URI: 'https://beta.vennhub.example/auth/apple/return',
  };
  const challenge = await computeS256Challenge(CODE_VERIFIER);
  const result = await handleStart({ provider: 'apple', codeChallenge: challenge, env });
  assert.equal(result.status, 200);
  assert.equal(result.body.parameters.response_mode, 'form_post');

  const noScopes = await handleStart({
    provider: 'apple', codeChallenge: challenge, env: { ...env, VH_AUTH_APPLE_SCOPES: '' },
  });
  assert.equal(noScopes.body.parameters.response_mode, 'query');
});

test('exchange sends the client secret to the provider but never returns it', async () => {
  const config = providerConfig('google', GOOGLE_ENV).config;
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ access_token: 'at-secret', id_token: 'x.y.z', expires_in: 3600 }), { status: 200 });
  };

  const result = await exchangeAuthorizationCode({ config, code: 'auth-code', codeVerifier: CODE_VERIFIER, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://oauth2.googleapis.com/token');
  const sentBody = seen[0].init.body;
  assert.ok(sentBody.includes('client_secret=google-client-secret-value'));
  assert.ok(sentBody.includes(`code_verifier=${CODE_VERIFIER}`));
  assert.ok(!JSON.stringify({ ok: result.ok, reason: result.reason }).includes('google-client-secret-value'));
});

test('x exchange uses basic auth and userinfo shaping', async () => {
  const env = {
    ...GOOGLE_ENV,
    VH_AUTH_X_CLIENT_ID: 'x-id',
    VH_AUTH_X_CLIENT_SECRET: 'x-secret-value',
    VH_AUTH_X_REDIRECT_URI: 'https://beta.vennhub.example/auth/x/return',
  };
  const config = providerConfig('x', env).config;
  const fetchImpl = async (url, init) => {
    if (url === config.tokenEndpoint) {
      assert.equal(init.headers.authorization, `Basic ${Buffer.from('x-id:x-secret-value').toString('base64')}`);
      return new Response(JSON.stringify({ access_token: 'x-access-token', expires_in: 7200 }), { status: 200 });
    }
    assert.equal(url, config.userinfoEndpoint);
    assert.equal(init.headers.authorization, 'Bearer x-access-token');
    return new Response(JSON.stringify({ data: { id: '4815162342', username: 'venn_user' } }), { status: 200 });
  };

  const exchange = await exchangeAuthorizationCode({ config, code: 'c', codeVerifier: CODE_VERIFIER, fetchImpl });
  assert.equal(exchange.ok, true);

  const shaped = await sessionFromTokenResponse({ config, tokenJson: exchange.tokenJson, fetchImpl, nowMs: 1_000 });
  assert.equal(shaped.ok, true);
  assert.deepEqual(shaped.session, {
    schemaVersion: 'vh-auth-session-v1',
    providerId: 'x',
    providerSubject: '4815162342',
    displayLabel: '@venn_user',
    issuedAt: 1_000,
    expiresAt: 1_000 + 7200 * 1000,
  });
  assert.ok(!JSON.stringify(shaped.session).includes('x-access-token'));
});

test('x session shaping fails closed on missing token or userinfo failure', async () => {
  const env = {
    ...GOOGLE_ENV,
    VH_AUTH_X_CLIENT_ID: 'x-id',
    VH_AUTH_X_CLIENT_SECRET: 'x-secret-value',
    VH_AUTH_X_REDIRECT_URI: 'https://beta.vennhub.example/auth/x/return',
  };
  const config = providerConfig('x', env).config;

  const missingToken = await sessionFromTokenResponse({ config, tokenJson: {}, fetchImpl: async () => { throw new Error('unused'); } });
  assert.deepEqual(missingToken, { ok: false, reason: 'provider_token_missing' });

  const userinfoDown = await sessionFromTokenResponse({
    config,
    tokenJson: { access_token: 'tok' },
    fetchImpl: async () => { throw new Error('network down'); },
  });
  assert.deepEqual(userinfoDown, { ok: false, reason: 'provider_subject_missing' });

  const userinfo500 = await sessionFromTokenResponse({
    config,
    tokenJson: { access_token: 'tok' },
    fetchImpl: async () => new Response('nope', { status: 500 }),
  });
  assert.deepEqual(userinfo500, { ok: false, reason: 'provider_subject_missing' });

  const noUsername = await sessionFromTokenResponse({
    config,
    tokenJson: { access_token: 'tok' },
    fetchImpl: async () => new Response(JSON.stringify({ data: { id: 'id-1' } }), { status: 200 }),
  });
  assert.equal(noUsername.ok, true);
  assert.equal(noUsername.session.displayLabel, null);
});

function makeIdToken(claims) {
  const seg = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${seg({ alg: 'RS256' })}.${seg(claims)}.${Buffer.from('sig').toString('base64url')}`;
}

test('oidc session shaping validates issuer, audience, and subject', async () => {
  const config = providerConfig('google', GOOGLE_ENV).config;
  const claims = {
    iss: 'https://accounts.google.com',
    aud: GOOGLE_ENV.VH_AUTH_GOOGLE_CLIENT_ID,
    sub: 'google-subject-1',
    email: 'user@example.com',
  };

  const ok = await sessionFromTokenResponse({
    config,
    tokenJson: { id_token: makeIdToken(claims), access_token: 'at-1', expires_in: 3600 },
    fetchImpl: async () => { throw new Error('unused'); },
    nowMs: 5_000,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.session, {
    schemaVersion: 'vh-auth-session-v1',
    providerId: 'google',
    providerSubject: 'google-subject-1',
    displayLabel: 'user@example.com',
    issuedAt: 5_000,
    expiresAt: 5_000 + 3600 * 1000,
  });
  assert.ok(!JSON.stringify(ok.session).includes('at-1'));
  assert.ok(!JSON.stringify(ok.session).includes('id_token'));

  const badIss = await sessionFromTokenResponse({
    config, tokenJson: { id_token: makeIdToken({ ...claims, iss: 'https://evil.example' }) }, fetchImpl: async () => {},
  });
  assert.deepEqual(badIss, { ok: false, reason: 'provider_issuer_mismatch' });

  const badAud = await sessionFromTokenResponse({
    config, tokenJson: { id_token: makeIdToken({ ...claims, aud: 'someone-else' }) }, fetchImpl: async () => {},
  });
  assert.deepEqual(badAud, { ok: false, reason: 'provider_audience_mismatch' });

  const noSub = await sessionFromTokenResponse({
    config, tokenJson: { id_token: makeIdToken({ ...claims, sub: '' }) }, fetchImpl: async () => {},
  });
  assert.deepEqual(noSub, { ok: false, reason: 'provider_subject_missing' });

  const noToken = await sessionFromTokenResponse({ config, tokenJson: {}, fetchImpl: async () => {} });
  assert.deepEqual(noToken, { ok: false, reason: 'provider_id_token_missing' });

  const nameLabel = await sessionFromTokenResponse({
    config,
    tokenJson: { id_token: makeIdToken({ ...claims, email: undefined, name: 'A Name' }) },
    fetchImpl: async () => {},
    nowMs: 1,
  });
  assert.equal(nameLabel.session.displayLabel, 'A Name');

  const noLabel = await sessionFromTokenResponse({
    config,
    tokenJson: { id_token: makeIdToken({ ...claims, email: undefined }) },
    fetchImpl: async () => {},
    nowMs: 1,
  });
  assert.equal(noLabel.session.displayLabel, null);
  assert.equal(noLabel.session.expiresAt, null);
});

test('provider errors surface as sanitized reason codes only', async () => {
  const config = providerConfig('google', GOOGLE_ENV).config;

  const failed = await exchangeAuthorizationCode({
    config, code: 'bad-code', codeVerifier: CODE_VERIFIER,
    fetchImpl: async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'secret-bearing description google-client-secret-value',
    }), { status: 400 }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'provider_exchange_failed');
  assert.equal(failed.providerStatus, 400);
  assert.equal(failed.providerError, 'invalid_grant');
  assert.ok(!JSON.stringify(failed).includes('google-client-secret-value'));
  assert.ok(!JSON.stringify(failed).includes('secret-bearing'));

  const nonJson = await exchangeAuthorizationCode({
    config, code: 'c', codeVerifier: CODE_VERIFIER,
    fetchImpl: async () => new Response('<html>gateway error</html>', { status: 502 }),
  });
  assert.equal(nonJson.reason, 'provider_exchange_failed');
  assert.equal(nonJson.providerError, 'unspecified');

  const unreachable = await exchangeAuthorizationCode({
    config, code: 'c', codeVerifier: CODE_VERIFIER,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.deepEqual(unreachable, { ok: false, reason: 'provider_unreachable' });
});

test('decodeJwtPayloadUnsafe fails closed on malformed tokens', () => {
  assert.equal(decodeJwtPayloadUnsafe(null), null);
  assert.equal(decodeJwtPayloadUnsafe('one.two'), null);
  assert.equal(decodeJwtPayloadUnsafe('a.!!!.c'), null);
  const nonObject = `${Buffer.from('{}').toString('base64url')}.${Buffer.from('"str"').toString('base64url')}.x`;
  assert.equal(decodeJwtPayloadUnsafe(nonObject), null);
});
