/**
 * Auth callback core (Slice C0) — provider registry, PKCE state
 * issuance/verification, server-side authorization-code exchange, and
 * non-secret session shaping.
 *
 * Custody rules (mirrors services/vhc-pager redaction discipline):
 *  - Provider client secrets exist only in env; they are injected into
 *    outbound token-endpoint requests and never enter responses, logs,
 *    or error reasons.
 *  - Raw provider tokens (access/refresh/id) are NOT returned to the
 *    browser. The PWA receives a sanitized session payload only:
 *    provider id, provider subject, optional display label, expiry.
 *  - Error paths return stable reason codes; provider error bodies are
 *    reduced to a sanitized `error` code (a-z0-9_ only, truncated).
 *
 * Sign-in here is account continuity/recovery. It is not proof of
 * human uniqueness and must never be presented as such.
 */

import { buildAppleClientSecret } from './apple-client-secret.mjs';

const encoder = new TextEncoder();

export const SIGN_IN_PROVIDERS = Object.freeze(['apple', 'google', 'x']);

export const SESSION_SCHEMA_VERSION = 'vh-auth-session-v1';

const STATE_VERSION = 1;
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

const PROVIDER_DEFS = Object.freeze({
  apple: {
    authorizeEndpoint: 'https://appleid.apple.com/auth/authorize',
    tokenEndpoint: 'https://appleid.apple.com/auth/token',
    defaultScopes: 'email',
    issuers: ['https://appleid.apple.com'],
  },
  google: {
    authorizeEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    defaultScopes: 'openid email',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
  },
  x: {
    authorizeEndpoint: 'https://x.com/i/oauth2/authorize',
    tokenEndpoint: 'https://api.x.com/2/oauth2/token',
    userinfoEndpoint: 'https://api.x.com/2/users/me',
    defaultScopes: 'users.read tweet.read',
    issuers: [],
  },
});

function subtleCrypto() {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  throw new Error('WebCrypto subtle API is required');
}

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToUtf8(value) {
  const normalized = String(value ?? '').replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

export function isSignInProvider(value) {
  return SIGN_IN_PROVIDERS.includes(value);
}

export async function hmacSha256Hex(secret, text) {
  const key = await subtleCrypto().subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(await subtleCrypto().subtle.sign('HMAC', key, encoder.encode(text)));
}

/**
 * Constant-time string equality for MAC verification. Compares lengths
 * first, then accumulates the XOR of every byte so the loop cost does
 * not depend on where the first mismatch is — closing the timing oracle
 * on the state HMAC compare. Only use for secret/MAC comparisons; a
 * plain === is fine for public-data compares.
 */
export function constantTimeEqual(a, b) {
  const aBytes = encoder.encode(String(a ?? ''));
  const bBytes = encoder.encode(String(b ?? ''));
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let index = 0; index < aBytes.length; index += 1) {
    diff |= aBytes[index] ^ bBytes[index];
  }
  return diff === 0;
}

export async function computeS256Challenge(codeVerifier) {
  const digest = await subtleCrypto().subtle.digest('SHA-256', encoder.encode(codeVerifier));
  return bytesToBase64Url(digest);
}

export function randomNonce(byteLength = 16) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64Url(bytes);
}

