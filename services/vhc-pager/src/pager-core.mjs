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
  const id = await sha256Hex(parsed.value.endpoint);
  await store.saveSubscription({ id, endpoint: parsed.value.endpoint, keys: parsed.value.keys ?? {} });
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
