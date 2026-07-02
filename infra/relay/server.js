/* Hardened Gun relay for local/dev and production-shaped mesh tests */
const http = require('http');
const { createRequire } = require('module');
const crypto = require('crypto');
const fs = require('fs');
const inspector = require('inspector');
const os = require('os');
const path = require('path');
const v8 = require('v8');
const { monitorEventLoopDelay } = require('perf_hooks');

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
const SEA = gunRequire('gun/sea');
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
const gunStatsEnabled = boolEnv('GUN_STATS', false);
const newsLatestIndexSnapshotFile = process.env.VH_RELAY_NEWS_INDEX_SNAPSHOT_FILE
  || (typeof gunFile === 'string' ? path.join(gunFile, 'news-latest-index-snapshot.json') : '');
const newsSynthesisLifecycleSnapshotFile = process.env.VH_RELAY_NEWS_LIFECYCLE_SNAPSHOT_FILE
  || (typeof gunFile === 'string' ? path.join(gunFile, 'news-synthesis-lifecycle-snapshot.json') : '');
const topicSynthesisLatestSnapshotFile = process.env.VH_RELAY_TOPIC_SYNTHESIS_SNAPSHOT_FILE
  || (typeof gunFile === 'string' ? path.join(gunFile, 'topic-synthesis-latest-snapshot.json') : '');
const COMMENT_JSON_FIELD = '__comment_json';
const COMMENT_INDEX_SCHEMA_VERSION = 'hermes-comment-index-v1';
const AGGREGATE_VOTER_NODE_VERSION = 'aggregate-voter-node-v1';
const AGGREGATE_PUBLIC_PROTOCOL_VERSION = 'luma-public-v1';
const AGGREGATE_VOTER_WRITER_KIND = 'luma';
const AGGREGATE_VOTER_AUTHOR_SCHEME = 'voter-v1';
const AGGREGATE_VOTER_AUDIENCE = 'vh-aggregate-voter';
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

function nonNegativeNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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
const wsBytesPerSecondLimit = numberEnv('VH_RELAY_WS_BYTES_PER_SEC', 10_000_000);
const maxActiveConnections = numberEnv('VH_RELAY_MAX_ACTIVE_CONNECTIONS', 5_000);
const userSignatureMaxSkewMs = numberEnv('VH_RELAY_USER_SIGNATURE_MAX_SKEW_MS', 5 * 60_000);
const userNonceTtlMs = numberEnv('VH_RELAY_USER_NONCE_TTL_MS', 10 * 60_000);
const healthProbeCompactionIntervalMs = numberEnv('VH_RELAY_HEALTH_PROBE_COMPACTION_INTERVAL_MS', 0);
const healthProbeCompactionMaxRecords = numberEnv('VH_RELAY_HEALTH_PROBE_COMPACTION_MAX_RECORDS', 0);
const aggregatePointReadCacheTtlMs = numberEnv('VH_RELAY_AGGREGATE_POINT_READ_CACHE_TTL_MS', 5_000);
const aggregatePointReadCacheMaxEntries = numberEnv('VH_RELAY_AGGREGATE_POINT_READ_CACHE_MAX_ENTRIES', 1_000);
const aggregateVoterReadTimeoutMs = numberEnv('VH_RELAY_AGGREGATE_VOTER_READ_TIMEOUT_MS', 1_500);
const aggregateVoterSelfPeerReadTimeoutMs = numberEnv(
  'VH_RELAY_AGGREGATE_VOTER_SELF_PEER_READ_TIMEOUT_MS',
  4_000,
);
const aggregateVoterSelfPeerReadbackEnabled = boolEnv(
  'VH_RELAY_AGGREGATE_VOTER_SELF_PEER_READBACK',
  false,
);
const gunMulticastEnabled = boolEnv('GUN_MULTICAST', false);
const relayId = String(process.env.VH_RELAY_ID || `local-relay-${port}`).trim();
const aggregatePointReadCache = new Map();
const newsLatestIndexRestCache = new Map();
const newsLatestIndexSnapshotCache = new Map();
const newsLatestIndexSnapshotStoryBodyCache = new Map();
let newsSynthesisLifecycleSnapshotCache = null;
let topicSynthesisLatestSnapshotCache = null;
const relayPeers = Array.from(new Set(jsonOrCsvEnv('VH_RELAY_PEERS')));
const criticalWriteReadbackMaxConcurrency = numberEnv('VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY', 2);
const criticalWriteReadbackQueueLimit = nonNegativeNumberEnv('VH_RELAY_CRITICAL_WRITE_READBACK_QUEUE_LIMIT', 16);
const criticalWriteReadbackQueueTimeoutMs = nonNegativeNumberEnv(
  'VH_RELAY_CRITICAL_WRITE_READBACK_QUEUE_TIMEOUT_MS',
  1_000,
);
const criticalWriteReadbackRetryAfterSeconds = numberEnv(
  'VH_RELAY_CRITICAL_WRITE_READBACK_RETRY_AFTER_SECONDS',
  2,
);
const relayResourceWatchdogEnabled = boolEnv(
  'VH_RELAY_RESOURCE_WATCHDOG_ENABLED',
  process.env.NODE_ENV === 'production',
);
const relayResourceWatchdogIntervalMs = numberEnv('VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS', 10_000);
const relayWatchdogMaxEventLoopLagP99Ms = numberEnv('VH_RELAY_WATCHDOG_MAX_EVENT_LOOP_LAG_P99_MS', 2_500);
const relayWatchdogMaxRssBytes = numberEnv('VH_RELAY_WATCHDOG_MAX_RSS_BYTES', 1_800_000_000);
const relayWatchdogMaxHeapUsedBytes = numberEnv('VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES', 1_300_000_000);
const relayWatchdogMaxRssGrowthBytes = nonNegativeNumberEnv('VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES', 0);
const relayWatchdogMaxHeapGrowthBytes = nonNegativeNumberEnv('VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES', 0);
const relayWatchdogHeapSnapshotEnabled = boolEnv('VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED', false);
const relayWatchdogDiagnosticDir = String(
  process.env.VH_RELAY_DIAGNOSTIC_DIR
  || (typeof gunFile === 'string' ? path.join(gunFile, 'diagnostics') : path.join(os.tmpdir(), 'vh-relay-diagnostics')),
).trim();
const newsLatestIndexRestMaxRecords = numberEnv('VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS', 80);
const newsLatestIndexSnapshotCacheEntryTail = nonNegativeNumberEnv(
  'VH_RELAY_NEWS_INDEX_SNAPSHOT_CACHE_ENTRY_TAIL',
  40,
);
const newsLatestIndexSnapshotMaxEntries = numberEnv(
  'VH_RELAY_NEWS_INDEX_SNAPSHOT_CACHE_MAX_ENTRIES',
  newsLatestIndexRestMaxRecords + newsLatestIndexSnapshotCacheEntryTail,
);
const newsLatestIndexSnapshotStoryBodyCacheMaxEntries = numberEnv(
  'VH_RELAY_NEWS_INDEX_SNAPSHOT_STORY_BODY_CACHE_MAX_ENTRIES',
  newsLatestIndexSnapshotMaxEntries,
);
const relayStartupJitterMaxMs = nonNegativeNumberEnv(
  'VH_RELAY_STARTUP_JITTER_MAX_MS',
  process.env.NODE_ENV === 'production' ? 5_000 : 0,
);
const radataBytesRefreshIntervalMs = nonNegativeNumberEnv(
  'VH_RELAY_RADATA_BYTES_REFRESH_INTERVAL_MS',
  30_000,
);
const radataBytesScanMaxEntries = numberEnv('VH_RELAY_RADATA_BYTES_SCAN_MAX_ENTRIES', 50_000);
const radataBytesScanMaxDepth = numberEnv('VH_RELAY_RADATA_BYTES_SCAN_MAX_DEPTH', 32);
const radataBytesScanTimeoutMs = numberEnv('VH_RELAY_RADATA_BYTES_SCAN_TIMEOUT_MS', 5_000);
const gunGraphScanEnabled = boolEnv('VH_RELAY_GUN_GRAPH_SCAN_ENABLED', false);
const gunGraphScanIntervalMs = nonNegativeNumberEnv('VH_RELAY_GUN_GRAPH_SCAN_INTERVAL_MS', 60_000);
const gunGraphScanBatchSize = numberEnv('VH_RELAY_GUN_GRAPH_SCAN_BATCH_SIZE', 1_000);
const gunGraphScanMaxSouls = numberEnv('VH_RELAY_GUN_GRAPH_SCAN_MAX_SOULS', 250_000);
const gunGraphScanMaxDurationMs = numberEnv('VH_RELAY_GUN_GRAPH_SCAN_MAX_DURATION_MS', 5_000);
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
  criticalWriteReadbacksStarted: new Map(),
  criticalWriteReadbacksQueued: new Map(),
  criticalWriteReadbackBackpressure: new Map(),
  criticalWriteReadbackQueueTimeouts: new Map(),
  criticalWriteReadbackMaxQueued: 0,
  relayWatchdogTrips: new Map(),
  snapshotBackgroundPauses: new Map(),
  snapshotBackgroundConcurrencyCaps: new Map(),
  newsLatestIndexSnapshotEntryEvictions: 0,
  newsLatestIndexSnapshotStoryBodyCacheEvictions: 0,
  radataBytesRefreshSuccesses: 0,
  radataBytesRefreshErrors: 0,
  radataBytesRefreshTruncated: 0,
  gunGraphScanSuccesses: 0,
  gunGraphScanErrors: 0,
  gunGraphScanTruncated: 0,
};
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
let lastRelayWatchdogSample = null;

const httpBuckets = new Map();
const seenUserNonces = new Map();
const PUBLIC_HTTP_RELAY_ROUTES = [
  '/vh/news/latest-index',
  '/vh/news/hot-index',
  '/vh/news/story',
  '/vh/news/synthesis-lifecycle',
  '/vh/topics/synthesis',
  '/vh/aggregates/point',
];

function incMap(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function storyIdFromSnapshotEntry(entry) {
  return String(entry?.entry?.[0] ?? entry?.story?.story_id ?? '').trim();
}

function snapshotEntryTimestamp(entry) {
  return latestIndexRecordTimestamp(entry?.entry?.[1])
    ?? Number(entry?.story?.cluster_window_end)
    ?? Number(entry?.story?.created_at)
    ?? 0;
}

function approximateJsonBytes(value) {
  if (value === null || value === undefined) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}

function boundNewsLatestIndexSnapshot(snapshot, { countEvictions = true } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries.filter(Boolean) : [];
  if (newsLatestIndexSnapshotMaxEntries <= 0 || entries.length <= newsLatestIndexSnapshotMaxEntries) {
    return {
      ...snapshot,
      entries,
    };
  }
  const seenStoryIds = new Set();
  const boundedEntries = entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort((left, right) => {
      const rightTimestamp = snapshotEntryTimestamp(right.entry);
      const leftTimestamp = snapshotEntryTimestamp(left.entry);
      return rightTimestamp - leftTimestamp
        || storyIdFromSnapshotEntry(left.entry).localeCompare(storyIdFromSnapshotEntry(right.entry))
        || left.originalIndex - right.originalIndex;
    })
    .filter(({ entry }) => {
      const storyId = storyIdFromSnapshotEntry(entry);
      if (!storyId) return false;
      if (seenStoryIds.has(storyId)) return false;
      seenStoryIds.add(storyId);
      return true;
    })
    .slice(0, newsLatestIndexSnapshotMaxEntries)
    .map(({ entry }) => entry);
  if (countEvictions) {
    metrics.newsLatestIndexSnapshotEntryEvictions += Math.max(0, entries.length - boundedEntries.length);
  }
  return {
    ...snapshot,
    entries: boundedEntries,
  };
}

function setNewsLatestIndexSnapshotCache(snapshotKey, snapshot, options = {}) {
  const bounded = boundNewsLatestIndexSnapshot(snapshot, options);
  newsLatestIndexSnapshotCache.set(snapshotKey, bounded);
  return bounded;
}

function snapshotStoryBodyCacheBytes() {
  let bytes = 0;
  for (const entry of newsLatestIndexSnapshotStoryBodyCache.values()) {
    bytes += Number(entry?.approx_bytes) || 0;
  }
  return bytes;
}

function evictSnapshotStoryBodyCache({ now = Date.now(), ttlMs = 0 } = {}) {
  let evicted = 0;
  if (ttlMs > 0) {
    for (const [storyId, cached] of newsLatestIndexSnapshotStoryBodyCache.entries()) {
      if (!cached || now - Number(cached.checked_at ?? 0) > ttlMs) {
        newsLatestIndexSnapshotStoryBodyCache.delete(storyId);
        evicted += 1;
      }
    }
  }
  if (
    newsLatestIndexSnapshotStoryBodyCacheMaxEntries > 0
    && newsLatestIndexSnapshotStoryBodyCache.size > newsLatestIndexSnapshotStoryBodyCacheMaxEntries
  ) {
    const sorted = [...newsLatestIndexSnapshotStoryBodyCache.entries()]
      .sort(([, left], [, right]) => (Number(left?.last_accessed_at ?? left?.checked_at ?? 0)
        - Number(right?.last_accessed_at ?? right?.checked_at ?? 0)));
    const removeCount = newsLatestIndexSnapshotStoryBodyCache.size - newsLatestIndexSnapshotStoryBodyCacheMaxEntries;
    for (const [storyId] of sorted.slice(0, removeCount)) {
      if (newsLatestIndexSnapshotStoryBodyCache.delete(storyId)) {
        evicted += 1;
      }
    }
  }
  if (evicted > 0) {
    metrics.newsLatestIndexSnapshotStoryBodyCacheEvictions += evicted;
  }
  return evicted;
}

function setSnapshotStoryBodyCache(storyId, story, checkedAt = Date.now()) {
  const normalizedStoryId = typeof storyId === 'string' ? storyId.trim() : '';
  if (!normalizedStoryId || newsLatestIndexSnapshotStoryBodyCacheMaxEntries <= 0) return;
  newsLatestIndexSnapshotStoryBodyCache.set(normalizedStoryId, {
    checked_at: checkedAt,
    last_accessed_at: checkedAt,
    story: story ?? null,
    approx_bytes: approximateJsonBytes(story),
  });
  evictSnapshotStoryBodyCache({ now: checkedAt });
}

function getSnapshotStoryBodyCache(storyId, ttlMs = 0) {
  const normalizedStoryId = typeof storyId === 'string' ? storyId.trim() : '';
  if (!normalizedStoryId) return null;
  const cached = newsLatestIndexSnapshotStoryBodyCache.get(normalizedStoryId);
  if (!cached) return null;
  const now = Date.now();
  if (ttlMs > 0 && now - Number(cached.checked_at ?? 0) > ttlMs) {
    if (newsLatestIndexSnapshotStoryBodyCache.delete(normalizedStoryId)) {
      metrics.newsLatestIndexSnapshotStoryBodyCacheEvictions += 1;
    }
    return null;
  }
  cached.last_accessed_at = now;
  return cached;
}

let activeCriticalWriteReadbacks = 0;
const queuedCriticalWriteReadbacks = [];
let relayWatchdogTripped = false;
let radataBytesRefreshInFlight = false;
const radataBytesCache = {
  bytes: 0,
  refreshedAt: 0,
  durationMs: 0,
  scannedEntries: 0,
  truncated: false,
  lastError: '',
};
let gunGraphScanInFlight = false;
const GUN_GRAPH_NAMESPACES = Object.freeze([
  'news_story',
  'news_latest_index',
  'news_hot_index',
  'news_lifecycle',
  'topic_synthesis',
  'aggregate',
  'forum',
  'other',
]);
const GUN_GRAPH_STATES = Object.freeze(['live', 'tombstoned', 'link_only', 'unknown']);
const gunGraphScanCache = {
  refreshedAt: 0,
  durationMs: 0,
  scannedSouls: 0,
  truncated: false,
  lastError: '',
  buckets: new Map(),
};

function criticalWriteReadbacksAreActive() {
  return (activeCriticalWriteReadbacks > 0 || queuedCriticalWriteReadbacks.length > 0)
    && boolEnv('VH_RELAY_NEWS_INDEX_SNAPSHOT_PAUSE_DURING_WRITE_READBACK', true);
}

function makeRelayBackpressureError(route, reason = 'relay-backpressure') {
  incMap(metrics.criticalWriteReadbackBackpressure, route);
  const error = makeHttpError(503, reason);
  error.code = 'relay-backpressure';
  error.retryAfterSeconds = criticalWriteReadbackRetryAfterSeconds;
  return error;
}

function forceCriticalWriteReadbackFailure(route) {
  if (process.env.NODE_ENV !== 'test') return false;
  const configuredRoutes = String(process.env.VH_RELAY_TEST_FORCE_CRITICAL_WRITE_READBACK_FAILURE_ROUTES || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return configuredRoutes.includes('*') || configuredRoutes.includes(route);
}

function cappedBackgroundConcurrency({
  operation,
  envName,
  fallback,
  maxEnvName,
  maxFallback,
}) {
  const requested = Math.max(1, numberEnv(envName, fallback));
  const max = Math.max(1, numberEnv(maxEnvName, maxFallback));
  const effective = Math.min(requested, max);
  if (effective < requested) {
    incMap(metrics.snapshotBackgroundConcurrencyCaps, operation);
  }
  return {
    requested,
    max,
    effective,
    capped: effective < requested,
  };
}

function snapshotBackgroundPauseInfo(operation, selectedCount, concurrency = {}) {
  incMap(metrics.snapshotBackgroundPauses, operation);
  return {
    enabled: true,
    selected_count: selectedCount,
    paused_due_to_critical_write_readback: true,
    active_critical_write_readback_count: activeCriticalWriteReadbacks,
    queued_critical_write_readback_count: queuedCriticalWriteReadbacks.length,
    ...concurrency,
  };
}

function releaseCriticalWriteReadbackSlot() {
  activeCriticalWriteReadbacks = Math.max(0, activeCriticalWriteReadbacks - 1);
  while (
    activeCriticalWriteReadbacks < criticalWriteReadbackMaxConcurrency
    && queuedCriticalWriteReadbacks.length > 0
  ) {
    const next = queuedCriticalWriteReadbacks.shift();
    clearTimeout(next.timer);
    activeCriticalWriteReadbacks += 1;
    next.resolve(releaseCriticalWriteReadbackSlot);
  }
}

function acquireCriticalWriteReadbackSlot(route) {
  if (activeCriticalWriteReadbacks < criticalWriteReadbackMaxConcurrency) {
    activeCriticalWriteReadbacks += 1;
    return Promise.resolve(releaseCriticalWriteReadbackSlot);
  }
  if (queuedCriticalWriteReadbacks.length >= criticalWriteReadbackQueueLimit) {
    throw makeRelayBackpressureError(route, 'relay-critical-readback-backpressure');
  }
  incMap(metrics.criticalWriteReadbacksQueued, route);
  metrics.criticalWriteReadbackMaxQueued = Math.max(
    metrics.criticalWriteReadbackMaxQueued,
    queuedCriticalWriteReadbacks.length + 1,
  );
  return new Promise((resolve, reject) => {
    const entry = {
      route,
      resolve,
      reject,
      timer: null,
    };
    entry.timer = setTimeout(() => {
      const index = queuedCriticalWriteReadbacks.indexOf(entry);
      if (index >= 0) queuedCriticalWriteReadbacks.splice(index, 1);
      incMap(metrics.criticalWriteReadbackQueueTimeouts, route);
      reject(makeRelayBackpressureError(route, 'relay-critical-readback-queue-timeout'));
    }, criticalWriteReadbackQueueTimeoutMs);
    queuedCriticalWriteReadbacks.push(entry);
  });
}

async function runCriticalWriteReadback(route, storyId, readback) {
  incMap(metrics.criticalWriteReadbacksStarted, route);
  const release = await acquireCriticalWriteReadbackSlot(route);
  try {
    if (forceCriticalWriteReadbackFailure(route)) {
      logEvent('warn', 'critical_write_readback_test_forced_failure', {
        route,
        story_id: storyId,
      });
      return null;
    }
    const testDelayMs = numberEnv('VH_RELAY_TEST_CRITICAL_WRITE_READBACK_DELAY_MS', 0);
    if (testDelayMs > 0) {
      logEvent('info', 'critical_write_readback_test_delay', {
        route,
        story_id: storyId,
        delay_ms: testDelayMs,
      });
      await new Promise((resolve) => setTimeout(resolve, testDelayMs));
    }
    return await readback();
  } finally {
    release();
  }
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

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function signatureMessageMatchesCanonical(message, canonical) {
  try {
    const expected = JSON.parse(canonical);
    const actual = typeof message === 'string' ? JSON.parse(message) : message;
    return stableJson(actual) === stableJson(expected);
  } catch {
    return message === canonical;
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
    const verifiedMessage = await SEA.verify(signature, devicePub);
    if (signatureMessageMatchesCanonical(verifiedMessage, canonical)) {
      return true;
    }
  } catch {
    // Fall through to the local shim verifier for runtimes where SEA.verify is unavailable.
  }

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
    if (!signatureMessageMatchesCanonical(messageCanonical, canonical) || typeof signatureValue !== 'string') {
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

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function scanRadataBytes(target) {
  if (!target || target === false) {
    return { bytes: 0, scanned_entries: 0, truncated: false };
  }
  const startedAt = Date.now();
  let rootStat = null;
  try {
    rootStat = await fs.promises.stat(target);
  } catch {
    return { bytes: 0, scanned_entries: 0, truncated: false };
  }
  if (rootStat.isFile()) {
    return { bytes: rootStat.size, scanned_entries: 1, truncated: false };
  }
  if (!rootStat.isDirectory()) {
    return { bytes: 0, scanned_entries: 1, truncated: false };
  }

  let bytes = 0;
  let scannedEntries = 0;
  let truncated = false;
  const stack = [{ dir: target, depth: 0 }];
  while (stack.length > 0) {
    if (Date.now() - startedAt > radataBytesScanTimeoutMs) {
      truncated = true;
      break;
    }
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
    } catch {
      truncated = true;
      continue;
    }
    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries > radataBytesScanMaxEntries) {
        truncated = true;
        stack.length = 0;
        break;
      }
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(entryPath);
          bytes += stat.size;
        } catch {
          truncated = true;
        }
      } else if (entry.isDirectory()) {
        if (current.depth + 1 <= radataBytesScanMaxDepth) {
          stack.push({ dir: entryPath, depth: current.depth + 1 });
        } else {
          truncated = true;
        }
      }
      if (scannedEntries % 256 === 0) {
        await yieldToEventLoop();
      }
      if (Date.now() - startedAt > radataBytesScanTimeoutMs) {
        truncated = true;
        stack.length = 0;
        break;
      }
    }
  }
  return { bytes, scanned_entries: scannedEntries, truncated };
}

async function refreshRadataBytesCache(reason = 'interval') {
  if (radataBytesRefreshInFlight) return;
  radataBytesRefreshInFlight = true;
  const startedAt = Date.now();
  try {
    const result = await scanRadataBytes(gunFile);
    radataBytesCache.bytes = result.bytes;
    radataBytesCache.refreshedAt = Date.now();
    radataBytesCache.durationMs = radataBytesCache.refreshedAt - startedAt;
    radataBytesCache.scannedEntries = result.scanned_entries;
    radataBytesCache.truncated = result.truncated;
    radataBytesCache.lastError = '';
    metrics.radataBytesRefreshSuccesses += 1;
    if (result.truncated) {
      metrics.radataBytesRefreshTruncated += 1;
      logEvent('warn', 'radata_bytes_refresh_truncated', {
        relay_id: relayId,
        reason,
        scanned_entries: result.scanned_entries,
        max_entries: radataBytesScanMaxEntries,
        max_depth: radataBytesScanMaxDepth,
        timeout_ms: radataBytesScanTimeoutMs,
      });
    }
  } catch (error) {
    metrics.radataBytesRefreshErrors += 1;
    radataBytesCache.lastError = error instanceof Error ? error.message : String(error);
    logEvent('warn', 'radata_bytes_refresh_failed', {
      relay_id: relayId,
      reason,
      error: radataBytesCache.lastError,
    });
  } finally {
    radataBytesRefreshInFlight = false;
  }
}

function startRadataBytesRefresh() {
  if (!gunFile || radataBytesRefreshIntervalMs <= 0) return;
  setTimeout(() => {
    void refreshRadataBytesCache('startup');
  }, 0).unref?.();
  const interval = setInterval(() => {
    void refreshRadataBytesCache('interval');
  }, radataBytesRefreshIntervalMs);
  interval.unref?.();
}

function gunGraphNamespaceForSoul(soul) {
  const normalized = typeof soul === 'string' ? soul.replace(/\/+$/, '') : '';
  if (!normalized) return 'other';
  if (normalized === 'vh/news/index/latest' || normalized.startsWith('vh/news/index/latest/')) {
    return 'news_latest_index';
  }
  if (normalized === 'vh/news/index/hot' || normalized.startsWith('vh/news/index/hot/')) {
    return 'news_hot_index';
  }
  if (normalized.includes('/synthesis_lifecycle')) {
    return 'news_lifecycle';
  }
  if (normalized === 'vh/news/stories' || normalized.startsWith('vh/news/stories/')) {
    return 'news_story';
  }
  if (normalized === 'vh/topics' || normalized.startsWith('vh/topics/')) {
    return 'topic_synthesis';
  }
  if (normalized === 'vh/aggregates' || normalized.startsWith('vh/aggregates/')) {
    return 'aggregate';
  }
  if (normalized === 'vh/forum' || normalized.startsWith('vh/forum/')) {
    return 'forum';
  }
  return 'other';
}