export function stateTtlMs(env) {
  const parsed = Number.parseInt(String(env.VH_AUTH_STATE_TTL_MS ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STATE_TTL_MS;
}

export function allowedOrigins(env) {
  return String(env.VH_AUTH_ALLOWED_ORIGINS ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().replace(/\/+$/u, ''))
    .filter(Boolean);
}

export function isAllowedOrigin(origin, env) {
  if (typeof origin !== 'string' || origin.length === 0) return false;
  const normalized = origin.replace(/\/+$/u, '');
  return allowedOrigins(env).includes(normalized);
}

export function isValidCodeChallenge(value) {
  return typeof value === 'string' && CODE_CHALLENGE_PATTERN.test(value);
}

export function isValidCodeVerifier(value) {
  return typeof value === 'string' && CODE_VERIFIER_PATTERN.test(value);
}

/**
 * Provider configuration resolved from env. Returns
 * `{ ok: true, config }` or `{ ok: false, reason }`. The config object
 * carries the client secret material; it must never be serialized into
 * a response.
 */
export function providerConfig(provider, env) {
  if (!isSignInProvider(provider)) return { ok: false, reason: 'unknown_provider' };
  const def = PROVIDER_DEFS[provider];

  if (provider === 'apple') {
    const clientId = env.VH_AUTH_APPLE_CLIENT_ID;
    const teamId = env.VH_AUTH_APPLE_TEAM_ID;
    const keyId = env.VH_AUTH_APPLE_KEY_ID;
    const privateKeyPem = env.VH_AUTH_APPLE_PRIVATE_KEY;
    const redirectUri = env.VH_AUTH_APPLE_REDIRECT_URI;
    if (!clientId || !teamId || !keyId || !privateKeyPem || !redirectUri) {
      return { ok: false, reason: 'provider_not_configured' };
    }
    return {
      ok: true,
      config: {
        provider,
        clientId,
        redirectUri,
        scopes: env.VH_AUTH_APPLE_SCOPES ?? def.defaultScopes,
        authorizeEndpoint: def.authorizeEndpoint,
        tokenEndpoint: def.tokenEndpoint,
        issuers: def.issuers,
        apple: { teamId, keyId, privateKeyPem },
      },
    };
  }

  if (provider === 'google') {
    const clientId = env.VH_AUTH_GOOGLE_CLIENT_ID;
    const clientSecret = env.VH_AUTH_GOOGLE_CLIENT_SECRET;
    const redirectUri = env.VH_AUTH_GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      return { ok: false, reason: 'provider_not_configured' };
    }
    return {
      ok: true,
      config: {
        provider,
        clientId,
        clientSecret,
        redirectUri,
        scopes: env.VH_AUTH_GOOGLE_SCOPES ?? def.defaultScopes,
        authorizeEndpoint: def.authorizeEndpoint,
        tokenEndpoint: def.tokenEndpoint,
        issuers: def.issuers,
      },
    };
  }

  const clientId = env.VH_AUTH_X_CLIENT_ID;
  const clientSecret = env.VH_AUTH_X_CLIENT_SECRET;
  const redirectUri = env.VH_AUTH_X_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return { ok: false, reason: 'provider_not_configured' };
  }
  return {
    ok: true,
    config: {
      provider,
      clientId,
      clientSecret,
      redirectUri,
      scopes: env.VH_AUTH_X_SCOPES ?? def.defaultScopes,
      authorizeEndpoint: def.authorizeEndpoint,
      tokenEndpoint: def.tokenEndpoint,
      userinfoEndpoint: def.userinfoEndpoint,
      issuers: def.issuers,
    },
  };
}

// ── State (single-use, expiring, HMAC-signed) ──────────────────────

export function stateSecret(env) {
  const secret = env.VH_AUTH_STATE_SECRET;
  return typeof secret === 'string' && secret.length >= 16 ? secret : null;
}

/**
 * Issue an HMAC-signed state value binding the provider and the PKCE
 * S256 code challenge. The browser holds the code_verifier; only the
 * challenge transits this boundary at /start.
 */
export async function issueState({ provider, codeChallenge, secret, origin, nowMs = Date.now(), ttlMs = DEFAULT_STATE_TTL_MS }) {
  const payload = {
    v: STATE_VERSION,
    provider,
    codeChallenge,
    nonce: randomNonce(),
    iat: nowMs,
    exp: nowMs + ttlMs,
  };
  // Bind the initiating (already allow-listed) PWA origin so a cross-site
  // form_post return leg can redirect the browser back to the exact origin that
  // holds the PKCE pending state. Optional + additive: unknown fields are
  // ignored on verify, so no STATE_VERSION bump and old in-flight states still
  // verify.
  if (typeof origin === 'string' && origin.length > 0) {
    payload.origin = origin;
  }
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await hmacSha256Hex(secret, encoded);
  return { state: `${encoded}.${signature}`, payload };
}

/**
 * Verify a state value WITHOUT consuming it: signature, shape, provider match,
 * expiry, and challenge/nonce validity. Does NOT touch the single-use nonce
 * ledger, so a read-only peek (e.g. the Apple form_post return leg reading the
 * bound origin) does not burn the state before the PWA's authoritative
 * POST /auth/:provider/callback consumes it.
 */
