/**
 * Auth callback worker (Slice C0) — Worker-style fetch handler, modeled
 * on services/vhc-pager/src/worker.mjs.
 *
 * Routes:
 *   OPTIONS /auth/:provider/start|callback  -> CORS preflight
 *   POST    /auth/:provider/start           -> issue state + authorize URL parameters
 *   GET/POST /auth/:provider/callback       -> exchange code, return non-secret session
 *   GET     /api/health                     -> config booleans only (no values)
 *
 * `:provider` is a closed set (apple|google|x); anything else is 404.
 * All secrets are env-held; no secret ever enters a response or log.
 */

import {
  createKvAuthStore,
  createMemoryAuthStore,
  handleCallback,
  handleStart,
  isAllowedOrigin,
  isSignInProvider,
  providerConfig,
  SIGN_IN_PROVIDERS,
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