function isGunLinkValue(value) {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === '#' && typeof value['#'] === 'string';
}

function emptyGunGraphBuckets() {
  const buckets = new Map();
  for (const namespace of GUN_GRAPH_NAMESPACES) {
    for (const state of GUN_GRAPH_STATES) {
      buckets.set(`${namespace}\t${state}`, {
        namespace,
        state,
        souls: 0,
        userFields: 0,
        userValueBytes: 0,
      });
    }
  }
  return buckets;
}

function addGunGraphBucket(buckets, { namespace, state, userFields, userValueBytes }) {
  const safeNamespace = GUN_GRAPH_NAMESPACES.includes(namespace) ? namespace : 'other';
  const safeState = GUN_GRAPH_STATES.includes(state) ? state : 'unknown';
  const key = `${safeNamespace}\t${safeState}`;
  const bucket = buckets.get(key) ?? {
    namespace: safeNamespace,
    state: safeState,
    souls: 0,
    userFields: 0,
    userValueBytes: 0,
  };
  bucket.souls += 1;
  bucket.userFields += Math.max(0, userFields || 0);
  bucket.userValueBytes += Math.max(0, userValueBytes || 0);
  buckets.set(key, bucket);
}

function summarizeGunGraphNode(soul, node) {
  const namespace = gunGraphNamespaceForSoul(soul);
  if (!isPlainRecord(node)) {
    return { namespace, state: 'unknown', userFields: 0, userValueBytes: 0 };
  }

  let linkFields = 0;
  let userFields = 0;
  let nonNullUserFields = 0;
  let nullUserFields = 0;
  let userValueBytes = 0;

  for (const field in node) {
    if (!Object.prototype.hasOwnProperty.call(node, field) || field === '_') continue;
    const value = node[field];
    if (isGunLinkValue(value)) {
      linkFields += 1;
      continue;
    }
    userFields += 1;
    if (value === null) {
      nullUserFields += 1;
    } else {
      nonNullUserFields += 1;
      userValueBytes += approximateJsonBytes(value);
    }
  }

  if (userFields > 0 && nonNullUserFields > 0) {
    return { namespace, state: 'live', userFields, userValueBytes };
  }
  if (userFields > 0 && nullUserFields === userFields) {
    return { namespace, state: 'tombstoned', userFields, userValueBytes };
  }
  if (userFields === 0 && linkFields > 0) {
    return { namespace, state: 'link_only', userFields, userValueBytes };
  }
  return { namespace, state: 'unknown', userFields, userValueBytes };
}

async function scanGunGraph(gunInstance) {
  const startedAt = Date.now();
  const graph = gunInstance?._?.graph;
  const buckets = emptyGunGraphBuckets();
  if (!isPlainRecord(graph)) {
    return { scanned_souls: 0, truncated: false, buckets };
  }

  let scannedSouls = 0;
  let truncated = false;
  for (const soul in graph) {
    if (!Object.prototype.hasOwnProperty.call(graph, soul)) continue;
    if (scannedSouls >= gunGraphScanMaxSouls) {
      truncated = true;
      break;
    }
    if (Date.now() - startedAt > gunGraphScanMaxDurationMs) {
      truncated = true;
      break;
    }
    scannedSouls += 1;
    addGunGraphBucket(buckets, summarizeGunGraphNode(soul, graph[soul]));
    if (scannedSouls % gunGraphScanBatchSize === 0) {
      await yieldToEventLoop();
      if (Date.now() - startedAt > gunGraphScanMaxDurationMs) {
        truncated = true;
        break;
      }
    }
  }
  return { scanned_souls: scannedSouls, truncated, buckets };
}

async function refreshGunGraphScanCache(gunInstance, reason = 'interval') {
  if (!gunGraphScanEnabled || gunGraphScanInFlight) return;
  gunGraphScanInFlight = true;
  const startedAt = Date.now();
  try {
    const result = await scanGunGraph(gunInstance);
    gunGraphScanCache.refreshedAt = Date.now();
    gunGraphScanCache.durationMs = gunGraphScanCache.refreshedAt - startedAt;
    gunGraphScanCache.scannedSouls = result.scanned_souls;
    gunGraphScanCache.truncated = result.truncated;
    gunGraphScanCache.lastError = '';
    gunGraphScanCache.buckets = result.buckets;
    metrics.gunGraphScanSuccesses += 1;
    if (result.truncated) {
      metrics.gunGraphScanTruncated += 1;
      logEvent('warn', 'gun_graph_scan_truncated', {
        relay_id: relayId,
        reason,
        scanned_souls: result.scanned_souls,
        max_souls: gunGraphScanMaxSouls,
        max_duration_ms: gunGraphScanMaxDurationMs,
      });
    }
  } catch (error) {
    metrics.gunGraphScanErrors += 1;
    gunGraphScanCache.lastError = error instanceof Error ? error.message : String(error);
    logEvent('warn', 'gun_graph_scan_failed', {
      relay_id: relayId,
      reason,
      error: gunGraphScanCache.lastError,
    });
  } finally {
    gunGraphScanInFlight = false;
  }
}

function startGunGraphScan(gunInstance) {
  if (!gunGraphScanEnabled) return;
  setTimeout(() => {
    void refreshGunGraphScanCache(gunInstance, 'startup');
  }, 0).unref?.();
  if (gunGraphScanIntervalMs <= 0) return;
  const interval = setInterval(() => {
    void refreshGunGraphScanCache(gunInstance, 'interval');
  }, gunGraphScanIntervalMs);
  interval.unref?.();
}

function openFileDescriptorCount() {
  for (const fdDir of ['/proc/self/fd', '/dev/fd']) {
    try {
      return fs.readdirSync(fdDir).length;
    } catch {
      // Try the next platform-specific descriptor directory.
    }
  }
  return null;
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
  add('vh_relay_critical_write_readbacks_active', activeCriticalWriteReadbacks);
  add('vh_relay_critical_write_readbacks_queued', queuedCriticalWriteReadbacks.length);
  add('vh_relay_critical_write_readbacks_max_queued', metrics.criticalWriteReadbackMaxQueued);
  add('vh_relay_radata_bytes', radataBytesCache.bytes);
  add('vh_relay_radata_bytes_refresh_enabled', gunFile && radataBytesRefreshIntervalMs > 0 ? 1 : 0);
  add('vh_relay_radata_bytes_refreshing', radataBytesRefreshInFlight ? 1 : 0);
  add('vh_relay_radata_bytes_last_refresh_age_ms', radataBytesCache.refreshedAt > 0 ? Date.now() - radataBytesCache.refreshedAt : -1);
  add('vh_relay_radata_bytes_last_refresh_duration_ms', radataBytesCache.durationMs);
  add('vh_relay_radata_bytes_last_refresh_scanned_entries', radataBytesCache.scannedEntries);
  add('vh_relay_radata_bytes_last_refresh_truncated', radataBytesCache.truncated ? 1 : 0);
  add('vh_relay_radata_bytes_refresh_successes_total', metrics.radataBytesRefreshSuccesses);
  add('vh_relay_radata_bytes_refresh_errors_total', metrics.radataBytesRefreshErrors);
  add('vh_relay_radata_bytes_refresh_truncated_total', metrics.radataBytesRefreshTruncated);
  add('vh_relay_gun_graph_scan_enabled', gunGraphScanEnabled ? 1 : 0);
  add('vh_relay_gun_graph_scan_running', gunGraphScanInFlight ? 1 : 0);
  add('vh_relay_gun_graph_scan_successes_total', metrics.gunGraphScanSuccesses);
  add('vh_relay_gun_graph_scan_errors_total', metrics.gunGraphScanErrors);
  add('vh_relay_gun_graph_scan_truncated', gunGraphScanCache.truncated ? 1 : 0);
  add('vh_relay_gun_graph_scan_truncated_total', metrics.gunGraphScanTruncated);
  add('vh_relay_gun_graph_scan_duration_ms', gunGraphScanCache.durationMs);
  add('vh_relay_gun_graph_scan_age_ms', gunGraphScanCache.refreshedAt > 0 ? Date.now() - gunGraphScanCache.refreshedAt : -1);
  add('vh_relay_gun_graph_scan_scanned_souls', gunGraphScanCache.scannedSouls);
  for (const bucket of [...gunGraphScanCache.buckets.values()]
    .sort((left, right) => `${left.namespace}\t${left.state}`.localeCompare(`${right.namespace}\t${right.state}`))) {
    const labels = { namespace: bucket.namespace, state: bucket.state };
    add('vh_relay_gun_graph_souls_total', bucket.souls, labels);
    add('vh_relay_gun_graph_user_fields_total', bucket.userFields, labels);
    add('vh_relay_gun_graph_user_value_bytes', bucket.userValueBytes, labels);
  }
  const memory = process.memoryUsage();
  const openFds = openFileDescriptorCount();
  add('vh_relay_process_rss_bytes', memory.rss);
  add('vh_relay_process_heap_used_bytes', memory.heapUsed);
  add('vh_relay_news_latest_index_snapshot_cache_entries', [...newsLatestIndexSnapshotCache.values()]
    .reduce((total, snapshot) => total + (Array.isArray(snapshot?.entries) ? snapshot.entries.length : 0), 0));
  add('vh_relay_news_latest_index_snapshot_cache_max_entries', newsLatestIndexSnapshotMaxEntries);
  add('vh_relay_news_latest_index_snapshot_entry_evictions_total', metrics.newsLatestIndexSnapshotEntryEvictions);
  add('vh_relay_news_latest_index_story_body_cache_entries', newsLatestIndexSnapshotStoryBodyCache.size);
  add('vh_relay_news_latest_index_story_body_cache_max_entries', newsLatestIndexSnapshotStoryBodyCacheMaxEntries);
  add('vh_relay_news_latest_index_story_body_cache_bytes', snapshotStoryBodyCacheBytes());
  add('vh_relay_news_latest_index_story_body_cache_evictions_total', metrics.newsLatestIndexSnapshotStoryBodyCacheEvictions);
  if (Number.isFinite(openFds)) {
    add('vh_relay_process_open_fds', openFds);
  }
  add('vh_relay_event_loop_lag_p95_ms', Math.round(eventLoopDelay.percentile(95) / 1e6));
  add('vh_relay_event_loop_lag_p99_ms', Math.round(eventLoopDelay.percentile(99) / 1e6));
  add('vh_relay_event_loop_lag_max_ms', Math.round(eventLoopDelay.max / 1e6));
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
  for (const [route, count] of metrics.criticalWriteReadbacksStarted) {
    add('vh_relay_critical_write_readbacks_started_total', count, { route });
  }
  for (const [route, count] of metrics.criticalWriteReadbacksQueued) {
    add('vh_relay_critical_write_readbacks_queued_total', count, { route });
  }
  for (const [route, count] of metrics.criticalWriteReadbackBackpressure) {
    add('vh_relay_critical_write_readback_backpressure_total', count, { route });
  }
  for (const [route, count] of metrics.criticalWriteReadbackQueueTimeouts) {
    add('vh_relay_critical_write_readback_queue_timeouts_total', count, { route });
  }
  for (const [reason, count] of metrics.relayWatchdogTrips) {
    add('vh_relay_resource_watchdog_trips_total', count, { reason });
  }
  for (const [operation, count] of metrics.snapshotBackgroundPauses) {
    add('vh_relay_snapshot_background_pauses_total', count, { operation });
  }
  for (const [operation, count] of metrics.snapshotBackgroundConcurrencyCaps) {
    add('vh_relay_snapshot_background_concurrency_caps_total', count, { operation });
  }
  return `${lines.join('\n')}\n`;
}

function mapToObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => String(left).localeCompare(String(right))));
}

function eventLoopDelaySummary() {
  return {
    p95_ms: Math.round(eventLoopDelay.percentile(95) / 1e6),
    p99_ms: Math.round(eventLoopDelay.percentile(99) / 1e6),
    max_ms: Math.round(eventLoopDelay.max / 1e6),
    mean_ms: Number.isFinite(eventLoopDelay.mean) ? Math.round(eventLoopDelay.mean / 1e6) : null,
  };
}

function safeDiagnosticFileSegment(value) {
  const cleaned = String(value || 'relay')
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'relay';
}

function writePrivateJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best-effort on filesystems that do not support chmod.
  }
}

function isSensitiveDiagnosticKey(key) {
  return /(env|environment|token|secret|password|passwd|credential|authorization|cookie|pin|private|signature|api[_-]?key|bearer)/i
    .test(String(key || ''));
}

function redactDiagnosticValue(value, key = '', depth = 0) {
  if (isSensitiveDiagnosticKey(key)) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticValue(entry, key, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactDiagnosticValue(entryValue, entryKey, depth + 1),
    ]));
  }
  return value;
}

function relayDiagnosticSnapshot(reason, details = {}) {
  const memory = process.memoryUsage();
  return {
    schema_version: 'vh-relay-self-capture-diagnostics-v1',
    generated_at: new Date().toISOString(),
    relay_id: relayId,
    reason,
    details,
    process: {
      pid: process.pid,
      node: process.version,
      uptime_ms: Math.round(process.uptime() * 1000),
      resource_usage: process.resourceUsage?.() ?? null,
    },
    memory: {
      rss: memory.rss,
      heap_total: memory.heapTotal,
      heap_used: memory.heapUsed,
      external: memory.external,
      array_buffers: memory.arrayBuffers,
    },
    event_loop_delay: eventLoopDelaySummary(),
    critical_write_readbacks: {
      active: activeCriticalWriteReadbacks,
      queued: queuedCriticalWriteReadbacks.length,
      max_queued: metrics.criticalWriteReadbackMaxQueued,
      started_by_route: mapToObject(metrics.criticalWriteReadbacksStarted),
      queued_by_route: mapToObject(metrics.criticalWriteReadbacksQueued),
      backpressure_by_route: mapToObject(metrics.criticalWriteReadbackBackpressure),
      queue_timeouts_by_route: mapToObject(metrics.criticalWriteReadbackQueueTimeouts),
    },
    write_failures_by_route: mapToObject(metrics.writeFailures),
    write_attempts_by_route: mapToObject(metrics.writeAttempts),
    snapshot_background_pauses_by_operation: mapToObject(metrics.snapshotBackgroundPauses),
    snapshot_cache: {
      latest_index_snapshot_entries: [...newsLatestIndexSnapshotCache.values()]
        .reduce((total, snapshot) => total + (Array.isArray(snapshot?.entries) ? snapshot.entries.length : 0), 0),
      latest_index_snapshot_max_entries: newsLatestIndexSnapshotMaxEntries,
      latest_index_snapshot_entry_evictions: metrics.newsLatestIndexSnapshotEntryEvictions,
      story_body_cache_entries: newsLatestIndexSnapshotStoryBodyCache.size,
      story_body_cache_max_entries: newsLatestIndexSnapshotStoryBodyCacheMaxEntries,
      story_body_cache_bytes: snapshotStoryBodyCacheBytes(),
      story_body_cache_evictions: metrics.newsLatestIndexSnapshotStoryBodyCacheEvictions,
    },
    config: {
      critical_write_readback_max_concurrency: criticalWriteReadbackMaxConcurrency,
      critical_write_readback_queue_limit: criticalWriteReadbackQueueLimit,
      critical_write_readback_queue_timeout_ms: criticalWriteReadbackQueueTimeoutMs,
      watchdog_interval_ms: relayResourceWatchdogIntervalMs,
      watchdog_max_event_loop_lag_p99_ms: relayWatchdogMaxEventLoopLagP99Ms,
      watchdog_max_rss_bytes: relayWatchdogMaxRssBytes,
      watchdog_max_heap_used_bytes: relayWatchdogMaxHeapUsedBytes,
      watchdog_max_rss_growth_bytes: relayWatchdogMaxRssGrowthBytes,
      watchdog_max_heap_growth_bytes: relayWatchdogMaxHeapGrowthBytes,
      watchdog_heap_snapshot_enabled: relayWatchdogHeapSnapshotEnabled,
      diagnostic_dir: relayWatchdogDiagnosticDir,
      gun_graph_scan_enabled: gunGraphScanEnabled,
      gun_graph_scan_interval_ms: gunGraphScanIntervalMs,
      gun_graph_scan_batch_size: gunGraphScanBatchSize,
      gun_graph_scan_max_souls: gunGraphScanMaxSouls,
      gun_graph_scan_max_duration_ms: gunGraphScanMaxDurationMs,
    },
  };
}

function writeRedactedProcessReport(reportPath) {
  if (!process.report || typeof process.report.getReport !== 'function') return null;
  const report = redactDiagnosticValue(process.report.getReport());
  writePrivateJsonFile(reportPath, report);
  return reportPath;
}

function shouldWriteHeapSnapshotForDiagnostic(reason, details = {}) {
  if (!relayWatchdogHeapSnapshotEnabled) return false;
  const diagnosticReason = `${reason} ${details?.reason ?? ''}`;
  return /(heap|rss)/i.test(diagnosticReason);
}

function writeBestEffortHeapSnapshot(base, reason, details = {}) {
  if (!relayWatchdogDiagnosticDir || !base || !shouldWriteHeapSnapshotForDiagnostic(reason, details)) {
    return { heap_snapshot_path: null, heap_summary_path: null };
  }
  const heapSnapshotPath = path.join(relayWatchdogDiagnosticDir, `${base}.heapsnapshot`);
  const heapSummaryPath = path.join(relayWatchdogDiagnosticDir, `${base}.heap-summary.json`);
  const summary = {
    schema_version: 'vh-relay-heap-summary-v1',
    generated_at: new Date().toISOString(),
    relay_id: relayId,
    reason,
    details,
    memory: process.memoryUsage(),
    heap_statistics: v8.getHeapStatistics(),
    heap_space_statistics: v8.getHeapSpaceStatistics(),
    note: 'Heap snapshot is host-private and may contain application object strings; share only this redacted summary unless explicitly approved.',
  };
  try {
    v8.writeHeapSnapshot(heapSnapshotPath);
    try {
      fs.chmodSync(heapSnapshotPath, 0o600);
    } catch {
      // Best-effort.
    }
  } catch (error) {
    writePrivateJsonFile(
      path.join(relayWatchdogDiagnosticDir, `${base}.heapsnapshot-error.json`),
      { error: error instanceof Error ? error.message : String(error) },
    );
    writePrivateJsonFile(heapSummaryPath, { ...summary, heap_snapshot_path: null });
    return { heap_snapshot_path: null, heap_summary_path: heapSummaryPath };
  }
  writePrivateJsonFile(heapSummaryPath, { ...summary, heap_snapshot_path: heapSnapshotPath });
  return { heap_snapshot_path: heapSnapshotPath, heap_summary_path: heapSummaryPath };
}

function writeRelayDiagnosticBundle(reason, details = {}) {
  if (!relayWatchdogDiagnosticDir) {
    return { summary_path: null, report_path: null, heap_snapshot_path: null, heap_summary_path: null };
  }
  fs.mkdirSync(relayWatchdogDiagnosticDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(relayWatchdogDiagnosticDir, 0o700);
  } catch {
    // Best-effort.
  }
  const base = `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeDiagnosticFileSegment(relayId)}-${safeDiagnosticFileSegment(reason)}`;
  const summaryPath = path.join(relayWatchdogDiagnosticDir, `${base}.json`);
  const reportPath = path.join(relayWatchdogDiagnosticDir, `${base}.process-report.json`);
  const artifacts = {
    process_report_path: null,
    heap_snapshot_path: null,
    heap_summary_path: null,
  };
  try {
    artifacts.process_report_path = writeRedactedProcessReport(reportPath);
  } catch (error) {
    writePrivateJsonFile(
      path.join(relayWatchdogDiagnosticDir, `${base}.process-report-error.json`),
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  const heapArtifacts = writeBestEffortHeapSnapshot(base, reason, details);
  artifacts.heap_snapshot_path = heapArtifacts.heap_snapshot_path;
  artifacts.heap_summary_path = heapArtifacts.heap_summary_path;
  writePrivateJsonFile(summaryPath, {
    ...relayDiagnosticSnapshot(reason, details),
    artifacts,
  });
  return {
    summary_path: summaryPath,
    report_path: artifacts.process_report_path,
    heap_snapshot_path: artifacts.heap_snapshot_path,
    heap_summary_path: artifacts.heap_summary_path,
    base,
  };
}

function inspectorPost(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function writeBestEffortCpuProfile(base) {
  if (!boolEnv('VH_RELAY_WATCHDOG_CPU_PROFILE_ENABLED', true) || !relayWatchdogDiagnosticDir || !base) {
    return null;
  }
  const session = new inspector.Session();
  const outputPath = path.join(relayWatchdogDiagnosticDir, `${base}.cpuprofile`);
  try {
    session.connect();
    await inspectorPost(session, 'Profiler.enable');
    await inspectorPost(session, 'Profiler.start');
    await new Promise((resolve) => setTimeout(resolve, numberEnv('VH_RELAY_WATCHDOG_CPU_PROFILE_MS', 250)));
    const result = await inspectorPost(session, 'Profiler.stop');
    fs.writeFileSync(outputPath, `${JSON.stringify(result.profile)}\n`, 'utf8');
    return outputPath;
  } catch (error) {
    try {
      fs.writeFileSync(
        path.join(relayWatchdogDiagnosticDir, `${base}.cpuprofile-error.txt`),
        String(error instanceof Error ? error.message : error),
        'utf8',
      );
    } catch {
      // Best-effort only.
    }
    return null;
  } finally {
    try {
      session.disconnect();
    } catch {
      // Best-effort only.
    }
  }
}

function relayWatchdogBreach() {
  if (process.env.NODE_ENV === 'test' && boolEnv('VH_RELAY_TEST_FORCE_WATCHDOG_TRIP', false)) {
    const forcedReason = String(process.env.VH_RELAY_TEST_FORCE_WATCHDOG_TRIP_REASON || 'test_forced').trim() || 'test_forced';
    return { reason: forcedReason, observed: true, limit: true };
  }
  const memory = process.memoryUsage();
  const delay = eventLoopDelaySummary();
  const now = Date.now();
  const previous = lastRelayWatchdogSample;
  lastRelayWatchdogSample = {
    sampled_at: now,
    rss: memory.rss,
    heap_used: memory.heapUsed,
  };
  if (relayWatchdogMaxEventLoopLagP99Ms > 0 && delay.p99_ms > relayWatchdogMaxEventLoopLagP99Ms) {
    return { reason: 'event_loop_lag_p99', observed: delay.p99_ms, limit: relayWatchdogMaxEventLoopLagP99Ms };
  }
  if (previous) {
    const elapsedMs = Math.max(1, now - previous.sampled_at);
    const heapGrowth = memory.heapUsed - previous.heap_used;
    const rssGrowth = memory.rss - previous.rss;
    if (relayWatchdogMaxHeapGrowthBytes > 0 && heapGrowth > relayWatchdogMaxHeapGrowthBytes) {
      return {
        reason: 'heap_used_growth_bytes',
        observed: heapGrowth,
        limit: relayWatchdogMaxHeapGrowthBytes,
        elapsed_ms: elapsedMs,
        current: memory.heapUsed,
        previous: previous.heap_used,
      };
    }
    if (relayWatchdogMaxRssGrowthBytes > 0 && rssGrowth > relayWatchdogMaxRssGrowthBytes) {
      return {
        reason: 'rss_growth_bytes',
        observed: rssGrowth,
        limit: relayWatchdogMaxRssGrowthBytes,
        elapsed_ms: elapsedMs,
        current: memory.rss,
        previous: previous.rss,
      };
    }
  }
  if (relayWatchdogMaxRssBytes > 0 && memory.rss > relayWatchdogMaxRssBytes) {
    return { reason: 'rss_bytes', observed: memory.rss, limit: relayWatchdogMaxRssBytes };
  }
  if (relayWatchdogMaxHeapUsedBytes > 0 && memory.heapUsed > relayWatchdogMaxHeapUsedBytes) {
    return { reason: 'heap_used_bytes', observed: memory.heapUsed, limit: relayWatchdogMaxHeapUsedBytes };
  }
  return null;
}

function tripRelayWatchdog(breach) {
  if (relayWatchdogTripped) return;
  relayWatchdogTripped = true;
  incMap(metrics.relayWatchdogTrips, breach.reason);
  const capture = writeRelayDiagnosticBundle(`watchdog-${breach.reason}`, breach);
  logEvent('error', 'relay_resource_watchdog_tripped', {
    relay_id: relayId,
    reason: breach.reason,
    observed: breach.observed,
    limit: breach.limit,
    diagnostic_summary_path: capture.summary_path,
    process_report_path: capture.report_path,
    heap_snapshot_path: capture.heap_snapshot_path,
    heap_summary_path: capture.heap_summary_path,
  });
  const forceExitTimer = setTimeout(() => process.exit(1), numberEnv('VH_RELAY_WATCHDOG_EXIT_GRACE_MS', 750));
  forceExitTimer.unref?.();
  writeBestEffortCpuProfile(capture.base)
    .catch(() => null)
    .finally(() => {
      clearTimeout(forceExitTimer);
      process.exit(1);
    });
}

function startRelayResourceWatchdog() {
  if (!relayResourceWatchdogEnabled && !(process.env.NODE_ENV === 'test' && boolEnv('VH_RELAY_TEST_FORCE_WATCHDOG_TRIP', false))) {
    return;
  }
  const interval = setInterval(() => {
    const breach = relayWatchdogBreach();
    if (breach) {
      tripRelayWatchdog(breach);
      return;
    }
    eventLoopDelay.reset();
  }, relayResourceWatchdogIntervalMs);
  interval.unref?.();
}

function installFatalCaptureHandlers() {
  const captureAndExit = (reason, error) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && typeof error.stack === 'string'
      ? error.stack.split('\n').slice(0, 8).join('\n')
      : null;
    try {
      const capture = writeRelayDiagnosticBundle(reason, { message, stack });
      logEvent('error', 'relay_fatal_capture_written', {
        relay_id: relayId,
        reason,
        diagnostic_summary_path: capture.summary_path,
        process_report_path: capture.report_path,
        heap_snapshot_path: capture.heap_snapshot_path,
        heap_summary_path: capture.heap_summary_path,
      });
    } catch (captureError) {
      logEvent('error', 'relay_fatal_capture_failed', {
        relay_id: relayId,
        reason,
        error: captureError instanceof Error ? captureError.message : String(captureError),
      });
    } finally {
      process.exit(1);
    }
  };
  process.on('uncaughtException', (error) => captureAndExit('uncaught-exception', error));
  process.on('unhandledRejection', (error) => captureAndExit('unhandled-rejection', error));
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

function readNonNullOnce(chain, timeoutMs = 1_500, intervalMs = 50) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value ?? null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const poll = () => {
      if (settled) return;
      chain.once((data) => {
        if (settled) return;
        if (data !== null && data !== undefined) {
          finish(data);
          return;
        }
        setTimeout(poll, intervalMs);
      });
    };
    poll();
  });
}

