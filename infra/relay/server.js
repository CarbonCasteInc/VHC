/* Hardened Gun relay for local/dev and production-shaped mesh tests */
const http = require('http');
const { createRequire } = require('module');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function resolveGun() {
  try {
    return { Gun: require('gun'), gunRequire: require };
  } catch {
    // Monorepo fallback: gun is declared under packages/gun-client.
    const gunRequire = createRequire(
      path.resolve(__dirname, '../../packages/gun-client/package.json')
    );
    return { Gun: gunRequire('gun'), gunRequire };
  }
}

const { Gun, gunRequire } = resolveGun();
const seaShim = gunRequire('gun/sea/shim');

// Provide required internal utilities that the WS adapter depends on.
// These were deprecated in Gun but ws.js still uses Gun.text.random and Gun.obj.* helpers.
// Without these shims, the WS adapter crashes on connection/disconnect.
Gun.text = Gun.text || {};
Gun.text.random =
  Gun.text.random ||
  ((len = 6) => {
    let s = '';
    const c = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXZabcdefghijklmnopqrstuvwxyz';
    while (len-- > 0) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
  });

Gun.obj = Gun.obj || {};
Gun.obj.map =
  Gun.obj.map ||
  function map(obj, cb, ctx) {
    if (!obj) return obj;
    Object.keys(obj).forEach((k) => cb.call(ctx, obj[k], k));
    return obj;
  };
Gun.obj.del = Gun.obj.del || ((obj, key) => {
  if (obj) delete obj[key];
  return obj;
});

gunRequire('gun/lib/ws');

const port = Number(process.env.GUN_PORT || 7777);
const host = process.env.GUN_HOST || '127.0.0.1';
const radiskEnabled = process.env.GUN_RADISK !== 'false';
const gunFile = radiskEnabled ? process.env.GUN_FILE || 'data' : false;
const COMMENT_JSON_FIELD = '__comment_json';
const COMMENT_INDEX_SCHEMA_VERSION = 'hermes-comment-index-v1';
const ROUTE_KIND = {
  USER: 'user',
  DAEMON: 'daemon',
};

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function csvEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeGunPeer(peer) {
  const trimmed = String(peer || '').trim();
  if (!trimmed) return null;
  return trimmed.endsWith('/gun') ? trimmed : `${trimmed.replace(/\/+$/, '')}/gun`;
}

function jsonOrCsvEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeGunPeer).filter(Boolean);
    }
  } catch {
    // fall through to comma-separated parsing
  }
  return raw.split(',').map(normalizeGunPeer).filter(Boolean);
}

const authRequired = boolEnv('VH_RELAY_AUTH_REQUIRED', process.env.NODE_ENV === 'production');
const daemonToken = String(process.env.VH_RELAY_DAEMON_TOKEN || '');
const userFallbackToken = String(process.env.VH_RELAY_USER_FALLBACK_TOKEN || '');
const allowedOrigins = csvEnv('VH_RELAY_ALLOWED_ORIGINS');
const allowAnyOrigin = allowedOrigins.length === 0 || allowedOrigins.includes('*');
const bodyLimitBytes = numberEnv('VH_RELAY_HTTP_BODY_LIMIT_BYTES', 1_000_000);
const httpRateLimitPerMinute = numberEnv('VH_RELAY_HTTP_RATE_LIMIT_PER_MIN', 1_200);
const wsBytesPerSecondLimit = numberEnv('VH_RELAY_WS_BYTES_PER_SEC', 1_000_000);
const maxActiveConnections = numberEnv('VH_RELAY_MAX_ACTIVE_CONNECTIONS', 5_000);
const userSignatureMaxSkewMs = numberEnv('VH_RELAY_USER_SIGNATURE_MAX_SKEW_MS', 5 * 60_000);
const userNonceTtlMs = numberEnv('VH_RELAY_USER_NONCE_TTL_MS', 10 * 60_000);
const healthProbeCompactionIntervalMs = numberEnv('VH_RELAY_HEALTH_PROBE_COMPACTION_INTERVAL_MS', 0);
const relayId = String(process.env.VH_RELAY_ID || `local-relay-${port}`).trim();
const relayPeers = Array.from(new Set(jsonOrCsvEnv('VH_RELAY_PEERS')));
const relayPeerAuthModes = new Set(['none', 'private_network_allowlist', 'peer_bearer_token']);
const relayPeerAuthMode = String(process.env.VH_RELAY_PEER_AUTH_MODE || 'none').trim() || 'none';
if (!relayPeerAuthModes.has(relayPeerAuthMode)) {
  throw new Error(`Unsupported VH_RELAY_PEER_AUTH_MODE: ${relayPeerAuthMode}`);
}
const relayPeerBearerToken = String(process.env.VH_RELAY_PEER_TOKEN || '');
const relayPeerAllowlist = csvEnv('VH_RELAY_PEER_ALLOWLIST');
const effectiveRelayPeerAllowlist = relayPeerAllowlist.length > 0
  ? relayPeerAllowlist
  : ['loopback', 'private'];