export async function verifyStateOnly({ state, provider, secret, nowMs = Date.now() }) {
  if (typeof state !== 'string' || state.length === 0 || state.length > 2048) {
    return { ok: false, reason: 'state_invalid' };
  }
  const parts = state.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'state_invalid' };
  const [encoded, signature] = parts;

  const expected = await hmacSha256Hex(secret, encoded);
  if (!constantTimeEqual(expected, signature)) return { ok: false, reason: 'state_signature_mismatch' };

  let payload;
  try {
    const parsed = safeJsonParse(base64UrlToUtf8(encoded));
    if (!parsed.ok) return { ok: false, reason: 'state_invalid' };
    payload = parsed.value;
  } catch {
    return { ok: false, reason: 'state_invalid' };
  }

  if (payload?.v !== STATE_VERSION || payload.provider !== provider) {
    return { ok: false, reason: 'state_provider_mismatch' };
  }
  if (!Number.isFinite(payload.exp) || payload.exp <= nowMs) {
    return { ok: false, reason: 'state_expired' };
  }
  if (!isValidCodeChallenge(payload.codeChallenge) || typeof payload.nonce !== 'string' || payload.nonce.length === 0) {
    return { ok: false, reason: 'state_invalid' };
  }

  return { ok: true, payload };
}

/**
 * Verify and CONSUME a state value: full verification, then single-use
 * enforcement through the store nonce ledger.
 */
export async function verifyAndConsumeState({ state, provider, secret, store, nowMs = Date.now() }) {
  const verified = await verifyStateOnly({ state, provider, secret, nowMs });
  if (!verified.ok) {
    return verified;
  }
  const { payload } = verified;

  // Best-effort replay ledger. hasNonce+rememberNonce are two steps and
  // the KV get/put is not atomic, so this is NOT a strict single-use
  // guarantee — a compare-and-set store (e.g. a Durable Object) would be
  // required for that and is out of scope for these foundations. The
  // authoritative single-use backstop is the provider's authorization
  // code: a concurrent second exchange of the same code returns
  // `provider_exchange_failed`. Keep this ledger as defense-in-depth.
  const nonceKey = `auth-state:${payload.nonce}`;
  if (await store.hasNonce(nonceKey, nowMs)) {
    return { ok: false, reason: 'state_replayed' };
  }
  await store.rememberNonce(nonceKey, payload.exp);

  return { ok: true, payload };
}

// ── Store (nonce ledger for single-use state) ──────────────────────

export function createMemoryAuthStore() {
  const nonces = new Map();
  return {
    async hasNonce(nonce, nowMs = Date.now()) {
      const expiresAt = nonces.get(nonce);
      return Number.isFinite(expiresAt) && expiresAt > nowMs;
    },
    async rememberNonce(nonce, expiresAt) {
      nonces.set(nonce, expiresAt);
    },
  };
}

export function createKvAuthStore(kv) {
  return {
    async hasNonce(nonce, nowMs = Date.now()) {
      const text = await kv.get(`nonce:${nonce}`);
      if (!text) return false;
      const parsed = safeJsonParse(text);
      return parsed.ok && Number.isFinite(parsed.value?.expiresAt) && parsed.value.expiresAt > nowMs;
    },
    async rememberNonce(nonce, expiresAt) {
      await kv.put(`nonce:${nonce}`, JSON.stringify({ expiresAt }));
    },
  };
}

// ── /start ─────────────────────────────────────────────────────────

/**
 * Build the provider authorize URL parameters for a /start request.
 * Returns the parameters and the assembled URL; contains no secrets
 * (client secret is only used at token exchange).
 */
export async function handleStart({ provider, codeChallenge, env, origin, nowMs = Date.now() }) {
  const secret = stateSecret(env);
  if (!secret) return { status: 503, body: { status: 'rejected', reason: 'state_secret_unconfigured' } };

  const resolved = providerConfig(provider, env);
  if (!resolved.ok) {
    return { status: resolved.reason === 'unknown_provider' ? 404 : 503, body: { status: 'rejected', reason: resolved.reason } };
  }
  if (!isValidCodeChallenge(codeChallenge)) {
    return { status: 400, body: { status: 'rejected', reason: 'code_challenge_invalid' } };
  }

  const { config } = resolved;
  const { state } = await issueState({
    provider,
    codeChallenge,
    secret,
    origin,
    nowMs,
    ttlMs: stateTtlMs(env),
  });

  const parameters = {
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  };
  if (provider === 'apple') {
    // Apple requires form_post response mode when scopes are requested.
    parameters.response_mode = config.scopes ? 'form_post' : 'query';
  }

  const url = new URL(config.authorizeEndpoint);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }

  return {
    status: 200,
    body: {
      status: 'ok',
      schemaVersion: 'vh-auth-start-v1',
      provider,
      authorizeEndpoint: config.authorizeEndpoint,
      authorizeUrl: url.toString(),
      parameters,
      expiresAt: nowMs + stateTtlMs(env),
    },
  };
}

