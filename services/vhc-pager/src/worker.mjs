import {
  createMemoryPagerStore,
  handleA6Alert,
  handleAck,
  handlePushSubscribe,
  missingHeartbeatIncident,
} from './pager-core.mjs';

const memoryStore = createMemoryPagerStore();

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

async function requestText(request) {
  return await request.text();
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
  const incident = store.state?.incidents?.get?.(incidentKey);
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
  return memoryStore;
}

export async function handleRequest(request, env = {}, ctx = {}) {
  const url = new URL(request.url);
  const store = selectedStore(env);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const heartbeat = missingHeartbeatIncident({
      latestHeartbeatAt: env.VH_PAGER_LAST_HEARTBEAT_AT,
      heartbeatMs: Number.parseInt(env.VH_PAGER_HEARTBEAT_MS ?? '900000', 10),
      nowMs: Date.now(),
    });
    return json({
      status: heartbeat.missing ? 'degraded' : 'ok',
      schemaVersion: 'vhc-pager-health-v1',
      activeSubscriptions: store.state?.subscriptions
        ? [...store.state.subscriptions.values()].filter((entry) => entry.status === 'active').length
        : null,
      outboxDepth: store.state?.outbox?.length ?? null,
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
    const result = await handleA6Alert({
      bodyText: await requestText(request),
      headers: request.headers,
      env,
      store,
      nowMs: Date.now(),
    });
    return json(result.body, result.status);
  }

  if (request.method === 'POST' && url.pathname === '/api/push-subscribe') {
    const result = await handlePushSubscribe({
      bodyText: await requestText(request),
      headers: request.headers,
      env,
      store,
    });
    return json(result.body, result.status);
  }

  const ackMatch = url.pathname.match(/^\/api\/ack\/([^/]+)$/);
  if (request.method === 'POST' && ackMatch) {
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
    if (!store.enqueueOutbox) return;
    ctx.waitUntil?.(store.enqueueOutbox({
      type: 'pager_deadman_check',
      createdAt: new Date().toISOString(),
    }));
  },
};