const metrics = {
  startedAt: Date.now(),
  activeConnections: 0,
  totalConnections: 0,
  droppedConnections: 0,
  httpRequests: 0,
  httpResponses: new Map(),
  writeAttempts: new Map(),
  writeSuccesses: new Map(),
  writeFailures: new Map(),
  authRejects: 0,
  rateLimited: 0,
  bodyTooLarge: 0,
  originRejects: 0,
  wsUpgradeRejects: 0,
  wsByteDrops: 0,
  compactionRuns: 0,
  compactionTombstones: 0,
};

const httpBuckets = new Map();
const seenUserNonces = new Map();

function incMap(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function logEvent(level, event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    service: 'vh-relay',
    event,
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (level === 'warn') console.warn(line);
  else if (level === 'error') console.error(line);
  else console.log(line);
}

function routeLabel(pathname) {
  if (pathname.startsWith('/vh/forum/')) return pathname;
  if (pathname.startsWith('/vh/topics/')) return pathname;
  if (pathname.startsWith('/vh/aggregates/')) return pathname;
  if (pathname === '/healthz' || pathname === '/readyz' || pathname === '/metrics') return pathname;
  return pathname || '/';
}

function clientAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function secureEqual(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin || allowAnyOrigin) return true;
  return allowedOrigins.includes(origin);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (allowAnyOrigin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, authorization, x-vh-relay-token, x-vh-relay-peer-token, x-vh-relay-device-pub, x-vh-relay-signature, x-vh-relay-nonce, x-vh-relay-timestamp, x-vh-device-pub, x-vh-signature, x-vh-nonce, x-vh-timestamp'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function takeHttpToken(req) {
  const now = Date.now();
  const key = clientAddress(req);
  const refillPerMs = httpRateLimitPerMinute / 60_000;
  const bucket = httpBuckets.get(key) || { tokens: httpRateLimitPerMinute, updatedAt: now };
  bucket.tokens = Math.min(
    httpRateLimitPerMinute,
    bucket.tokens + Math.max(0, now - bucket.updatedAt) * refillPerMs
  );
  bucket.updatedAt = now;
  if (bucket.tokens < 1) {
    httpBuckets.set(key, bucket);
    metrics.rateLimited += 1;
    return false;
  }
  bucket.tokens -= 1;
  httpBuckets.set(key, bucket);
  return true;
}

function makeHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

function relayToken(req) {
  return String(req.headers['x-vh-relay-token'] || '').trim();
}

function relayPeerRequestToken(req) {
  const header = bearerToken(req);
  return header || String(req.headers['x-vh-relay-peer-token'] || '').trim();
}

function readHeader(req, names) {
  for (const name of names) {
    const value = req.headers[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function decodeSignatureHeader(value) {
  if (!value || value.startsWith('SEA')) return value;
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return value;
  }
}

function cleanupSeenUserNonces(now = Date.now()) {
  for (const [key, expiresAt] of seenUserNonces) {
    if (expiresAt <= now) seenUserNonces.delete(key);
  }
}

function rememberUserNonce(devicePub, nonce, now = Date.now()) {
  cleanupSeenUserNonces(now);
  const key = `${devicePub}:${nonce}`;
  if (seenUserNonces.has(key)) {
    return false;
  }
  seenUserNonces.set(key, now + userNonceTtlMs);
  return true;
}

function normalizeRemoteAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  return value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
}

function isLoopbackAddress(address) {
  const normalized = normalizeRemoteAddress(address);
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function isPrivateAddress(address) {
  const normalized = normalizeRemoteAddress(address);
  if (isLoopbackAddress(normalized)) return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  const match = normalized.match(/^172\.(\d{1,2})\./);
  if (match) {
    const octet = Number(match[1]);
    return octet >= 16 && octet <= 31;
  }
  return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

function relayPeerAllowlistMatches(address) {
  const normalized = normalizeRemoteAddress(address);
  return effectiveRelayPeerAllowlist.some((entry) => {
    const rule = String(entry || '').trim().toLowerCase();
    if (!rule) return false;
    if (rule === '*') return true;
    if (['loopback', 'localhost'].includes(rule)) return isLoopbackAddress(normalized);
    if (['private', 'private_network', 'private-network'].includes(rule)) {
      return isPrivateAddress(normalized);
    }
    return normalizeRemoteAddress(rule) === normalized;
  });
}

function relayPeerAuthDecision(req) {
  if (relayPeerAuthMode === 'none') {
    return { allowed: true, reason: 'relay-peer-auth-disabled' };
  }
  if (relayPeerAuthMode === 'peer_bearer_token') {
    if (!relayPeerBearerToken) {
      return { allowed: false, reason: 'relay-peer-token-not-configured' };
    }
    return secureEqual(relayPeerRequestToken(req), relayPeerBearerToken)
      ? { allowed: true, reason: 'relay-peer-token-valid' }
      : { allowed: false, reason: 'relay-peer-token-required' };
  }
  const remoteAddress = req.socket?.remoteAddress || '';
  return relayPeerAllowlistMatches(remoteAddress)
    ? { allowed: true, reason: 'relay-peer-private-network-allowed', remote_address: normalizeRemoteAddress(remoteAddress) }
    : { allowed: false, reason: 'relay-peer-private-network-rejected', remote_address: normalizeRemoteAddress(remoteAddress) };
}

function isGunPeerSocketPath(pathname) {
  return pathname === '/gun' || pathname.startsWith('/gun/');
}

async function verifyUserSignature(req, pathname, body) {
  const devicePub = readHeader(req, ['x-vh-relay-device-pub', 'x-vh-device-pub']);
  const signature = decodeSignatureHeader(readHeader(req, ['x-vh-relay-signature', 'x-vh-signature']));
  const nonce = readHeader(req, ['x-vh-relay-nonce', 'x-vh-nonce']);
  const timestamp = readHeader(req, ['x-vh-relay-timestamp', 'x-vh-timestamp']);
  if (!devicePub || !signature || !nonce || !timestamp) {
    throw makeHttpError(401, 'user-signature-required');
  }
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > userSignatureMaxSkewMs) {
    throw makeHttpError(401, 'user-signature-stale');
  }
  if (!rememberUserNonce(devicePub, nonce)) {
    throw makeHttpError(401, 'user-signature-replay');
  }
  const canonical = JSON.stringify({ path: pathname, body, nonce, timestamp: String(timestamp) });
  const verified = await verifySeaSignature(signature, devicePub, canonical);
  if (!verified) {
    if (boolEnv('VH_RELAY_AUTH_DEBUG', false)) {
      logEvent('warn', 'user_signature_invalid_debug', {
        device_pub_prefix: devicePub.slice(0, 12),
        canonical,
        signature_prefix: signature.slice(0, 16),
      });
    }
    throw makeHttpError(401, 'user-signature-invalid');
  }
}

async function verifySeaSignature(signature, devicePub, canonical) {
  try {
    const parsed = JSON.parse(signature.startsWith('SEA') ? signature.slice(3) : signature);
    const message = parsed?.m;
    const signatureValue = parsed?.s;
    const messageCanonical =
      typeof message === 'string'
        ? message
        : message && typeof message === 'object'
          ? JSON.stringify(message)
          : '';
    if (messageCanonical !== canonical || typeof signatureValue !== 'string') {
      return false;
    }
    const [x, y] = String(devicePub).split('.');
    if (!x || !y) return false;
    const key = await (seaShim.ossl || seaShim.subtle).importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x, y, ext: true, key_ops: ['verify'] },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const hash = await seaShim.subtle.digest(
      { name: 'SHA-256' },
      new seaShim.TextEncoder().encode(messageCanonical)
    );
    return await (seaShim.ossl || seaShim.subtle).verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      key,
      new Uint8Array(seaShim.Buffer.from(signatureValue, 'base64')),
      new Uint8Array(hash)
    );
  } catch {
    return false;
  }
}

async function assertRouteAuth(req, pathname, body, kind) {
  if (!authRequired) return;
  if (kind === ROUTE_KIND.DAEMON) {
    if (!daemonToken) {
      throw makeHttpError(503, 'daemon-auth-not-configured');
    }
    if (secureEqual(bearerToken(req), daemonToken)) return;
    throw makeHttpError(401, 'daemon-token-required');
  }
  if (userFallbackToken && secureEqual(relayToken(req), userFallbackToken)) return;
  await verifyUserSignature(req, pathname, body);
}

function dirSizeBytes(target) {
  if (!target || target === false) return 0;
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    let total = 0;
    for (const entry of fs.readdirSync(target)) {
      total += dirSizeBytes(path.join(target, entry));
    }
    return total;
  } catch {
    return 0;
  }
}

