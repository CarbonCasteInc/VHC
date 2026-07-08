/**
 * Auth callback worker (Slice C0) — Worker-style fetch handler, modeled
 * on services/vhc-pager/src/worker.mjs.
 *
 * Routes:
 *   OPTIONS /auth/:provider/start|callback  -> CORS preflight
 *   POST    /auth/:provider/start           -> issue state + authorize URL parameters
 *   GET/POST /auth/:provider/callback       -> exchange code, return non-secret session
 *   POST    /auth/apple/return              -> Apple form_post receiver: 303 to the PWA callback route
 *   GET     /api/health                     -> config booleans only (no values)
 *
 * `:provider` is a closed set (apple|google|x); anything else is 404.
 * All secrets are env-held; no secret ever enters a response or log.
 */

import {
  allowedOrigins,
  createKvAuthStore,
  createMemoryAuthStore,
  handleCallback,
  handleStart,
  isAllowedOrigin,
  isSignInProvider,
  providerConfig,
  sanitizeProviderErrorCode,
  SIGN_IN_PROVIDERS,
  stateSecret,
  verifyStateOnly,
} from './auth-core.mjs';

const memoryStore = createMemoryAuthStore();
const encoder = new TextEncoder();

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function maxBodyBytes(env) {
  const parsed = Number.parseInt(String(env.VH_AUTH_MAX_BODY_BYTES ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 64 * 1024;
}

async function requestText(request, env) {
  const limit = maxBodyBytes(env);
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > limit) throw new Error('request_body_too_large');
  if (!request.body?.getReader) {
    const text = await request.text();
    if (encoder.encode(text).byteLength > limit) throw new Error('request_body_too_large');
    return text;
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('request_body_too_large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function limitedJsonBody(request, env) {
  let text;
  try {
    text = await requestText(request, env);
  } catch (error) {
    if (error instanceof Error && error.message === 'request_body_too_large') {
      return { response: json({ status: 'rejected', reason: 'request_body_too_large' }, 413) };
    }
    throw error;
  }
  try {
    const value = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { response: json({ status: 'rejected', reason: 'invalid_json' }, 400) };
    }
    return { value };
  } catch {
    return { response: json({ status: 'rejected', reason: 'invalid_json' }, 400) };
  }
}

function selectedStore(env) {
  if (env.__TEST_STORE) return env.__TEST_STORE;
  if (env.VH_AUTH_KV) return createKvAuthStore(env.VH_AUTH_KV);
  if (env.VH_AUTH_ALLOW_VOLATILE_STORE === '1' || env.VH_AUTH_ALLOW_VOLATILE_STORE === 'true') return memoryStore;
  return null;
}

function nowMs(env) {
  const forced = Number.parseInt(String(env.__TEST_NOW_MS ?? ''), 10);
  return Number.isFinite(forced) ? forced : Date.now();
}

/**
 * Resolve which PWA origin the Apple form_post receiver redirects to. The flow's
 * PKCE pending state lives in the sessionStorage of the origin that STARTED the
 * flow, so redirecting to the wrong origin dead-ends the sign-in. Precedence:
 *
 *   1. `stateOrigin` — the origin bound into the signed state at /start — when
 *      it is still allow-listed. This is the exact initiating origin.
 *   2. `VH_AUTH_PWA_ORIGIN` — an explicit operator override — when allow-listed.
 *   3. The sole allow-listed origin, for the common single-origin deployment
 *      (zero extra config).
 *
 * Returns null for a multi-origin deployment when neither the state nor the
 * override resolves — the caller fails closed (503) rather than guessing.
 */
function resolvePwaOrigin(env, stateOrigin) {
  if (typeof stateOrigin === 'string' && isAllowedOrigin(stateOrigin, env)) {
    return stateOrigin.replace(/\/+$/u, '');
  }
  const override = env.VH_AUTH_PWA_ORIGIN;
  if (typeof override === 'string' && isAllowedOrigin(override, env)) {
    return override.replace(/\/+$/u, '');
  }
  const origins = allowedOrigins(env);
  return origins.length === 1 ? origins[0] : null;
}

/**
 * Build the PWA callback URL from a resolved origin plus the PWA callback route
 * (VH_AUTH_PWA_CALLBACK_ROUTE, defaulting to the PWA's own VITE_AUTH_CALLBACK_ROUTE
 * default of /auth/callback).
 */
function pwaCallbackTarget(origin, env) {
  const route = typeof env.VH_AUTH_PWA_CALLBACK_ROUTE === 'string' && env.VH_AUTH_PWA_CALLBACK_ROUTE.startsWith('/')
    ? env.VH_AUTH_PWA_CALLBACK_ROUTE
    : '/auth/callback';
  return `${origin}${route}`;
}

function isFormUrlencoded(request) {
  const contentType = request.headers.get('content-type') ?? '';
  return contentType.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded';
}

/**
 * Apple form_post receiver. With scopes configured (the default), Apple
 * delivers `code` + `state` (on success) or `error` + `state` (on user cancel /
 * provider error) as a TOP-LEVEL browser POST (application/x-www-form-urlencoded,
 * Origin: https://appleid.apple.com) to the registered redirect URI — so no
 * Origin allow-list and no JSON body apply here.
 *
 * This receiver reads ONLY `state` plus either `code` or a sanitized `error`,
 * and 303-redirects to the PWA callback route with them as query parameters —
 * the same exposure as the response_mode=query GET leg tolerated by
 * /auth/:provider/callback. The redirect targets the origin bound into the
 * signed state (verify-only — the single-use nonce is NOT consumed here, so the
 * PWA's later POST /auth/apple/callback can still consume it). The PKCE
 * `code_verifier` is deliberately NEVER read from this leg (it must only travel
 * in the PWA's later POST body); any other form field (Apple's `user` JSON, an
 * erroneous verifier) is ignored and never forwarded.
 */
async function handleAppleFormPostReturn(request, env) {
  if (request.method !== 'POST') {
    return json({ status: 'rejected', reason: 'method_not_allowed' }, 405, { allow: 'POST' });
  }
  if (!isFormUrlencoded(request)) {
    return json({ status: 'rejected', reason: 'unsupported_content_type' }, 415);
  }

  let text;
  try {
    text = await requestText(request, env);
  } catch (error) {
    if (error instanceof Error && error.message === 'request_body_too_large') {
      return json({ status: 'rejected', reason: 'request_body_too_large' }, 413);
    }
    throw error;
  }

  const form = new URLSearchParams(text);
  const code = form.get('code') ?? '';
  const state = form.get('state') ?? '';
  const errorCode = form.get('error') ?? '';
  if (state.length === 0 || state.length > 2048) {
    return json({ status: 'rejected', reason: 'state_invalid' }, 400);
  }

  // Verify-only peek to recover the initiating origin bound into the state.
  // Never consumes the nonce; a bad/expired state simply falls back to the
  // override / single-origin resolution below.
  let stateOrigin = null;
  const secret = stateSecret(env);
  if (secret) {
    const verified = await verifyStateOnly({ state, provider: 'apple', secret, nowMs: nowMs(env) });
    if (verified.ok && typeof verified.payload.origin === 'string') {
      stateOrigin = verified.payload.origin;
    }
  }

  const origin = resolvePwaOrigin(env, stateOrigin);
  if (!origin) {
    return json({ status: 'rejected', reason: 'pwa_origin_unconfigured' }, 503);
  }
  const location = new URL(pwaCallbackTarget(origin, env));
  location.searchParams.set('provider', 'apple');
  location.searchParams.set('state', state);

  // Error/cancel leg: Apple posts `error` (e.g. user_cancelled_authorize) and
  // `state`, no code. Forward the sanitized error so the PWA renders a graceful
  // failure and clears its pending state instead of dead-ending on a raw JSON
  // page at the worker origin. OAuth error codes are a public enum — nothing
  // secret rides here, and no code is forwarded.
  if (errorCode.length > 0) {
    location.searchParams.set('error', sanitizeProviderErrorCode(errorCode));
  } else if (code.length > 0 && code.length <= 2048) {
    location.searchParams.set('code', code);
  } else {
    return json({ status: 'rejected', reason: 'code_invalid' }, 400);
  }

  return new Response(null, {
    status: 303,
    headers: {
      location: location.toString(),
      'cache-control': 'no-store',
    },
  });
}

function requireAllowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin, env)) {
    return { response: json({ status: 'rejected', reason: 'origin_not_allowed' }, 403) };
  }
  return { origin };
}