// ── Token exchange ─────────────────────────────────────────────────

export function sanitizeProviderErrorCode(value) {
  const text = String(value ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
  return text || 'unspecified';
}

async function providerTokenRequest({ config, code, codeVerifier, nowMs }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
    client_id: config.clientId,
  });
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };

  if (config.provider === 'apple') {
    body.set('client_secret', await buildAppleClientSecret({
      teamId: config.apple.teamId,
      clientId: config.clientId,
      keyId: config.apple.keyId,
      privateKeyPem: config.apple.privateKeyPem,
      nowMs,
    }));
  } else if (config.provider === 'google') {
    body.set('client_secret', config.clientSecret);
  } else {
    // X (OAuth2 confidential client): HTTP basic auth carries the secret.
    headers.authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  }

  return { url: config.tokenEndpoint, init: { method: 'POST', headers, body: body.toString() } };
}

/**
 * Exchange an authorization code + code_verifier at the provider token
 * endpoint, injecting the server-held client secret. Returns either
 * `{ ok: true, tokenJson }` or a sanitized failure — provider response
 * bodies are never propagated.
 */
export async function exchangeAuthorizationCode({ config, code, codeVerifier, fetchImpl, nowMs = Date.now() }) {
  // Building the request can throw before any network call — most
  // notably Apple's ES256 client-secret build on a malformed .p8 or
  // missing key config (apple_private_key_import_failed /
  // apple_client_secret_config_missing). Map that to a stable
  // sanitized reason so the "always a clean rejection" contract holds;
  // never propagate the underlying error (it could reference secret
  // material).
  let request;
  try {
    request = await providerTokenRequest({ config, code, codeVerifier, nowMs });
  } catch {
    return { ok: false, reason: 'provider_not_configured' };
  }

  let response;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch {
    return { ok: false, reason: 'provider_unreachable' };
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok || !json || typeof json !== 'object') {
    return {
      ok: false,
      reason: 'provider_exchange_failed',
      providerStatus: response.status,
      providerError: sanitizeProviderErrorCode(json?.error),
    };
  }

  return { ok: true, tokenJson: json };
}

// ── Session shaping (non-secret payload for the PWA) ───────────────

export function decodeJwtPayloadUnsafe(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const parsed = safeJsonParse(base64UrlToUtf8(parts[1]));
    return parsed.ok && typeof parsed.value === 'object' && parsed.value !== null ? parsed.value : null;
  } catch {
    return null;
  }
}

export function audienceIncludes(aud, clientId) {
  if (typeof clientId !== 'string' || clientId.length === 0) return false;
  if (typeof aud === 'string') return aud === clientId;
  if (Array.isArray(aud)) return aud.includes(clientId);
  return false;
}

function expiryFromTokenJson(tokenJson, nowMs) {
  const expiresIn = Number(tokenJson.expires_in);
  return Number.isFinite(expiresIn) && expiresIn > 0 ? nowMs + Math.floor(expiresIn) * 1000 : null;
}

function truncateLabel(value) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 120) : null;
}

/**
 * Derive the non-secret session payload the PWA receives. Raw provider
 * tokens are intentionally dropped here — they never reach the browser.
 *
 * The id_token arrives directly from the provider token endpoint over
 * TLS (not from the browser), so possession is authenticated by the
 * exchange itself; `iss`/`aud` are still checked defensively.
 */