function metricsText() {
  const lines = [];
  const add = (name, value, labels = {}) => {
    const labelEntries = Object.entries(labels);
    const suffix = labelEntries.length
      ? `{${labelEntries.map(([key, val]) => `${key}="${String(val).replace(/"/g, '\\"')}"`).join(',')}}`
      : '';
    lines.push(`${name}${suffix} ${value}`);
  };
  add('vh_relay_uptime_seconds', Math.floor((Date.now() - metrics.startedAt) / 1000));
  add('vh_relay_active_connections', metrics.activeConnections);
  add('vh_relay_total_connections', metrics.totalConnections);
  add('vh_relay_dropped_connections_total', metrics.droppedConnections);
  add('vh_relay_http_requests_total', metrics.httpRequests);
  add('vh_relay_auth_rejects_total', metrics.authRejects);
  add('vh_relay_rate_limited_total', metrics.rateLimited);
  add('vh_relay_body_too_large_total', metrics.bodyTooLarge);
  add('vh_relay_origin_rejects_total', metrics.originRejects);
  add('vh_relay_ws_upgrade_rejects_total', metrics.wsUpgradeRejects);
  add('vh_relay_ws_byte_drops_total', metrics.wsByteDrops);
  add('vh_relay_compaction_runs_total', metrics.compactionRuns);
  add('vh_relay_compaction_tombstones_total', metrics.compactionTombstones);
  add('vh_relay_radata_bytes', dirSizeBytes(gunFile));
  for (const [status, count] of metrics.httpResponses) {
    add('vh_relay_http_responses_total', count, { status });
  }
  for (const [route, count] of metrics.writeAttempts) {
    add('vh_relay_write_attempts_total', count, { route });
  }
  for (const [route, count] of metrics.writeSuccesses) {
    add('vh_relay_write_successes_total', count, { route });
  }
  for (const [route, count] of metrics.writeFailures) {
    add('vh_relay_write_failures_total', count, { route });
  }
  return `${lines.join('\n')}\n`;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readJsonBody(req, limitBytes = bodyLimitBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > limitBytes) {
        tooLarge = true;
        metrics.bodyTooLarge += 1;
        reject(makeHttpError(413, 'body-too-large'));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(body.trim() ? JSON.parse(body) : {});
      } catch {
        reject(makeHttpError(400, 'invalid-json'));
      }
    });
    req.on('error', reject);
  });
}