export async function handleRequest(request, env = {}, _ctx = {}) {
  const url = new URL(request.url);
  const authMatch = url.pathname.match(/^\/auth\/([^/]+)\/(start|callback)$/);

  if (url.pathname === '/auth/apple/return') {
    return handleAppleFormPostReturn(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const configured = {};
    for (const provider of SIGN_IN_PROVIDERS) {
      configured[provider] = providerConfig(provider, env).ok;
    }
    return json({
      status: 'ok',
      schemaVersion: 'vh-auth-callback-health-v1',
      providersConfigured: configured,
      durableStore: Boolean(selectedStore(env)),
    });
  }

  if (!authMatch) {
    return json({ status: 'missing', reason: 'route_not_found' }, 404);
  }

  const [, provider, action] = authMatch;
  if (!isSignInProvider(provider)) {
    return json({ status: 'rejected', reason: 'unknown_provider' }, 404);
  }

  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('origin');
    if (!isAllowedOrigin(origin, env)) {
      return json({ status: 'rejected', reason: 'origin_not_allowed' }, 403);
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const store = selectedStore(env);
  if (!store) return json({ status: 'rejected', reason: 'durable_store_required' }, 503);

  if (action === 'start') {
    if (request.method !== 'POST') {
      return json({ status: 'rejected', reason: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
    }
    const originCheck = requireAllowedOrigin(request, env);
    if (originCheck.response) return originCheck.response;

    const body = await limitedJsonBody(request, env);
    if (body.response) return body.response;

    const result = await handleStart({
      provider,
      codeChallenge: body.value.codeChallenge,
      env,
      origin: originCheck.origin,
      nowMs: nowMs(env),
    });
    return json(result.body, result.status, corsHeaders(originCheck.origin));
  }

  // action === 'callback'
  let params;
  let headers = {};
  if (request.method === 'POST') {
    const originCheck = requireAllowedOrigin(request, env);
    if (originCheck.response) return originCheck.response;
    headers = corsHeaders(originCheck.origin);

    const body = await limitedJsonBody(request, env);
    if (body.response) return body.response;
    params = {
      code: body.value.code,
      state: body.value.state,
      codeVerifier: body.value.codeVerifier,
    };
  } else if (request.method === 'GET') {
    // The provider redirect carries only `code` + `state`. The PKCE
    // `code_verifier` is a bearer secret and MUST NOT travel in a URL
    // (it would land in edge access logs, browser history, and Referer
    // headers), so the GET branch never reads it. A verifier-less
    // callback fails PKCE verification, steering clients to the primary
    // POST-with-verifier-in-body flow.
    params = {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      codeVerifier: undefined,
    };
  } else {
    return json({ status: 'rejected', reason: 'method_not_allowed' }, 405, { allow: 'GET, POST, OPTIONS' });
  }

  const result = await handleCallback({
    provider,
    code: params.code,
    state: params.state,
    codeVerifier: params.codeVerifier,
    env,
    store,
    fetchImpl: env.__TEST_FETCH ?? globalThis.fetch,
    nowMs: nowMs(env),
  });
  return json(result.body, result.status, headers);
}

export default {
  fetch: handleRequest,
};
