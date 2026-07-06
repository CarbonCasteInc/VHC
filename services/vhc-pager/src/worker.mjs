import {
  createKvPagerStore,
  createMemoryPagerStore,
  handleA6Alert,
  handleAck,
  handlePushSubscribe,
  missingHeartbeatIncident,
} from './pager-core.mjs';

const memoryStore = createMemoryPagerStore();
const encoder = new TextEncoder();

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
  const parsed = Number.parseInt(String(env.VH_PAGER_MAX_BODY_BYTES ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 128 * 1024;
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

function authToken(headers) {
  const value = headers.get('authorization') ?? '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function readIncident({ incidentKey, request, env, store }) {
  if (authToken(request.headers) !== env.VH_PAGER_DEVICE_TOKEN) {
    return json({ status: 'rejected', reason: 'device_token_required' }, 401);
  }
  const incident = await store.getIncident(incidentKey);
  if (!incident) return json({ status: 'missing', reason: 'incident_not_found' }, 404);
  return json({
    status: 'ok',
    incident: {
      incidentKey: incident.incidentKey,
      firstSeenAt: incident.firstSeenAt,
      latestSeenAt: incident.latestSeenAt,
      severity: incident.severity,
      status: incident.status,
      ackedAt: incident.ackedAt ?? null,
      alert: incident.alert,
    },
  });
}

function selectedStore(env) {
  if (env.__TEST_STORE) return env.__TEST_STORE;
  if (env.VH_PAGER_KV) return createKvPagerStore(env.VH_PAGER_KV);
  if (env.VH_PAGER_ALLOW_VOLATILE_STORE === '1' || env.VH_PAGER_ALLOW_VOLATILE_STORE === 'true') return memoryStore;
  return null;
}

function durableStoreRequired() {
  return json({ status: 'rejected', reason: 'durable_store_required' }, 503);
}

async function limitedBodyOrResponse(request, env) {
  try {
    return { bodyText: await requestText(request, env) };
  } catch (error) {
    if (error instanceof Error && error.message === 'request_body_too_large') {
      return { response: json({ status: 'rejected', reason: 'request_body_too_large' }, 413) };
    }
    throw error;
  }
}

export async function handleRequest(request, env = {}, ctx = {}) {
  const url = new URL(request.url);
  const store = selectedStore(env);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    if (!store) return durableStoreRequired();
    const heartbeat = missingHeartbeatIncident({
      latestHeartbeatAt: env.VH_PAGER_LAST_HEARTBEAT_AT,
      heartbeatMs: Number.parseInt(env.VH_PAGER_HEARTBEAT_MS ?? '900000', 10),
      nowMs: Date.now(),
    });
    return json({
      status: heartbeat.missing ? 'degraded' : 'ok',
      schemaVersion: 'vhc-pager-health-v1',
      activeSubscriptions: await store.activeSubscriptionCount(),
      outboxDepth: await store.outboxDepth(),
      heartbeat,
    }, heartbeat.missing ? 503 : 200);
  }

  if (request.method === 'GET' && url.pathname === '/api/config') {
    return json({
      schemaVersion: 'vhc-pager-public-config-v1',
      vapidPublicKey: env.VH_PAGER_VAPID_PUBLIC_KEY ?? null,
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/a6-alert') {
    if (!store) return durableStoreRequired();
    const body = await limitedBodyOrResponse(request, env);
    if (body.response) return body.response;
    const result = await handleA6Alert({
      bodyText: body.bodyText,
      headers: request.headers,
      env,
      store,
      nowMs: Date.now(),
    });
    return json(result.body, result.status);
  }

  if (request.method === 'POST' && url.pathname === '/api/push-subscribe') {
    if (!store) return durableStoreRequired();
    const body = await limitedBodyOrResponse(request, env);
    if (body.response) return body.response;
    const result = await handlePushSubscribe({
      bodyText: body.bodyText,
      headers: request.headers,
      env,
      store,
    });
    return json(result.body, result.status);
  }

  const ackMatch = url.pathname.match(/^\/api\/ack\/([^/]+)$/);
  if (request.method === 'POST' && ackMatch) {
    if (!store) return durableStoreRequired();
    const result = await handleAck({
      incidentKey: decodeURIComponent(ackMatch[1]),
      headers: request.headers,
      env,
      store,
      nowMs: Date.now(),
    });
    return json(result.body, result.status);
  }

  const incidentMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)$/);
  if (request.method === 'GET' && incidentMatch) {
    if (!store) return durableStoreRequired();
    return readIncident({
      incidentKey: decodeURIComponent(incidentMatch[1]),
      request,
      env,
      store,
    });
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return new Response('VHC pager worker is running. Serve the static PWA assets from services/vhc-pager/pwa/.', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return json({ status: 'missing', reason: 'route_not_found' }, 404);
}

export default {
  fetch: handleRequest,
  async scheduled(_event, env = {}, ctx = {}) {
    const store = selectedStore(env);
    if (!store?.enqueueOutbox) return;
    ctx.waitUntil?.(store.enqueueOutbox({
      type: 'pager_deadman_check',
      createdAt: new Date().toISOString(),
    }));
  },
};