async function putScalarRecord(chain, record, options = {}) {
  const rootTimeoutMs = options.rootTimeoutMs ?? 3_000;
  const fieldTimeoutMs = options.fieldTimeoutMs ?? 1_000;
  const writes = [putWithTimeout(chain, record, rootTimeoutMs)];
  for (const [key, value] of Object.entries(record)) {
    if (key === '_' || value === undefined || !isGunScalar(value)) continue;
    writes.push(putWithTimeout(chain.get(key), value, fieldTimeoutMs));
  }
  await Promise.allSettled(writes);
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

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGunScalar(value) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function writeScalarFields(graph, soul, state, value) {
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || key === '_') continue;
    if (!isGunScalar(raw)) continue;
    graph[soul] = stateNode(graph[soul], key, state, raw, soul);
  }
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

function buildCommentGraph(comment, existingCommentIds = []) {
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
    idsJson: JSON.stringify(Array.from(new Set([...existingCommentIds, comment.id]))),
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
    if (
      key !== COMMENT_JSON_FIELD &&
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      continue;
    }
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

function encodeTopicSynthesisCandidate(candidate) {
  return {
    __candidate_synthesis_json: JSON.stringify(candidate),
    candidate_id: candidate.candidate_id,
    topic_id: candidate.topic_id,
    epoch: candidate.epoch,
    created_at: candidate.created_at,
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

function readTopicSynthesisLatestSnapshot() {
  if (topicSynthesisLatestSnapshotCache) return topicSynthesisLatestSnapshotCache;
  const empty = { cached_at: 0, records: {} };
  if (!topicSynthesisLatestSnapshotFile) {
    topicSynthesisLatestSnapshotCache = empty;
    return empty;
  }
  try {
    if (!fs.existsSync(topicSynthesisLatestSnapshotFile)) {
      topicSynthesisLatestSnapshotCache = empty;
      return empty;
    }
    const parsed = JSON.parse(fs.readFileSync(topicSynthesisLatestSnapshotFile, 'utf8'));
    if (
      !parsed
      || parsed.schema_version !== 'vh-topic-synthesis-latest-relay-snapshot-v1'
      || !parsed.records
      || typeof parsed.records !== 'object'
      || Array.isArray(parsed.records)
    ) {
      topicSynthesisLatestSnapshotCache = empty;
      return empty;
    }
    topicSynthesisLatestSnapshotCache = {
      cached_at: Number(parsed.cached_at) || 0,
      records: parsed.records,
    };
    return topicSynthesisLatestSnapshotCache;
  } catch (error) {
    logEvent('warn', 'topic_synthesis_latest_snapshot_read_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    topicSynthesisLatestSnapshotCache = empty;
    return empty;
  }
}

function readTopicSynthesisLatestRecordFromSnapshot(topicId) {
  const normalizedTopicId = typeof topicId === 'string' ? topicId.trim() : '';
  if (!normalizedTopicId) return null;
  const snapshot = readTopicSynthesisLatestSnapshot();
  const record = stripGunMetadata(snapshot.records?.[normalizedTopicId]);
  const synthesis = parseTopicSynthesisEnvelope(record?.__topic_synthesis_json);
  if (synthesis?.topic_id !== normalizedTopicId) return null;
  return { record, synthesis };
}

function persistTopicSynthesisLatestSnapshot(snapshot) {
  if (!topicSynthesisLatestSnapshotFile) return;
  try {
    fs.mkdirSync(path.dirname(topicSynthesisLatestSnapshotFile), { recursive: true });
    const tmpFile = `${topicSynthesisLatestSnapshotFile}.tmp`;
    fs.writeFileSync(
      tmpFile,
      `${JSON.stringify({
        schema_version: 'vh-topic-synthesis-latest-relay-snapshot-v1',
        cached_at: snapshot.cached_at,
        records: snapshot.records,
      })}\n`,
    );
    fs.renameSync(tmpFile, topicSynthesisLatestSnapshotFile);
  } catch (error) {
    logEvent('warn', 'topic_synthesis_latest_snapshot_persist_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function upsertTopicSynthesisLatestSnapshot(synthesis) {
  const topicId = typeof synthesis?.topic_id === 'string' ? synthesis.topic_id.trim() : '';
  if (!topicId) return;
  const snapshot = readTopicSynthesisLatestSnapshot();
  const next = {
    cached_at: Date.now(),
    records: {
      ...(snapshot.records ?? {}),
      [topicId]: encodeTopicSynthesis(synthesis),
    },
  };
  topicSynthesisLatestSnapshotCache = next;
  persistTopicSynthesisLatestSnapshot(next);
}

function buildTopicSynthesisCandidateGraph(candidate) {
  const state = Gun.state();
  const topicId = String(candidate.topic_id);
  const epoch = String(candidate.epoch);
  const candidateId = String(candidate.candidate_id);
  const epochRootSoul = `vh/topics/${topicId}/epochs`;
  const epochSoul = `${epochRootSoul}/${epoch}`;
  const candidatesSoul = `${epochSoul}/candidates`;
  const candidateSoul = `${candidatesSoul}/${candidateId}`;
  const encoded = encodeTopicSynthesisCandidate(candidate);
  const graph = {};

  linkNode(graph, 'vh', 'topics', 'vh/topics', state);
  linkNode(graph, 'vh/topics', topicId, `vh/topics/${topicId}`, state);
  linkNode(graph, `vh/topics/${topicId}`, 'epochs', epochRootSoul, state);
  linkNode(graph, epochRootSoul, epoch, epochSoul, state);
  linkNode(graph, epochSoul, 'candidates', candidatesSoul, state);
  linkNode(graph, candidatesSoul, candidateId, candidateSoul, state);

  for (const [key, value] of Object.entries(encoded)) {
    if (value === undefined) continue;
    graph[candidateSoul] = stateNode(graph[candidateSoul], key, state, value, candidateSoul);
  }

  return graph;
}

function sanitizeNewsStoryWrite(body) {
  const record = isPlainRecord(body?.record) ? body.record : null;
  if (!record) {
    throw new Error('news-story-record-required');
  }
  const story = parseStoryBundleEnvelope(record.__story_bundle_json);
  const storyId = typeof record.story_id === 'string' ? record.story_id.trim() : '';
  if (!storyId || story?.story_id !== storyId) {
    throw new Error('news-story-record-mismatch');
  }
  return { story_id: storyId, record };
}

function buildNewsStoryGraph(write) {
  const state = Gun.state();
  const storySoul = `vh/news/stories/${write.story_id}`;
  const graph = {};
  linkNode(graph, 'vh', 'news', 'vh/news', state);
  linkNode(graph, 'vh/news', 'stories', 'vh/news/stories', state);
  linkNode(graph, 'vh/news/stories', write.story_id, storySoul, state);
  writeScalarFields(graph, storySoul, state, write.record);
  return graph;
}

function sanitizeNewsLatestIndexWrite(body) {
  const record = isPlainRecord(body?.record) ? body.record : null;
  if (!record) {
    throw new Error('news-latest-index-record-required');
  }
  const storyId = typeof record.story_id === 'string' ? record.story_id.trim() : '';
  const latestActivityAt = Number(record.latest_activity_at);
  if (!storyId || !Number.isFinite(latestActivityAt) || latestActivityAt < 0) {
    throw new Error('news-latest-index-record-invalid');
  }
  return { story_id: storyId, record };
}

function buildNewsLatestIndexGraph(write) {
  const state = Gun.state();
  const latestRootSoul = 'vh/news/index/latest';
  const latestSoul = `${latestRootSoul}/${write.story_id}`;
  const graph = {};
  linkNode(graph, 'vh', 'news', 'vh/news', state);
  linkNode(graph, 'vh/news', 'index', 'vh/news/index', state);
  linkNode(graph, 'vh/news/index', 'latest', latestRootSoul, state);
  linkNode(graph, latestRootSoul, write.story_id, latestSoul, state);
  writeScalarFields(graph, latestSoul, state, write.record);
  return graph;
}

function sanitizeNewsHotIndexWrite(body) {
  const record = isPlainRecord(body?.record) ? body.record : null;
  if (!record) {
    throw new Error('news-hot-index-record-required');
  }
  const storyId = typeof record.story_id === 'string' ? record.story_id.trim() : '';
  const hotness = Number(record.hotness);
  if (!storyId || !Number.isFinite(hotness) || hotness < 0) {
    throw new Error('news-hot-index-record-invalid');
  }
  return { story_id: storyId, record };
}

function buildNewsHotIndexGraph(write) {
  const state = Gun.state();
  const hotRootSoul = 'vh/news/index/hot';
  const hotSoul = `${hotRootSoul}/${write.story_id}`;
  const graph = {};
  linkNode(graph, 'vh', 'news', 'vh/news', state);
  linkNode(graph, 'vh/news', 'index', 'vh/news/index', state);
  linkNode(graph, 'vh/news/index', 'hot', hotRootSoul, state);
  linkNode(graph, hotRootSoul, write.story_id, hotSoul, state);
  writeScalarFields(graph, hotSoul, state, write.record);
  return graph;
}

function sanitizeNewsSynthesisLifecycleWrite(body) {
  const record = isPlainRecord(body?.record)
    ? body.record
    : isPlainRecord(body?.lifecycle)
      ? body.lifecycle
      : null;
  if (!record) {
    throw new Error('news-synthesis-lifecycle-record-required');
  }
  const forbiddenField = Object.keys(record).find((key) => {
    const normalized = key.toLowerCase();
    return normalized === '_authorscheme'
      || normalized === 'signedwriteenvelope'
      || normalized === 'sessionref'
      || normalized === 'voter_id'
      || normalized === 'identity_id'
      || normalized === 'user_id'
      || normalized === 'device_pub'
      || normalized.includes('token')
      || normalized.includes('oauth')
      || normalized.includes('bearer')
      || normalized.includes('nullifier');
  });
  if (forbiddenField) {
    throw new Error('news-synthesis-lifecycle-record-private-field');
  }
  const storyId = typeof record.story_id === 'string' ? record.story_id.trim() : '';
  const topicId = typeof record.topic_id === 'string' ? record.topic_id.trim() : '';
  const sourceSetRevision = typeof record.source_set_revision === 'string'
    ? record.source_set_revision.trim()
    : '';
  const status = typeof record.status === 'string' ? record.status.trim() : '';
  const frameTableState = typeof record.frame_table_state === 'string'
    ? record.frame_table_state.trim()
    : '';
  const sourceCount = Number(record.source_count);
  const canonicalSourceCount = Number(record.canonical_source_count);
  const updatedAt = Number(record.updated_at);
  if (
    record.schemaVersion !== 'vh-news-synthesis-lifecycle-v1'
    || !storyId
    || !topicId
    || !sourceSetRevision
    || !['pending', 'in_progress', 'accepted_available', 'retryable_failure', 'terminal_unavailable', 'suppressed'].includes(status)
    || !['frame_table_pending', 'frame_table_ready', 'frame_table_unavailable'].includes(frameTableState)
    || !Number.isFinite(sourceCount)
    || sourceCount < 0
    || !Number.isFinite(canonicalSourceCount)
    || canonicalSourceCount < 0
    || !Number.isFinite(updatedAt)
    || updatedAt < 0
  ) {
    throw new Error('news-synthesis-lifecycle-record-invalid');
  }
  return { story_id: storyId, record };
}

function buildNewsSynthesisLifecycleGraph(write) {
  const state = Gun.state();
  const storySoul = `vh/news/stories/${write.story_id}`;
  const lifecycleRootSoul = `${storySoul}/synthesis_lifecycle`;
  const lifecycleLatestSoul = `${lifecycleRootSoul}/latest`;
  const graph = {};
  linkNode(graph, 'vh', 'news', 'vh/news', state);
  linkNode(graph, 'vh/news', 'stories', 'vh/news/stories', state);
  linkNode(graph, 'vh/news/stories', write.story_id, storySoul, state);
  linkNode(graph, storySoul, 'synthesis_lifecycle', lifecycleRootSoul, state);
  linkNode(graph, lifecycleRootSoul, 'latest', lifecycleLatestSoul, state);
  writeScalarFields(graph, lifecycleLatestSoul, state, write.record);
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
  const envelope = isPlainRecord(write.node.signedWriteEnvelope) ? write.node.signedWriteEnvelope : null;
  const envelopeSoul = `${pointSoul}/signedWriteEnvelope`;
  const envelopePayloadSoul = `${envelopeSoul}/payload`;
  const envelopeSessionRefSoul = `${envelopeSoul}/sessionRef`;
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

  writeScalarFields(graph, pointSoul, state, write.node);

  if (envelope) {
    linkNode(graph, pointSoul, 'signedWriteEnvelope', envelopeSoul, state);
    for (const [key, value] of Object.entries(envelope)) {
      if (key === 'payload' && isPlainRecord(value)) {
        linkNode(graph, envelopeSoul, 'payload', envelopePayloadSoul, state);
        writeScalarFields(graph, envelopePayloadSoul, state, value);
        continue;
      }
      if (key === 'sessionRef' && isPlainRecord(value)) {
        linkNode(graph, envelopeSoul, 'sessionRef', envelopeSessionRefSoul, state);
        writeScalarFields(graph, envelopeSessionRefSoul, state, value);
        continue;
      }
      if (isGunScalar(value)) {
        graph[envelopeSoul] = stateNode(graph[envelopeSoul], key, state, value, envelopeSoul);
      }
    }
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

async function readTopicSynthesisBack(gun, topicId, synthesisId, options = {}) {
  const latestChain = gun.get('vh').get('topics').get(topicId).get('latest');
  const synthesisTimeoutMs = numberEnv('VH_RELAY_TOPIC_SYNTHESIS_REST_READ_TIMEOUT_MS', 1_500);
  const [directRaw, scalarRaw] = await Promise.all([
    readOnce(latestChain, synthesisTimeoutMs),
    readOnce(latestChain.get('__topic_synthesis_json'), synthesisTimeoutMs),
  ]);
  const direct = stripGunMetadata(directRaw);
  const envelope = direct && typeof direct === 'object'
    ? parseTopicSynthesisEnvelope(direct.__topic_synthesis_json)
    : null;
  if (envelope?.topic_id === topicId && envelope?.synthesis_id === synthesisId) {
    return envelope;
  }
  const scalar = parseTopicSynthesisEnvelope(scalarRaw);
  if (scalar?.topic_id === topicId && scalar?.synthesis_id === synthesisId) {
    return scalar;
  }
  if (options.allowSnapshotFallback === false) {
    return null;
  }
  const snapshot = readTopicSynthesisLatestRecordFromSnapshot(topicId);
  if (snapshot?.synthesis?.synthesis_id === synthesisId) {
    return snapshot.synthesis;
  }
  return null;
}

async function pollTopicSynthesisBack(gun, topicId, synthesisId, timeoutMs = 5_000, options = {}) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readTopicSynthesisBack(gun, topicId, synthesisId, options);
    if (latest) return latest;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return latest;
}

async function readTopicLatestSynthesisRecord(gun, topicId) {
  const latestChain = gun.get('vh').get('topics').get(topicId).get('latest');
  const synthesisTimeoutMs = numberEnv('VH_RELAY_TOPIC_SYNTHESIS_REST_READ_TIMEOUT_MS', 1_500);
  const [directRaw, scalarRaw] = await Promise.all([
    readOnce(latestChain, synthesisTimeoutMs),
    readOnce(latestChain.get('__topic_synthesis_json'), synthesisTimeoutMs),
  ]);
  const direct = stripGunMetadata(directRaw);
  const envelope = direct && typeof direct === 'object'
    ? parseTopicSynthesisEnvelope(direct.__topic_synthesis_json)
    : null;
  if (envelope?.topic_id === topicId) {
    return {
      record: direct,
      synthesis: envelope,
    };
  }
  const scalar = parseTopicSynthesisEnvelope(scalarRaw);
  if (scalar?.topic_id === topicId) {
    return {
      record: { __topic_synthesis_json: JSON.stringify(scalar) },
      synthesis: scalar,
    };
  }
  return readTopicSynthesisLatestRecordFromSnapshot(topicId);
}

function hasAcceptedTopicSynthesisPayload(synthesis) {
  if (!synthesis || typeof synthesis !== 'object') return false;
  if (typeof synthesis.facts_summary !== 'string' || synthesis.facts_summary.trim().length === 0) {
    return false;
  }
  if (!Array.isArray(synthesis.frames) || synthesis.frames.length === 0) {
    return false;
  }
  return synthesis.frames.every((row) => (
    row
    && typeof row === 'object'
    && typeof row.frame === 'string'
    && row.frame.trim().length > 0
    && typeof row.reframe === 'string'
    && row.reframe.trim().length > 0
  ));
}

function hasFrameTableReadyPayload(synthesis) {
  return hasAcceptedTopicSynthesisPayload(synthesis)
    && synthesis.frames.every((row) => (
      typeof row.frame_point_id === 'string'
      && row.frame_point_id.trim().length > 0
      && typeof row.reframe_point_id === 'string'
      && row.reframe_point_id.trim().length > 0
    ));
}

function synthesisInputsIncludeStory(synthesis, story) {
  const storyId = typeof story?.story_id === 'string' ? story.story_id.trim() : '';
  if (!storyId) return false;
  const storyBundleIds = Array.isArray(synthesis?.inputs?.story_bundle_ids)
    ? synthesis.inputs.story_bundle_ids
    : [];
  return storyBundleIds.some((candidate) => String(candidate ?? '').trim() === storyId);
}

function acceptedSynthesisMatchesStoryRevision(story, synthesis, lifecycle) {
  if (!hasAcceptedTopicSynthesisPayload(synthesis)) return false;
  if (!synthesisInputsIncludeStory(synthesis, story)) return false;
  if (!lifecycle || typeof lifecycle !== 'object') return false;
  if (lifecycle.status !== 'accepted_available') return false;
  if (typeof story?.provenance_hash !== 'string' || !story.provenance_hash.trim()) return false;
  if (lifecycle.source_set_revision !== story.provenance_hash) return false;
  if (typeof synthesis.synthesis_id !== 'string' || lifecycle.synthesis_id !== synthesis.synthesis_id) return false;
  if (Number.isFinite(Number(synthesis.epoch)) && Number.isFinite(Number(lifecycle.epoch))) {
    return Math.floor(Number(synthesis.epoch)) === Math.floor(Number(lifecycle.epoch));
  }
  return true;
}

function parseStoryBundleEnvelope(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseNewsSynthesisLifecycleRecord(value, storyId) {
  const direct = stripGunMetadata(value);
  if (!direct || typeof direct !== 'object') return null;
  if (
    direct.schemaVersion !== 'vh-news-synthesis-lifecycle-v1'
    || direct.story_id !== storyId
    || typeof direct.status !== 'string'
  ) {
    return null;
  }
  return direct;
}

function readNewsSynthesisLifecycleSnapshot() {
  if (newsSynthesisLifecycleSnapshotCache) return newsSynthesisLifecycleSnapshotCache;
  const empty = { cached_at: 0, records: {} };
  if (!newsSynthesisLifecycleSnapshotFile) {
    newsSynthesisLifecycleSnapshotCache = empty;
    return empty;
  }
  try {
    if (!fs.existsSync(newsSynthesisLifecycleSnapshotFile)) {
      newsSynthesisLifecycleSnapshotCache = empty;
      return empty;
    }
    const parsed = JSON.parse(fs.readFileSync(newsSynthesisLifecycleSnapshotFile, 'utf8'));
    if (
      !parsed
      || parsed.schema_version !== 'vh-news-synthesis-lifecycle-relay-snapshot-v1'
      || !parsed.records
      || typeof parsed.records !== 'object'
      || Array.isArray(parsed.records)
    ) {
      newsSynthesisLifecycleSnapshotCache = empty;
      return empty;
    }
    newsSynthesisLifecycleSnapshotCache = {
      cached_at: Number(parsed.cached_at) || 0,
      records: parsed.records,
    };
    return newsSynthesisLifecycleSnapshotCache;
  } catch (error) {
    logEvent('warn', 'news_synthesis_lifecycle_snapshot_read_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    newsSynthesisLifecycleSnapshotCache = empty;
    return empty;
  }
}

function readNewsSynthesisLifecycleRecordFromSnapshot(storyId) {
  const snapshot = readNewsSynthesisLifecycleSnapshot();
  return parseNewsSynthesisLifecycleRecord(snapshot.records?.[storyId], storyId);
}

function persistNewsSynthesisLifecycleSnapshot(snapshot) {
  if (!newsSynthesisLifecycleSnapshotFile) return;
  try {
    fs.mkdirSync(path.dirname(newsSynthesisLifecycleSnapshotFile), { recursive: true });
    const tmpFile = `${newsSynthesisLifecycleSnapshotFile}.tmp`;
    fs.writeFileSync(
      tmpFile,
      `${JSON.stringify({
        schema_version: 'vh-news-synthesis-lifecycle-relay-snapshot-v1',
        cached_at: snapshot.cached_at,
        records: snapshot.records,
      })}\n`,
    );
    fs.renameSync(tmpFile, newsSynthesisLifecycleSnapshotFile);
  } catch (error) {
    logEvent('warn', 'news_synthesis_lifecycle_snapshot_persist_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function upsertNewsSynthesisLifecycleSnapshot(record) {
  const storyId = typeof record?.story_id === 'string' ? record.story_id.trim() : '';
  if (!storyId) return;
  const snapshot = readNewsSynthesisLifecycleSnapshot();
  const next = {
    cached_at: Date.now(),
    records: {
      ...(snapshot.records ?? {}),
      [storyId]: record,
    },
  };
  newsSynthesisLifecycleSnapshotCache = next;
  persistNewsSynthesisLifecycleSnapshot(next);
}

async function readNewsStoryRecord(gun, storyId, options = {}) {
  const storyChains = [
    gun.get('vh/news/stories').get(storyId),
    gun.get(`vh/news/stories/${storyId}`),
    gun.get('vh').get('news').get('stories').get(storyId),
  ];
  const storyTimeoutMs = options.timeoutMs ?? numberEnv('VH_RELAY_NEWS_STORY_REST_READ_TIMEOUT_MS', 1_500);
  const allowSnapshotFallback = options.allowSnapshotFallback !== false
    && boolEnv('VH_RELAY_NEWS_STORY_SNAPSHOT_FALLBACK', true);
  const parseReadResult = (result) => {
    if (result.kind === 'direct') {
      const direct = stripGunMetadata(result.value);
      const envelope = direct && typeof direct === 'object'
        ? parseStoryBundleEnvelope(direct.__story_bundle_json)
        : null;
      if (envelope?.story_id === storyId) {
        return {
          record: direct,
          story: envelope,
        };
      }
      return null;
    }
    const scalar = parseStoryBundleEnvelope(result.value);
    if (scalar?.story_id === storyId) {
      return {
        record: { __story_bundle_json: JSON.stringify(scalar), story_id: storyId },
        story: scalar,
      };
    }
    return null;
  };
  const pending = storyChains.flatMap((storyChain) => [
    readOnce(storyChain, storyTimeoutMs).then((value) => ({ kind: 'direct', value })),
    readNonNullOnce(storyChain.get('__story_bundle_json'), storyTimeoutMs)
      .then((value) => ({ kind: 'scalar', value })),
  ]);
  while (pending.length > 0) {
    const { index, result } = await Promise.race(
      pending.map((promise, index) => promise.then((result) => ({ index, result }))),
    );
    pending.splice(index, 1);
    const parsed = parseReadResult(result);
    if (parsed) return parsed;
  }
  return allowSnapshotFallback ? readNewsStoryRecordFromLatestIndexSnapshot(storyId) : null;
}

async function readNewsSynthesisLifecycleRecord(gun, storyId, options = {}) {
  const lifecycleChain = gun
    .get('vh')
    .get('news')
    .get('stories')
    .get(storyId)
    .get('synthesis_lifecycle')
    .get('latest');
  const timeoutMs = options.timeoutMs ?? numberEnv('VH_RELAY_NEWS_LIFECYCLE_REST_READ_TIMEOUT_MS', 750);
  const direct = parseNewsSynthesisLifecycleRecord(await readOnce(lifecycleChain, timeoutMs), storyId);
  if (direct || options.allowSnapshotFallback === false) return direct;
  return readNewsSynthesisLifecycleRecordFromSnapshot(storyId);
}

async function readNewsSynthesisLifecycleRecordFromFields(gun, storyId, options = {}) {
  const lifecycleChain = gun
    .get('vh')
    .get('news')
    .get('stories')
    .get(storyId)
    .get('synthesis_lifecycle')
    .get('latest');
  const timeoutMs = options.timeoutMs ?? numberEnv('VH_RELAY_NEWS_LIFECYCLE_FIELD_REST_READ_TIMEOUT_MS', 250);
  const fields = [
    'schemaVersion',
    'story_id',
    'topic_id',
    'source_set_revision',
    'source_count',
    'canonical_source_count',
    'status',
    'retryable',
    'reason',
    'synthesis_id',
    'epoch',
    'frame_table_state',
    'updated_at',
  ];
  const values = await Promise.all(
    fields.map((field) => readOnce(lifecycleChain.get(field), timeoutMs)),
  );
  const record = {};
  for (let index = 0; index < fields.length; index += 1) {
    const value = stripGunMetadata(values[index]);
    if (value !== null && value !== undefined) {
      record[fields[index]] = value;
    }
  }
  return parseNewsSynthesisLifecycleRecord(record, storyId)
    ?? (options.allowSnapshotFallback === false ? null : readNewsSynthesisLifecycleRecordFromSnapshot(storyId));
}

async function refreshPotentiallyStaleLifecycleRecord(gun, story, synthesis, lifecycle) {
  if (!hasAcceptedTopicSynthesisPayload(synthesis) || !synthesisInputsIncludeStory(synthesis, story)) {
    return lifecycle;
  }
  if (acceptedSynthesisMatchesStoryRevision(story, synthesis, lifecycle)) {
    return lifecycle;
  }
  const timeoutMs = numberEnv('VH_RELAY_NEWS_LIFECYCLE_FIELD_REST_READ_TIMEOUT_MS', 250);
  const fieldLifecycle = await readNewsSynthesisLifecycleRecordFromFields(gun, story.story_id, { timeoutMs })
    .catch(() => null);
  return fieldLifecycle ?? lifecycle;
}

async function pollNewsStoryBack(gun, storyId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readNewsStoryRecord(gun, storyId, {
      timeoutMs: 1_500,
      allowSnapshotFallback: false,
    });
    if (latest) return latest;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return latest;
}

async function pollNewsSynthesisLifecycleBack(gun, storyId, expected, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readNewsSynthesisLifecycleRecord(gun, storyId, {
      timeoutMs: 1_500,
      allowSnapshotFallback: false,
    });
    if (
      latest
      && latest.story_id === storyId
      && latest.status === expected.status
      && Number(latest.updated_at) === Number(expected.updated_at)
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return latest;
}

function indexEntryPriority(root, storyId) {
  const direct = root && typeof root === 'object' ? root[storyId] : null;
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return direct;
  }
  if (direct && typeof direct === 'object') {
    for (const key of ['latest_activity_at', 'cluster_window_end', 'created_at']) {
      const value = Number(direct[key]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }
  const fieldState = root && typeof root === 'object' && root._ && typeof root._ === 'object'
    ? root._['>']
    : null;
  const stateValue = fieldState && typeof fieldState === 'object'
    ? Number(fieldState[storyId])
    : Number.NaN;
  return Number.isFinite(stateValue) ? stateValue : 0;
}

function extractIndexChildKeys(value) {
  if (!value || typeof value !== 'object') return [];
  const keys = new Set();
  for (const key of Object.keys(value)) {
    if (key !== '_') keys.add(key);
  }
  const fieldState = value._ && typeof value._ === 'object' ? value._['>'] : null;
  if (fieldState && typeof fieldState === 'object') {
    for (const key of Object.keys(fieldState)) {
      if (key !== '_') keys.add(key);
    }
  }
  return [...keys].sort((a, b) => indexEntryPriority(value, b) - indexEntryPriority(value, a) || a.localeCompare(b));
}

function gunLinkSoul(value) {
  if (!value || typeof value !== 'object') return null;
  const soul = value['#'];
  return typeof soul === 'string' && soul.trim() ? soul.trim() : null;
}

function isGunLinkRecord(value) {
  return Boolean(gunLinkSoul(value));
}

function resolveLatestActivityFromStory(story) {
  if (!story || typeof story !== 'object') return null;
  for (const key of ['cluster_window_end', 'created_at', 'updated_at', 'published_at']) {
    const value = Number(story[key]);
    if (Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return null;
}

function latestIndexRecordHasTimestamp(record) {
  if (typeof record === 'number' && Number.isFinite(record)) return true;
  if (typeof record === 'string' && Number.isFinite(Number(record))) return true;
  if (!record || typeof record !== 'object') return false;
  return ['latest_activity_at', 'cluster_window_end', 'created_at'].some((key) => {
    const value = Number(record[key]);
    return Number.isFinite(value) && value >= 0;
  });
}

function latestIndexRecordTimestamp(record) {
  if (typeof record === 'number' && Number.isFinite(record) && record >= 0) return Math.floor(record);
  if (typeof record === 'string' && Number.isFinite(Number(record)) && Number(record) >= 0) {
    return Math.floor(Number(record));
  }
  if (!record || typeof record !== 'object') return null;
  for (const key of ['latest_activity_at', 'cluster_window_end', 'created_at']) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  }
  return null;
}

function hotIndexRecordHotness(record) {
  if (typeof record === 'number' && Number.isFinite(record) && record >= 0) return record;
  if (typeof record === 'string' && Number.isFinite(Number(record)) && Number(record) >= 0) {
    return Number(record);
  }
  if (!record || typeof record !== 'object') return null;
  const value = Number(record.hotness);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeHotIndexRecordForResponse(storyId, record) {
  const normalizedStoryId = typeof storyId === 'string' ? storyId.trim() : '';
  if (!normalizedStoryId) return null;
  const hotness = hotIndexRecordHotness(record);
  if (hotness === null) return null;
  if (!record || typeof record !== 'object') {
    return { story_id: normalizedStoryId, hotness };
  }
  const recordStoryId = typeof record.story_id === 'string' ? record.story_id.trim() : '';
  if (recordStoryId && recordStoryId !== normalizedStoryId) {
    return null;
  }
  return {
    ...record,
    story_id: normalizedStoryId,
    hotness,
  };
}

function finiteNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function latestIndexProductMetadataStatus(record, story) {
  if (!story || typeof story !== 'object') return 'story_missing';
  if (!record || typeof record !== 'object') return 'missing';
  const sourceCount = Array.isArray(story.sources) ? story.sources.length : 0;
  const canonicalSourceCount = Array.isArray(story.primary_sources)
    ? story.primary_sources.length
    : sourceCount;
  const hasSchema = record.product_state_schema_version === 'vh-news-product-feed-index-v1';
  const hasStory = String(record.story_id ?? '').trim() === String(story.story_id ?? '').trim();
  const hasTopic = String(record.topic_id ?? '').trim() === String(story.topic_id ?? '').trim();
  const hasRevision = String(record.source_set_revision ?? '').trim() === String(story.provenance_hash ?? '').trim();
  const hasSourceCounts =
    finiteNonNegativeInteger(record.source_count) === sourceCount &&
    finiteNonNegativeInteger(record.canonical_source_count) === canonicalSourceCount;
  const hasTimestamps =
    finiteNonNegativeInteger(record.story_created_at) === finiteNonNegativeInteger(story.created_at) &&
    finiteNonNegativeInteger(record.cluster_window_start) === finiteNonNegativeInteger(story.cluster_window_start);
  if (hasSchema && hasStory && hasTopic && hasRevision && hasSourceCounts && hasTimestamps) {
    return 'complete';
  }
  return hasSchema || hasTopic || finiteNonNegativeInteger(record.source_count) !== null
    ? 'partial_or_mismatch'
    : 'missing';
}

function storySourceCount(story) {
  if (!story || typeof story !== 'object') return 0;
  const canonical = Array.isArray(story.primary_sources) ? story.primary_sources : null;
  const sources = canonical ?? (Array.isArray(story.sources) ? story.sources : []);
  return sources.length;
}

function lifecycleStateFields(lifecycle) {
  if (!lifecycle || typeof lifecycle !== 'object') {
    return {
      lifecycle_source_set_revision: null,
      lifecycle_updated_at: null,
    };
  }
  return {
    lifecycle_source_set_revision: typeof lifecycle.source_set_revision === 'string'
      ? lifecycle.source_set_revision
      : null,
    lifecycle_updated_at: Number.isFinite(lifecycle.updated_at)
      ? lifecycle.updated_at
      : null,
  };
}

function derivePublicFeedStoryState(story, synthesis, lifecycle) {
  const acceptedAvailable = acceptedSynthesisMatchesStoryRevision(story, synthesis, lifecycle);
  const frameReady = hasFrameTableReadyPayload(synthesis);
  const lifecycleFields = lifecycleStateFields(lifecycle);
  if (lifecycle?.status === 'suppressed') {
    return {
      synthesis_state: 'accepted_synthesis_suppressed',
      frame_table_state: 'frame_table_unavailable',
      synthesis_id: lifecycle.synthesis_id ?? null,
      epoch: Number.isFinite(lifecycle.epoch) ? lifecycle.epoch : null,
      lifecycle_status: lifecycle.status,
      ...lifecycleFields,
      terminal_unavailable_reason: lifecycle.reason ?? 'suppressed',
      retryable: false,
    };
  }
  if (acceptedAvailable) {
    return {
      synthesis_state: 'accepted_synthesis_available',
      frame_table_state: frameReady ? 'frame_table_ready' : 'frame_table_unavailable',
      synthesis_id: synthesis.synthesis_id ?? null,
      epoch: Number.isFinite(synthesis.epoch) ? synthesis.epoch : null,
      lifecycle_status: lifecycle?.status ?? 'accepted_available',
      ...lifecycleFields,
      terminal_unavailable_reason: null,
      retryable: false,
    };
  }
  if (lifecycle?.status === 'terminal_unavailable') {
    return {
      synthesis_state: 'synthesis_terminal_unavailable',
      frame_table_state: 'frame_table_unavailable',
      synthesis_id: lifecycle.synthesis_id ?? null,
      epoch: Number.isFinite(lifecycle.epoch) ? lifecycle.epoch : null,
      lifecycle_status: lifecycle.status,
      ...lifecycleFields,
      terminal_unavailable_reason: lifecycle.reason ?? 'terminal_unavailable',
      retryable: false,
    };
  }
  if (lifecycle?.status === 'retryable_failure') {
    return {
      synthesis_state: 'synthesis_loading',
      frame_table_state: 'frame_table_pending',
      synthesis_id: lifecycle.synthesis_id ?? null,
      epoch: Number.isFinite(lifecycle.epoch) ? lifecycle.epoch : null,
      lifecycle_status: lifecycle.status,
      ...lifecycleFields,
      terminal_unavailable_reason: null,
      retryable: true,
    };
  }
  return {
    synthesis_state: lifecycle?.status === 'in_progress' ? 'synthesis_loading' : 'synthesis_pending',
    frame_table_state: 'frame_table_pending',
    synthesis_id: lifecycle?.synthesis_id ?? null,
    epoch: Number.isFinite(lifecycle?.epoch) ? lifecycle.epoch : null,
    lifecycle_status: lifecycle?.status ?? 'pending',
    ...lifecycleFields,
    terminal_unavailable_reason: null,
    retryable: lifecycle?.retryable === true,
  };
}

const INCOMPLETE_PUBLIC_SYNTHESIS_LIFECYCLE_STATUSES = new Set([
  'pending',
  'in_progress',
  'retryable_failure',
]);

function latestIndexStaleIncompleteLifecycleFilter() {
  return {
    enabled: boolEnv(
      'VH_RELAY_NEWS_INDEX_HIDE_STALE_INCOMPLETE_LIFECYCLE',
      process.env.NODE_ENV === 'production',
    ),
    staleWindowMs: numberEnv(
      'VH_RELAY_NEWS_INDEX_INCOMPLETE_LIFECYCLE_STALE_MS',
      numberEnv('VH_PUBLIC_FEED_SYNTHESIS_PENDING_STALE_MS', 7 * 24 * 60 * 60 * 1000),
    ),
    now: Date.now(),
  };
}

function staleIncompleteLifecycleExclusion(entry, filter) {
  if (!filter?.enabled) return null;
  const story = entry?.story;
  const storyState = entry?.storyState;
  const storyId = String(entry?.entry?.[0] ?? story?.story_id ?? '').trim();
  if (!storyId || !story || !storyState || typeof storyState !== 'object') return null;
  const lifecycleStatus = String(storyState.lifecycle_status ?? '').trim();
  if (!INCOMPLETE_PUBLIC_SYNTHESIS_LIFECYCLE_STATUSES.has(lifecycleStatus)) return null;
  const lifecycleUpdatedAt = Number(storyState.lifecycle_updated_at);
  const latestActivityAt = latestIndexRecordTimestamp(entry.entry?.[1])
    ?? resolveLatestActivityFromStory(story)
    ?? null;
  const base = {
    story_id: storyId,
    latest_activity_at: latestActivityAt,
    lifecycle_status: lifecycleStatus,
    lifecycle_updated_at: Number.isFinite(lifecycleUpdatedAt) ? lifecycleUpdatedAt : null,
    stale_window_ms: filter.staleWindowMs,
  };
  if (!Number.isFinite(lifecycleUpdatedAt) || lifecycleUpdatedAt <= 0) {
    return {
      ...base,
      reason: 'synthesis_lifecycle_incomplete_missing_updated_at',
    };
  }
  const ageMs = Math.max(0, Math.floor(filter.now - lifecycleUpdatedAt));
  if (ageMs > filter.staleWindowMs) {
    return {
      ...base,
      reason: 'synthesis_lifecycle_incomplete_stale',
      lifecycle_age_ms: ageMs,
    };
  }
  return null;
}

function hideStaleIncompleteLifecycleEntry(entry, filter) {
  const exclusion = staleIncompleteLifecycleExclusion(entry, filter);
  return exclusion ? { excluded: exclusion } : entry;
}

function exclusionReasonCounts(records) {
  return records.reduce((acc, record) => {
    const reason = String(record?.reason ?? 'unknown');
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
}

function latestIndexPageNextCursor(pageEntries, hasMoreVisibleEntries) {
  if (!hasMoreVisibleEntries) return null;
  return pageEntries
    .map((entry) => latestIndexRecordTimestamp(entry.entry?.[1]))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b)[0] ?? null;
}

function createFeedCompositionAccumulator(now = Date.now()) {
  return {
    total_visible: 0,
    singleton_visible: 0,
    multi_source_visible: 0,
    pending_synthesis: 0,
    synthesis_loading: 0,
    accepted_synthesis_available: 0,
    terminal_unavailable: 0,
    accepted_synthesis_suppressed: 0,
    frame_table_ready: 0,
    frame_table_unavailable: 0,
    source_count_total: 0,
    average_source_count: 0,
    max_source_count: 0,
    latest_activity_at: null,
    freshness_age_ms: null,
    now_ms: now,
  };
}

function accumulateFeedComposition(composition, story, record, state) {
  const sourceCount = storySourceCount(story);
  const latestActivityAt = Number(record?.latest_activity_at ?? resolveLatestActivityFromStory(story) ?? 0);
  composition.total_visible += 1;
  if (sourceCount <= 1) composition.singleton_visible += 1;
  else composition.multi_source_visible += 1;
  composition.source_count_total += sourceCount;
  composition.max_source_count = Math.max(composition.max_source_count, sourceCount);
  if (state.synthesis_state === 'synthesis_pending') composition.pending_synthesis += 1;
  if (state.synthesis_state === 'synthesis_loading') composition.synthesis_loading += 1;
  if (state.synthesis_state === 'accepted_synthesis_available') composition.accepted_synthesis_available += 1;
  if (state.synthesis_state === 'synthesis_terminal_unavailable') composition.terminal_unavailable += 1;
  if (state.synthesis_state === 'accepted_synthesis_suppressed') composition.accepted_synthesis_suppressed += 1;
  if (state.frame_table_state === 'frame_table_ready') composition.frame_table_ready += 1;
  if (state.frame_table_state === 'frame_table_unavailable') composition.frame_table_unavailable += 1;
  if (Number.isFinite(latestActivityAt) && latestActivityAt > 0) {
    composition.latest_activity_at = Math.max(composition.latest_activity_at ?? 0, Math.floor(latestActivityAt));
  }
}

function finalizeFeedComposition(composition) {
  if (composition.total_visible > 0) {
    composition.average_source_count = Number((composition.source_count_total / composition.total_visible).toFixed(3));
  }
  if (composition.latest_activity_at !== null) {
    composition.freshness_age_ms = Math.max(0, composition.now_ms - composition.latest_activity_at);
  }
  delete composition.source_count_total;
  return composition;
}

function feedCompositionForEntries(entries, now = Date.now()) {
  const composition = createFeedCompositionAccumulator(now);
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.story && entry?.storyState) {
      accumulateFeedComposition(composition, entry.story, entry.entry?.[1], entry.storyState);
    }
  }
  return finalizeFeedComposition(composition);
}

function addFeedCompositionWindowFields(composition, {
  organicEntries = [],
  scanWindowEntries = [],
  backfillRecords = [],
  now = Date.now(),
} = {}) {
  const organicComposition = feedCompositionForEntries(organicEntries, now);
  const scanWindowComposition = feedCompositionForEntries(scanWindowEntries, now);
  const backfillStoryIds = (Array.isArray(backfillRecords) ? backfillRecords : [])
    .map((record) => String(record?.story_id ?? '').trim())
    .filter(Boolean);
  return {
    ...composition,
    organic_selected_count: Array.isArray(organicEntries) ? organicEntries.length : 0,
    organic_singleton_visible: organicComposition.singleton_visible,
    organic_multi_source_visible: organicComposition.multi_source_visible,
    scan_window_selected_count: Array.isArray(scanWindowEntries) ? scanWindowEntries.length : 0,
    scan_window_singleton_visible: scanWindowComposition.singleton_visible,
    scan_window_multi_source_visible: scanWindowComposition.multi_source_visible,
    backfill_used: backfillStoryIds.length > 0,
    backfill_story_ids: backfillStoryIds,
  };
}

function synthesizeLatestIndexRecordFromStory(storyId, story, fallbackPriority) {
  const latestActivityAt = resolveLatestActivityFromStory(story) ?? Math.max(0, Math.floor(fallbackPriority || 0));
  const sourceCount = Array.isArray(story?.sources) ? story.sources.length : 0;
  const canonicalSourceCount = Array.isArray(story?.primary_sources)
    ? story.primary_sources.length
    : sourceCount;
  return {
    story_id: storyId,
    latest_activity_at: latestActivityAt,
    product_state_schema_version: 'vh-news-product-feed-index-v1',
    topic_id: typeof story?.topic_id === 'string' ? story.topic_id : null,
    source_set_revision: typeof story?.provenance_hash === 'string' ? story.provenance_hash : null,
    source_count: sourceCount,
    canonical_source_count: canonicalSourceCount,
    story_created_at: Number.isFinite(Number(story?.created_at)) ? Math.max(0, Math.floor(Number(story.created_at))) : null,
    cluster_window_start: Number.isFinite(Number(story?.cluster_window_start))
      ? Math.max(0, Math.floor(Number(story.cluster_window_start)))
      : null,
  };
}

const RELAY_HOTNESS_ROUNDING_SCALE = 1_000_000;
const RELAY_HOTNESS_MS_PER_HOUR = 3_600_000;
const RELAY_HOTNESS_CONFIG = {
  decayHalfLifeHours: 8,
  breakingWindowHours: 3,
  breakingVelocityBoost: 0.75,
  weights: {
    coverage: 0.32,
    velocity: 0.38,
    confidence: 0.12,
    sourceDiversity: 0.08,
    freshness: 0.1,
  },
};

function relayClamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function relayNormalizeUnitInterval(value, fallback) {
  return typeof value === 'number' ? relayClamp01(value) : relayClamp01(fallback);
}

function relaySourceDiversityScore(sourceCount) {
  if (!Number.isFinite(sourceCount) || sourceCount <= 0) return 0;
  return relayClamp01(Math.log1p(sourceCount) / Math.log(8));
}

function computeRelayStoryHotness(story, nowMs = Date.now()) {
  const latestActivityAt = Math.max(0, Math.floor(Number(story?.cluster_window_end) || 0));
  const normalizedNow = Number.isFinite(nowMs) && nowMs >= 0 ? Math.floor(nowMs) : latestActivityAt;
  const ageHours = Math.max(0, normalizedNow - latestActivityAt) / RELAY_HOTNESS_MS_PER_HOUR;
  const freshness = Math.pow(2, -ageHours / Math.max(0.25, RELAY_HOTNESS_CONFIG.decayHalfLifeHours));
  const features = story?.cluster_features && typeof story.cluster_features === 'object'
    ? story.cluster_features
    : {};
  const coverage = relayNormalizeUnitInterval(features.coverage_score, 0.35);
  const velocity = relayNormalizeUnitInterval(features.velocity_score, 0.2);
  const confidence = relayNormalizeUnitInterval(features.confidence_score, 0.5);
  const sourceDiversity = relaySourceDiversityScore(Array.isArray(story?.sources) ? story.sources.length : 0);
  const weightedBase =
    RELAY_HOTNESS_CONFIG.weights.coverage * coverage +
    RELAY_HOTNESS_CONFIG.weights.velocity * velocity +
    RELAY_HOTNESS_CONFIG.weights.confidence * confidence +
    RELAY_HOTNESS_CONFIG.weights.sourceDiversity * sourceDiversity +
    RELAY_HOTNESS_CONFIG.weights.freshness * freshness;
  const breakingMultiplier = ageHours <= Math.max(0, RELAY_HOTNESS_CONFIG.breakingWindowHours)
    ? 1 + Math.max(0, RELAY_HOTNESS_CONFIG.breakingVelocityBoost) * velocity
    : 1;
  return Math.round(Math.max(0, weightedBase * breakingMultiplier) * RELAY_HOTNESS_ROUNDING_SCALE)
    / RELAY_HOTNESS_ROUNDING_SCALE;
}

function synthesizeHotIndexRecordFromStory(storyId, story) {
  const latestMetadata = synthesizeLatestIndexRecordFromStory(storyId, story, resolveLatestActivityFromStory(story));
  const { latest_activity_at: _latestActivityAt, ...productMetadata } = latestMetadata;
  return {
    story_id: storyId,
    hotness: computeRelayStoryHotness(story),
    ...productMetadata,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }));
  return results;
}

async function readLinkedGunRecord(gun, value, timeoutMs) {
  const soul = gunLinkSoul(value);
  if (!soul) return value;
  const linked = stripGunMetadata(await readOnce(gun.get(soul), timeoutMs));
  return linked !== null && linked !== undefined ? linked : value;
}

async function readNewsLatestIndexRecord(gun, storyId, timeoutMs = 1_500) {
  const indexChain = gun.get('vh').get('news').get('index').get('latest');
  const raw = stripGunMetadata(await readOnce(indexChain.get(storyId), timeoutMs));
  const record = stripGunMetadata(await readLinkedGunRecord(gun, raw, timeoutMs));
  if (!record || typeof record !== 'object') return null;
  const recordStoryId = typeof record.story_id === 'string' ? record.story_id.trim() : '';
  const latestActivityAt = Number(record.latest_activity_at);
  if (recordStoryId === storyId && Number.isFinite(latestActivityAt) && latestActivityAt >= 0) {
    return record;
  }
  return null;
}

async function readNewsHotIndexRecord(gun, storyId, timeoutMs = 1_500) {
  const indexChain = gun.get('vh').get('news').get('index').get('hot');
  const raw = stripGunMetadata(await readOnce(indexChain.get(storyId), timeoutMs));
  const record = stripGunMetadata(await readLinkedGunRecord(gun, raw, timeoutMs));
  if (!record || typeof record !== 'object') return null;
  const recordStoryId = typeof record.story_id === 'string' ? record.story_id.trim() : '';
  const hotness = Number(record.hotness);
  if (recordStoryId === storyId && Number.isFinite(hotness) && hotness >= 0) {
    return record;
  }
  return null;
}

async function pollNewsLatestIndexBack(gun, storyId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readNewsLatestIndexRecord(gun, storyId, 1_500);
    if (latest) return latest;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return latest;
}

async function pollNewsHotIndexBack(gun, storyId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let hot = null;
  while (Date.now() < deadline) {
    hot = await readNewsHotIndexRecord(gun, storyId, 1_500);
    if (hot) return hot;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return hot;
}

async function readIndexMapSnapshots(indexChain, timeoutMs, maxKeys) {
  return new Promise((resolve) => {
    const snapshots = {};
    let mapped = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        mapped?.off?.();
      } catch {
        // Best-effort cleanup for Gun map listeners.
      }
      resolve(snapshots);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      mapped = indexChain.map();
      mapped.on((value, key) => {
        if (settled || typeof key !== 'string' || key === '_' || !key.trim()) {
          return;
        }
        const clean = stripGunMetadata(value);
        if (clean !== null && clean !== undefined) {
          snapshots[key] = clean;
        }
        if (Object.keys(snapshots).length >= maxKeys) {
          clearTimeout(timer);
          finish();
        }
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

async function readNewsLatestIndexRecords(gun, options = {}) {
  const indexChain = gun.get('vh').get('news').get('index').get('latest');
  const rootTimeoutMs = numberEnv('VH_RELAY_NEWS_INDEX_REST_ROOT_TIMEOUT_MS', 2_000);
  const childTimeoutMs = numberEnv('VH_RELAY_NEWS_INDEX_REST_CHILD_TIMEOUT_MS', 750);
  const storyTimeoutMs = numberEnv('VH_RELAY_NEWS_INDEX_STORY_REST_READ_TIMEOUT_MS', 2_500);
  const maxRecords = Math.min(
    numberEnv('VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS', 80),
    positiveInteger(options.limit, numberEnv('VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS', 80)),
  );
  const consistencyFilter = options.consistencyFilter !== false
    && boolEnv('VH_RELAY_NEWS_INDEX_REST_CONSISTENCY_FILTER', true);
  const mapFallbackEnabled = boolEnv('VH_RELAY_NEWS_INDEX_REST_MAP_FALLBACK', consistencyFilter);
  const storyFallbackEnabled = boolEnv('VH_RELAY_NEWS_INDEX_REST_STORY_FALLBACK', false);
  const concurrency = numberEnv('VH_RELAY_NEWS_INDEX_REST_CONCURRENCY', 32);
  const beforeCursor = options.before === undefined || options.before === null || String(options.before).trim() === ''
    ? Number.NaN
    : Number(options.before);
  const hasBeforeCursor = Number.isFinite(beforeCursor) && beforeCursor >= 0;
  const rawRoot = await readOnce(indexChain, rootTimeoutMs);
  const requestedScanLimit = consistencyFilter
    ? positiveInteger(
      options.scanLimit,
      numberEnv('VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS', Math.max(maxRecords * 4, maxRecords)),
    )
    : maxRecords;
  const rootKeys = extractIndexChildKeys(rawRoot);
  const mapSnapshots = rootKeys.length === 0 && mapFallbackEnabled
    ? await readIndexMapSnapshots(indexChain, childTimeoutMs, requestedScanLimit)
    : {};
  const readableRoot = Object.keys(mapSnapshots).length > 0
    ? {
      ...(rawRoot && typeof rawRoot === 'object' ? stripGunMetadata(rawRoot) : {}),
      ...mapSnapshots,
    }
    : rawRoot;
  const latestSourceKeys = extractIndexChildKeys(readableRoot);
  let storyFallbackKeys = [];
  if (consistencyFilter && storyFallbackEnabled && (latestSourceKeys.length === 0 || hasBeforeCursor)) {
    const storyRootChain = gun.get('vh').get('news').get('stories');
    const rawStoryRoot = await readOnce(storyRootChain, rootTimeoutMs).catch(() => null);
    const storyRootKeys = extractIndexChildKeys(rawStoryRoot);
    const storyMapSnapshots = storyRootKeys.length === 0
      ? await readIndexMapSnapshots(storyRootChain, childTimeoutMs, requestedScanLimit)
      : {};
    const readableStoryRoot = Object.keys(storyMapSnapshots).length > 0
      ? {
        ...(rawStoryRoot && typeof rawStoryRoot === 'object' ? stripGunMetadata(rawStoryRoot) : {}),
        ...storyMapSnapshots,
      }
      : rawStoryRoot;
    storyFallbackKeys = extractIndexChildKeys(readableStoryRoot);
  }
  const sourceKeys = Array.from(new Set([...latestSourceKeys, ...storyFallbackKeys]));
  const scanSourceKeys = !consistencyFilter && hasBeforeCursor
    ? sourceKeys.filter((storyId) => indexEntryPriority(readableRoot, storyId) < beforeCursor)
    : sourceKeys;
  const scanLimit = requestedScanLimit;
  const keys = scanSourceKeys.slice(0, Math.min(scanSourceKeys.length, scanLimit));
  const records = {};
  const stories = {};
  const storyStates = {};
  const excludedRecords = [];
  const repairedRecords = [];
  const compositionNow = Date.now();
  const composition = createFeedCompositionAccumulator(compositionNow);
  const staleIncompleteFilter = latestIndexStaleIncompleteLifecycleFilter();
  staleIncompleteFilter.now = compositionNow;
  const entries = await mapWithConcurrency(keys, concurrency, async (storyId) => {
    const direct = readableRoot && typeof readableRoot === 'object' && storyId in readableRoot
      ? stripGunMetadata(readableRoot[storyId])
      : null;
    const child = await readLinkedGunRecord(
      gun,
      stripGunMetadata(await readOnce(indexChain.get(storyId), childTimeoutMs)),
      childTimeoutMs,
    );
    const record = child !== null && child !== undefined
      ? child
      : direct !== null && direct !== undefined
        ? await readLinkedGunRecord(gun, direct, childTimeoutMs)
        : null;

    if (!consistencyFilter) {
      return record !== null && record !== undefined ? [storyId, record] : null;
    }

    const storyResult = await readNewsStoryRecord(gun, storyId, { timeoutMs: storyTimeoutMs });
    if (!storyResult) {
      return {
        excluded: {
          story_id: storyId,
          reason: 'story_body_missing',
          latest_activity_at: latestIndexRecordTimestamp(record) ?? indexEntryPriority(readableRoot, storyId) ?? null,
        },
      };
    }
    const fallbackLatestActivityAt = latestIndexRecordTimestamp(record) ?? indexEntryPriority(readableRoot, storyId);

    const [synthesisResult, initialLifecycle] = await Promise.all([
      readTopicLatestSynthesisRecord(gun, storyResult.story.topic_id).catch(() => null),
      readNewsSynthesisLifecycleRecord(gun, storyId).catch(() => null),
    ]);
    const lifecycle = await refreshPotentiallyStaleLifecycleRecord(
      gun,
      storyResult.story,
      synthesisResult?.synthesis,
      initialLifecycle,
    );
    const storyState = derivePublicFeedStoryState(storyResult.story, synthesisResult?.synthesis, lifecycle);

    if (record !== null && record !== undefined && latestIndexRecordHasTimestamp(record)) {
      const metadataStatus = latestIndexProductMetadataStatus(record, storyResult.story);
      if (metadataStatus === 'complete') {
        return hideStaleIncompleteLifecycleEntry(
          { entry: [storyId, record], story: storyResult.story, storyState },
          staleIncompleteFilter,
        );
      }
      const synthesized = synthesizeLatestIndexRecordFromStory(
        storyId,
        storyResult.story,
        fallbackLatestActivityAt,
      );
      return {
        ...hideStaleIncompleteLifecycleEntry(
          { entry: [storyId, synthesized], story: storyResult.story, storyState },
          staleIncompleteFilter,
        ),
        repaired: {
          story_id: storyId,
          reason: `latest_index_product_metadata_${metadataStatus}_from_story_body`,
          latest_activity_at: synthesized.latest_activity_at,
        },
      };
    }

    const synthesized = synthesizeLatestIndexRecordFromStory(
      storyId,
      storyResult.story,
      fallbackLatestActivityAt,
    );
    return {
      ...hideStaleIncompleteLifecycleEntry(
        { entry: [storyId, synthesized], story: storyResult.story, storyState },
        staleIncompleteFilter,
      ),
      repaired: {
        story_id: storyId,
        reason: record === null || record === undefined
          ? 'latest_index_record_missing_from_story_body'
          : isGunLinkRecord(record)
            ? 'latest_index_record_unresolved_link_from_story_body'
            : 'latest_index_record_timestamp_missing_from_story_body',
        latest_activity_at: synthesized.latest_activity_at,
      },
    };
  });
  const visibleEntries = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (Array.isArray(entry)) {
      const timestamp = latestIndexRecordTimestamp(entry[1]);
      if (hasBeforeCursor && (!Number.isFinite(timestamp) || timestamp >= beforeCursor)) continue;
      visibleEntries.push({ entry, story: null, storyState: null });
      continue;
    }
    if (entry.excluded) {
      const excludedTimestamp = Number(entry.excluded.latest_activity_at);
      if (hasBeforeCursor && (!Number.isFinite(excludedTimestamp) || excludedTimestamp >= beforeCursor)) continue;
      excludedRecords.push(entry.excluded);
      continue;
    }
    if (entry.repaired) {
      repairedRecords.push(entry.repaired);
    }
    if (entry.entry) {
      const timestamp = latestIndexRecordTimestamp(entry.entry[1]);
      if (hasBeforeCursor && (!Number.isFinite(timestamp) || timestamp >= beforeCursor)) continue;
      visibleEntries.push(entry);
    }
  }
  visibleEntries.sort((left, right) => {
    const leftTimestamp = latestIndexRecordTimestamp(left.entry?.[1]) ?? 0;
    const rightTimestamp = latestIndexRecordTimestamp(right.entry?.[1]) ?? 0;
    return rightTimestamp - leftTimestamp || String(left.entry?.[0] ?? '').localeCompare(String(right.entry?.[0] ?? ''));
  });
  const chronologicalPageEntries = visibleEntries.slice(0, maxRecords);
  const selectedEntries = [...chronologicalPageEntries];
  const compositionBackfillRecords = [];
  const compositionBackfillMinLimit = positiveInteger(
    options.compositionBackfillMinLimit,
    numberEnv('VH_RELAY_NEWS_INDEX_COMPOSITION_BACKFILL_MIN_LIMIT', 12),
  );
  const shouldBackfillCorroboratedStory =
    consistencyFilter
    && !hasBeforeCursor
    && maxRecords >= compositionBackfillMinLimit
    && selectedEntries.length > 0
    && selectedEntries.every((entry) => storySourceCount(entry.story) <= 1);
  if (shouldBackfillCorroboratedStory) {
    const selectedStoryIds = new Set(selectedEntries.map((entry) => String(entry.entry?.[0] ?? '')));
    const corroboratedBackfill = visibleEntries.find((entry) =>
      !selectedStoryIds.has(String(entry.entry?.[0] ?? ''))
      && storySourceCount(entry.story) > 1);
    if (corroboratedBackfill) {
      selectedEntries.push(corroboratedBackfill);
      compositionBackfillRecords.push({
        story_id: corroboratedBackfill.entry[0],
        reason: 'freshest_visible_corroborated_story_backfilled_for_mixed_feed_window',
        source_count: storySourceCount(corroboratedBackfill.story),
        latest_activity_at: latestIndexRecordTimestamp(corroboratedBackfill.entry[1]) ?? null,
      });
    }
  }
  for (const entry of selectedEntries) {
    records[entry.entry[0]] = entry.entry[1];
    if (entry.story) {
      stories[entry.entry[0]] = entry.story;
    }
    if (entry.story && entry.storyState) {
      storyStates[entry.entry[0]] = entry.storyState;
      accumulateFeedComposition(composition, entry.story, entry.entry[1], entry.storyState);
    }
  }
  const truncated = scanSourceKeys.length > keys.length || visibleEntries.length > chronologicalPageEntries.length;
  return {
    root: options.includeRoot ? stripGunMetadata(rawRoot) || {} : undefined,
    sourceKeyCount: sourceKeys.length,
    windowSourceKeyCount: !consistencyFilter && hasBeforeCursor
      ? scanSourceKeys.length
      : hasBeforeCursor
        ? visibleEntries.length + excludedRecords.length
        : sourceKeys.length,
    scannedKeyCount: keys.length,
    truncated,
    before: hasBeforeCursor ? Math.floor(beforeCursor) : null,
    nextCursor: latestIndexPageNextCursor(chronologicalPageEntries, truncated),
    consistency: {
      enabled: consistencyFilter,
      mode: consistencyFilter ? 'relay_visible_filter' : 'disabled',
      scan_limit: keys.length,
      excluded_count: excludedRecords.length,
      excluded_reason_counts: exclusionReasonCounts(excludedRecords),
      repaired_count: repairedRecords.length,
      story_body_timeout_ms: consistencyFilter ? storyTimeoutMs : null,
      latest_index_source_key_count: latestSourceKeys.length,
      story_fallback_enabled: Boolean(consistencyFilter && storyFallbackEnabled),
      story_fallback_key_count: storyFallbackKeys.length,
      stale_incomplete_lifecycle_filter: {
        enabled: Boolean(staleIncompleteFilter.enabled),
        stale_window_ms: staleIncompleteFilter.staleWindowMs,
      },
      composition_backfill_min_limit: compositionBackfillMinLimit,
    },
    composition: addFeedCompositionWindowFields(finalizeFeedComposition(composition), {
      organicEntries: chronologicalPageEntries,
      scanWindowEntries: visibleEntries,
      backfillRecords: compositionBackfillRecords,
      now: compositionNow,
    }),
    storyStates,
    excludedRecords,
    repairedRecords,
    compositionBackfillRecords,
    records,
    stories,
    snapshotEntries: visibleEntries,
  };
}

function latestIndexParsedBefore(options = {}) {
  const beforeValue = options.before === undefined || options.before === null || String(options.before).trim() === ''
    ? null
    : Number(options.before);
  return Number.isFinite(beforeValue) && beforeValue >= 0 ? Math.floor(beforeValue) : null;
}

function latestIndexRestCacheKey(options = {}) {
  return JSON.stringify({
    limit: options.limit ?? null,
    includeRoot: Boolean(options.includeRoot),
    includeExcluded: Boolean(options.includeExcluded),
    consistencyFilter: options.consistencyFilter === false ? false : true,
    scanLimit: options.scanLimit ?? null,
    compositionBackfillMinLimit: options.compositionBackfillMinLimit ?? null,
    before: latestIndexParsedBefore(options),
  });
}

function latestIndexSnapshotCacheKey(options = {}) {
  return JSON.stringify({
    consistencyFilter: options.consistencyFilter === false ? false : true,
  });
}

function serializeNewsLatestIndexSnapshot(snapshotKey, snapshot) {
  return {
    schema_version: 'vh-news-latest-index-relay-snapshot-v1',
    snapshot_key: snapshotKey,
    cached_at: snapshot.cached_at,
    source_key_count: snapshot.sourceKeyCount,
    scanned_key_count: snapshot.scannedKeyCount,
    consistency: snapshot.consistency,
    repaired_records: snapshot.repairedRecords,
    entries: (Array.isArray(snapshot.entries) ? snapshot.entries : []).map((entry) => ({
      story_id: String(entry.entry?.[0] ?? ''),
      record: entry.entry?.[1] ?? null,
      story: entry.story ?? null,
      story_state: entry.storyState ?? null,
    })).filter((entry) => entry.story_id && entry.record && entry.story),
  };
}

function deserializeNewsLatestIndexSnapshot(value) {
  if (!value || typeof value !== 'object' || value.schema_version !== 'vh-news-latest-index-relay-snapshot-v1') {
    return null;
  }
  if (!Array.isArray(value.entries) || typeof value.snapshot_key !== 'string') return null;
  return {
    snapshotKey: value.snapshot_key,
    snapshot: {
      cached_at: Number(value.cached_at) || 0,
      sourceKeyCount: Number(value.source_key_count) || value.entries.length,
      scannedKeyCount: Number(value.scanned_key_count) || value.entries.length,
      consistency: value.consistency && typeof value.consistency === 'object' ? value.consistency : {},
      repairedRecords: Array.isArray(value.repaired_records) ? value.repaired_records : [],
      entries: value.entries
        .filter((entry) => entry && typeof entry.story_id === 'string' && entry.record && entry.story)
        .map((entry) => ({
          entry: [entry.story_id, entry.record],
          story: entry.story,
          storyState: entry.story_state ?? null,
        })),
    },
  };
}

function persistNewsLatestIndexSnapshot(snapshotKey, snapshot) {
  if (!newsLatestIndexSnapshotFile) return;
  try {
    const boundedSnapshot = boundNewsLatestIndexSnapshot(snapshot, { countEvictions: false });
    fs.mkdirSync(path.dirname(newsLatestIndexSnapshotFile), { recursive: true });
    const tmpFile = `${newsLatestIndexSnapshotFile}.tmp`;
    fs.writeFileSync(
      tmpFile,
      `${JSON.stringify(serializeNewsLatestIndexSnapshot(snapshotKey, boundedSnapshot))}\n`,
    );
    fs.renameSync(tmpFile, newsLatestIndexSnapshotFile);
  } catch (error) {
    logEvent('warn', 'news_latest_index_snapshot_persist_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function readPersistedNewsLatestIndexSnapshot(snapshotKey, cacheTtlMs) {
  if (!newsLatestIndexSnapshotFile) return null;
  try {
    if (!fs.existsSync(newsLatestIndexSnapshotFile)) return null;
    const parsed = deserializeNewsLatestIndexSnapshot(
      JSON.parse(fs.readFileSync(newsLatestIndexSnapshotFile, 'utf8')),
    );
    if (!parsed || parsed.snapshotKey !== snapshotKey) return null;
    if (cacheTtlMs > 0 && Date.now() - parsed.snapshot.cached_at > cacheTtlMs) return null;
    return setNewsLatestIndexSnapshotCache(snapshotKey, parsed.snapshot, { countEvictions: false });
  } catch (error) {
    logEvent('warn', 'news_latest_index_snapshot_read_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function newsLatestIndexSnapshotAgeMs(snapshot) {
  const cachedAt = Number(snapshot?.cached_at);
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return null;
  return Math.max(0, Date.now() - cachedAt);
}

function newsLatestIndexSnapshotHasEntries(snapshot) {
  return Array.isArray(snapshot?.entries) && snapshot.entries.length > 0;
}

function newsLatestIndexSnapshotIsFresh(snapshot, maxAgeMs) {
  if (!newsLatestIndexSnapshotHasEntries(snapshot)) return false;
  if (maxAgeMs <= 0) return true;
  const ageMs = newsLatestIndexSnapshotAgeMs(snapshot);
  return Number.isFinite(ageMs) && ageMs <= maxAgeMs;
}

function newsLatestIndexSnapshotIsStale(snapshot, maxAgeMs) {
  if (!newsLatestIndexSnapshotHasEntries(snapshot) || maxAgeMs <= 0) return false;
  const ageMs = newsLatestIndexSnapshotAgeMs(snapshot);
  return Number.isFinite(ageMs) && ageMs > maxAgeMs;
}

function emptyNewsLatestIndexSnapshot() {
  return {
    cached_at: 0,
    sourceKeyCount: 0,
    scannedKeyCount: 0,
    consistency: {},
    repairedRecords: [],
    entries: [],
  };
}

function storyFromNewsStoryWriteRecord(record, storyId) {
  if (!record || typeof record !== 'object') return null;
  const story = parseStoryBundleEnvelope(record.__story_bundle_json);
  return story?.story_id === storyId ? story : null;
}

function deriveSnapshotStoryStateFromLifecycle(story, lifecycle) {
  if (!story || !lifecycle || typeof lifecycle !== 'object') {
    return story ? derivePublicFeedStoryState(story, null, null) : null;
  }
  const revisionMatches = typeof story.provenance_hash === 'string'
    && story.provenance_hash.trim()
    && lifecycle.source_set_revision === story.provenance_hash;
  if (
    lifecycle.status === 'accepted_available'
    && revisionMatches
    && typeof lifecycle.synthesis_id === 'string'
    && lifecycle.synthesis_id.trim()
  ) {
    return {
      synthesis_state: 'accepted_synthesis_available',
      frame_table_state: lifecycle.frame_table_state === 'frame_table_ready'
        ? 'frame_table_ready'
        : 'frame_table_unavailable',
      synthesis_id: lifecycle.synthesis_id,
      epoch: Number.isFinite(lifecycle.epoch) ? lifecycle.epoch : null,
      lifecycle_status: lifecycle.status,
      ...lifecycleStateFields(lifecycle),
      terminal_unavailable_reason: null,
      retryable: false,
    };
  }
  return derivePublicFeedStoryState(story, null, lifecycle);
}

async function upsertNewsLatestIndexSnapshotFromWrite(gun, {
  storyId,
  latestRecord = null,
  storyRecord = null,
  lifecycleRecord = null,
  reason = 'news_write',
} = {}) {
  const normalizedStoryId = typeof storyId === 'string' ? storyId.trim() : '';
  if (!normalizedStoryId) return false;
  try {
    const snapshotKey = latestIndexSnapshotCacheKey({ consistencyFilter: true });
    const existingSnapshot = newsLatestIndexSnapshotCache.get(snapshotKey)
      ?? readPersistedNewsLatestIndexSnapshot(snapshotKey, 0)
      ?? emptyNewsLatestIndexSnapshot();
    const entries = Array.isArray(existingSnapshot.entries) ? [...existingSnapshot.entries] : [];
    const existingIndex = entries.findIndex((entry) =>
      String(entry?.entry?.[0] ?? entry?.story?.story_id ?? '').trim() === normalizedStoryId);
    const existingEntry = existingIndex >= 0
      ? entries[existingIndex]
      : { entry: [normalizedStoryId, null], story: null, storyState: null };
    const readTimeoutMs = numberEnv('VH_RELAY_NEWS_INDEX_SNAPSHOT_WRITE_THROUGH_READ_TIMEOUT_MS', 500);
    let nextRecord = latestRecord && typeof latestRecord === 'object'
      ? latestRecord
      : existingEntry.entry?.[1] ?? null;
    let nextStory = storyFromNewsStoryWriteRecord(storyRecord, normalizedStoryId)
      ?? existingEntry.story
      ?? null;

    if (!nextStory && gun) {
      const storyResult = await readNewsStoryRecord(gun, normalizedStoryId, {
        timeoutMs: readTimeoutMs,
        allowSnapshotFallback: false,
      }).catch(() => null);
      nextStory = storyResult?.story ?? null;
    }
    if (!nextRecord && gun) {
      nextRecord = await readNewsLatestIndexRecord(gun, normalizedStoryId, readTimeoutMs).catch(() => null);
    }

    let nextStoryState = existingEntry.storyState ?? null;
    if (nextStory && lifecycleRecord) {
      nextStoryState = deriveSnapshotStoryStateFromLifecycle(nextStory, lifecycleRecord);
    } else if (nextStory && !nextStoryState) {
      nextStoryState = deriveSnapshotStoryStateFromLifecycle(nextStory, null);
    }

    if (!nextRecord && !nextStory && !nextStoryState) return false;

    const nextEntry = {
      entry: [normalizedStoryId, nextRecord],
      story: nextStory,
      storyState: nextStoryState,
    };
    if (existingIndex >= 0) {
      entries[existingIndex] = nextEntry;
    } else {
      entries.push(nextEntry);
    }

    const completeEntryCount = entries.filter((entry) => entry?.entry?.[1] && entry?.story).length;
    const now = Date.now();
    const snapshot = {
      cached_at: now,
      entries,
      sourceKeyCount: Math.max(Number(existingSnapshot.sourceKeyCount) || 0, completeEntryCount),
      scannedKeyCount: Math.max(Number(existingSnapshot.scannedKeyCount) || 0, completeEntryCount),
      consistency: {
        ...(existingSnapshot.consistency ?? {}),
        latest_index_write_through: {
          story_id: normalizedStoryId,
          updated_at: now,
          reason,
          has_record: Boolean(nextRecord),
          has_story: Boolean(nextStory),
          has_story_state: Boolean(nextStoryState),
        },
      },
      repairedRecords: Array.isArray(existingSnapshot.repairedRecords)
        ? existingSnapshot.repairedRecords
        : [],
    };
    const boundedSnapshot = setNewsLatestIndexSnapshotCache(snapshotKey, snapshot);
    if (nextStory) {
      setSnapshotStoryBodyCache(normalizedStoryId, nextStory, now);
    }
    newsLatestIndexRestCache.clear();
    persistNewsLatestIndexSnapshot(snapshotKey, boundedSnapshot);
    return true;
  } catch (error) {
    logEvent('warn', 'news_latest_index_snapshot_write_through_failed', {
      story_id: normalizedStoryId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function readNewsStoryRecordFromLatestIndexSnapshot(storyId) {
  const normalizedStoryId = typeof storyId === 'string' ? storyId.trim() : '';
  if (!normalizedStoryId) return null;
  const cacheTtlMs = Math.max(
    0,
    numberEnv(
      'VH_RELAY_NEWS_STORY_SNAPSHOT_FALLBACK_TTL_MS',
      numberEnv('VH_RELAY_NEWS_INDEX_REST_EMPTY_CACHE_TTL_MS', 5 * 60_000),
    ),
  );
  const snapshotKey = latestIndexSnapshotCacheKey({ consistencyFilter: true });
  const snapshot = newsLatestIndexSnapshotCache.get(snapshotKey)
    ?? readPersistedNewsLatestIndexSnapshot(snapshotKey, cacheTtlMs);
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  const matched = entries.find((entry) =>
    String(entry?.entry?.[0] ?? entry?.story?.story_id ?? '').trim() === normalizedStoryId
    && entry?.story?.story_id === normalizedStoryId);
  if (!matched?.story) return null;
  const story = parseStoryBundleEnvelope(JSON.stringify(matched.story));
  if (!story || story.story_id !== normalizedStoryId) return null;
  return {
    record: {
      story_id: normalizedStoryId,
      __story_bundle_json: JSON.stringify(story),
    },
    story,
    source: 'latest-index-snapshot',
  };
}

async function refreshSnapshotEntryStoryState(gun, entry) {
  if (!gun || !entry?.story || !entry?.entry?.[0]) {
    return { entry, refreshed: false };
  }
  const story = entry.story;
  const storyId = typeof story.story_id === 'string' && story.story_id.trim()
    ? story.story_id.trim()
    : String(entry.entry[0] ?? '').trim();
  if (!storyId || typeof story.topic_id !== 'string' || !story.topic_id.trim()) {
    return { entry, refreshed: false };
  }

  const fieldTimeoutMs = numberEnv('VH_RELAY_NEWS_LIFECYCLE_FIELD_REST_READ_TIMEOUT_MS', 250);
  const fieldLifecycle = await readNewsSynthesisLifecycleRecordFromFields(gun, storyId, { timeoutMs: fieldTimeoutMs })
    .catch(() => null);
  const initialLifecycle = fieldLifecycle
    ?? await readNewsSynthesisLifecycleRecord(gun, storyId).catch(() => null);
  if (!initialLifecycle) {
    return { entry, refreshed: false };
  }
  const lifecycleRevisionMatches = typeof story.provenance_hash === 'string'
    && story.provenance_hash.trim()
    && initialLifecycle.source_set_revision === story.provenance_hash;
  if (
    initialLifecycle.status === 'accepted_available'
    && lifecycleRevisionMatches
    && typeof initialLifecycle.synthesis_id === 'string'
    && initialLifecycle.synthesis_id.trim()
  ) {
    return {
      entry: {
        ...entry,
        storyState: {
          synthesis_state: 'accepted_synthesis_available',
          frame_table_state: initialLifecycle.frame_table_state === 'frame_table_ready'
            ? 'frame_table_ready'
            : 'frame_table_unavailable',
          synthesis_id: initialLifecycle.synthesis_id,
          epoch: Number.isFinite(initialLifecycle.epoch) ? initialLifecycle.epoch : null,
          lifecycle_status: initialLifecycle.status,
          ...lifecycleStateFields(initialLifecycle),
          terminal_unavailable_reason: null,
          retryable: false,
        },
      },
      refreshed: true,
    };
  }
  if (initialLifecycle.status !== 'accepted_available') {
    return {
      entry: {
        ...entry,
        storyState: derivePublicFeedStoryState(story, null, initialLifecycle),
      },
      refreshed: true,
    };
  }
  return {
    entry: {
      ...entry,
      storyState: derivePublicFeedStoryState(story, null, initialLifecycle),
    },
    refreshed: true,
  };
}

function shouldRefreshSnapshotEntryStoryState(entry) {
  if (entry?.story) {
    const stateRevision = typeof entry.storyState?.lifecycle_source_set_revision === 'string'
      ? entry.storyState.lifecycle_source_set_revision.trim()
      : '';
    const storyRevision = typeof entry.story.provenance_hash === 'string'
      ? entry.story.provenance_hash.trim()
      : '';
    if (
      !entry.storyState
      || !stateRevision
      || !Number.isFinite(entry.storyState.lifecycle_updated_at)
      || (storyRevision && stateRevision !== storyRevision)
    ) {
      return true;
    }
    return false;
  }
  const snapshotState = String(entry?.storyState?.synthesis_state ?? '').trim();
  if (snapshotState && snapshotState !== 'synthesis_pending') return true;
  return storySourceCount(entry?.story) > 1;
}

async function verifySnapshotStoryBodies(gun, entries) {
  const concurrency = cappedBackgroundConcurrency({
    operation: 'story_body_verify',
    envName: 'VH_RELAY_NEWS_INDEX_SNAPSHOT_STORY_VERIFY_CONCURRENCY',
    fallback: 4,
    maxEnvName: 'VH_RELAY_NEWS_INDEX_SNAPSHOT_STORY_VERIFY_MAX_CONCURRENCY',
    maxFallback: 2,
  });
  if (!boolEnv('VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES', true)) {
    return {
      entries,
      info: {
        enabled: false,
        selected_count: entries.length,
        verified_count: 0,
        dropped_count: 0,
        requested_concurrency: concurrency.requested,
        effective_concurrency: 0,
        max_concurrency: concurrency.max,
        concurrency_capped: concurrency.capped,
      },
    };
  }
  if (criticalWriteReadbacksAreActive()) {
    return {
      entries,
      info: {
        ...snapshotBackgroundPauseInfo('story_body_verify', entries.length, {
          requested_concurrency: concurrency.requested,
          effective_concurrency: 0,
          max_concurrency: concurrency.max,
          concurrency_capped: concurrency.capped,
        }),
        verified_count: 0,
        dropped_count: 0,
        cached_count: 0,
        skipped_count: entries.length,
      },
    };
  }
  const timeoutMs = numberEnv('VH_RELAY_NEWS_INDEX_STORY_REST_READ_TIMEOUT_MS', 2_500);
  const cacheTtlMs = Math.max(0, numberEnv('VH_RELAY_NEWS_INDEX_SNAPSHOT_STORY_VERIFY_CACHE_TTL_MS', 5 * 60_000));
  const checked = await mapWithConcurrency(entries, concurrency.effective, async (entry) => {
    const storyId = String(entry?.entry?.[0] ?? entry?.story?.story_id ?? '').trim();
    if (!storyId) return { entry: null, verified: false };
    if (criticalWriteReadbacksAreActive()) {
      return { entry, verified: false, skipped: true };
    }
    const cached = getSnapshotStoryBodyCache(storyId, cacheTtlMs);
    if (cached && cacheTtlMs > 0 && Date.now() - cached.checked_at <= cacheTtlMs) {
      return cached.story
        ? {
          entry: {
            ...entry,
            story: cached.story,
          },
          verified: true,
          cached: true,
        }
        : { entry: null, verified: false, cached: true };
    }
    const testDelayMs = numberEnv('VH_RELAY_TEST_SNAPSHOT_BACKGROUND_READ_DELAY_MS', 0);
    if (testDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, testDelayMs));
    }
    if (criticalWriteReadbacksAreActive()) {
      return { entry, verified: false, skipped: true };
    }
    const storyResult = await readNewsStoryRecord(gun, storyId, { timeoutMs }).catch(() => null);
    if (!storyResult?.story) {
      if (cacheTtlMs > 0) {
        setSnapshotStoryBodyCache(storyId, null);
      }
      return { entry: null, verified: false, cached: false };
    }
    if (cacheTtlMs > 0) {
      setSnapshotStoryBodyCache(storyId, storyResult.story);
    }
    return {
      entry: {
        ...entry,
        story: storyResult.story,
      },
      verified: true,
      cached: false,
    };
  });
  return {
    entries: checked.map((result) => result.entry).filter(Boolean),
    info: {
      enabled: true,
      selected_count: entries.length,
      verified_count: checked.filter((result) => result.verified).length,
      dropped_count: checked.filter((result) => !result.entry).length,
      cached_count: checked.filter((result) => result.cached).length,
      skipped_count: checked.filter((result) => result.skipped).length,
      requested_concurrency: concurrency.requested,
      effective_concurrency: concurrency.effective,
      max_concurrency: concurrency.max,
      concurrency_capped: concurrency.capped,
    },
  };
}

async function refreshSnapshotStoryStates(gun, entries) {
  const concurrency = cappedBackgroundConcurrency({
    operation: 'story_state_refresh',
    envName: 'VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_CONCURRENCY',
    fallback: 3,
    maxEnvName: 'VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_MAX_CONCURRENCY',
    maxFallback: 1,
  });
  if (!boolEnv('VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES', true)) {
    return {
      entries,
      info: {
        enabled: false,
        selected_count: entries.length,
        refreshed_count: 0,
        requested_concurrency: concurrency.requested,
        effective_concurrency: 0,
        max_concurrency: concurrency.max,
        concurrency_capped: concurrency.capped,
      },
    };
  }
  if (criticalWriteReadbacksAreActive()) {
    return {
      entries,
      info: {
        ...snapshotBackgroundPauseInfo('story_state_refresh', entries.length, {
          requested_concurrency: concurrency.requested,
          effective_concurrency: 0,
          max_concurrency: concurrency.max,
          concurrency_capped: concurrency.capped,
        }),
        candidate_count: 0,
        refreshed_count: 0,
        skipped_count: entries.length,
      },
    };
  }
  const refreshCandidates = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => shouldRefreshSnapshotEntryStoryState(entry));
  const refreshed = await mapWithConcurrency(refreshCandidates, concurrency.effective, ({ entry }) => {
    if (criticalWriteReadbacksAreActive()) {
      return { entry, refreshed: false, skipped: true };
    }
    return refreshSnapshotEntryStoryState(gun, entry);
  });
  const nextEntries = [...entries];
  for (let index = 0; index < refreshed.length; index += 1) {
    nextEntries[refreshCandidates[index].index] = refreshed[index].entry;
  }
  return {
    entries: nextEntries,
    info: {
      enabled: true,
      selected_count: entries.length,
      candidate_count: refreshCandidates.length,
      refreshed_count: refreshed.filter((result) => result.refreshed).length,
      skipped_count: refreshed.filter((result) => result.skipped).length,
      requested_concurrency: concurrency.requested,
      effective_concurrency: concurrency.effective,
      max_concurrency: concurrency.max,
      concurrency_capped: concurrency.capped,
    },
  };
}

function persistRefreshedLatestIndexSnapshotEntries(snapshot, options, refreshedEntries, refreshInfo) {
  const refreshedCount = Number(refreshInfo?.refreshed_count) || 0;
  if (refreshedCount <= 0 || !Array.isArray(snapshot?.entries) || !Array.isArray(refreshedEntries)) {
    return;
  }
  const refreshedByStoryId = new Map();
  for (const entry of refreshedEntries) {
    const storyId = String(entry?.entry?.[0] ?? entry?.story?.story_id ?? '').trim();
    if (storyId) {
      refreshedByStoryId.set(storyId, entry);
    }
  }
  if (refreshedByStoryId.size === 0) {
    return;
  }
  const nextEntries = snapshot.entries.map((entry) => {
    const storyId = String(entry?.entry?.[0] ?? entry?.story?.story_id ?? '').trim();
    return refreshedByStoryId.get(storyId) ?? entry;
  });
  const snapshotKey = latestIndexSnapshotCacheKey(options);
  const now = Date.now();
  const nextSnapshot = {
    ...snapshot,
    cached_at: now,
    entries: nextEntries,
    consistency: {
      ...(snapshot.consistency ?? {}),
      latest_index_snapshot_story_state_persist: {
        updated_at: now,
        refreshed_count: refreshedCount,
      },
    },
  };
  const boundedSnapshot = setNewsLatestIndexSnapshotCache(snapshotKey, nextSnapshot);
  persistNewsLatestIndexSnapshot(snapshotKey, boundedSnapshot);
}

async function buildNewsLatestIndexResultFromSnapshot(gun, snapshot, options = {}, cacheInfo = {}) {
  const allowSnapshotStoryFallback = cacheInfo.allow_snapshot_story_fallback === true;
  const publicCacheInfo = { ...cacheInfo };
  delete publicCacheInfo.allow_snapshot_story_fallback;
  const maxRecords = Math.min(
    numberEnv('VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS', 80),
    positiveInteger(options.limit, numberEnv('VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS', 80)),
  );
  const beforeCursor = latestIndexParsedBefore(options);
  const hasBeforeCursor = beforeCursor !== null;
  const orderedSnapshotEntries = (Array.isArray(snapshot.entries) ? snapshot.entries : [])
    .filter((entry) => {
      const timestamp = latestIndexRecordTimestamp(entry.entry?.[1]);
      return !hasBeforeCursor || (Number.isFinite(timestamp) && timestamp < beforeCursor);
    })
    .sort((left, right) => {
      const leftTimestamp = latestIndexRecordTimestamp(left.entry?.[1]) ?? 0;
      const rightTimestamp = latestIndexRecordTimestamp(right.entry?.[1]) ?? 0;
      return rightTimestamp - leftTimestamp || String(left.entry?.[0] ?? '').localeCompare(String(right.entry?.[0] ?? ''));
    });
  const staleIncompleteFilter = latestIndexStaleIncompleteLifecycleFilter();
  const excludedRecords = [];
  const visibleEntries = [];
  for (const entry of orderedSnapshotEntries) {
    const exclusion = staleIncompleteLifecycleExclusion(entry, staleIncompleteFilter);
    if (exclusion) excludedRecords.push(exclusion);
    else visibleEntries.push(entry);
  }
  const chronologicalPageEntries = visibleEntries.slice(0, maxRecords);
  let selectedEntries = [...chronologicalPageEntries];
  const compositionBackfillRecords = [];
  const compositionBackfillMinLimit = positiveInteger(
    options.compositionBackfillMinLimit,
    numberEnv('VH_RELAY_NEWS_INDEX_COMPOSITION_BACKFILL_MIN_LIMIT', 12),
  );
  const shouldBackfillCorroboratedStory =
    !hasBeforeCursor
    && maxRecords >= compositionBackfillMinLimit
    && selectedEntries.length > 0
    && selectedEntries.every((entry) => storySourceCount(entry.story) <= 1);
  if (shouldBackfillCorroboratedStory) {
    const selectedStoryIds = new Set(selectedEntries.map((entry) => String(entry.entry?.[0] ?? '')));
    const corroboratedBackfill = visibleEntries.find((entry) =>
      !selectedStoryIds.has(String(entry.entry?.[0] ?? ''))
      && storySourceCount(entry.story) > 1);
    if (corroboratedBackfill) {
      selectedEntries.push(corroboratedBackfill);
      compositionBackfillRecords.push({
        story_id: corroboratedBackfill.entry[0],
        reason: 'freshest_visible_corroborated_story_backfilled_for_mixed_feed_window',
        source_count: storySourceCount(corroboratedBackfill.story),
        latest_activity_at: latestIndexRecordTimestamp(corroboratedBackfill.entry[1]) ?? null,
      });
    }
  }
  const selectedEntriesBeforeBodyReadback = [...selectedEntries];
  let bodyReadbackResult = await verifySnapshotStoryBodies(gun, selectedEntries);
  selectedEntries = bodyReadbackResult.entries;
  if (allowSnapshotStoryFallback) {
    const selectedByStoryId = new Map(selectedEntries.map((entry) => [String(entry?.entry?.[0] ?? ''), entry]));
    let fallbackCount = 0;
    const restoredEntries = selectedEntriesBeforeBodyReadback
      .map((entry) => {
        const storyId = String(entry?.entry?.[0] ?? '').trim();
        if (!storyId) return null;
        const selected = selectedByStoryId.get(storyId);
        if (selected) return selected;
        const snapshotStory = parseStoryBundleEnvelope(JSON.stringify(entry?.story ?? null));
        if (!snapshotStory || snapshotStory.story_id !== storyId) return null;
        fallbackCount += 1;
        return {
          ...entry,
          story: snapshotStory,
        };
      })
      .filter(Boolean);
    if (fallbackCount > 0) {
      selectedEntries = restoredEntries;
    }
    bodyReadbackResult = {
      ...bodyReadbackResult,
      info: {
        ...(bodyReadbackResult.info ?? {}),
        snapshot_story_fallback_enabled: true,
        snapshot_story_fallback_count: fallbackCount,
        degraded_to_snapshot_stories: fallbackCount > 0,
      },
    };
  }
  const refreshResult = await refreshSnapshotStoryStates(gun, selectedEntries);
  selectedEntries = refreshResult.entries;
  if (options.persistSnapshotOnRead === true) {
    persistRefreshedLatestIndexSnapshotEntries(snapshot, options, selectedEntries, refreshResult.info);
  }
  const records = {};
  const stories = {};
  const storyStates = {};
  const compositionNow = Date.now();
  const composition = createFeedCompositionAccumulator(compositionNow);
  for (const entry of selectedEntries) {
    records[entry.entry[0]] = entry.entry[1];
    if (entry.story) {
      stories[entry.entry[0]] = entry.story;
    }
    if (entry.story && entry.storyState) {
      storyStates[entry.entry[0]] = entry.storyState;
      accumulateFeedComposition(composition, entry.story, entry.entry[1], entry.storyState);
    }
  }
  const truncated = visibleEntries.length > chronologicalPageEntries.length;
  return {
    root: null,
    sourceKeyCount: snapshot.sourceKeyCount ?? visibleEntries.length,
    windowSourceKeyCount: visibleEntries.length,
    scannedKeyCount: snapshot.scannedKeyCount ?? visibleEntries.length,
    truncated,
    before: beforeCursor,
    nextCursor: latestIndexPageNextCursor(chronologicalPageEntries, truncated),
    consistency: {
      ...(snapshot.consistency ?? {}),
      empty_read_cache: publicCacheInfo,
      snapshot_story_body_readback: bodyReadbackResult.info,
      snapshot_story_state_refresh: refreshResult.info,
      excluded_count: excludedRecords.length,
      excluded_reason_counts: exclusionReasonCounts(excludedRecords),
      stale_incomplete_lifecycle_filter: {
        enabled: Boolean(staleIncompleteFilter.enabled),
        stale_window_ms: staleIncompleteFilter.staleWindowMs,
      },
      composition_backfill_min_limit: compositionBackfillMinLimit,
    },
    composition: addFeedCompositionWindowFields(finalizeFeedComposition(composition), {
      organicEntries: chronologicalPageEntries,
      scanWindowEntries: visibleEntries,
      backfillRecords: compositionBackfillRecords,
      now: compositionNow,
    }),
    storyStates,
    excludedRecords,
    repairedRecords: snapshot.repairedRecords ?? [],
    compositionBackfillRecords,
    records,
    stories,
    snapshotEntries: snapshot.entries,
  };
}

async function readNewsLatestIndexRecordsWithEmptyRetry(gun, options = {}) {
  const retryAttempts = Math.max(1, numberEnv('VH_RELAY_NEWS_INDEX_REST_EMPTY_RETRY_ATTEMPTS', 1));
  const retryDelayMs = Math.max(0, numberEnv('VH_RELAY_NEWS_INDEX_REST_EMPTY_RETRY_DELAY_MS', 250));
  const cacheTtlMs = Math.max(0, numberEnv('VH_RELAY_NEWS_INDEX_REST_EMPTY_CACHE_TTL_MS', 5 * 60_000));
  const snapshotMaxAgeMs = Math.max(
    0,
    numberEnv('VH_RELAY_NEWS_INDEX_SNAPSHOT_MAX_AGE_MS', 24 * 60 * 60 * 1000),
  );
  const cacheKey = latestIndexRestCacheKey(options);
  const snapshotCacheKey = latestIndexSnapshotCacheKey(options);
  const serveStaleSnapshotOnEmpty = boolEnv(
    'VH_RELAY_NEWS_INDEX_SERVE_STALE_SNAPSHOT_ON_EMPTY',
    process.env.NODE_ENV === 'production',
  );
  if (boolEnv('VH_RELAY_NEWS_INDEX_REST_PREFER_SNAPSHOT', process.env.NODE_ENV === 'production')) {
    const snapshot = newsLatestIndexSnapshotCache.get(snapshotCacheKey)
      ?? readPersistedNewsLatestIndexSnapshot(snapshotCacheKey, snapshotMaxAgeMs);
    if (newsLatestIndexSnapshotIsFresh(snapshot, snapshotMaxAgeMs)) {
      return buildNewsLatestIndexResultFromSnapshot(gun, snapshot, options, {
        served_from: 'preferred_latest_index_snapshot',
        cached_at: snapshot.cached_at,
        age_ms: newsLatestIndexSnapshotAgeMs(snapshot),
        snapshot_max_age_ms: snapshotMaxAgeMs,
      });
    }
  }
  let lastResult = null;
  for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
    const result = await readNewsLatestIndexRecords(gun, options);
    lastResult = result;
    const hasRecords = Object.keys(result.records).length > 0;
    const hasIndexEvidence = Number(result.sourceKeyCount) > 0
      || Number(result.windowSourceKeyCount) > 0
      || Number(result.scannedKeyCount) > 0;
    if (hasRecords || hasIndexEvidence || attempt === retryAttempts - 1) {
      if (hasRecords && cacheKey && cacheTtlMs > 0) {
        newsLatestIndexRestCache.set(cacheKey, { cached_at: Date.now(), result });
      }
      if (
        options.persistSnapshotOnRead === true
        && hasRecords
        && Array.isArray(result.snapshotEntries)
        && result.snapshotEntries.length > 0
        && cacheTtlMs > 0
      ) {
        const snapshot = {
          cached_at: Date.now(),
          entries: result.snapshotEntries,
          sourceKeyCount: result.sourceKeyCount,
          scannedKeyCount: result.scannedKeyCount,
          consistency: result.consistency,
          repairedRecords: result.repairedRecords,
        };
        const boundedSnapshot = setNewsLatestIndexSnapshotCache(snapshotCacheKey, snapshot);
        persistNewsLatestIndexSnapshot(snapshotCacheKey, boundedSnapshot);
      }
      if (!hasRecords && cacheKey && cacheTtlMs > 0) {
        const cached = newsLatestIndexRestCache.get(cacheKey);
        if (cached && Date.now() - cached.cached_at <= cacheTtlMs) {
          return {
            ...cached.result,
            consistency: {
              ...(cached.result.consistency ?? {}),
              empty_read_cache: {
                served_from: 'last_non_empty_latest_index',
                cached_at: cached.cached_at,
                age_ms: Date.now() - cached.cached_at,
              },
            },
          };
        }
        const snapshot = newsLatestIndexSnapshotCache.get(snapshotCacheKey)
          ?? readPersistedNewsLatestIndexSnapshot(snapshotCacheKey, snapshotMaxAgeMs);
        if (newsLatestIndexSnapshotIsFresh(snapshot, snapshotMaxAgeMs)) {
          return buildNewsLatestIndexResultFromSnapshot(gun, snapshot, options, {
            served_from: 'last_non_empty_latest_index_snapshot',
            cached_at: snapshot.cached_at,
            age_ms: newsLatestIndexSnapshotAgeMs(snapshot),
            snapshot_max_age_ms: snapshotMaxAgeMs,
          });
        }
        if (serveStaleSnapshotOnEmpty) {
          const staleSnapshot = newsLatestIndexSnapshotCache.get(snapshotCacheKey)
            ?? readPersistedNewsLatestIndexSnapshot(snapshotCacheKey, 0);
          if (newsLatestIndexSnapshotIsStale(staleSnapshot, snapshotMaxAgeMs)) {
            return buildNewsLatestIndexResultFromSnapshot(gun, staleSnapshot, options, {
              served_from: 'stale_latest_index_snapshot',
              cached_at: staleSnapshot.cached_at,
              age_ms: newsLatestIndexSnapshotAgeMs(staleSnapshot),
              snapshot_max_age_ms: snapshotMaxAgeMs,
              stale: true,
              allow_snapshot_story_fallback: true,
            });
          }
        }
      }
      return result;
    }
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return lastResult ?? await readNewsLatestIndexRecords(gun, options);
}

async function readNewsHotIndexRecords(gun, options = {}) {
  const indexChain = gun.get('vh').get('news').get('index').get('hot');
  const rootTimeoutMs = numberEnv('VH_RELAY_NEWS_HOT_INDEX_REST_ROOT_TIMEOUT_MS',
    numberEnv('VH_RELAY_NEWS_INDEX_REST_ROOT_TIMEOUT_MS', 2_000));
  const childTimeoutMs = numberEnv('VH_RELAY_NEWS_HOT_INDEX_REST_CHILD_TIMEOUT_MS',
    numberEnv('VH_RELAY_NEWS_INDEX_REST_CHILD_TIMEOUT_MS', 750));
  const maxRecords = Math.min(
    numberEnv('VH_RELAY_NEWS_HOT_INDEX_REST_MAX_RECORDS',
      numberEnv('VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS', 80)),
    positiveInteger(options.limit, numberEnv('VH_RELAY_NEWS_HOT_INDEX_REST_MAX_RECORDS',
      numberEnv('VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS', 80))),
  );
  const concurrency = numberEnv('VH_RELAY_NEWS_HOT_INDEX_REST_CONCURRENCY',
    numberEnv('VH_RELAY_NEWS_INDEX_REST_CONCURRENCY', 32));
  const requestedScanLimit = positiveInteger(
    options.scanLimit,
    numberEnv('VH_RELAY_NEWS_HOT_INDEX_REST_SCAN_RECORDS', maxRecords),
  );
  const rootScanLimit = Math.min(
    requestedScanLimit,
    positiveInteger(
      options.rootScanLimit,
      numberEnv('VH_RELAY_NEWS_HOT_INDEX_REST_ROOT_SCAN_RECORDS', Math.min(requestedScanLimit, 32)),
    ),
  );
  const mapFallbackEnabled = boolEnv('VH_RELAY_NEWS_HOT_INDEX_REST_MAP_FALLBACK', true);
  const rawRoot = await readOnce(indexChain, rootTimeoutMs);
  const rootKeys = extractIndexChildKeys(rawRoot);
  const mapSnapshots = rootKeys.length === 0 && mapFallbackEnabled
    ? await readIndexMapSnapshots(indexChain, childTimeoutMs, requestedScanLimit)
    : {};
  const readableRoot = Object.keys(mapSnapshots).length > 0
    ? {
      ...(rawRoot && typeof rawRoot === 'object' ? stripGunMetadata(rawRoot) : {}),
      ...mapSnapshots,
    }
    : rawRoot;
  const sourceKeys = extractIndexChildKeys(readableRoot);
  const keys = sourceKeys.slice(0, Math.min(sourceKeys.length, rootScanLimit));
  const entries = await mapWithConcurrency(keys, concurrency, async (storyId) => {
    const direct = readableRoot && typeof readableRoot === 'object' && storyId in readableRoot
      ? stripGunMetadata(readableRoot[storyId])
      : null;
    const child = await readLinkedGunRecord(
      gun,
      stripGunMetadata(await readOnce(indexChain.get(storyId), childTimeoutMs)),
      childTimeoutMs,
    );
    const record = child !== null && child !== undefined
      ? child
      : direct !== null && direct !== undefined
        ? await readLinkedGunRecord(gun, direct, childTimeoutMs)
        : null;
    const normalized = normalizeHotIndexRecordForResponse(storyId, record);
    return normalized ? [storyId, normalized] : null;
  });
  const visibleEntries = entries
    .filter(Boolean)
    .sort((left, right) =>
      (hotIndexRecordHotness(right[1]) ?? 0) - (hotIndexRecordHotness(left[1]) ?? 0)
      || String(left[0]).localeCompare(String(right[0])),
    );
  const mergedEntries = [...visibleEntries];
  const seenStoryIds = new Set(mergedEntries.map((entry) => String(entry[0])));
  let latestFallbackInfo = null;
  let latestFallbackVisibleStoryIds = null;
  if (maxRecords > 0) {
    const latestFallback = await readNewsLatestIndexRecordsWithEmptyRetry(gun, {
      limit: maxRecords,
      scanLimit: Math.max(maxRecords, rootScanLimit),
      consistencyFilter: true,
    }).catch((error) => {
      latestFallbackInfo = {
        attempted: true,
        error: error instanceof Error ? error.message : String(error),
      };
      return null;
    });
    if (latestFallback) {
      latestFallbackVisibleStoryIds = new Set(Object.keys(latestFallback.records ?? {}));
      let added = 0;
      for (const [storyId, story] of Object.entries(latestFallback.stories ?? {})) {
        const hotRecord = synthesizeHotIndexRecordFromStory(storyId, story);
        if (hotIndexRecordHotness(hotRecord) === null) continue;
        if (seenStoryIds.has(storyId)) {
          const existingIndex = mergedEntries.findIndex((entry) => String(entry[0]) === storyId);
          if (
            existingIndex >= 0
            && latestIndexProductMetadataStatus(mergedEntries[existingIndex][1], story) !== 'complete'
          ) {
            mergedEntries[existingIndex] = [storyId, hotRecord];
          }
          continue;
        }
        mergedEntries.push([storyId, hotRecord]);
        seenStoryIds.add(storyId);
        added += 1;
      }
      latestFallbackInfo = {
        attempted: true,
        added_count: added,
        latest_record_count: Object.keys(latestFallback.records ?? {}).length,
      };
    }
  }
  const visibleLatestOnly = boolEnv(
    'VH_RELAY_NEWS_HOT_INDEX_REST_VISIBLE_LATEST_ONLY',
    process.env.NODE_ENV === 'production',
  );
  const responseEntries = visibleLatestOnly && latestFallbackVisibleStoryIds && latestFallbackVisibleStoryIds.size > 0
    ? mergedEntries.filter((entry) => latestFallbackVisibleStoryIds.has(String(entry[0])))
    : mergedEntries;
  if (latestFallbackInfo && visibleLatestOnly && latestFallbackVisibleStoryIds) {
    latestFallbackInfo = {
      ...latestFallbackInfo,
      visible_latest_only: true,
      visible_latest_story_count: latestFallbackVisibleStoryIds.size,
    };
  }
  const sortedEntries = responseEntries
    .sort((left, right) =>
      (hotIndexRecordHotness(right[1]) ?? 0) - (hotIndexRecordHotness(left[1]) ?? 0)
      || String(left[0]).localeCompare(String(right[0])),
    );
  const records = {};
  for (const entry of sortedEntries.slice(0, maxRecords)) {
    records[entry[0]] = entry[1];
  }
  return {
    root: options.includeRoot ? stripGunMetadata(rawRoot) || {} : undefined,
    sourceKeyCount: sourceKeys.length,
    scannedKeyCount: keys.length,
    truncated: sourceKeys.length > keys.length || sortedEntries.length > Object.keys(records).length,
    latestFallback: latestFallbackInfo,
    records,
  };
}

function parseAggregatePointSnapshot(value, context) {
  const clean = stripGunMetadata(value);
  if (!clean || typeof clean !== 'object') return null;
  const sourceWindow = stripGunMetadata(clean.source_window);
  const snapshot = {
    schema_version: clean.schema_version,
    topic_id: clean.topic_id,
    synthesis_id: clean.synthesis_id,
    epoch: clean.epoch,
    point_id: clean.point_id,
    agree: clean.agree,
    disagree: clean.disagree,
    weight: clean.weight,
    participants: clean.participants,
    version: clean.version,
    computed_at: clean.computed_at,
    source_window: sourceWindow,
  };
  if (
    snapshot.schema_version !== 'point-aggregate-snapshot-v1' ||
    snapshot.topic_id !== context.topicId ||
    snapshot.synthesis_id !== context.synthesisId ||
    snapshot.epoch !== context.epoch ||
    snapshot.point_id !== context.pointId ||
    !Number.isFinite(snapshot.agree) ||
    !Number.isFinite(snapshot.disagree) ||
    !Number.isFinite(snapshot.weight) ||
    !Number.isFinite(snapshot.participants) ||
    !Number.isFinite(snapshot.version) ||
    !Number.isFinite(snapshot.computed_at) ||
    !snapshot.source_window ||
    typeof snapshot.source_window !== 'object' ||
    !Number.isFinite(snapshot.source_window.from_seq) ||
    !Number.isFinite(snapshot.source_window.to_seq)
  ) {
    return null;
  }
  return {
    ...snapshot,
    agree: Math.max(0, Math.floor(snapshot.agree)),
    disagree: Math.max(0, Math.floor(snapshot.disagree)),
    participants: Math.max(0, Math.floor(snapshot.participants)),
    version: Math.max(0, Math.floor(snapshot.version)),
    computed_at: Math.max(0, Math.floor(snapshot.computed_at)),
    source_window: {
      from_seq: Math.max(0, Math.floor(snapshot.source_window.from_seq)),
      to_seq: Math.max(0, Math.floor(snapshot.source_window.to_seq)),
    },
  };
}

function parseAggregateVoterNodeForRead(value, context, voterId) {
  const clean = stripGunMetadata(value);
  if (!clean || typeof clean !== 'object') return null;
  if (clean.point_id !== context.pointId) return null;
  if (clean.topic_id !== undefined && clean.topic_id !== context.topicId) return null;
  if (clean.synthesis_id !== undefined && clean.synthesis_id !== context.synthesisId) return null;
  if (clean.epoch !== undefined && clean.epoch !== context.epoch) return null;
  if (clean.voter_id !== undefined && clean.voter_id !== voterId) return null;
  if (![ -1, 0, 1 ].includes(clean.agreement)) return null;
  if (!Number.isFinite(clean.weight) || clean.weight < 0) return null;
  if (typeof clean.updated_at !== 'string' || !clean.updated_at.trim()) return null;
  return {
    point_id: clean.point_id,
    agreement: clean.agreement,
    weight: clean.weight,
    updated_at: clean.updated_at,
  };
}

function parseAggregateVoterRow(voterId, voterPayload, context) {
  if (typeof voterId !== 'string' || !voterId.trim() || voterId === '_') return null;
  const voterRecord = stripGunMetadata(voterPayload);
  if (!voterRecord || typeof voterRecord !== 'object') return null;
  const node = parseAggregateVoterNodeForRead(voterRecord[context.pointId], context, voterId);
  if (!node) return null;
  const updatedAtMs = Date.parse(node.updated_at);
  return {
    voter_id: voterId,
    node,
    updated_at_ms: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? Math.floor(updatedAtMs) : 0,
  };
}

function mergeAggregateRowsByVoter(rows) {
  const byVoter = new Map();
  for (const row of rows) {
    if (!row) continue;
    const existing = byVoter.get(row.voter_id);
    if (!existing || row.updated_at_ms >= existing.updated_at_ms) {
      byVoter.set(row.voter_id, row);
    }
  }
  return [...byVoter.values()];
}

async function readAggregateVoterRowsViaMap(votersChain, context, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const mapped = votersChain.map?.();
    if (!mapped?.once) {
      resolve([]);
      return;
    }
    const rowsByVoter = new Map();
    const startedAt = Date.now();
    let lastEventAt = startedAt;
    let settled = false;
    const callback = (voterPayload, voterId) => {
      if (typeof voterId !== 'string' || !voterId.trim() || voterId === '_') {
        return;
      }
      lastEventAt = Date.now();
      const row = parseAggregateVoterRow(voterId, voterPayload, context);
      if (row) {
        rowsByVoter.set(voterId, row);
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(watchdogInterval);
      clearTimeout(maxTimer);
      try {
        mapped.off?.(callback);
      } catch {
        // Best-effort Gun map cleanup.
      }
      resolve([...rowsByVoter.values()]);
    };
    const watchdogInterval = setInterval(() => {
      const now = Date.now();
      if (now - lastEventAt >= 200 || now - startedAt >= timeoutMs) {
        finish();
      }
    }, 50);
    const maxTimer = setTimeout(finish, timeoutMs + 100);
    mapped.once(callback);
  });
}

async function readAggregateVoterIdsViaMap(votersChain, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const mapped = votersChain.map?.();
    if (!mapped?.once) {
      resolve([]);
      return;
    }
    const ids = new Set();
    const callback = (_value, key) => {
      if (typeof key === 'string' && key.trim() && key !== '_') {
        ids.add(key);
      }
    };
    mapped.once(callback);
    setTimeout(() => {
      try {
        mapped.off?.(callback);
      } catch {
        // Best-effort Gun map cleanup.
      }
      resolve([...ids]);
    }, timeoutMs);
  });
}

function selfGunPeerUrl() {
  const normalizedHost = !host || host === '0.0.0.0' || host === '::'
    ? '127.0.0.1'
    : host;
  const bracketedHost = normalizedHost.includes(':') && !normalizedHost.startsWith('[')
    ? `[${normalizedHost}]`
    : normalizedHost;
  return `http://${bracketedHost}:${port}/gun`;
}

async function readAggregateVoterRowsFromGun(gun, context, timeoutMs = aggregateVoterReadTimeoutMs) {
  const votersChain = gun.get('vh').get('aggregates').get('topics').get(context.topicId)
    .get('syntheses').get(context.synthesisId)
    .get('epochs').get(String(context.epoch))
    .get('voters');
  const raw = stripGunMetadata(await readOnce(votersChain, timeoutMs));
  const mapRows = await readAggregateVoterRowsViaMap(votersChain, context, timeoutMs);
  const rootRows = [];
  const voterIds = new Set();
  if (raw && typeof raw === 'object') {
    for (const [voterId, voterPayload] of Object.entries(raw)) {
      if (voterId === '_') continue;
      voterIds.add(voterId);
      const row = parseAggregateVoterRow(voterId, voterPayload, context);
      if (row) rootRows.push(row);
    }
  }
  for (const row of mapRows) {
    voterIds.add(row.voter_id);
  }
  for (const voterId of await readAggregateVoterIdsViaMap(votersChain, timeoutMs)) {
    voterIds.add(voterId);
  }
  const leafRows = await Promise.all([...voterIds].map(async (voterId) => {
    const direct = await readOnce(votersChain.get(voterId).get(context.pointId), timeoutMs);
    const node = parseAggregateVoterNodeForRead(direct, context, voterId);
    if (!node) return null;
    const updatedAtMs = Date.parse(node.updated_at);
    return {
      voter_id: voterId,
      node,
      updated_at_ms: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? Math.floor(updatedAtMs) : 0,
    };
  }));
  return mergeAggregateRowsByVoter([...rootRows, ...mapRows, ...leafRows]);
}

async function readAggregateVoterRowsViaSelfPeer(context) {
  if (!aggregateVoterSelfPeerReadbackEnabled) return [];
  const peerGun = Gun({
    peers: [selfGunPeerUrl()],
    localStorage: false,
    radisk: false,
    file: false,
    axe: false,
  });
  let timedOut = false;
  let timeoutHandle = null;
  try {
    const rowsPromise = readAggregateVoterRowsFromGun(
      peerGun,
      context,
      aggregateVoterSelfPeerReadTimeoutMs,
    ).catch(() => []);
    const timeoutPromise = new Promise((resolve) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        resolve([]);
      }, Math.max(1, aggregateVoterSelfPeerReadTimeoutMs + 250));
    });
    const rows = await Promise.race([rowsPromise, timeoutPromise]);
    if (timedOut) {
      logEvent('warn', 'aggregate_self_peer_readback_timeout', {
        topic_id: context.topicId,
        synthesis_id: context.synthesisId,
        epoch: context.epoch,
        point_id: context.pointId,
        timeout_ms: aggregateVoterSelfPeerReadTimeoutMs,
      });
    }
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    try {
      peerGun.off?.();
    } catch {
      // Best-effort loopback Gun client cleanup.
    }
  }
}

async function readAggregatePointSnapshot(gun, context) {
  const pointChain = gun.get('vh').get('aggregates').get('topics').get(context.topicId)
    .get('syntheses').get(context.synthesisId)
    .get('epochs').get(String(context.epoch))
    .get('points').get(context.pointId);
  const direct = stripGunMetadata(await readOnce(pointChain, 750));
  let snapshot = parseAggregatePointSnapshot(direct, context);
  if (!snapshot && direct && typeof direct === 'object') {
    const sourceWindow = stripGunMetadata(await readOnce(pointChain.get('source_window'), 750));
    snapshot = parseAggregatePointSnapshot({ ...direct, source_window: sourceWindow }, context);
  }
  return snapshot;
}

function summarizeAggregateRows(pointId, rows) {
  let agree = 0;
  let disagree = 0;
  let weight = 0;
  let participants = 0;
  for (const row of rows) {
    if (row.node.agreement === 1) {
      agree += 1;
      weight += row.node.weight;
      participants += 1;
    } else if (row.node.agreement === -1) {
      disagree += 1;
      weight += row.node.weight;
      participants += 1;
    }
  }
  return { point_id: pointId, agree, disagree, weight, participants };
}

function snapshotAggregate(snapshot) {
  return snapshot ? {
    point_id: snapshot.point_id,
    agree: snapshot.agree,
    disagree: snapshot.disagree,
    weight: snapshot.weight,
    participants: snapshot.participants,
  } : null;
}

function aggregatePointReadCacheKey(context) {
  return [
    context.topicId,
    context.synthesisId,
    String(context.epoch),
    context.pointId,
  ].join('\u001f');
}

function readAggregatePointCache(context) {
  if (aggregatePointReadCacheTtlMs <= 0) return null;
  const key = aggregatePointReadCacheKey(context);
  const cached = aggregatePointReadCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cached_at > aggregatePointReadCacheTtlMs) {
    aggregatePointReadCache.delete(key);
    return null;
  }
  return {
    ...cached.result,
    cached: true,
  };
}

function writeAggregatePointCache(result) {
  if (aggregatePointReadCacheTtlMs <= 0) return;
  const key = aggregatePointReadCacheKey(result.context);
  aggregatePointReadCache.set(key, {
    cached_at: Date.now(),
    result,
  });
  while (aggregatePointReadCache.size > aggregatePointReadCacheMaxEntries) {
    const staleKey = aggregatePointReadCache.keys().next().value;
    if (!staleKey) break;
    aggregatePointReadCache.delete(staleKey);
  }
}

function invalidateAggregatePointCache(params) {
  try {
    const context = {
      topicId: normalizeRequiredString(params.topicId ?? params.topic_id, 'topic-id'),
      synthesisId: normalizeRequiredString(params.synthesisId ?? params.synthesis_id, 'synthesis-id'),
      epoch: normalizeFiniteNonNegativeInteger(params.epoch, 'epoch'),
      pointId: normalizeRequiredString(params.pointId ?? params.point_id, 'point-id'),
    };
    aggregatePointReadCache.delete(aggregatePointReadCacheKey(context));
  } catch {
    // Ignore malformed invalidation hints; write validation reports those.
  }
}

async function readAggregatePoint(gun, params) {
  const context = {
    topicId: normalizeRequiredString(params.topicId, 'topic-id'),
    synthesisId: normalizeRequiredString(params.synthesisId, 'synthesis-id'),
    epoch: normalizeFiniteNonNegativeInteger(params.epoch, 'epoch'),
    pointId: normalizeRequiredString(params.pointId, 'point-id'),
  };
  const cached = readAggregatePointCache(context);
  if (cached) return cached;

  const [snapshot, localRows] = await Promise.all([
    readAggregatePointSnapshot(gun, context),
    readAggregateVoterRowsFromGun(gun, context),
  ]);
  const materialized = snapshotAggregate(snapshot);
  const localAggregate = summarizeAggregateRows(context.pointId, localRows);
  const shouldReadSelfPeerRows = aggregateVoterSelfPeerReadbackEnabled && (
    localRows.length === 0 ||
    (materialized && localAggregate.participants <= materialized.participants)
  );
  const rows = shouldReadSelfPeerRows ||
    (
      !aggregateVoterSelfPeerReadbackEnabled &&
      localRows.length === 0 &&
      (!materialized || materialized.participants <= 0)
    )
    ? mergeAggregateRowsByVoter([
      ...localRows,
      ...await readAggregateVoterRowsViaSelfPeer(context),
    ])
    : localRows;
  const rowAggregate = summarizeAggregateRows(context.pointId, rows);
  const aggregate = !materialized ||
    rowAggregate.participants > materialized.participants ||
    rowAggregate.weight > materialized.weight
    ? rowAggregate
    : materialized;
  const result = {
    context,
    aggregate,
    snapshot,
    row_count: rows.length,
    cached: false,
  };
  writeAggregatePointCache(result);
  return result;
}

function parseCommentEnvelope(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseCommentIndex(value, threadId) {
  const clean = stripGunMetadata(value);
  if (!clean || typeof clean !== 'object') return [];
  if (clean.schemaVersion !== COMMENT_INDEX_SCHEMA_VERSION || clean.threadId !== threadId) return [];
  if (typeof clean.idsJson !== 'string') return [];
  try {
    const parsed = JSON.parse(clean.idsJson);
    return Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function parseCommentIndexEntry(value, threadId, key) {
  const clean = stripGunMetadata(value);
  if (!clean || typeof clean !== 'object') return null;
  if (clean.schemaVersion !== COMMENT_INDEX_SCHEMA_VERSION || clean.threadId !== threadId) return null;
  if (typeof clean.commentId !== 'string' || clean.commentId.trim().length === 0) return null;
  if (key && key !== clean.commentId) return null;
  return clean.commentId;
}

async function readCommentIndexEntrySnapshot(entriesChain, threadId, timeoutMs = 1_000) {
  return new Promise((resolve) => {
    const mapped = entriesChain.map?.();
    if (!mapped?.once) {
      resolve([]);
      return;
    }
    const ids = new Set();
    mapped.once((data, key) => {
      const commentId = parseCommentIndexEntry(data, threadId, key);
      if (commentId) ids.add(commentId);
    });
    setTimeout(() => resolve([...ids]), timeoutMs);
  });
}

async function readCommentIndexIds(indexRoot, threadId, timeoutMs = 250) {
  const currentChain = indexRoot.get('current');
  const current = await readOnce(currentChain, timeoutMs);
  const scalar = await readOnce(currentChain.get('idsJson'), timeoutMs);
  const entries = await readCommentIndexEntrySnapshot(indexRoot.get('entries'), threadId, timeoutMs);
  return Array.from(new Set([
    ...parseCommentIndex(current, threadId),
    ...parseCommentIndex({
      schemaVersion: COMMENT_INDEX_SCHEMA_VERSION,
      threadId,
      idsJson: scalar,
    }, threadId),
    ...entries,
  ]));
}

async function readCommentBack(commentChain, threadId, commentId, timeoutMs = 250) {
  const direct = stripGunMetadata(await readOnce(commentChain, timeoutMs));
  if (direct && typeof direct === 'object' && direct.id === commentId && direct.threadId === threadId) {
    return direct;
  }
  const envelope = parseCommentEnvelope(await readOnce(commentChain.get(COMMENT_JSON_FIELD), timeoutMs));
  if (envelope?.id === commentId && envelope?.threadId === threadId) {
    return envelope;
  }
  return null;
}

function normalizeCommentForRead(comment, threadId, commentId) {
  if (!comment || typeof comment !== 'object') return null;
  const envelope = parseCommentEnvelope(comment[COMMENT_JSON_FIELD]);
  if (
    envelope &&
    envelope.id === commentId &&
    envelope.threadId === threadId
  ) {
    return envelope;
  }
  return comment.id === commentId && comment.threadId === threadId ? comment : null;
}

async function pollCommentBack(gun, threadId, commentId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  const threadChain = gun.get('vh').get('forum').get('threads').get(threadId);
  const commentChain = threadChain.get('comments').get(commentId);
  const indexRoot = gun.get('vh').get('forum').get('indexes').get('comment_ids').get(encodeURIComponent(threadId));
  let latest = null;
  while (Date.now() < deadline) {
    latest = await readCommentBack(commentChain, threadId, commentId);
    const indexIds = await readCommentIndexIds(indexRoot, threadId);
    if (latest && indexIds.includes(commentId)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return latest;
}

async function readForumComments(gun, threadId, timeoutMs = 1_000) {
  const cleanThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  if (!cleanThreadId) {
    throw new Error('thread_id-required');
  }
  const threadChain = gun.get('vh').get('forum').get('threads').get(cleanThreadId);
  const commentsChain = threadChain.get('comments');
  const indexRoot = gun.get('vh').get('forum').get('indexes').get('comment_ids').get(encodeURIComponent(cleanThreadId));
  const commentIds = await readCommentIndexIds(indexRoot, cleanThreadId, timeoutMs);
  const comments = [];
  for (const commentId of commentIds) {
    const comment = await readCommentBack(commentsChain.get(commentId), cleanThreadId, commentId, timeoutMs);
    const normalized = normalizeCommentForRead(comment, cleanThreadId, commentId);
    if (normalized) {
      comments.push(normalized);
    }
  }
  comments.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  return {
    thread_id: cleanThreadId,
    comment_ids: commentIds,
    comments,
  };
}

async function readForumThread(gun, threadId, timeoutMs = 1_000) {
  const cleanThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  if (!cleanThreadId) {
    throw new Error('thread_id-required');
  }
  const threadChain = gun.get('vh').get('forum').get('threads').get(cleanThreadId);
  const thread = await readThreadBack(threadChain, cleanThreadId, timeoutMs);
  return thread && thread.id === cleanThreadId ? thread : null;
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
    if (key === 'signedWriteEnvelope' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
      clean[key] = JSON.parse(JSON.stringify(raw));
      continue;
    }
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

function sanitizeTopicSynthesisCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('synthesis-candidate-required');
  }
  const topicId = typeof value.topic_id === 'string' ? value.topic_id.trim() : '';
  const candidateId = typeof value.candidate_id === 'string' ? value.candidate_id.trim() : '';
  if (!topicId) throw new Error('synthesis-candidate-topic-required');
  if (!candidateId) throw new Error('synthesis-candidate-id-required');
  if (!Number.isFinite(value.epoch)) throw new Error('synthesis-candidate-epoch-required');
  return {
    ...value,
    topic_id: topicId,
    candidate_id: candidateId,
    epoch: Math.floor(value.epoch),
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

function normalizeLiteralString(value, name, expected) {
  const normalized = normalizeRequiredString(value, name);
  if (normalized !== expected) throw new Error(`${name}-invalid`);
  return normalized;
}

function normalizeLiteralNumber(value, name, expected) {
  const normalized = normalizeFiniteNumber(value, name);
  if (normalized !== expected) throw new Error(`${name}-invalid`);
  return normalized;
}

function assertExactObjectKeys(value, allowedKeys, name) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`${name}-field-invalid`);
  }
}

function aggregateVoterEnvelopePayloadMatches(envelopePayload, payload) {
  for (const [key, value] of Object.entries(payload)) {
    if (envelopePayload[key] !== value) return false;
  }
  return Object.keys(envelopePayload).length === Object.keys(payload).length;
}

function sanitizeAggregateVoterEnvelope(envelope, payload, voterId) {
  if (!isPlainRecord(envelope)) {
    throw new Error('signed-write-envelope-required');
  }
  const envelopePayload = envelope.payload;
  if (!isPlainRecord(envelopePayload)) {
    throw new Error('signed-write-envelope-payload-required');
  }
  if (!aggregateVoterEnvelopePayloadMatches(envelopePayload, payload)) {
    throw new Error('signed-write-envelope-payload-mismatch');
  }
  const sessionRef = envelope.sessionRef;
  if (!isPlainRecord(sessionRef)) {
    throw new Error('signed-write-envelope-session-ref-required');
  }

  return {
    envelopeVersion: normalizeLiteralNumber(envelope.envelopeVersion, 'signed-envelope-version', 1),
    signatureSuite: normalizeLiteralString(envelope.signatureSuite, 'signed-envelope-signature-suite', 'jcs-ed25519-sha256-v1'),
    protocolVersion: normalizeLiteralString(envelope.protocolVersion, 'signed-envelope-protocol-version', 'luma-write-v1'),
    profile: normalizeRequiredString(envelope.profile, 'signed-envelope-profile'),
    audience: normalizeLiteralString(envelope.audience, 'signed-envelope-audience', AGGREGATE_VOTER_AUDIENCE),
    origin: normalizeRequiredString(envelope.origin, 'signed-envelope-origin'),
    scheme: normalizeLiteralString(envelope.scheme, 'signed-envelope-scheme', AGGREGATE_VOTER_AUTHOR_SCHEME),
    publicAuthor: normalizeLiteralString(envelope.publicAuthor, 'signed-envelope-public-author', voterId),
    sessionRef: {
      tokenHash: normalizeRequiredString(sessionRef.tokenHash, 'signed-envelope-session-token-hash'),
      envelopeDigest: normalizeRequiredString(sessionRef.envelopeDigest, 'signed-envelope-session-envelope-digest'),
    },
    payload,
    payloadDigest: normalizeRequiredString(envelope.payloadDigest, 'signed-envelope-payload-digest'),
    sequence: normalizeFiniteNonNegativeInteger(envelope.sequence, 'signed-envelope-sequence'),
    nonce: normalizeRequiredString(envelope.nonce, 'signed-envelope-nonce'),
    idempotencyKey: normalizeRequiredString(envelope.idempotencyKey, 'signed-envelope-idempotency-key'),
    issuedAt: normalizeFiniteNonNegativeInteger(envelope.issuedAt, 'signed-envelope-issued-at'),
    signature: normalizeRequiredString(envelope.signature, 'signed-envelope-signature'),
  };
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

  const topicId = normalizeRequiredString(value.topic_id, 'topic-id');
  const synthesisId = normalizeRequiredString(value.synthesis_id, 'synthesis-id');
  const epoch = normalizeFiniteNonNegativeInteger(value.epoch, 'epoch');
  const voterId = normalizeRequiredString(value.voter_id, 'voter-id');
  const pointId = normalizeRequiredString(node.point_id, 'point-id');
  const baseNode = {
    point_id: pointId,
    agreement,
    weight: normalizeFiniteNumber(node.weight, 'weight'),
    updated_at: normalizeRequiredString(node.updated_at, 'updated-at'),
  };
  const isLumaNode =
    node.schema_version !== undefined ||
    node._protocolVersion !== undefined ||
    node._writerKind !== undefined ||
    node._authorScheme !== undefined ||
    node.signedWriteEnvelope !== undefined ||
    node.topic_id !== undefined ||
    node.synthesis_id !== undefined ||
    node.epoch !== undefined ||
    node.voter_id !== undefined;

  if (!isLumaNode) {
    assertExactObjectKeys(node, new Set(['point_id', 'agreement', 'weight', 'updated_at']), 'aggregate-voter-node');
    return {
      topic_id: topicId,
      synthesis_id: synthesisId,
      epoch,
      voter_id: voterId,
      node: baseNode,
    };
  }

  assertExactObjectKeys(
    node,
    new Set([
      'schema_version',
      '_protocolVersion',
      '_writerKind',
      '_authorScheme',
      'topic_id',
      'synthesis_id',
      'epoch',
      'voter_id',
      'point_id',
      'agreement',
      'weight',
      'updated_at',
      'signedWriteEnvelope',
    ]),
    'aggregate-voter-luma-node',
  );
  const lumaPayload = {
    schema_version: normalizeLiteralString(node.schema_version, 'schema-version', AGGREGATE_VOTER_NODE_VERSION),
    _protocolVersion: normalizeLiteralString(node._protocolVersion, 'protocol-version', AGGREGATE_PUBLIC_PROTOCOL_VERSION),
    _writerKind: normalizeLiteralString(node._writerKind, 'writer-kind', AGGREGATE_VOTER_WRITER_KIND),
    _authorScheme: normalizeLiteralString(node._authorScheme, 'author-scheme', AGGREGATE_VOTER_AUTHOR_SCHEME),
    topic_id: normalizeLiteralString(node.topic_id, 'node-topic-id', topicId),
    synthesis_id: normalizeLiteralString(node.synthesis_id, 'node-synthesis-id', synthesisId),
    epoch: normalizeLiteralNumber(node.epoch, 'node-epoch', epoch),
    voter_id: normalizeLiteralString(node.voter_id, 'node-voter-id', voterId),
    ...baseNode,
  };
  const signedWriteEnvelope = sanitizeAggregateVoterEnvelope(node.signedWriteEnvelope, lumaPayload, voterId);

  return {
    topic_id: topicId,
    synthesis_id: synthesisId,
    epoch,
    voter_id: voterId,
    node: {
      ...lumaPayload,
      signedWriteEnvelope,
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
  const readback = await runCriticalWriteReadback('/vh/forum/thread', clean.id, async () => {
    const threadChain = gun.get('vh').get('forum').get('threads').get(clean.id);
    const writes = [putWithTimeout(threadChain, clean)];
    for (const [key, value] of Object.entries(clean)) {
      writes.push(putWithTimeout(threadChain.get(key), value, 750));
    }
    await Promise.allSettled(writes);
    let observed = await pollThreadBack(threadChain, clean.id, 2_000);
    if (!observed) {
      injectGraph(gun, buildThreadGraph(clean));
      observed = await pollThreadBack(threadChain, clean.id, 5_000);
    }
    return observed;
  });
  if (!readback) {
    throw new Error('thread-readback-failed');
  }
  return readback;
}

async function writeForumComment(gun, comment) {
  const clean = sanitizeComment(comment);
  const readback = await runCriticalWriteReadback('/vh/forum/comment', clean.id, async () => {
    const indexRoot = gun.get('vh').get('forum').get('indexes').get('comment_ids').get(encodeURIComponent(clean.threadId));
    const existingCommentIds = await readCommentIndexIds(indexRoot, clean.threadId);
    injectGraph(gun, buildCommentGraph(clean, existingCommentIds));
    return pollCommentBack(gun, clean.threadId, clean.id, 5_000);
  });
  if (!readback) {
    throw new Error('comment-readback-failed');
  }
  return readback;
}

async function writeTopicSynthesis(gun, synthesis) {
  const clean = sanitizeTopicSynthesis(synthesis);
  const readback = await runCriticalWriteReadback('/vh/topics/synthesis', clean.synthesis_id, async () => {
    injectGraph(gun, buildTopicSynthesisGraph(clean));
    return pollTopicSynthesisBack(
      gun,
      clean.topic_id,
      clean.synthesis_id,
      5_000,
      { allowSnapshotFallback: false },
    );
  });
  if (!readback) {
    throw new Error('topic-synthesis-readback-failed');
  }
  upsertTopicSynthesisLatestSnapshot(clean);
  return clean;
}

async function writeTopicSynthesisCandidate(gun, candidate) {
  const clean = sanitizeTopicSynthesisCandidate(candidate);
  const readback = await runCriticalWriteReadback('/vh/topics/synthesis-candidate', clean.candidate_id, async () => {
    const candidateChain = gun
      .get('vh')
      .get('topics')
      .get(clean.topic_id)
      .get('epochs')
      .get(String(clean.epoch))
      .get('candidates')
      .get(clean.candidate_id);
    injectGraph(gun, buildTopicSynthesisCandidateGraph(clean));
    return stripGunMetadata(await readOnce(candidateChain, 5_000));
  });
  if (!readback || readback.candidate_id !== clean.candidate_id) {
    throw new Error('topic-synthesis-candidate-readback-failed');
  }
  return clean;
}

async function writeNewsStoryRecord(gun, body) {
  const clean = sanitizeNewsStoryWrite(body);
  const readback = await runCriticalWriteReadback(
    '/vh/news/story',
    clean.story_id,
    async () => {
      injectGraph(gun, buildNewsStoryGraph(clean));
      const observed = await pollNewsStoryBack(
        gun,
        clean.story_id,
        numberEnv('VH_RELAY_NEWS_STORY_WRITE_READBACK_TIMEOUT_MS', 5_000),
      );
      if (!observed) return null;
      await upsertNewsLatestIndexSnapshotFromWrite(gun, {
        storyId: clean.story_id,
        storyRecord: clean.record,
        reason: 'story_write',
      });
      return observed;
    },
  );
  if (!readback) {
    throw new Error('news-story-readback-failed');
  }
  return clean;
}

async function writeNewsLatestIndexRecord(gun, body) {
  const clean = sanitizeNewsLatestIndexWrite(body);
  const readback = await runCriticalWriteReadback(
    '/vh/news/latest-index',
    clean.story_id,
    async () => {
      injectGraph(gun, buildNewsLatestIndexGraph(clean));
      const observed = await pollNewsLatestIndexBack(
        gun,
        clean.story_id,
        numberEnv('VH_RELAY_NEWS_LATEST_INDEX_WRITE_READBACK_TIMEOUT_MS', 5_000),
      );
      if (!observed) return null;
      await upsertNewsLatestIndexSnapshotFromWrite(gun, {
        storyId: clean.story_id,
        latestRecord: observed,
        reason: 'latest_index_write',
      });
      return observed;
    },
  );
  if (!readback) {
    throw new Error('news-latest-index-readback-failed');
  }
  return clean;
}

async function writeNewsHotIndexRecord(gun, body) {
  const clean = sanitizeNewsHotIndexWrite(body);
  const readback = await runCriticalWriteReadback(
    '/vh/news/hot-index',
    clean.story_id,
    async () => {
      injectGraph(gun, buildNewsHotIndexGraph(clean));
      return pollNewsHotIndexBack(
        gun,
        clean.story_id,
        numberEnv('VH_RELAY_NEWS_HOT_INDEX_WRITE_READBACK_TIMEOUT_MS',
          numberEnv('VH_RELAY_NEWS_LATEST_INDEX_WRITE_READBACK_TIMEOUT_MS', 5_000)),
      );
    },
  );
  if (!readback) {
    throw new Error('news-hot-index-readback-failed');
  }
  return clean;
}

async function writeNewsSynthesisLifecycleRecord(gun, body) {
  const clean = sanitizeNewsSynthesisLifecycleWrite(body);
  const readback = await runCriticalWriteReadback(
    '/vh/news/synthesis-lifecycle',
    clean.story_id,
    async () => {
      injectGraph(gun, buildNewsSynthesisLifecycleGraph(clean));
      const observed = await pollNewsSynthesisLifecycleBack(
        gun,
        clean.story_id,
        clean.record,
        numberEnv('VH_RELAY_NEWS_LIFECYCLE_WRITE_READBACK_TIMEOUT_MS', 5_000),
      );
      if (!observed) return null;
      upsertNewsSynthesisLifecycleSnapshot(clean.record);
      await upsertNewsLatestIndexSnapshotFromWrite(gun, {
        storyId: clean.story_id,
        lifecycleRecord: observed,
        reason: 'synthesis_lifecycle_write',
      });
      return observed;
    },
  );
  if (!readback) {
    throw new Error('news-synthesis-lifecycle-readback-failed');
  }
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
  if (healthProbeCompactionMaxRecords <= 0) {
    logEvent('info', 'health_probe_compaction_skipped', {
      reason: 'max-records-not-configured',
    });
    return;
  }
  metrics.compactionRuns += 1;
  let tombstoned = 0;
  try {
    gun.get('vh').get('__health').map().once((value, key) => {
      if (tombstoned >= healthProbeCompactionMaxRecords) {
        return;
      }
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
    const message = String(error?.message || '');
    const status = error?.statusCode
      || (/(required|invalid|mismatch|private-field)/.test(message) ? 400 : 500);
    if (error?.code === 'relay-backpressure') {
      res.setHeader('Retry-After', String(error.retryAfterSeconds ?? criticalWriteReadbackRetryAfterSeconds));
    } else if (status === 401 || status === 403 || status === 503) {
      metrics.authRejects += 1;
    }
    incMap(metrics.writeFailures, label);
    logEvent(status >= 500 ? 'error' : 'warn', 'write_route_failed', {
      route: label,
      status,
      error: error instanceof Error ? error.message : String(error),
      ...(error?.code === 'relay-backpressure' ? { retry_after_seconds: error.retryAfterSeconds ?? criticalWriteReadbackRetryAfterSeconds } : {}),
    });
    sendJson(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(error?.code === 'relay-backpressure' ? { retryable: true, retry_after_seconds: error.retryAfterSeconds ?? criticalWriteReadbackRetryAfterSeconds } : {}),
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
      gun_stats_enabled: gunStatsEnabled,
      auth_required: authRequired,
      relay_peer_count: relayPeers.length,
      relay_peers_configured: relayPeers.length > 0,
      relay_peer_auth_mode: relayPeerAuthMode,
      active_connections: metrics.activeConnections,
      critical_write_readbacks_active: activeCriticalWriteReadbacks,
      critical_write_readbacks_queued: queuedCriticalWriteReadbacks.length,
      event_loop_delay: eventLoopDelaySummary(),
      memory: process.memoryUsage(),
      route_surface: 'vh-relay-http-v1',
      public_http_routes: PUBLIC_HTTP_RELAY_ROUTES,
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
      gun_stats_enabled: gunStatsEnabled,
      relay_peer_count: relayPeers.length,
      relay_peers_configured: relayPeers.length > 0,
      relay_peer_auth_mode: relayPeerAuthMode,
      relay_peer_auth_configured: relayPeerAuthMode !== 'none',
      critical_write_readbacks_active: activeCriticalWriteReadbacks,
      critical_write_readbacks_queued: queuedCriticalWriteReadbacks.length,
      event_loop_delay: eventLoopDelaySummary(),
      memory: process.memoryUsage(),
      route_surface: 'vh-relay-http-v1',
      public_http_routes: PUBLIC_HTTP_RELAY_ROUTES,
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

  if (req.method === 'GET' && pathname === '/vh/topics/synthesis') {
    const topicId = parsedUrl.searchParams.get('topic_id')?.trim();
    if (!topicId) {
      sendJson(res, 400, { ok: false, error: 'topic_id-required' });
      return;
    }
    void readTopicLatestSynthesisRecord(gun, topicId)
      .then((result) => {
        if (!result) {
          sendJson(res, 404, { ok: false, error: 'topic-synthesis-not-found', topic_id: topicId });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          topic_id: result.synthesis.topic_id,
          synthesis_id: result.synthesis.synthesis_id,
          synthesis: result.synthesis,
          record: result.record,
        });
      })
      .catch((error) => {
        sendJson(res, 502, {
          ok: false,
          error_class: 'vh-relay-502',
          error: error instanceof Error ? error.message : String(error),
          topic_id: topicId,
        });
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/vh/news/story') {
    const storyId = parsedUrl.searchParams.get('story_id')?.trim();
    if (!storyId) {
      sendJson(res, 400, { ok: false, error: 'story_id-required' });
      return;
    }
    void readNewsStoryRecord(gun, storyId)
      .then((result) => {
        if (!result) {
          sendJson(res, 404, { ok: false, error: 'news-story-not-found', story_id: storyId });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          story_id: result.story.story_id,
          topic_id: result.story.topic_id,
          source: result.source ?? 'story-body',
          story: result.story,
          record: result.record,
        });
      })
      .catch((error) => {
        sendJson(res, 502, {
          ok: false,
          error_class: 'vh-relay-502',
          error: error instanceof Error ? error.message : String(error),
          story_id: storyId,
        });
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/vh/news/latest-index') {
    const limit = parsedUrl.searchParams.get('limit');
    const includeRoot = boolEnv('VH_RELAY_NEWS_INDEX_REST_INCLUDE_ROOT', false)
      || parsedUrl.searchParams.get('include_root') === 'true';
    const includeExcluded = boolEnv('VH_RELAY_NEWS_INDEX_REST_INCLUDE_EXCLUDED', false)
      || parsedUrl.searchParams.get('include_excluded') === 'true';
    const consistencyFilter = parsedUrl.searchParams.get('consistency') === 'false'
      ? false
      : undefined;
    const scanLimit = parsedUrl.searchParams.get('scan_limit');
    const before = parsedUrl.searchParams.get('before');
    const compositionBackfillMinLimit = parsedUrl.searchParams.get('composition_backfill_min_limit');
    const persistMode = parsedUrl.searchParams.get('persist');
    if (persistMode !== null && persistMode !== 'false') {
      sendJson(res, 400, {
        ok: false,
        error: 'latest-index-persist-mode-unsupported',
        supported_persist_values: ['false'],
      });
      return;
    }
    void readNewsLatestIndexRecordsWithEmptyRetry(
      gun,
      {
        limit,
        includeRoot,
        includeExcluded,
        consistencyFilter,
        scanLimit,
        before,
        compositionBackfillMinLimit,
        persistSnapshotOnRead: false,
      },
    )
      .then((result) => {
        const payload = {
          ok: true,
          record_count: Object.keys(result.records).length,
          source_key_count: result.sourceKeyCount,
          window_source_key_count: result.windowSourceKeyCount,
          scanned_key_count: result.scannedKeyCount,
          truncated: result.truncated,
          before: result.before,
          next_cursor: result.nextCursor,
          consistency: result.consistency,
          composition: result.composition,
          composition_backfill_records: result.compositionBackfillRecords,
          backfill_used: result.compositionBackfillRecords.length > 0,
          backfill_story_ids: result.compositionBackfillRecords
            .map((record) => String(record?.story_id ?? '').trim())
            .filter(Boolean),
          story_states: result.storyStates,
          records: result.records,
          stories: result.stories,
        };
        if (result.root) payload.root = result.root;
        if (includeExcluded) {
          payload.excluded_records = result.excludedRecords;
          payload.repaired_records = result.repairedRecords;
        }
        sendJson(res, 200, payload);
      })
      .catch((error) => {
        sendJson(res, 502, {
          ok: false,
          error_class: 'vh-relay-502',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/vh/news/hot-index') {
    const limit = parsedUrl.searchParams.get('limit');
    const includeRoot = boolEnv('VH_RELAY_NEWS_HOT_INDEX_REST_INCLUDE_ROOT', false)
      || parsedUrl.searchParams.get('include_root') === 'true';
    const scanLimit = parsedUrl.searchParams.get('scan_limit');
    void readNewsHotIndexRecords(gun, { limit, includeRoot, scanLimit })
      .then((result) => {
        const payload = {
          ok: true,
          record_count: Object.keys(result.records).length,
          source_key_count: result.sourceKeyCount,
          scanned_key_count: result.scannedKeyCount,
          truncated: result.truncated,
          latest_fallback: result.latestFallback,
          records: result.records,
        };
        if (result.root) payload.root = result.root;
        sendJson(res, 200, payload);
      })
      .catch((error) => {
        sendJson(res, 502, {
          ok: false,
          error_class: 'vh-relay-502',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/vh/news/synthesis-lifecycle') {
    const storyId = parsedUrl.searchParams.get('story_id')?.trim();
    if (!storyId) {
      sendJson(res, 400, { ok: false, error: 'story_id-required' });
      return;
    }
    void Promise.all([
      readNewsSynthesisLifecycleRecord(gun, storyId).catch(() => null),
      readNewsSynthesisLifecycleRecordFromFields(gun, storyId).catch(() => null),
    ])
      .then(([direct, fromFields]) => {
        const lifecycle = direct ?? fromFields;
        if (!lifecycle) {
          sendJson(res, 404, {
            ok: false,
            error: 'news-synthesis-lifecycle-not-found',
            story_id: storyId,
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          story_id: storyId,
          topic_id: lifecycle.topic_id,
          status: lifecycle.status,
          frame_table_state: lifecycle.frame_table_state,
          lifecycle,
          record: lifecycle,
        });
      })
      .catch((error) => {
        sendJson(res, 502, {
          ok: false,
          error_class: 'vh-relay-502',
          error: error instanceof Error ? error.message : String(error),
          story_id: storyId,
        });
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/vh/aggregates/point') {
    const topicId = parsedUrl.searchParams.get('topic_id')?.trim();
    const synthesisId = parsedUrl.searchParams.get('synthesis_id')?.trim();
    const epoch = Number(parsedUrl.searchParams.get('epoch'));
    const pointId = parsedUrl.searchParams.get('point_id')?.trim();
    void readAggregatePoint(gun, { topicId, synthesisId, epoch, pointId })
      .then((result) => {
        sendJson(res, 200, {
          ok: true,
          topic_id: result.context.topicId,
          synthesis_id: result.context.synthesisId,
          epoch: result.context.epoch,
          point_id: result.context.pointId,
          aggregate: result.aggregate,
          snapshot: result.snapshot,
          row_count: result.row_count,
          cached: Boolean(result.cached),
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes('required') ? 400 : 502;
        sendJson(res, status, {
          ok: false,
          ...(status === 502 ? { error_class: 'vh-relay-502' } : {}),
          error: message,
          topic_id: topicId ?? null,
          synthesis_id: synthesisId ?? null,
          epoch: Number.isFinite(epoch) ? epoch : null,
          point_id: pointId ?? null,
        });
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/vh/forum/comments') {
    const threadId = parsedUrl.searchParams.get('thread_id')?.trim();
    if (!threadId) {
      sendJson(res, 400, { ok: false, error: 'thread_id-required' });
      return;
    }
    void readForumComments(gun, threadId)
      .then((result) => {
        sendJson(res, 200, {
          ok: true,
          thread_id: result.thread_id,
          comment_ids: result.comment_ids,
          count: result.comments.length,
          comments: result.comments,
        });
      })
      .catch((error) => {
        const status = String(error?.message || '').includes('required') ? 400 : 502;
        sendJson(res, status, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          thread_id: threadId,
        });
      });
    return;
  }

  if (req.method === 'GET' && pathname === '/vh/forum/thread') {
    const threadId = parsedUrl.searchParams.get('thread_id')?.trim();
    if (!threadId) {
      sendJson(res, 400, { ok: false, error: 'thread_id-required' });
      return;
    }
    void readForumThread(gun, threadId)
      .then((thread) => {
        if (!thread) {
          sendJson(res, 404, {
            ok: false,
            error: 'thread-not-found',
            thread_id: threadId,
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          thread_id: threadId,
          thread,
        });
      })
      .catch((error) => {
        const status = String(error?.message || '').includes('required') ? 400 : 502;
        sendJson(res, status, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          thread_id: threadId,
        });
      });
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

  if (req.method === 'POST' && pathname === '/vh/topics/synthesis-candidate') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.DAEMON, async (body) => {
      const candidate = await writeTopicSynthesisCandidate(gun, body.candidate);
      return {
        topic_id: candidate.topic_id,
        epoch: candidate.epoch,
        candidate_id: candidate.candidate_id,
      };
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/news/story') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.DAEMON, async (body) => {
      const write = await writeNewsStoryRecord(gun, body);
      return { story_id: write.story_id };
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/news/latest-index') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.DAEMON, async (body) => {
      const write = await writeNewsLatestIndexRecord(gun, body);
      return { story_id: write.story_id };
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/news/hot-index') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.DAEMON, async (body) => {
      const write = await writeNewsHotIndexRecord(gun, body);
      return { story_id: write.story_id };
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/news/synthesis-lifecycle') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.DAEMON, async (body) => {
      const write = await writeNewsSynthesisLifecycleRecord(gun, body);
      return {
        story_id: write.story_id,
        status: write.record.status,
      };
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/vh/aggregates/voter') {
    void handleWriteRoute(req, res, pathname, ROUTE_KIND.USER, async (body) => {
      const write = await writeAggregateVoter(gun, body);
      invalidateAggregatePointCache({
        topicId: write.topic_id,
        synthesisId: write.synthesis_id,
        epoch: write.epoch,
        pointId: write.node.point_id,
      });
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
      invalidateAggregatePointCache({
        topicId: snapshot.topic_id,
        synthesisId: snapshot.synthesis_id,
        epoch: snapshot.epoch,
        pointId: snapshot.point_id,
      });
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
  stats: gunStatsEnabled,
  axe: false,
  multicast: gunMulticastEnabled,
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

installFatalCaptureHandlers();
startRelayResourceWatchdog();
startRadataBytesRefresh();
startGunGraphScan(gun);

function listen() {
  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[vh:relay] Gun relay listening on ${host}:${port} relay_id=${relayId} peer_count=${relayPeers.length} peer_auth=${relayPeerAuthMode}`
    );
  });
}

if (relayStartupJitterMaxMs > 0) {
  const jitterMs = Math.floor(Math.random() * relayStartupJitterMaxMs);
  logEvent('info', 'relay_startup_jitter', {
    relay_id: relayId,
    jitter_ms: jitterMs,
    max_jitter_ms: relayStartupJitterMaxMs,
  });
  setTimeout(listen, jitterMs);
} else {
  listen();
}
