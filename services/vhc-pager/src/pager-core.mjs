const encoder = new TextEncoder();
const DEFAULT_HEARTBEAT_FLOOR_MS = 35 * 60 * 1000;

function subtleCrypto() {
  if (globalThis.crypto?.subtle) return globalThis.crypto;
  throw new Error('WebCrypto subtle API is required');
}

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function kvGetJson(kv, key, fallback = null) {
  if (typeof kv.get !== 'function') return fallback;
  const text = await kv.get(key);
  if (!text) return fallback;
  const parsed = safeJsonParse(text);
  return parsed.ok ? parsed.value : fallback;
}

async function kvPutJson(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

function headerValue(headers, name) {
  const lower = name.toLowerCase();
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

function bearerToken(headers) {
  const auth = headerValue(headers, 'authorization');
  const match = String(auth ?? '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeAlertClassFamily(alertClass) {
  const text = String(alertClass ?? '').trim();
  if (!text) return 'unknown';
  if (text.startsWith('exit_69')) return 'exit_69';
  if (text.startsWith('exit_75')) return 'exit_75';
  if (text.startsWith('exit_78')) return 'exit_78';
  if (text.includes('freshness')) return 'freshness';
  if (text.includes('relay_liveness')) return 'relay_liveness';
  if (text.includes('watch_closure')) return 'watch_closure';
  return text.replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase();
}

function allowedPushEndpointHosts(value) {
  return String(value ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatchesPattern(hostname, pattern) {
  if (!pattern) return false;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
}

function isPrivateEndpointHost(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  const ipv4 = host.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (!ipv4) return false;
  const octets = host.split('.').map((entry) => Number.parseInt(entry, 10));
  if (octets.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) return true;
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

export function validatePushSubscription({ subscription, allowedHosts = '' }) {
  const endpoint = String(subscription?.endpoint ?? '');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: 'push_endpoint_url_invalid' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'push_endpoint_https_required' };
  if (url.username || url.password) return { ok: false, reason: 'push_endpoint_credentials_forbidden' };
  if (isPrivateEndpointHost(url.hostname)) return { ok: false, reason: 'push_endpoint_private_host_forbidden' };
  const hostAllowlist = allowedPushEndpointHosts(allowedHosts);
  if (hostAllowlist.length > 0 && !hostAllowlist.some((pattern) => hostMatchesPattern(url.hostname.toLowerCase(), pattern))) {
    return { ok: false, reason: 'push_endpoint_host_not_allowed' };
  }
  return { ok: true, endpoint };
}

function alertClassFromPayload(payload) {
  const publisherClass = payload?.publisher?.failureClass;
  if (publisherClass && publisherClass !== 'none') return publisherClass;
  const blocker = Array.isArray(payload?.blockers) ? payload.blockers[0] : null;
  return String(blocker ?? payload?.status ?? 'unknown').split(':')[0];
}

export function incidentKeyForAlert(payload) {
  const source = 'public-feed';
  return `a6:${source}:${normalizeAlertClassFamily(alertClassFromPayload(payload))}`;
}

export function sanitizePagerAlert(payload) {
  return {
    schemaVersion: payload?.schemaVersion ?? null,
    generatedAt: payload?.generatedAt ?? null,
    alertReason: payload?.alertReason ?? null,
    status: payload?.status ?? null,
    observedStatus: payload?.observedStatus ?? null,
    severity: payload?.severity ?? null,
    blockers: Array.isArray(payload?.blockers) ? payload.blockers.map((entry) => String(entry).slice(0, 240)) : [],
    fingerprint: payload?.fingerprint ?? null,
    alertClass: alertClassFromPayload(payload),
    publisher: payload?.publisher
      ? {
          status: payload.publisher.status ?? null,
          failureClass: payload.publisher.failureClass ?? null,
          activeState: payload.publisher.activeState ?? null,
          subState: payload.publisher.subState ?? null,
          execMainStatus: payload.publisher.execMainStatus ?? null,
          result: payload.publisher.result ?? null,
          recoveryHint: payload.publisher.recoveryHint ?? null,
        }
      : null,
    freshness: payload?.freshness
      ? {
          status: payload.freshness.status ?? null,
          blockerCount: Array.isArray(payload.freshness.blockers) ? payload.freshness.blockers.length : 0,
        }
      : null,
    relayLiveness: payload?.relayLiveness
      ? {
          status: payload.relayLiveness.status ?? null,
          blockerCount: Array.isArray(payload.relayLiveness.blockers) ? payload.relayLiveness.blockers.length : 0,
        }
      : null,
    relaySnapshot: payload?.relaySnapshot
      ? {
          status: payload.relaySnapshot.status ?? null,
          blockerCount: Array.isArray(payload.relaySnapshot.blockers) ? payload.relaySnapshot.blockers.length : 0,
        }
      : null,
    watchClosure: payload?.watchClosure
      ? {
          status: payload.watchClosure.status ?? null,
          verdictStatus: payload.watchClosure.verdictStatus ?? null,
          blockerCount: Array.isArray(payload.watchClosure.blockers) ? payload.watchClosure.blockers.length : 0,
        }
      : null,
  };
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

export async function sha256Hex(text) {
  return bytesToHex(await subtleCrypto().subtle.digest('SHA-256', encoder.encode(text)));
}

export function signatureBase({ timestamp, nonce, bodyText }) {
  return `${timestamp}.${nonce}.${bodyText}`;
}

export async function signA6Alert({ secret, timestamp, nonce, bodyText }) {
  return `sha256=${await hmacSha256Hex(secret, signatureBase({ timestamp, nonce, bodyText }))}`;
}

async function verifyA6Signature({ env, headers, bodyText, store, nowMs }) {
  const secret = env.VH_PAGER_A6_WEBHOOK_SECRET;
  const requireSigned = env.VH_PAGER_REQUIRE_SIGNED === '1' || env.VH_PAGER_REQUIRE_SIGNED === 'true';
  const bootstrapSecret = env.VH_PAGER_UNSIGNED_BOOTSTRAP_SECRET;
  const bootstrapDisabled = env.VH_PAGER_UNSIGNED_BOOTSTRAP_DISABLED === '1' || env.VH_PAGER_UNSIGNED_BOOTSTRAP_DISABLED === 'true';
  const timestamp = headerValue(headers, 'x-vhc-alert-timestamp');
  const nonce = headerValue(headers, 'x-vhc-alert-nonce');
  const signature = headerValue(headers, 'x-vhc-alert-signature');
  const freshnessMs = parsePositiveInt(env.VH_PAGER_SIGNATURE_FRESHNESS_MS, 5 * 60 * 1000);
  if (secret && timestamp && nonce && signature) {
    const timestampMs = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > freshnessMs) {
      return { ok: false, status: 401, reason: 'signature_timestamp_out_of_window' };
    }
    if (await store.hasNonce(nonce, nowMs)) {
      return { ok: false, status: 401, reason: 'signature_nonce_replay' };
    }
    const expected = await signA6Alert({ secret, timestamp, nonce, bodyText });
    if (expected !== signature) {
      return { ok: false, status: 401, reason: 'signature_mismatch' };
    }
    await store.rememberNonce(nonce, nowMs + freshnessMs);
    await store.setUnsignedBootstrapDisabled(true);
    return { ok: true, mode: 'signed' };
  }
  if (requireSigned || bootstrapDisabled || await store.unsignedBootstrapDisabled()) {
    return { ok: false, status: 401, reason: 'signed_ingest_required' };
  }
  if (bootstrapSecret && headerValue(headers, 'x-vhc-bootstrap-secret') === bootstrapSecret) {
    return { ok: true, mode: 'unsigned_bootstrap' };
  }
  return { ok: false, status: 401, reason: 'ingest_auth_missing' };
}

export function createMemoryPagerStore() {
  const state = {
    alerts: [],
    incidents: new Map(),
    outbox: [],
    nonces: new Map(),
    subscriptions: new Map(),
    unsignedDisabled: false,
    fanoutFailure: false,
  };
  return {
    state,
    async hasNonce(nonce, nowMs = Date.now()) {
      const expiresAt = state.nonces.get(nonce);
      return Number.isFinite(expiresAt) && expiresAt > nowMs;
    },
    async rememberNonce(nonce, expiresAt) {
      state.nonces.set(nonce, expiresAt);
    },
    async unsignedBootstrapDisabled() {
      return state.unsignedDisabled;
    },
    async setUnsignedBootstrapDisabled(value) {
      state.unsignedDisabled = Boolean(value);
    },
    async persistAlert(record) {
      state.alerts.push(record);
      const existing = state.incidents.get(record.incidentKey) ?? {
        incidentKey: record.incidentKey,
        firstSeenAt: record.receivedAt,
        latestSeenAt: record.receivedAt,
        status: 'open',
        severity: 'info',
        fingerprintHistory: [],
        ackedAt: null,
      };
      existing.latestSeenAt = record.receivedAt;
      existing.severity = record.alert.severity ?? existing.severity;
      if (record.alert.fingerprint && !existing.fingerprintHistory.includes(record.alert.fingerprint)) {
        existing.fingerprintHistory.push(record.alert.fingerprint);
      }
      existing.alert = record.alert;
      state.incidents.set(record.incidentKey, existing);
      return existing;
    },
    async enqueueOutbox(event) {
      if (state.fanoutFailure) throw new Error('fanout_failed');
      state.outbox.push(event);
    },
    async ackIncident(incidentKey, deviceId, nowIso) {
      const incident = state.incidents.get(incidentKey);
      if (!incident) return null;
      incident.ackedAt = nowIso;
      incident.ackedByDeviceId = deviceId;
      return incident;
    },
    async getIncident(incidentKey) {
      return state.incidents.get(incidentKey) ?? null;
    },
    async saveSubscription(subscription) {
      state.subscriptions.set(subscription.id, { ...subscription, status: 'active' });
    },
    async deleteSubscription(id) {
      state.subscriptions.delete(id);
    },
    async markSubscriptionDead(id) {
      const current = state.subscriptions.get(id);
      if (current) state.subscriptions.set(id, { ...current, status: 'dead' });
    },
    async activeSubscriptionCount() {
      return [...state.subscriptions.values()].filter((entry) => entry.status === 'active').length;
    },
    async outboxDepth() {
      return state.outbox.length;
    },
  };
}

export function createKvPagerStore(kv) {
  return {
    async hasNonce(nonce, nowMs = Date.now()) {
      const record = await kvGetJson(kv, `nonce:${nonce}`);
      return Number.isFinite(record?.expiresAt) && record.expiresAt > nowMs;
    },
    async rememberNonce(nonce, expiresAt) {
      await kvPutJson(kv, `nonce:${nonce}`, { expiresAt });
    },
    async unsignedBootstrapDisabled() {
      return (await kv.get('flag:unsigned-bootstrap-disabled')) === 'true';
    },
    async setUnsignedBootstrapDisabled(value) {
      await kv.put('flag:unsigned-bootstrap-disabled', value ? 'true' : 'false');
    },
    async persistAlert(record) {
      await kvPutJson(kv, `alert:${record.requestHash}`, record);
      const incidentKey = `incident:${record.incidentKey}`;
      const existing = await kvGetJson(kv, incidentKey, {
        incidentKey: record.incidentKey,
        firstSeenAt: record.receivedAt,
        latestSeenAt: record.receivedAt,
        status: 'open',
        severity: 'info',
        fingerprintHistory: [],
        ackedAt: null,
      });
      const incident = {
        ...existing,
        latestSeenAt: record.receivedAt,
        severity: record.alert.severity ?? existing.severity,
        fingerprintHistory: record.alert.fingerprint && !existing.fingerprintHistory?.includes(record.alert.fingerprint)
          ? [...(existing.fingerprintHistory ?? []), record.alert.fingerprint]
          : (existing.fingerprintHistory ?? []),
        alert: record.alert,
      };
      await kvPutJson(kv, incidentKey, incident);
      return incident;
    },
    async enqueueOutbox(event) {
      const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      await kvPutJson(kv, `outbox:${Date.now()}:${id}`, event);
    },
    async ackIncident(incidentKey, deviceId, nowIso) {
      const key = `incident:${incidentKey}`;
      const incident = await kvGetJson(kv, key);
      if (!incident) return null;
      const updated = { ...incident, ackedAt: nowIso, ackedByDeviceId: deviceId };
      await kvPutJson(kv, key, updated);
      return updated;
    },
    async getIncident(incidentKey) {
      return await kvGetJson(kv, `incident:${incidentKey}`);
    },
    async saveSubscription(subscription) {
      await kvPutJson(kv, `subscription:${subscription.id}`, { ...subscription, status: 'active' });
    },
    async deleteSubscription(id) {
      await kv.delete(`subscription:${id}`);
    },
    async markSubscriptionDead(id) {
      const current = await kvGetJson(kv, `subscription:${id}`);
      if (current) await kvPutJson(kv, `subscription:${id}`, { ...current, status: 'dead' });
    },
    async activeSubscriptionCount() {
      const list = await kv.list({ prefix: 'subscription:' });
      let count = 0;
      for (const key of list.keys ?? []) {
        const current = await kvGetJson(kv, key.name);
        if (current?.status === 'active') count += 1;
      }
      return count;
    },
    async outboxDepth() {
      const list = await kv.list({ prefix: 'outbox:' });
      return list.keys?.length ?? 0;
    },
  };
}

export async function handleA6Alert({ bodyText, headers = {}, env = {}, store, nowMs = Date.now() }) {
  const auth = await verifyA6Signature({ env, headers, bodyText, store, nowMs });
  if (!auth.ok) return { status: auth.status, body: { status: 'rejected', reason: auth.reason } };
  const parsed = safeJsonParse(bodyText);
  if (!parsed.ok) return { status: 400, body: { status: 'rejected', reason: 'invalid_json' } };
  const alert = sanitizePagerAlert(parsed.value);
  const incidentKey = incidentKeyForAlert(alert);
  const record = {
    schemaVersion: 'vhc-pager-alert-record-v1',
    receivedAt: new Date(nowMs).toISOString(),
    authMode: auth.mode,
    requestHash: await sha256Hex(bodyText),
    incidentKey,
    alert,
  };
  const incident = await store.persistAlert(record);
  let fanout = 'queued';
  try {
    await store.enqueueOutbox({
      type: alert.alertReason === 'test_fire' ? 'test_fire' : alert.status === 'pass' ? 'recovery_or_heartbeat' : 'incident_update',
      incidentKey,
      recordHash: record.requestHash,
    });
  } catch (error) {
    fanout = `failed_after_persist:${error instanceof Error ? error.message : String(error)}`;
  }
  return {
    status: 202,
    body: {
      status: 'accepted',
      incidentKey,
      fanout,
      persistedAlertCount: store.state?.alerts?.length ?? null,
      incidentStatus: incident.status,
    },
  };
}

export async function handleAck({ incidentKey, headers = {}, env = {}, store, nowMs = Date.now() }) {
  const token = bearerToken(headers);
  if (!token || token !== env.VH_PAGER_DEVICE_TOKEN) {
    return { status: 401, body: { status: 'rejected', reason: 'device_token_required' } };
  }
  const incident = await store.ackIncident(incidentKey, 'primary-iphone', new Date(nowMs).toISOString());
  if (!incident) return { status: 404, body: { status: 'missing', reason: 'incident_not_found' } };
  return { status: 200, body: { status: 'acked', incidentKey } };
}

export async function handlePushSubscribe({ bodyText, headers = {}, env = {}, store }) {
  if (headerValue(headers, 'x-vhc-enrollment-secret') !== env.VH_PAGER_ENROLLMENT_SECRET) {
    return { status: 401, body: { status: 'rejected', reason: 'enrollment_secret_required' } };
  }
  const parsed = safeJsonParse(bodyText);
  if (!parsed.ok || !parsed.value?.endpoint) return { status: 400, body: { status: 'rejected', reason: 'invalid_subscription' } };
  const validation = validatePushSubscription({
    subscription: parsed.value,
    allowedHosts: env.VH_PAGER_PUSH_ENDPOINT_HOST_ALLOWLIST,
  });
  if (!validation.ok) return { status: 400, body: { status: 'rejected', reason: validation.reason } };
  const id = await sha256Hex(validation.endpoint);
  await store.saveSubscription({ id, endpoint: validation.endpoint, keys: parsed.value.keys ?? {} });
  return { status: 201, body: { status: 'subscribed', id } };
}

export function missingHeartbeatIncident({ latestHeartbeatAt, heartbeatMs, nowMs = Date.now() }) {
  const maxAgeMs = Math.max(2 * heartbeatMs, DEFAULT_HEARTBEAT_FLOOR_MS);
  const latestMs = Date.parse(String(latestHeartbeatAt ?? ''));
  if (!Number.isFinite(latestMs)) return { missing: true, ageMs: null, maxAgeMs, reason: 'heartbeat_missing' };
  const ageMs = nowMs - latestMs;
  return {
    missing: ageMs > maxAgeMs,
    ageMs,
    maxAgeMs,
    reason: ageMs > maxAgeMs ? `heartbeat_stale:${ageMs}/${maxAgeMs}` : 'heartbeat_fresh',
  };
}