function putWithTimeout(chain, value, timeoutMs = 1_500) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, timeoutMs);
    chain.put(value, (ack) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ack });
    });
  });
}

function readOnce(chain, timeoutMs = 1_500) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    chain.once((data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data ?? null);
    });
  });
}

function stripGunMetadata(value) {
  if (!value || typeof value !== 'object') return value;
  const { _, ...rest } = value;
  return rest;
}

function parseThreadEnvelope(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseTopicSynthesisEnvelope(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function stateNode(node, field, state, value, soul) {
  return Gun.state.ify(node || {}, field, state, value, soul);
}

function linkNode(graph, soul, field, childSoul, state) {
  graph[soul] = stateNode(graph[soul], field, state, { '#': childSoul }, soul);
}

function buildThreadGraph(thread) {
  const state = Gun.state();
  const threadSoul = `vh/forum/threads/${thread.id}`;
  const graph = {};
  linkNode(graph, 'vh', 'forum', 'vh/forum', state);
  linkNode(graph, 'vh/forum', 'threads', 'vh/forum/threads', state);
  linkNode(graph, 'vh/forum/threads', thread.id, threadSoul, state);
  for (const [key, value] of Object.entries(thread)) {
    if (value === undefined) continue;
    graph[threadSoul] = stateNode(graph[threadSoul], key, state, value, threadSoul);
  }
  return graph;
}

function buildCommentGraph(comment) {
  const state = Gun.state();
  const threadSoul = `vh/forum/threads/${comment.threadId}`;
  const commentsSoul = `${threadSoul}/comments`;
  const commentSoul = `${commentsSoul}/${comment.id}`;
  const indexKey = encodeURIComponent(comment.threadId);
  const indexRootSoul = `vh/forum/indexes/comment_ids/${indexKey}`;
  const indexCurrentSoul = `${indexRootSoul}/current`;
  const indexEntriesSoul = `${indexRootSoul}/entries`;
  const indexEntrySoul = `${indexEntriesSoul}/${comment.id}`;
  const updatedAt = Date.now();
  const indexEntry = {
    schemaVersion: COMMENT_INDEX_SCHEMA_VERSION,
    threadId: comment.threadId,
    commentId: comment.id,
    updatedAt,
  };
  const indexCurrent = {
    schemaVersion: COMMENT_INDEX_SCHEMA_VERSION,
    threadId: comment.threadId,
    idsJson: JSON.stringify([comment.id]),
    updatedAt,
  };
  const encodedComment = {
    ...comment,
    [COMMENT_JSON_FIELD]: JSON.stringify(comment),
  };
  const graph = {};

  linkNode(graph, 'vh', 'forum', 'vh/forum', state);
  linkNode(graph, 'vh/forum', 'threads', 'vh/forum/threads', state);
  linkNode(graph, 'vh/forum/threads', comment.threadId, threadSoul, state);
  linkNode(graph, threadSoul, 'comments', commentsSoul, state);
  linkNode(graph, commentsSoul, comment.id, commentSoul, state);
  linkNode(graph, 'vh/forum', 'indexes', 'vh/forum/indexes', state);
  linkNode(graph, 'vh/forum/indexes', 'comment_ids', 'vh/forum/indexes/comment_ids', state);
  linkNode(graph, 'vh/forum/indexes/comment_ids', indexKey, indexRootSoul, state);
  linkNode(graph, indexRootSoul, 'current', indexCurrentSoul, state);
  linkNode(graph, indexRootSoul, 'entries', indexEntriesSoul, state);
  linkNode(graph, indexEntriesSoul, comment.id, indexEntrySoul, state);

  for (const [key, value] of Object.entries(encodedComment)) {
    if (value === undefined) continue;
    graph[commentSoul] = stateNode(graph[commentSoul], key, state, value, commentSoul);
  }
  for (const [key, value] of Object.entries(indexEntry)) {
    graph[indexEntrySoul] = stateNode(graph[indexEntrySoul], key, state, value, indexEntrySoul);
  }
  for (const [key, value] of Object.entries(indexCurrent)) {
    graph[indexCurrentSoul] = stateNode(graph[indexCurrentSoul], key, state, value, indexCurrentSoul);
  }

  return graph;
}

function encodeTopicSynthesis(synthesis) {
  return {
    __topic_synthesis_json: JSON.stringify(synthesis),
    schemaVersion: synthesis.schemaVersion,
    topic_id: synthesis.topic_id,
    epoch: synthesis.epoch,
    synthesis_id: synthesis.synthesis_id,
    created_at: synthesis.created_at,
  };
}

function buildTopicSynthesisGraph(synthesis) {
  const state = Gun.state();
  const topicId = String(synthesis.topic_id);
  const epoch = String(synthesis.epoch);
  const latestSoul = `vh/topics/${topicId}/latest`;
  const epochRootSoul = `vh/topics/${topicId}/epochs`;
  const epochSoul = `${epochRootSoul}/${epoch}`;
  const epochSynthesisSoul = `${epochSoul}/synthesis`;
  const encoded = encodeTopicSynthesis(synthesis);
  const graph = {};

  linkNode(graph, 'vh', 'topics', 'vh/topics', state);
  linkNode(graph, 'vh/topics', topicId, `vh/topics/${topicId}`, state);
  linkNode(graph, `vh/topics/${topicId}`, 'latest', latestSoul, state);
  linkNode(graph, `vh/topics/${topicId}`, 'epochs', epochRootSoul, state);
  linkNode(graph, epochRootSoul, epoch, epochSoul, state);
  linkNode(graph, epochSoul, 'synthesis', epochSynthesisSoul, state);

  for (const [key, value] of Object.entries(encoded)) {
    if (value === undefined) continue;
    graph[latestSoul] = stateNode(graph[latestSoul], key, state, value, latestSoul);
    graph[epochSynthesisSoul] = stateNode(graph[epochSynthesisSoul], key, state, value, epochSynthesisSoul);
  }

  return graph;
}

function buildAggregateVoterGraph(write) {
  const state = Gun.state();
  const topicRootSoul = `vh/aggregates/topics/${write.topic_id}`;
  const synthesesSoul = `${topicRootSoul}/syntheses`;
  const synthesisSoul = `${synthesesSoul}/${write.synthesis_id}`;
  const epochsSoul = `${synthesisSoul}/epochs`;
  const epochSoul = `${epochsSoul}/${write.epoch}`;
  const votersSoul = `${epochSoul}/voters`;
  const voterSoul = `${votersSoul}/${write.voter_id}`;
  const pointSoul = `${voterSoul}/${write.node.point_id}`;
  const graph = {};

  linkNode(graph, 'vh', 'aggregates', 'vh/aggregates', state);
  linkNode(graph, 'vh/aggregates', 'topics', 'vh/aggregates/topics', state);
  linkNode(graph, 'vh/aggregates/topics', write.topic_id, topicRootSoul, state);
  linkNode(graph, topicRootSoul, 'syntheses', synthesesSoul, state);
  linkNode(graph, synthesesSoul, write.synthesis_id, synthesisSoul, state);
  linkNode(graph, synthesisSoul, 'epochs', epochsSoul, state);
  linkNode(graph, epochsSoul, String(write.epoch), epochSoul, state);
  linkNode(graph, epochSoul, 'voters', votersSoul, state);
  linkNode(graph, votersSoul, write.voter_id, voterSoul, state);
  linkNode(graph, voterSoul, write.node.point_id, pointSoul, state);

  for (const [key, value] of Object.entries(write.node)) {
    if (value === undefined) continue;
    graph[pointSoul] = stateNode(graph[pointSoul], key, state, value, pointSoul);
  }

  return graph;
}

function buildAggregatePointSnapshotGraph(snapshot) {
  const state = Gun.state();
  const topicRootSoul = `vh/aggregates/topics/${snapshot.topic_id}`;
  const synthesesSoul = `${topicRootSoul}/syntheses`;
  const synthesisSoul = `${synthesesSoul}/${snapshot.synthesis_id}`;
  const epochsSoul = `${synthesisSoul}/epochs`;
  const epochSoul = `${epochsSoul}/${snapshot.epoch}`;
  const pointsSoul = `${epochSoul}/points`;
  const pointSoul = `${pointsSoul}/${snapshot.point_id}`;
  const sourceWindowSoul = `${pointSoul}/source_window`;
  const graph = {};

  linkNode(graph, 'vh', 'aggregates', 'vh/aggregates', state);
  linkNode(graph, 'vh/aggregates', 'topics', 'vh/aggregates/topics', state);
  linkNode(graph, 'vh/aggregates/topics', snapshot.topic_id, topicRootSoul, state);
  linkNode(graph, topicRootSoul, 'syntheses', synthesesSoul, state);
  linkNode(graph, synthesesSoul, snapshot.synthesis_id, synthesisSoul, state);
  linkNode(graph, synthesisSoul, 'epochs', epochsSoul, state);
  linkNode(graph, epochsSoul, String(snapshot.epoch), epochSoul, state);
  linkNode(graph, epochSoul, 'points', pointsSoul, state);
  linkNode(graph, pointsSoul, snapshot.point_id, pointSoul, state);
  linkNode(graph, pointSoul, 'source_window', sourceWindowSoul, state);

  for (const [key, value] of Object.entries(snapshot)) {
    if (key === 'source_window' || value === undefined) continue;
    graph[pointSoul] = stateNode(graph[pointSoul], key, state, value, pointSoul);
  }

  graph[sourceWindowSoul] = stateNode(
    graph[sourceWindowSoul],
    'from_seq',
    state,
    snapshot.source_window.from_seq,
    sourceWindowSoul
  );
  graph[sourceWindowSoul] = stateNode(
    graph[sourceWindowSoul],
    'to_seq',
    state,
    snapshot.source_window.to_seq,
    sourceWindowSoul
  );

  return graph;
}

function injectGraph(gun, graph) {
  gun._.on('in', {
    '#': `vh-relay-http-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    put: graph,
    $: gun,
    _: { faith: true },
  });
}

async function pollThreadBack(threadChain, threadId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readThreadBack(threadChain, threadId);
    if (latest) return latest;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return latest;
}

async function readThreadBack(threadChain, threadId) {
  const direct = stripGunMetadata(await readOnce(threadChain));
  if (direct && typeof direct === 'object' && direct.id === threadId) {
    return direct;
  }
  const envelope = parseThreadEnvelope(await readOnce(threadChain.get('__thread_json')));
  if (envelope?.id === threadId) {
    return envelope;
  }
  return null;
}

async function readTopicSynthesisBack(gun, topicId, synthesisId) {
  const latestChain = gun.get('vh').get('topics').get(topicId).get('latest');
  const direct = stripGunMetadata(await readOnce(latestChain));
  const envelope = direct && typeof direct === 'object'
    ? parseTopicSynthesisEnvelope(direct.__topic_synthesis_json)
    : null;
  if (envelope?.topic_id === topicId && envelope?.synthesis_id === synthesisId) {
    return envelope;
  }
  const scalar = parseTopicSynthesisEnvelope(await readOnce(latestChain.get('__topic_synthesis_json')));
  if (scalar?.topic_id === topicId && scalar?.synthesis_id === synthesisId) {
    return scalar;
  }
  return null;
}

function readTopicSynthesisFromGraph(gun, topicId, synthesisId) {
  const latestSoul = `vh/topics/${topicId}/latest`;
  const node = gun?._?.graph?.[latestSoul];
  const envelope = parseTopicSynthesisEnvelope(node?.__topic_synthesis_json);
  return envelope?.topic_id === topicId && envelope?.synthesis_id === synthesisId ? envelope : null;
}

function sanitizeThread(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('thread-required');
  }
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) {
    throw new Error('thread-id-required');
  }
  const clean = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || key === '_') continue;
    if (
      raw === null ||
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean'
    ) {
      clean[key] = raw;
    }
  }
  clean.id = id;
  return clean;
}

function sanitizeComment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('comment-required');
  }
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const threadId = typeof value.threadId === 'string' ? value.threadId.trim() : '';
  if (!id) throw new Error('comment-id-required');
  if (!threadId) throw new Error('comment-thread-required');
  const clean = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || key === '_' || key === COMMENT_JSON_FIELD) continue;
    if (
      raw === null ||
      typeof raw === 'string' ||
      typeof raw === 'number' ||
      typeof raw === 'boolean'
    ) {
      clean[key] = raw;
    }
  }
  clean.id = id;
  clean.threadId = threadId;
  if (typeof clean.schemaVersion !== 'string') {
    clean.schemaVersion = 'hermes-comment-v1';
  }
  if (!Number.isFinite(clean.upvotes)) {
    clean.upvotes = 0;
  }
  if (!Number.isFinite(clean.downvotes)) {
    clean.downvotes = 0;
  }
  return clean;
}

function sanitizeTopicSynthesis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('synthesis-required');
  }
  const topicId = typeof value.topic_id === 'string' ? value.topic_id.trim() : '';
  const synthesisId = typeof value.synthesis_id === 'string' ? value.synthesis_id.trim() : '';
  if (!topicId) throw new Error('synthesis-topic-required');
  if (!synthesisId) throw new Error('synthesis-id-required');
  if (!Number.isFinite(value.epoch)) throw new Error('synthesis-epoch-required');
  return {
    ...value,
    topic_id: topicId,
    synthesis_id: synthesisId,
  };
}

function normalizeRequiredString(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${name}-required`);
  return normalized;
}

function normalizeFiniteNumber(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name}-required`);
  return value;
}

function normalizeFiniteNonNegativeInteger(value, name) {
  const normalized = normalizeFiniteNumber(value, name);
  if (normalized < 0) throw new Error(`${name}-non-negative-required`);
  return Math.floor(normalized);
}

function sanitizeAggregateVoterWrite(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('aggregate-voter-required');
  }
  const node = value.node;
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error('aggregate-voter-node-required');
  }

  const agreement = normalizeFiniteNumber(node.agreement, 'agreement');
  if (![ -1, 0, 1 ].includes(agreement)) {
    throw new Error('agreement-invalid');
  }

  return {
    topic_id: normalizeRequiredString(value.topic_id, 'topic-id'),
    synthesis_id: normalizeRequiredString(value.synthesis_id, 'synthesis-id'),
    epoch: normalizeFiniteNonNegativeInteger(value.epoch, 'epoch'),
    voter_id: normalizeRequiredString(value.voter_id, 'voter-id'),
    node: {
      point_id: normalizeRequiredString(node.point_id, 'point-id'),
      agreement,
      weight: normalizeFiniteNumber(node.weight, 'weight'),
      updated_at: normalizeRequiredString(node.updated_at, 'updated-at'),
    },
  };
}

function sanitizeAggregatePointSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('aggregate-snapshot-required');
  }
  const sourceWindow = value.source_window;
  if (!sourceWindow || typeof sourceWindow !== 'object' || Array.isArray(sourceWindow)) {
    throw new Error('source-window-required');
  }

  return {
    schema_version: normalizeRequiredString(value.schema_version, 'schema-version'),
    topic_id: normalizeRequiredString(value.topic_id, 'topic-id'),
    synthesis_id: normalizeRequiredString(value.synthesis_id, 'synthesis-id'),
    epoch: normalizeFiniteNonNegativeInteger(value.epoch, 'epoch'),
    point_id: normalizeRequiredString(value.point_id, 'point-id'),
    agree: normalizeFiniteNonNegativeInteger(value.agree, 'agree'),
    disagree: normalizeFiniteNonNegativeInteger(value.disagree, 'disagree'),
    weight: normalizeFiniteNumber(value.weight, 'weight'),
    participants: normalizeFiniteNonNegativeInteger(value.participants, 'participants'),
    version: normalizeFiniteNonNegativeInteger(value.version, 'version'),
    computed_at: normalizeFiniteNonNegativeInteger(value.computed_at, 'computed-at'),
    source_window: {
      from_seq: normalizeFiniteNonNegativeInteger(sourceWindow.from_seq, 'source-window-from-seq'),
      to_seq: normalizeFiniteNonNegativeInteger(sourceWindow.to_seq, 'source-window-to-seq'),
    },
  };
}

async function writeForumThread(gun, thread) {
  const clean = sanitizeThread(thread);
  const threadChain = gun.get('vh').get('forum').get('threads').get(clean.id);
  const writes = [putWithTimeout(threadChain, clean)];
  for (const [key, value] of Object.entries(clean)) {
    writes.push(putWithTimeout(threadChain.get(key), value, 750));
  }
  await Promise.allSettled(writes);
  let readback = await pollThreadBack(threadChain, clean.id, 2_000);
  if (!readback) {
    injectGraph(gun, buildThreadGraph(clean));
    readback = await pollThreadBack(threadChain, clean.id, 5_000);
  }
  if (!readback) {
    throw new Error('thread-readback-failed');
  }
  return readback;
}

async function writeForumComment(gun, comment) {
  const clean = sanitizeComment(comment);
  injectGraph(gun, buildCommentGraph(clean));
  return clean;
}

async function writeTopicSynthesis(gun, synthesis) {
  const clean = sanitizeTopicSynthesis(synthesis);
  injectGraph(gun, buildTopicSynthesisGraph(clean));
  return clean;
}

async function writeAggregateVoter(gun, write) {
  const clean = sanitizeAggregateVoterWrite(write);
  injectGraph(gun, buildAggregateVoterGraph(clean));
  return clean;
}

async function writeAggregatePointSnapshot(gun, snapshot) {
  const clean = sanitizeAggregatePointSnapshot(snapshot);
  injectGraph(gun, buildAggregatePointSnapshotGraph(clean));
  return clean;
}

function compactHistoricalHealthProbes(gun) {
  metrics.compactionRuns += 1;
  let tombstoned = 0;
  try {
    gun.get('vh').get('__health').map().once((value, key) => {
      if (typeof key !== 'string' || !key.startsWith('__vh_health_probe_')) {
        return;
      }
      tombstoned += 1;
      metrics.compactionTombstones += 1;
      gun.get('vh').get('__health').get(key).put(null);
    });
    logEvent('info', 'health_probe_compaction_started', { tombstoned });
  } catch (error) {
    logEvent('warn', 'health_probe_compaction_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleWriteRoute(req, res, pathname, kind, write) {
  const label = routeLabel(pathname);
  incMap(metrics.writeAttempts, label);
  try {
    const body = await readJsonBody(req);
    await assertRouteAuth(req, pathname, body, kind);
    const payload = await write(body);
    incMap(metrics.writeSuccesses, label);
    sendJson(res, 200, { ok: true, ...payload });
  } catch (error) {
    const status = error?.statusCode || (String(error?.message || '').includes('required') ? 400 : 500);
    if (status === 401 || status === 403 || status === 503) {
      metrics.authRejects += 1;
    }
    incMap(metrics.writeFailures, label);
    logEvent(status >= 500 ? 'error' : 'warn', 'write_route_failed', {
      route: label,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const server = http.createServer((req, res) => {
  metrics.httpRequests += 1;
  res.on('finish', () => {
    incMap(metrics.httpResponses, String(res.statusCode || 0));
  });

  const parsedUrl = new URL(req.url || '/', 'http://vh-relay.local');
  const pathname = parsedUrl.pathname;
  applyCors(req, res);

  if (!isOriginAllowed(req)) {
    metrics.originRejects += 1;
    logEvent('warn', 'origin_rejected', {
      origin: req.headers.origin || null,
      path: pathname,
    });
    sendJson(res, 403, { ok: false, error: 'origin-not-allowed' });
    return;
  }

  if (!takeHttpToken(req)) {
    sendJson(res, 429, { ok: false, error: 'rate-limited' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/healthz') {
    sendJson(res, 200, {
      ok: true,
      service: 'vh-relay',
      relay_id: relayId,
      uptime_ms: Date.now() - metrics.startedAt,
      radisk_enabled: radiskEnabled,
      auth_required: authRequired,
      relay_peer_count: relayPeers.length,
      relay_peers_configured: relayPeers.length > 0,
      relay_peer_auth_mode: relayPeerAuthMode,
      active_connections: metrics.activeConnections,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/readyz') {
    const ready = !authRequired || Boolean(daemonToken);
    sendJson(res, ready ? 200 : 503, {
      ok: ready,
      service: 'vh-relay',
      relay_id: relayId,
      auth_required: authRequired,
      daemon_auth_configured: Boolean(daemonToken),
      user_signature_auth_available: true,
      radisk_enabled: radiskEnabled,
      relay_peer_count: relayPeers.length,
      relay_peers_configured: relayPeers.length > 0,
      relay_peer_auth_mode: relayPeerAuthMode,
      relay_peer_auth_configured: relayPeerAuthMode !== 'none',
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/vh/relay-peer/authz') {
    const decision = relayPeerAuthDecision(req);
    if (!decision.allowed) {
      metrics.authRejects += 1;
      logEvent('warn', 'relay_peer_auth_rejected', {
        relay_id: relayId,
        mode: relayPeerAuthMode,
        reason: decision.reason,
        remote_address: decision.remote_address || null,
      });
    }
    sendJson(res, decision.allowed ? 200 : 403, {
      ok: decision.allowed,
      service: 'vh-relay',
      relay_id: relayId,
      relay_peer_auth_mode: relayPeerAuthMode,
      reason: decision.reason,
      remote_address: decision.remote_address || null,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/metrics') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(metricsText());
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/forum/thread') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.USER, async (body) => {
      const thread = await writeForumThread(gun, body.thread);
      return { thread_id: thread.id };
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/forum/comment') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.USER, async (body) => {
      const comment = await writeForumComment(gun, body.comment);
      return {
        thread_id: comment.threadId,
        comment_id: comment.id,
      };
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/topics/synthesis') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.DAEMON, async (body) => {
      const synthesis = await writeTopicSynthesis(gun, body.synthesis);
      return {
        topic_id: synthesis.topic_id,
        synthesis_id: synthesis.synthesis_id,
      };
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/aggregates/voter') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.USER, async (body) => {
      const write = await writeAggregateVoter(gun, body);
      return {
        topic_id: write.topic_id,
        synthesis_id: write.synthesis_id,
        epoch: write.epoch,
        voter_id: write.voter_id,
        point_id: write.node.point_id,
      };
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/aggregates/point-snapshot') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.USER, async (body) => {
      const snapshot = await writeAggregatePointSnapshot(gun, body.snapshot);
      return {
        topic_id: snapshot.topic_id,
        synthesis_id: snapshot.synthesis_id,
        epoch: snapshot.epoch,
        point_id: snapshot.point_id,
      };
    });
    return;
  }

  res.statusCode = 200;
  res.end('vh relay alive\n');
});

// Minimal, stable Gun relay (no custom hooks)
const gun = Gun({
  web: server,
  radisk: radiskEnabled,
  file: gunFile,
  axe: false,
  peers: relayPeers
});

if (boolEnv('VH_RELAY_COMPACT_HEALTH_PROBES_ON_START', false)) {
  setTimeout(() => compactHistoricalHealthProbes(gun), 1_000).unref?.();
}
if (healthProbeCompactionIntervalMs > 0) {
  setInterval(() => compactHistoricalHealthProbes(gun), healthProbeCompactionIntervalMs).unref?.();
}

server.on('connection', (socket) => {
  metrics.activeConnections += 1;
  metrics.totalConnections += 1;
  socket.on('close', () => {
    metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
  });
  if (metrics.activeConnections > maxActiveConnections) {
    metrics.droppedConnections += 1;
    logEvent('warn', 'connection_dropped', {
      reason: 'max-active-connections',
      active_connections: metrics.activeConnections,
      limit: maxActiveConnections,
    });
    socket.destroy();
    return;
  }

  let windowStartedAt = Date.now();
  let bytesInWindow = 0;
  socket.on('data', (chunk) => {
    const now = Date.now();
    if (now - windowStartedAt >= 1_000) {
      windowStartedAt = now;
      bytesInWindow = 0;
    }
    bytesInWindow += Buffer.byteLength(chunk);
    if (bytesInWindow > wsBytesPerSecondLimit) {
      metrics.wsByteDrops += 1;
      metrics.droppedConnections += 1;
      logEvent('warn', 'connection_dropped', {
        reason: 'bytes-per-second-limit',
        bytes_in_window: bytesInWindow,
        limit: wsBytesPerSecondLimit,
      });
      socket.destroy();
    }
  });
});

server.prependListener('upgrade', (req, socket) => {
  const parsedUrl = new URL(req.url || '/', 'http://vh-relay.local');
  const pathname = parsedUrl.pathname;
  if (!isOriginAllowed(req)) {
    metrics.originRejects += 1;
    metrics.wsUpgradeRejects += 1;
    metrics.droppedConnections += 1;
    logEvent('warn', 'ws_upgrade_rejected', {
      reason: 'origin-not-allowed',
      origin: req.headers.origin || null,
      path: req.url || null,
    });
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  if (isGunPeerSocketPath(pathname)) {
    const decision = relayPeerAuthDecision(req);
    if (!decision.allowed) {
      metrics.authRejects += 1;
      metrics.wsUpgradeRejects += 1;
      metrics.droppedConnections += 1;
      logEvent('warn', 'ws_upgrade_rejected', {
        relay_id: relayId,
        reason: decision.reason,
        mode: relayPeerAuthMode,
        path: req.url || null,
        remote_address: decision.remote_address || null,
      });
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  }
});

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[vh:relay] Gun relay listening on ${host}:${port} relay_id=${relayId} peer_count=${relayPeers.length} peer_auth=${relayPeerAuthMode}`
  );
});