export async function sessionFromTokenResponse({ config, tokenJson, fetchImpl, nowMs = Date.now() }) {
  if (config.provider === 'x') {
    const accessToken = tokenJson.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      return { ok: false, reason: 'provider_token_missing' };
    }
    let userJson = null;
    try {
      const response = await fetchImpl(config.userinfoEndpoint, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      userJson = response.ok ? await response.json() : null;
    } catch {
      userJson = null;
    }
    const subject = userJson?.data?.id;
    if (typeof subject !== 'string' || subject.length === 0) {
      return { ok: false, reason: 'provider_subject_missing' };
    }
    const username = userJson.data.username;
    return {
      ok: true,
      session: {
        schemaVersion: SESSION_SCHEMA_VERSION,
        providerId: 'x',
        providerSubject: subject,
        displayLabel: truncateLabel(typeof username === 'string' && username ? `@${username}` : null),
        issuedAt: nowMs,
        expiresAt: expiryFromTokenJson(tokenJson, nowMs),
      },
    };
  }

  const claims = decodeJwtPayloadUnsafe(tokenJson.id_token);
  if (!claims) return { ok: false, reason: 'provider_id_token_missing' };
  if (config.issuers.length > 0 && !config.issuers.includes(claims.iss)) {
    return { ok: false, reason: 'provider_issuer_mismatch' };
  }
  // OIDC allows `aud` to be either a string or an array of audiences.
  if (!audienceIncludes(claims.aud, config.clientId)) {
    return { ok: false, reason: 'provider_audience_mismatch' };
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return { ok: false, reason: 'provider_subject_missing' };
  }

  return {
    ok: true,
    session: {
      schemaVersion: SESSION_SCHEMA_VERSION,
      providerId: config.provider,
      providerSubject: claims.sub,
      displayLabel: truncateLabel(
        typeof claims.email === 'string' && claims.email
          ? claims.email
          : typeof claims.name === 'string' && claims.name
            ? claims.name
            : null,
      ),
      issuedAt: nowMs,
      expiresAt: expiryFromTokenJson(tokenJson, nowMs),
    },
  };
}

// ── /callback ──────────────────────────────────────────────────────

/**
 * Validate state, verify the PKCE verifier against the challenge bound
 * at /start, exchange the code server-side, and return the sanitized
 * session payload. Any failure returns a clean rejection with no
 * partial session and no secret material.
 */
export async function handleCallback({ provider, code, state, codeVerifier, env, store, fetchImpl, nowMs = Date.now() }) {
  const secret = stateSecret(env);
  if (!secret) return { status: 503, body: { status: 'rejected', reason: 'state_secret_unconfigured' } };

  const resolved = providerConfig(provider, env);
  if (!resolved.ok) {
    return { status: resolved.reason === 'unknown_provider' ? 404 : 503, body: { status: 'rejected', reason: resolved.reason } };
  }

  if (typeof code !== 'string' || code.length === 0 || code.length > 2048) {
    return { status: 400, body: { status: 'rejected', reason: 'code_invalid' } };
  }
  if (!isValidCodeVerifier(codeVerifier)) {
    return { status: 400, body: { status: 'rejected', reason: 'code_verifier_invalid' } };
  }

  const stateResult = await verifyAndConsumeState({ state, provider, secret, store, nowMs });
  if (!stateResult.ok) {
    return { status: 401, body: { status: 'rejected', reason: stateResult.reason } };
  }

  const expectedChallenge = await computeS256Challenge(codeVerifier);
  if (expectedChallenge !== stateResult.payload.codeChallenge) {
    return { status: 401, body: { status: 'rejected', reason: 'code_verifier_mismatch' } };
  }

  const exchange = await exchangeAuthorizationCode({
    config: resolved.config,
    code,
    codeVerifier,
    fetchImpl,
    nowMs,
  });
  if (!exchange.ok) {
    // A request-build failure (e.g. malformed Apple key) is a server
    // config fault -> 503, matching the config-time semantics; provider
    // exchange/network failures are upstream -> 502. Either way it is a
    // clean rejection with no partial session and no secret material.
    const status = exchange.reason === 'provider_not_configured' ? 503 : 502;
    return {
      status,
      body: {
        status: 'rejected',
        reason: exchange.reason,
        ...(exchange.providerStatus !== undefined ? { providerStatus: exchange.providerStatus } : {}),
        ...(exchange.providerError !== undefined ? { providerError: exchange.providerError } : {}),
      },
    };
  }

  const shaped = await sessionFromTokenResponse({
    config: resolved.config,
    tokenJson: exchange.tokenJson,
    fetchImpl,
    nowMs,
  });
  if (!shaped.ok) {
    return { status: 502, body: { status: 'rejected', reason: shaped.reason } };
  }

  return { status: 200, body: { status: 'ok', session: shaped.session } };
}
