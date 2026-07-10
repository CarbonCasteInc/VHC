#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPublicFeedFreshnessMonitor } from './public-feed-freshness-monitor.mjs';
import { newsAggregatorPublisherLivenessWatchInternal } from './news-aggregator-publisher-liveness-watch.mjs';

const REPORT_SCHEMA_VERSION = 'vh-public-feed-alert-watch-v2';
const STATE_SCHEMA_VERSION = 'vh-public-feed-alert-state-v3';
const DEFAULT_UNIT = 'vh-news-aggregator.service';
const DEFAULT_STATE_DIR = '.local/state/vhc/public-feed-alert';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RELAY_LIVENESS_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_RELAY_SNAPSHOT_MAX_AGE_MS = 45 * 60 * 1000;
const DEFAULT_WATCH_CLOSURE_MAX_AGE_MS = 90 * 60 * 1000;
const NEWS_DAEMON_TRANSPORT_UNAVAILABLE_EXIT_CODE = '69';
const NEWS_DAEMON_WRAPPER_REFUSAL_EXIT_CODE = '75';
const NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE = '78';
// Public projections are constructed only from closed enums, exact numeric
// grammars, hashes, and ordinals. Raw report and error text is never emitted.
const FRESHNESS_FAILURE_REASON_CODES = new Set([
  'latest_index_empty',
  'latest_index_fetch_failed',
  'latest_index_stale',
  'latest_index_timestamp_missing',
]);
const FRESHNESS_BLOCKER_CLASSES = new Set([
  'health_unhealthy',
  'latest_index_not_fresh',
  'openai_preflight_failed',
  'origins_not_configured',
]);
const PASS_FAIL_STATUSES = new Set(['pass', 'fail']);
const PASS_WARN_FAIL_STATUSES = new Set(['pass', 'warn', 'fail']);
const REPORT_STATUSES = new Set(['pass', 'fail', 'skipped']);
const WATCH_VERDICT_STATUSES = new Set(['pass', 'fail', 'in_progress']);
const THRESHOLD_STATUSES = new Set(['pass', 'fail', 'not_ready']);
const DELIVERY_STATUSES = new Set(['pending', 'sent', 'suppressed', 'failed', 'missing_channel']);
const DELIVERY_REASONS = new Set([
  'test_fire',
  'first_failure',
  'retry_failed_delivery',
  'state_changed',
  'heartbeat_due',
  'unchanged_suppressed',
]);
const SYSTEMD_ACTIVE_STATES = new Set(['active', 'inactive', 'failed', 'activating', 'deactivating']);
const SYSTEMD_SUB_STATES = new Set(['running', 'dead', 'failed', 'auto-restart', 'exited']);
const SYSTEMD_RESULTS = new Set(['success', 'exit-code', 'signal', 'timeout', 'watchdog', 'start-limit-hit']);
const HEAP_PLATEAU_VERDICTS = new Set(['heap_driver_unknown', 'heap_plateau_observed', 'heap_still_linear']);
const RELAY_LIVENESS_REASON_CODES = new Set([
  'docker_inspect_failed',
  'restart_count_increased',
  'readyz_unhealthy',
  'readyz_failed',
  'metrics_unhealthy',
  'rss_hot',
  'heap_hot',
  'early_heap_snapshot_missing',
  'event_loop_lag_hot',
  'critical_readbacks_queued',
  'watchdog_trips_increased',
  'metrics_failed',
]);
const SNAPSHOT_REASON_CODES = new Set([
  'path_not_absolute',
  'unexpected_snapshot_filename',
  'unexpected_snapshot_path',
  'snapshot_missing',
  'mtime_not_sane',
  'snapshot_size_not_sane',
  'snapshot_parse_failed',
  'schema_mismatch',
  'entries_not_array',
  'entries_empty',
  'entry_count_mismatch',
  'cached_at_not_sane',
  'newest_entry_not_sane',
  'newest_entry_stale',
]);
const WATCH_CLOSURE_REASON_CODES = new Set([
  'archive_samples_missing',
  'archive_sample_failures',
  'publisher_nrestarts',
  'publisher_liveness_status',
  'relay_liveness_status',
  'relay_snapshot_status',
  'public_freshness_status',
  'runtime_failed_ticks',
  'runtime_raw_write_failures',
  'runtime_nonfatal_prewrite_failures',
  'storycluster_failure_artifact_dir_missing',
  'storycluster_failure_artifacts',
  'storycluster_degeneracy_warnings',
  'window_short',
  'relay_memory_trend_fail',
  'relay_memory_trend_warn',
  'sample_parse_failed',
]);
const PROJECTED_BLOCKER_CODES = new Set([
  'publisher_systemctl_failed',
  'publisher_exit_69_transport_unavailable',
  'publisher_exit_69_start_limit_parked',
  'publisher_exit_75_wrapper_refusal',
  'publisher_exit_78',
  'publisher_not_running',
  'publisher_restart_churn',
  'public_feed',
  'alert_delivery_failed',
  'alert_delivery_missing_channel',
]);
const PROJECTED_FAMILY_REASONS = new Map([
  ['public_feed', new Set([...FRESHNESS_BLOCKER_CLASSES, 'unclassified_blocker', 'status_fail'])],
  ['relay_liveness', new Set([
    ...RELAY_LIVENESS_REASON_CODES,
    'report_missing', 'report_invalid', 'output_stale', 'generated_at_missing', 'status_fail', 'unclassified',
  ])],
  ['relay_snapshot', new Set([
    ...SNAPSHOT_REASON_CODES,
    'report_missing', 'report_invalid', 'output_stale', 'generated_at_missing', 'status_fail', 'unclassified',
  ])],
  ['watch_closure', new Set([
    ...WATCH_CLOSURE_REASON_CODES,
    'verdict_missing', 'verdict_invalid', 'output_stale', 'generated_at_missing', 'status_fail',
    'heap_limit_source_default', 'unclassified',
  ])],
]);
const SEVERITY_RANK = {
  none: 0,
  warning: 1,
  critical: 2,
};

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) return trimmed;
  }
  return null;
}

function boolEnv(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function nonNegativeInt(value, fallback) {
  const parsed = strictNonNegativeInteger(value);
  return parsed === null ? fallback : parsed;
}

function strictNonNegativeInteger(value, max = Number.MAX_SAFE_INTEGER) {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,15}$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

function resolveHome(env) {
  return firstNonEmpty(env.HOME, process.env.HOME) ?? os.homedir();
}

function resolveStateDir(env) {
  return firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_STATE_DIR)
    ?? path.join(resolveHome(env), DEFAULT_STATE_DIR);
}

function resolveStateFile(env) {
  return firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_STATE_FILE)
    ?? path.join(resolveStateDir(env), 'state.json');
}

function resolveOutputFile(env) {
  return firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_OUTPUT_FILE)
    ?? path.join(resolveStateDir(env), 'latest.json');
}

function hashValue(value, length = 16) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
}

function sortedUniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))].sort();
}

function structuredFailureReasonCode(value) {
  const match = String(value ?? '').trim().toLowerCase().match(/^([a-z][a-z0-9_-]*)(?=:|$)/);
  const candidate = match?.[1] ?? null;
  return candidate && FRESHNESS_FAILURE_REASON_CODES.has(candidate)
    ? candidate
    : 'unclassified_failure';
}

function structuredFailureReasonCodes(values) {
  return sortedUniqueStrings((Array.isArray(values) ? values : []).map(structuredFailureReasonCode));
}

function failureNumericDiagnostics(value) {
  const text = String(value ?? '');
  const staleMatch = text.match(/^latest_index_stale:(\d{1,15})\/(\d{1,15})$/);
  if (staleMatch) {
    const newestAgeMs = strictNonNegativeInteger(staleMatch[1]);
    const maxAgeMs = strictNonNegativeInteger(staleMatch[2]);
    return newestAgeMs !== null && maxAgeMs !== null
      ? { maxAgeMs: [maxAgeMs], newestAgeMs: [newestAgeMs] }
      : {};
  }
  return {};
}

function structuredFailureDiagnostics(values) {
  // Public alert projections must be identical when only arbitrary detail
  // changes. Never add raw text or a raw-detail-derived hash here.
  return canonicalObjectSet((Array.isArray(values) ? values : []).map((value) => ({
    reasonCode: structuredFailureReasonCode(value),
    numericDiagnostics: failureNumericDiagnostics(value),
  })));
}

function blockerClass(value) {
  const match = String(value ?? '').trim().toLowerCase().match(/^([a-z][a-z0-9_-]*)(?=:|$)/);
  const candidate = match?.[1] ?? null;
  return candidate && FRESHNESS_BLOCKER_CLASSES.has(candidate)
    ? candidate
    : 'unclassified_blocker';
}

function blockerClasses(values) {
  return sortedUniqueStrings((values ?? []).map(blockerClass));
}

function blockerReasonCode(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const familyMatch = text.match(/^([a-z][a-z0-9_-]*):([a-z][a-z0-9_-]*)(?=:|$)/);
  if (familyMatch && PROJECTED_FAMILY_REASONS.get(familyMatch[1])?.has(familyMatch[2])) {
    return `${familyMatch[1]}:${familyMatch[2]}`;
  }
  const codeMatch = text.match(/^([a-z][a-z0-9_-]*)(?=:|$)/);
  return codeMatch && PROJECTED_BLOCKER_CODES.has(codeMatch[1]) ? codeMatch[1] : 'unclassified_blocker';
}

function blockerReasonCodes(values) {
  return sortedUniqueStrings((values ?? []).map(blockerReasonCode));
}

function canonicalObjectSet(values) {
  const byKey = new Map();
  for (const value of values) {
    const key = JSON.stringify(value);
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, value]) => value);
}

function strictRelayIdentityHash(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return /^vhc-relay-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? hashValue(normalized) : null;
}

function endpointIdentityHash(value) {
  try {
    const parsed = new URL(String(value ?? ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const endpoint = `${parsed.protocol.toLowerCase()}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ''}`;
    return hashValue(endpoint);
  } catch {
    return null;
  }
}

function canonicalIdentifiedEntries(values, identityKey = 'identityHash') {
  return values
    .map((value, index) => ({ ...value, sourceOrdinal: index + 1 }))
    .sort((left, right) => {
      const leftKey = left[identityKey] ?? `~${String(left.sourceOrdinal).padStart(8, '0')}`;
      const rightKey = right[identityKey] ?? `~${String(right.sourceOrdinal).padStart(8, '0')}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
    .map(({ sourceOrdinal, ...value }, index) => ({ ...value, ordinal: index + 1 }));
}

function projectedEnum(value, allowed, fallback = 'unknown') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.has(normalized) ? normalized : fallback;
}

function safeIsoTimestamp(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeNonNegativeNumber(value, { integer = false } = {}) {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) return null;
  return value;
}

function projectedSchemaVersion(value, expected) {
  if (value === null || value === undefined) return null;
  return value === expected ? expected : 'unrecognized';
}

function projectedFingerprint(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return /^[0-9a-f]{24}$/.test(normalized) ? normalized : null;
}

function projectAlertState(value) {
  if (!value || typeof value !== 'object') return null;
  const sourceStatuses = value.sourceStatuses && typeof value.sourceStatuses === 'object'
    ? Object.fromEntries(['publisher', 'freshness', 'relayLiveness', 'relaySnapshot', 'watchClosure']
        .map((key) => [key, projectedEnum(value.sourceStatuses[key], REPORT_STATUSES, 'fail')]))
    : null;
  return {
    schemaVersion: projectedSchemaVersion(value.schemaVersion, STATE_SCHEMA_VERSION),
    generatedAt: safeIsoTimestamp(value.generatedAt),
    lastObservedFingerprint: projectedFingerprint(value.lastObservedFingerprint),
    lastObservedStatus: projectedEnum(value.lastObservedStatus, PASS_FAIL_STATUSES, 'fail'),
    lastDeliveredFingerprint: projectedFingerprint(value.lastDeliveredFingerprint),
    lastDeliveredStatus: projectedEnum(value.lastDeliveredStatus, PASS_FAIL_STATUSES, 'fail'),
    lastDeliveredAt: safeIsoTimestamp(value.lastDeliveredAt),
    lastDeliveryStatus: projectedEnum(value.lastDeliveryStatus, DELIVERY_STATUSES, 'failed'),
    lastDeliveryReason: projectedEnum(value.lastDeliveryReason, DELIVERY_REASONS, 'unchanged_suppressed'),
    lastPublisherNRestarts: strictNonNegativeInteger(value.lastPublisherNRestarts),
    sourceStatuses,
  };
}

function projectedReasonCode(value, allowed, fallback = 'unclassified') {
  const match = String(value ?? '').trim().toLowerCase().match(/^([a-z][a-z0-9_-]*)(?=:|$)/);
  return match && allowed.has(match[1]) ? match[1] : fallback;
}

function projectedReasonCodes(values, allowed, fallback = 'unclassified') {
  return sortedUniqueStrings((Array.isArray(values) ? values : [])
    .map((value) => projectedReasonCode(value, allowed, fallback)));
}

function exactPair(text, pattern) {
  const match = text.match(pattern);
  if (!match) return null;
  const left = strictNonNegativeInteger(match[1]);
  const right = strictNonNegativeInteger(match[2]);
  return left === null || right === null ? null : [left, right];
}

function relayReasonNumericDiagnostics(value, reasonCode) {
  const text = String(value ?? '').trim().toLowerCase();
  if (reasonCode === 'readyz_unhealthy' || reasonCode === 'metrics_unhealthy') {
    const match = text.match(new RegExp(`^${reasonCode}:(\\d{3})$`));
    const httpStatus = match ? strictNonNegativeInteger(match[1], 599) : null;
    return httpStatus !== null && httpStatus >= 100 ? { httpStatus: [httpStatus] } : {};
  }
  if (reasonCode === 'event_loop_lag_hot') {
    const numberPattern = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
    const match = text.match(new RegExp(`^event_loop_lag_hot:(${numberPattern})/(${numberPattern})$`, 'i'));
    if (!match) return {};
    const observedMs = Number(match[1]);
    const limitMs = Number(match[2]);
    return Number.isFinite(observedMs) && Number.isFinite(limitMs)
      && observedMs >= 0 && limitMs >= 0
      && observedMs <= Number.MAX_SAFE_INTEGER && limitMs <= Number.MAX_SAFE_INTEGER
      ? { limitMs: [limitMs], observedMs: [observedMs] }
      : {};
  }
  const pair = exactPair(text, new RegExp(`^${reasonCode}:(\\d{1,15})/(\\d{1,15})$`));
  if (!pair) return {};
  const [observed, limit] = pair;
  if (reasonCode === 'restart_count_increased') return { currentRestartCount: [limit], previousRestartCount: [observed] };
  if (reasonCode === 'watchdog_trips_increased') return { currentWatchdogTrips: [limit], previousWatchdogTrips: [observed] };
  if (reasonCode === 'rss_hot') return { limitBytes: [limit], rssBytes: [observed] };
  if (reasonCode === 'heap_hot') return { heapUsedBytes: [observed], limitBytes: [limit] };
  if (reasonCode === 'early_heap_snapshot_missing') return { heapUsedBytes: [observed], thresholdBytes: [limit] };
  if (reasonCode === 'critical_readbacks_queued') return { limitCount: [limit], observedCount: [observed] };
  return {};
}

function relayReasonDiagnostics(values) {
  return canonicalObjectSet((Array.isArray(values) ? values : []).map((value) => {
    const reasonCode = projectedReasonCode(value, RELAY_LIVENESS_REASON_CODES);
    return { reasonCode, numericDiagnostics: relayReasonNumericDiagnostics(value, reasonCode) };
  }));
}

function snapshotReasonNumericDiagnostics(value, reasonCode) {
  const text = String(value ?? '').trim().toLowerCase();
  if (reasonCode === 'snapshot_size_not_sane') {
    const match = text.match(/^snapshot_size_not_sane:(\d{1,15})$/);
    const sizeBytes = match ? strictNonNegativeInteger(match[1]) : null;
    return sizeBytes === null ? {} : { sizeBytes: [sizeBytes] };
  }
  const pair = exactPair(text, new RegExp(`^${reasonCode}:(\\d{1,15})/(\\d{1,15})$`));
  if (!pair) return {};
  if (reasonCode === 'entry_count_mismatch') return { actualCount: [pair[0]], expectedCount: [pair[1]] };
  if (reasonCode === 'newest_entry_stale') return { maxAgeMs: [pair[1]], newestEntryAgeMs: [pair[0]] };
  return {};
}

function snapshotReasonDiagnostics(values) {
  return canonicalObjectSet((Array.isArray(values) ? values : []).map((value) => {
    const reasonCode = projectedReasonCode(value, SNAPSHOT_REASON_CODES);
    return { reasonCode, numericDiagnostics: snapshotReasonNumericDiagnostics(value, reasonCode) };
  }));
}

function thresholdFingerprintState(threshold) {
  if (!threshold) return null;
  return {
    status: threshold.status ?? null,
    blockerReasonCodes: blockerReasonCodes(threshold.blockers),
  };
}

function maxSeverity(...values) {
  let best = 'none';
  for (const value of values) {
    const severity = Object.hasOwn(SEVERITY_RANK, value) ? value : 'none';
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[best]) {
      best = severity;
    }
  }
  return best;
}

function freshnessAgeState(readback) {
  const newestAgeMs = Number.isFinite(readback?.newestAgeMs) ? readback.newestAgeMs : null;
  const maxAgeMs = Number.isFinite(readback?.maxAgeMs) ? readback.maxAgeMs : null;
  if (newestAgeMs === null || maxAgeMs === null) return 'unknown';
  return newestAgeMs > maxAgeMs ? 'stale' : 'fresh';
}

function readJsonFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonReport(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { exists: false, parsed: null, error: null };
  }
  try {
    return { exists: true, parsed: JSON.parse(readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { exists: true, parsed: null, error };
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function summarizeFreshnessReadback(readback) {
  return {
    endpointHash: endpointIdentityHash(readback?.origin),
    status: projectedEnum(readback?.status, PASS_FAIL_STATUSES, 'fail'),
    recordCount: safeNonNegativeNumber(readback?.recordCount, { integer: true }),
    newestAgeMs: safeNonNegativeNumber(readback?.newestAgeMs, { integer: true }),
    maxAgeMs: safeNonNegativeNumber(readback?.maxAgeMs, { integer: true }),
    failureCount: Array.isArray(readback?.failures) ? readback.failures.length : 0,
    failureReasonCodes: structuredFailureReasonCodes(readback?.failures),
    failureDiagnostics: structuredFailureDiagnostics(readback?.failures),
  };
}

function summarizeFreshness(summary) {
  const origins = Array.isArray(summary?.config?.origins) ? summary.config.origins : [];
  const latestIndexReadbacks = Array.isArray(summary?.latestIndexReadbacks)
    ? canonicalIdentifiedEntries(summary.latestIndexReadbacks.map(summarizeFreshnessReadback), 'endpointHash')
    : [];
  return {
    schemaVersion: projectedSchemaVersion(summary?.schemaVersion, 'public-feed-freshness-monitor-v1'),
    generatedAt: safeIsoTimestamp(summary?.generatedAt),
    status: projectedEnum(summary?.status, PASS_FAIL_STATUSES, 'fail'),
    blockers: blockerClasses(Array.isArray(summary?.blockers) ? summary.blockers : []),
    maxAgeMs: safeNonNegativeNumber(summary?.config?.maxAgeMs, { integer: true }),
    originCount: origins.length,
    originEndpointHashes: sortedUniqueStrings(origins.map(endpointIdentityHash).filter(Boolean)),
    latestIndexReadbacks,
  };
}

function reportGeneratedAgeMs(report, now) {
  const generatedAtMs = Date.parse(String(report?.generatedAt ?? ''));
  return Number.isFinite(generatedAtMs) ? Math.max(0, now - generatedAtMs) : null;
}

function reportInputEnabled(env, requireEnvName, fileEnvName) {
  const requireValue = firstNonEmpty(env[requireEnvName]);
  if (requireValue !== null) return boolEnv(requireValue, false);
  return Boolean(firstNonEmpty(env[fileEnvName]));
}

function reportFreshnessBlockers({ label, report, maxAgeMs, now }) {
  const blockers = [];
  const ageMs = reportGeneratedAgeMs(report, now);
  if (ageMs === null) {
    blockers.push(`${label}:generated_at_missing`);
  } else if (ageMs > maxAgeMs) {
    blockers.push(`${label}:output_stale:${ageMs}/${maxAgeMs}`);
  }
  return {
    ageMs,
    blockers,
  };
}

function hasBlockers(value) {
  return Array.isArray(value) && value.length > 0;
}

function relayLivenessFile(env) {
  return firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_FILE)
    ?? path.join(resolveHome(env), '.local/state/vhc/relay-liveness/latest.json');
}

function relaySnapshotFile(env) {
  return firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_RELAY_SNAPSHOT_FILE)
    ?? path.join(resolveHome(env), '.local/state/vhc/relay-snapshot-watch/latest.json');
}

function watchClosureVerdictFile(env) {
  return firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_WATCH_CLOSURE_VERDICT_FILE)
    ?? path.join(resolveHome(env), '.local/state/vhc/phase5-scope-a-watch-closure/verdict.json');
}

function summarizeRelayLivenessReport({ env, now }) {
  const enabled = reportInputEnabled(
    env,
    'VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_LIVENESS',
    'VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_FILE',
  );
  const filePath = relayLivenessFile(env);
  const maxAgeMs = nonNegativeInt(env.VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_MAX_AGE_MS, DEFAULT_RELAY_LIVENESS_MAX_AGE_MS);
  if (!enabled) {
    return { status: 'skipped', severity: 'none', required: false, sourceRole: 'relay_liveness', blockers: [] };
  }
  const read = readJsonReport(filePath);
  if (!read.exists) {
    return {
      status: 'fail',
      severity: 'critical',
      required: true,
      sourceRole: 'relay_liveness',
      generatedAt: null,
      ageMs: null,
      maxAgeMs,
      blockers: ['relay_liveness:report_missing'],
      relays: [],
    };
  }
  if (!read.parsed) {
    return {
      status: 'fail',
      severity: 'critical',
      required: true,
      sourceRole: 'relay_liveness',
      generatedAt: null,
      ageMs: null,
      maxAgeMs,
      blockers: ['relay_liveness:report_invalid'],
      relays: [],
    };
  }
  const freshness = reportFreshnessBlockers({
    label: 'relay_liveness',
    report: read.parsed,
    maxAgeMs,
    now,
  });
  const relays = Array.isArray(read.parsed.relays)
    ? canonicalIdentifiedEntries(read.parsed.relays.map((relay) => ({
        identityHash: strictRelayIdentityHash(relay.name),
        status: projectedEnum(relay.status, PASS_FAIL_STATUSES, 'fail'),
        reasonCodes: projectedReasonCodes(relay.blockers, RELAY_LIVENESS_REASON_CODES),
        reasonDiagnostics: relayReasonDiagnostics(relay.blockers),
        blockerCount: Array.isArray(relay.blockers) ? relay.blockers.length : 0,
        restartCount: safeNonNegativeNumber(relay.docker?.restartCount, { integer: true }),
        rssBytes: safeNonNegativeNumber(relay.metrics?.rssBytes, { integer: true }),
        heapUsedBytes: safeNonNegativeNumber(relay.metrics?.heapUsedBytes, { integer: true }),
        watchdogTrips: safeNonNegativeNumber(relay.metrics?.watchdogTrips, { integer: true }),
        eventLoopLagP99Ms: safeNonNegativeNumber(relay.metrics?.eventLoopLagP99Ms),
        criticalReadbacksQueued: safeNonNegativeNumber(relay.metrics?.criticalReadbacksQueued, { integer: true }),
      })))
    : [];
  const relayReasonCodes = sortedUniqueStrings(relays.flatMap((relay) => relay.reasonCodes));
  const statusBlockers = read.parsed.status === 'pass'
    ? []
    : relayReasonCodes.length > 0
      ? relayReasonCodes.map((code) => code === 'unclassified'
          ? 'relay_liveness:unclassified'
          : `relay_liveness:${code}`)
      : ['relay_liveness:status_fail'];
  const blockers = [
    ...freshness.blockers,
    ...statusBlockers,
  ];
  return {
    schemaVersion: projectedSchemaVersion(read.parsed.schemaVersion, 'vh-news-relay-liveness-watch-v1'),
    status: blockers.length > 0 ? 'fail' : 'pass',
    severity: hasBlockers(statusBlockers)
      ? 'critical'
      : hasBlockers(freshness.blockers)
        ? 'warning'
        : 'none',
    required: true,
    sourceRole: 'relay_liveness',
    generatedAt: safeIsoTimestamp(read.parsed.generatedAt),
    ageMs: freshness.ageMs,
    maxAgeMs,
    blockers,
    relays,
  };
}

function relayNameFromSnapshotPath(filePath) {
  return String(filePath ?? '').split(/[\\/]+/).find((segment) => segment.startsWith('vhc-relay-')) ?? null;
}

function summarizeRelaySnapshotReport({ env, now }) {
  const enabled = reportInputEnabled(
    env,
    'VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_SNAPSHOT',
    'VH_PUBLIC_FEED_ALERT_RELAY_SNAPSHOT_FILE',
  );
  const filePath = relaySnapshotFile(env);
  const maxAgeMs = nonNegativeInt(env.VH_PUBLIC_FEED_ALERT_RELAY_SNAPSHOT_MAX_AGE_MS, DEFAULT_RELAY_SNAPSHOT_MAX_AGE_MS);
  if (!enabled) {
    return { status: 'skipped', severity: 'none', required: false, sourceRole: 'relay_snapshot', blockers: [] };
  }
  const read = readJsonReport(filePath);
  if (!read.exists) {
    return {
      status: 'fail',
      severity: 'critical',
      required: true,
      sourceRole: 'relay_snapshot',
      generatedAt: null,
      ageMs: null,
      maxAgeMs,
      blockers: ['relay_snapshot:report_missing'],
      snapshots: [],
    };
  }
  if (!read.parsed) {
    return {
      status: 'fail',
      severity: 'critical',
      required: true,
      sourceRole: 'relay_snapshot',
      generatedAt: null,
      ageMs: null,
      maxAgeMs,
      blockers: ['relay_snapshot:report_invalid'],
      snapshots: [],
    };
  }
  const freshness = reportFreshnessBlockers({
    label: 'relay_snapshot',
    report: read.parsed,
    maxAgeMs,
    now,
  });
  const snapshots = Array.isArray(read.parsed.snapshots)
    ? canonicalIdentifiedEntries(read.parsed.snapshots.map((snapshot) => ({
        relayIdentityHash: strictRelayIdentityHash(relayNameFromSnapshotPath(snapshot.file)),
        status: projectedEnum(snapshot.status, PASS_FAIL_STATUSES, 'fail'),
        reasonCodes: projectedReasonCodes([
          ...(Array.isArray(snapshot.failures) ? snapshot.failures : []),
          ...(Array.isArray(snapshot.freshnessFailures) ? snapshot.freshnessFailures : []),
        ], SNAPSHOT_REASON_CODES),
        reasonDiagnostics: snapshotReasonDiagnostics([
          ...(Array.isArray(snapshot.failures) ? snapshot.failures : []),
          ...(Array.isArray(snapshot.freshnessFailures) ? snapshot.freshnessFailures : []),
        ]),
        entryCount: safeNonNegativeNumber(snapshot.entryCount, { integer: true }),
        cachedAgeMs: safeNonNegativeNumber(snapshot.cachedAgeMs, { integer: true }),
        newestEntryAgeMs: safeNonNegativeNumber(snapshot.newestEntryAgeMs, { integer: true }),
        failureCount: Array.isArray(snapshot.failures) ? snapshot.failures.length : 0,
        freshnessFailureCount: Array.isArray(snapshot.freshnessFailures) ? snapshot.freshnessFailures.length : 0,
      })), 'relayIdentityHash')
    : [];
  const snapshotReasonCodes = sortedUniqueStrings(snapshots.flatMap((snapshot) => snapshot.reasonCodes));
  const statusBlockers = read.parsed.status === 'pass'
    ? []
    : snapshotReasonCodes.length > 0
      ? snapshotReasonCodes.map((code) => code === 'unclassified'
          ? 'relay_snapshot:unclassified'
          : `relay_snapshot:${code}`)
      : ['relay_snapshot:status_fail'];
  const blockers = [
    ...freshness.blockers,
    ...statusBlockers,
  ];
  return {
    schemaVersion: projectedSchemaVersion(read.parsed.schemaVersion, 'vh-relay-latest-index-snapshot-watch-v1'),
    status: blockers.length > 0 ? 'fail' : 'pass',
    severity: blockers.length > 0 ? 'warning' : 'none',
    required: true,
    sourceRole: 'relay_snapshot',
    generatedAt: safeIsoTimestamp(read.parsed.generatedAt),
    ageMs: freshness.ageMs,
    maxAgeMs,
    blockers,
    snapshots,
  };
}

function defaultLimitSource(value) {
  return String(value ?? '').startsWith('default:');
}

function limitSourceClass(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return 'missing';
  return defaultLimitSource(normalized) ? 'default' : 'configured';
}

function projectWatchClosureBlocker(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const code = projectedReasonCode(text, WATCH_CLOSURE_REASON_CODES);
  if (code === 'unclassified') return 'watch_closure:unclassified';
  if (code === 'window_short') {
    const match = text.match(/^window_short:(\d{1,6}(?:\.\d{1,2})?)\/(24|48)$/);
    return match ? `watch_closure:window_short:${match[1]}/${match[2]}` : 'watch_closure:window_short';
  }
  const countCodes = new Set([
    'archive_sample_failures',
    'runtime_failed_ticks',
    'runtime_raw_write_failures',
    'runtime_nonfatal_prewrite_failures',
    'storycluster_failure_artifacts',
    'storycluster_degeneracy_warnings',
  ]);
  if (countCodes.has(code)) {
    const match = text.match(new RegExp(`^${code}:(\\d{1,15})$`));
    return match && Number.isSafeInteger(Number(match[1]))
      ? `watch_closure:${code}:${match[1]}`
      : `watch_closure:${code}`;
  }
  if (code === 'publisher_nrestarts') {
    const match = text.match(/^publisher_nrestarts:(\d{1,15})->(\d{1,15})$/);
    return match && Number.isSafeInteger(Number(match[1])) && Number.isSafeInteger(Number(match[2]))
      ? `watch_closure:publisher_nrestarts:${match[1]}/${match[2]}`
      : 'watch_closure:publisher_nrestarts';
  }
  return `watch_closure:${code}`;
}

function projectWatchClosureBlockers(values) {
  return sortedUniqueStrings((Array.isArray(values) ? values : []).map(projectWatchClosureBlocker));
}

function watchClosureProvenanceBlockers(verdict) {
  const relayMemory = verdict?.relayMemory;
  if (!relayMemory) return [];
  const blockers = [];
  if (defaultLimitSource(relayMemory.heapLimitSource)) {
    blockers.push('watch_closure:heap_limit_source_default');
  }
  if (Array.isArray(relayMemory.relays)) {
    for (const relay of relayMemory.relays) {
      if (!defaultLimitSource(relay?.heapLimitSource)) continue;
      blockers.push('watch_closure:heap_limit_source_default');
    }
  }
  return sortedUniqueStrings(blockers);
}

function summarizeWatchClosureVerdict({ env, now }) {
  const enabled = reportInputEnabled(
    env,
    'VH_PUBLIC_FEED_ALERT_REQUIRE_WATCH_CLOSURE',
    'VH_PUBLIC_FEED_ALERT_WATCH_CLOSURE_VERDICT_FILE',
  );
  const filePath = watchClosureVerdictFile(env);
  const maxAgeMs = nonNegativeInt(env.VH_PUBLIC_FEED_ALERT_WATCH_CLOSURE_MAX_AGE_MS, DEFAULT_WATCH_CLOSURE_MAX_AGE_MS);
  if (!enabled) {
    return { status: 'skipped', severity: 'none', required: false, sourceRole: 'watch_closure', blockers: [] };
  }
  const read = readJsonReport(filePath);
  if (!read.exists) {
    return {
      status: 'fail',
      severity: 'critical',
      required: true,
      sourceRole: 'watch_closure',
      generatedAt: null,
      ageMs: null,
      maxAgeMs,
      blockers: ['watch_closure:verdict_missing'],
      verdictStatus: null,
    };
  }
  if (!read.parsed) {
    return {
      status: 'fail',
      severity: 'critical',
      required: true,
      sourceRole: 'watch_closure',
      generatedAt: null,
      ageMs: null,
      maxAgeMs,
      blockers: ['watch_closure:verdict_invalid'],
      verdictStatus: null,
    };
  }
  const freshness = reportFreshnessBlockers({
    label: 'watch_closure',
    report: read.parsed,
    maxAgeMs,
    now,
  });
  const verdictStatus = projectedEnum(read.parsed.status, WATCH_VERDICT_STATUSES, 'fail');
  const verdictFailed = verdictStatus === 'fail';
  const verdictBlockers = verdictFailed
    ? Array.isArray(read.parsed.blockers) && read.parsed.blockers.length > 0
      ? projectWatchClosureBlockers(read.parsed.blockers)
      : ['watch_closure:status_fail']
    : [];
  const provenanceBlockers = watchClosureProvenanceBlockers(read.parsed);
  const blockers = [...freshness.blockers, ...verdictBlockers, ...provenanceBlockers];
  return {
    schemaVersion: projectedSchemaVersion(read.parsed.schemaVersion, 'vh-phase5-scope-a-watch-closure-verdict-v1'),
    status: blockers.length > 0 ? 'fail' : 'pass',
    severity: blockers.length > 0 ? 'warning' : 'none',
    required: true,
    sourceRole: 'watch_closure',
    generatedAt: safeIsoTimestamp(read.parsed.generatedAt),
    ageMs: freshness.ageMs,
    maxAgeMs,
    blockers,
    verdictStatus,
    verdictSeverity: verdictStatus === 'fail' ? 'critical' : verdictStatus === 'pass' ? 'ok' : 'info',
    window: read.parsed.window
      ? {
          startAt: safeIsoTimestamp(read.parsed.window.startAt),
          cleanStartAt: safeIsoTimestamp(read.parsed.window.cleanStartAt),
          hoursObserved: safeNonNegativeNumber(read.parsed.window.hoursObserved),
        }
      : null,
    thresholds: {
      twentyFourHour: read.parsed.thresholds?.twentyFourHour
        ? {
            status: projectedEnum(read.parsed.thresholds.twentyFourHour.status, THRESHOLD_STATUSES),
            blockers: projectWatchClosureBlockers(read.parsed.thresholds.twentyFourHour.blockers),
          }
        : null,
      fortyEightHour: read.parsed.thresholds?.fortyEightHour
        ? {
            status: projectedEnum(read.parsed.thresholds.fortyEightHour.status, THRESHOLD_STATUSES),
            blockers: projectWatchClosureBlockers(read.parsed.thresholds.fortyEightHour.blockers),
          }
        : null,
    },
    relayMemory: read.parsed.relayMemory
      ? {
          status: projectedEnum(read.parsed.relayMemory.status, PASS_WARN_FAIL_STATUSES, 'fail'),
          heapPlateauVerdict: projectedEnum(read.parsed.relayMemory.heapPlateauVerdict, HEAP_PLATEAU_VERDICTS),
          heapLimitSourceClass: limitSourceClass(read.parsed.relayMemory.heapLimitSource),
          rssLimitSourceClass: limitSourceClass(read.parsed.relayMemory.rssLimitSource),
          relays: Array.isArray(read.parsed.relayMemory.relays)
            ? canonicalIdentifiedEntries(read.parsed.relayMemory.relays.map((relay) => ({
                identityHash: strictRelayIdentityHash(relay.name),
                trendStatus: projectedEnum(relay.trendStatus, PASS_WARN_FAIL_STATUSES, 'fail'),
                heapPlateauVerdict: projectedEnum(relay.heapPlateauVerdict, HEAP_PLATEAU_VERDICTS),
                heapLimitSourceClass: limitSourceClass(relay.heapLimitSource),
                shortestProjectedLimitHours: safeNonNegativeNumber(relay.shortestProjectedLimitHours),
              })))
            : [],
        }
      : null,
  };
}

function readPublisherSystemctlShow(unit, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl('systemctl', [
    '--user',
    'show',
    unit,
    '-p',
    'ActiveState',
    '-p',
    'SubState',
    '-p',
    'NRestarts',
    '-p',
    'ExecMainStatus',
    '-p',
    'Result',
    '--no-pager',
  ], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error('systemctl_show_failed');
  }
  return String(result.stdout ?? '');
}

function inspectPublisherUnit({
  env,
  systemctlShowText = null,
  spawnSyncImpl = spawnSync,
} = {}) {
  const unit = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_PUBLISHER_UNIT, DEFAULT_UNIT);
  const blockers = [];
  let properties = {};
  try {
    properties = newsAggregatorPublisherLivenessWatchInternal.parseSystemctlShow(
      systemctlShowText ?? readPublisherSystemctlShow(unit, spawnSyncImpl),
    );
  } catch {
    blockers.push('publisher_systemctl_failed');
  }

  const activeState = projectedEnum(properties.ActiveState, SYSTEMD_ACTIVE_STATES);
  const subState = projectedEnum(properties.SubState, SYSTEMD_SUB_STATES);
  const parsedExecMainStatus = strictNonNegativeInteger(properties.ExecMainStatus, 255);
  const execMainStatus = parsedExecMainStatus !== null
    ? String(parsedExecMainStatus)
    : null;
  const result = projectedEnum(properties.Result, SYSTEMD_RESULTS);
  const nRestarts = strictNonNegativeInteger(properties.NRestarts);
  const running = activeState === 'active' && subState === 'running';
  const systemdRestarting = activeState === 'activating' || subState === 'auto-restart';
  const exit69 = execMainStatus === NEWS_DAEMON_TRANSPORT_UNAVAILABLE_EXIT_CODE;
  const exit75 = execMainStatus === NEWS_DAEMON_WRAPPER_REFUSAL_EXIT_CODE;
  const exit78 = execMainStatus === NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE;
  const startLimitHit = result === 'start-limit-hit';
  const exit69Restarting = !running && exit69 && systemdRestarting && !startLimitHit;
  const exit69Parked = !running && exit69 && (startLimitHit || !systemdRestarting);
  const failureClass = running
    ? 'none'
    : exit69Restarting
      ? 'exit_69_transport_unavailable'
      : exit69Parked
        ? 'exit_69_start_limit_parked'
        : exit75
          ? 'exit_75_wrapper_refusal'
          : exit78
            ? 'exit_78_fail_closed'
            : 'unit_not_running';
  const severity = failureClass === 'none'
    ? 'none'
    : failureClass === 'exit_69_transport_unavailable'
      ? 'warning'
      : 'critical';
  const recoveryHint = failureClass === 'exit_69_transport_unavailable'
    ? 'bounded_systemd_restart_in_progress'
    : failureClass === 'exit_69_start_limit_parked'
      ? 'start_limit_exhausted_operator_restart_required'
    : failureClass === 'exit_78_fail_closed'
      ? 'operator_required'
      : failureClass === 'exit_75_wrapper_refusal'
        ? 'operator_required'
      : !running
        ? 'operator_inspection_required'
        : 'none';

  if (!running && blockers.length === 0) {
    if (failureClass === 'exit_69_transport_unavailable') {
      blockers.push('publisher_exit_69_transport_unavailable');
    } else if (failureClass === 'exit_69_start_limit_parked') {
      blockers.push('publisher_exit_69_start_limit_parked');
    } else if (failureClass === 'exit_75_wrapper_refusal') {
      blockers.push('publisher_exit_75_wrapper_refusal');
    } else if (exit78) {
      blockers.push('publisher_exit_78');
    } else {
      blockers.push('publisher_not_running');
    }
  }

  return {
    unitRole: 'publisher',
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    activeState,
    subState,
    execMainStatus,
    result,
    nRestarts,
    failureClass,
    severity,
    recoveryHint,
  };
}

function previousPublisherRestartCount(previousState) {
  return strictNonNegativeInteger(previousState?.lastPublisherNRestarts);
}

function restartChurnBlocker({ publisher, previousState }) {
  const previousNRestarts = previousPublisherRestartCount(previousState);
  const currentNRestarts = Number.isFinite(publisher?.nRestarts) ? publisher.nRestarts : null;
  if (previousNRestarts === null || currentNRestarts === null || currentNRestarts <= previousNRestarts) {
    return null;
  }
  return `publisher_restart_churn:${previousNRestarts}/${currentNRestarts}`;
}

function fingerprintFor({
  status,
  blockers,
  publisher,
  freshness,
  relayLiveness,
  relaySnapshot,
  watchClosure,
}) {
  // Diagnostics retain their full secret-safe values; only this projection is
  // reduced to stable semantic state before hashing for delivery dedupe.
  // Closed family/reason codes and token-free endpoint identities drive real
  // transitions; raw report strings and secret-bearing URL components do not.
  return hashValue(JSON.stringify({
    status,
    blockerReasonCodes: blockerReasonCodes(blockers),
    publisher: {
      status: publisher.status,
      activeState: publisher.activeState,
      subState: publisher.subState,
      execMainStatus: publisher.execMainStatus,
      failureClass: publisher.failureClass,
    },
    freshness: {
      status: freshness.status,
      blockerClasses: blockerClasses(freshness.blockers),
      originCount: freshness.originCount ?? 0,
      originEndpointHashes: sortedUniqueStrings(freshness.originEndpointHashes ?? []),
      latestIndexReadbacks: canonicalObjectSet(freshness.latestIndexReadbacks.map((entry) => ({
        identity: entry.endpointHash ?? `ordinal:${entry.ordinal}`,
        status: entry.status,
        ageState: freshnessAgeState(entry),
        failureReasonCodes: sortedUniqueStrings(entry.failureReasonCodes ?? []),
      }))),
    },
    relayLiveness: {
      status: relayLiveness.status,
      blockerReasonCodes: blockerReasonCodes(relayLiveness.blockers),
      relays: canonicalObjectSet((relayLiveness.relays ?? []).map((relay) => ({
        identity: relay.identityHash ?? `ordinal:${relay.ordinal}`,
        status: relay.status,
        reasonCodes: sortedUniqueStrings(relay.reasonCodes ?? []),
      }))),
    },
    relaySnapshot: {
      status: relaySnapshot.status,
      blockerReasonCodes: blockerReasonCodes(relaySnapshot.blockers),
      snapshots: canonicalObjectSet((relaySnapshot.snapshots ?? []).map((snapshot) => ({
        identity: snapshot.relayIdentityHash ?? `ordinal:${snapshot.ordinal}`,
        status: snapshot.status,
        reasonCodes: sortedUniqueStrings(snapshot.reasonCodes ?? []),
      }))),
    },
    watchClosure: {
      status: watchClosure.status,
      blockerReasonCodes: blockerReasonCodes(watchClosure.blockers),
      verdictStatus: watchClosure.verdictStatus,
      thresholds: {
        twentyFourHour: thresholdFingerprintState(watchClosure.thresholds?.twentyFourHour),
        fortyEightHour: thresholdFingerprintState(watchClosure.thresholds?.fortyEightHour),
      },
      relayMemoryStatus: watchClosure.relayMemory?.status ?? null,
      relayMemoryVerdict: watchClosure.relayMemory?.heapPlateauVerdict ?? null,
      relayMemoryRelays: canonicalObjectSet((watchClosure.relayMemory?.relays ?? []).map((relay) => ({
        identity: relay.identityHash ?? `ordinal:${relay.ordinal}`,
        status: relay.trendStatus ?? null,
        verdict: relay.heapPlateauVerdict ?? null,
      }))),
    },
  }), 24);
}

function shouldDeliverAlert({
  env,
  now,
  status,
  fingerprint,
  previousState,
}) {
  const heartbeatMs = nonNegativeInt(env.VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS, 0);
  const testFire = boolEnv(env.VH_PUBLIC_FEED_ALERT_TEST_FIRE, false);
  const previousFingerprint = previousState?.lastObservedFingerprint ?? null;
  const previousStatus = previousState?.lastObservedStatus ?? null;
  const previousDeliveredFingerprint = previousState?.lastDeliveredFingerprint ?? null;
  const lastDeliveredAtMs = Date.parse(String(previousState?.lastDeliveredAt ?? ''));
  const previousStateSchemaVersion = previousState?.schemaVersion ?? null;
  const stateSchemaMismatch = previousStateSchemaVersion !== null
    && previousStateSchemaVersion !== STATE_SCHEMA_VERSION;
  const heartbeatDue = heartbeatMs > 0
    && (!Number.isFinite(lastDeliveredAtMs) || now - lastDeliveredAtMs >= heartbeatMs);
  const changed = previousFingerprint !== null && previousFingerprint !== fingerprint;
  const firstFailure = previousFingerprint === null && status === 'fail';
  const priorDeliveryFailed = ['failed', 'missing_channel'].includes(previousState?.lastDeliveryStatus);
  const retryUndeliveredState = previousFingerprint === fingerprint
    && (priorDeliveryFailed || (status === 'fail' && previousDeliveredFingerprint !== fingerprint));
  const failureOrRecoveryChanged = changed && (status === 'fail' || previousStatus === 'fail');
  let reason = 'unchanged_suppressed';
  if (testFire) {
    reason = 'test_fire';
  } else if (firstFailure) {
    reason = 'first_failure';
  } else if (retryUndeliveredState) {
    reason = 'retry_failed_delivery';
  } else if (failureOrRecoveryChanged) {
    reason = 'state_changed';
  } else if (stateSchemaMismatch && status === 'fail') {
    reason = 'state_changed';
  } else if (heartbeatDue) {
    reason = 'heartbeat_due';
  }
  return {
    deliver: testFire
      || firstFailure
      || retryUndeliveredState
      || failureOrRecoveryChanged
      || (stateSchemaMismatch && status === 'fail')
      || heartbeatDue,
    reason,
    heartbeatMs,
    status,
  };
}

function sourceStatusesFor({
  publisher,
  freshness,
  relayLiveness,
  relaySnapshot,
  watchClosure,
}) {
  return {
    publisher: projectedEnum(publisher?.status, REPORT_STATUSES, 'fail'),
    freshness: projectedEnum(freshness?.status, REPORT_STATUSES, 'fail'),
    relayLiveness: projectedEnum(relayLiveness?.status, REPORT_STATUSES, 'fail'),
    relaySnapshot: projectedEnum(relaySnapshot?.status, REPORT_STATUSES, 'fail'),
    watchClosure: projectedEnum(watchClosure?.status, REPORT_STATUSES, 'fail'),
  };
}

function alertPayload(summary, reason) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: summary.generatedAt,
    alertReason: reason,
    status: summary.status,
    observedStatus: summary.observedStatus,
    severity: summary.severity,
    blockers: summary.blockers,
    fingerprint: summary.fingerprint,
    publisher: summary.publisher,
    freshness: summary.freshness,
    relayLiveness: summary.relayLiveness,
    relaySnapshot: summary.relaySnapshot,
    watchClosure: summary.watchClosure,
  };
}

function signedWebhookHeaders({ body, secret, nowMs = Date.now(), nonce = randomUUID() }) {
  if (!secret) return { headers: { 'content-type': 'application/json' }, signature: null };
  const timestamp = String(nowMs);
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest('hex');
  return {
    headers: {
      'content-type': 'application/json',
      'x-vhc-alert-timestamp': timestamp,
      'x-vhc-alert-nonce': nonce,
      'x-vhc-alert-signature': `sha256=${signature}`,
    },
    signature: {
      algorithm: 'hmac-sha256',
      timestamp,
      nonce,
    },
  };
}

async function deliverWebhook({
  webhookUrl,
  payload,
  timeoutMs,
  hmacSecret = null,
  fetchImpl = fetch,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const body = JSON.stringify(payload);
  const signed = signedWebhookHeaders({ body, secret: hmacSecret });
  try {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: signed.headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`webhook_http_${response.status}`);
    }
    return { status: 'sent', channel: 'webhook' };
  } finally {
    clearTimeout(timeout);
  }
}

function formatEmail({ to, from, subject, payload }) {
  return [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    JSON.stringify(payload, null, 2),
    '',
  ].join('\r\n');
}

function validatedMailbox(value) {
  const mailbox = String(value ?? '').trim();
  if (!mailbox || /[\r\n]/.test(mailbox)) return null;
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+$/i.test(mailbox) ? mailbox : null;
}

function deliveryErrorClass(channel, error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (channel === 'webhook') {
    const httpMatch = message.match(/^webhook_http_(\d{3})$/);
    const httpStatus = httpMatch ? Number(httpMatch[1]) : null;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) {
      return `webhook_http_${httpStatus}`;
    }
    return error instanceof Error && error.name === 'AbortError' ? 'webhook_timeout' : 'webhook_network';
  }
  if (message === 'email_address_invalid') return 'email_address_invalid';
  if (message === 'sendmail_exit') return 'sendmail_exit';
  return 'email_transport';
}

function deliverEmail({
  env,
  payload,
  spawnSyncImpl = spawnSync,
}) {
  const rawTo = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_EMAIL_TO);
  const to = validatedMailbox(rawTo);
  if (!rawTo) return null;
  if (!to) throw new Error('email_address_invalid');
  const from = validatedMailbox(firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_EMAIL_FROM, 'vhc-public-feed-alert@localhost'));
  if (!from) throw new Error('email_address_invalid');
  const sendmail = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_SENDMAIL, '/usr/sbin/sendmail');
  const subject = `[VHC] public feed alert ${payload.status} ${payload.fingerprint}`;
  const result = spawnSyncImpl(sendmail, ['-t'], {
    input: formatEmail({ to, from, subject, payload }),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error('sendmail_exit');
  }
  return { status: 'sent', channel: 'email' };
}

async function deliverAlert({
  env,
  summary,
  deliveryDecision,
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
}) {
  if (!deliveryDecision.deliver) {
    return {
      status: 'suppressed',
      reason: deliveryDecision.reason,
      channels: [],
      error: null,
    };
  }

  const payload = alertPayload(summary, deliveryDecision.reason);
  const channels = [];
  const errors = [];
  const timeoutMs = nonNegativeInt(env.VH_PUBLIC_FEED_ALERT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const webhookUrl = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_WEBHOOK_URL);
  const hmacSecret = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_WEBHOOK_HMAC_SECRET);
  const hasEmail = Boolean(firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_EMAIL_TO));

  if (webhookUrl) {
    try {
      channels.push(await deliverWebhook({ webhookUrl, payload, timeoutMs, hmacSecret, fetchImpl }));
    } catch (error) {
      errors.push(deliveryErrorClass('webhook', error));
    }
  }

  if (hasEmail) {
    try {
      const result = deliverEmail({ env, payload, spawnSyncImpl });
      if (result) channels.push(result);
    } catch (error) {
      errors.push(deliveryErrorClass('email', error));
    }
  }

  if (!webhookUrl && !hasEmail) {
    return {
      status: 'missing_channel',
      reason: deliveryDecision.reason,
      channels: [],
      error: 'missing_channel',
    };
  }

  if (errors.length > 0 || channels.length === 0) {
    return {
      status: 'failed',
      reason: deliveryDecision.reason,
      channels,
      error: sortedUniqueStrings(errors).join('|') || 'delivery_channel_failed',
    };
  }

  return {
    status: 'sent',
    reason: deliveryDecision.reason,
    channels,
    error: null,
  };
}

async function persistState({
  stateFile,
  nowIso,
  fingerprint,
  status,
  publisher,
  sourceStatuses,
  delivery,
  previousState,
}) {
  const delivered = delivery.status === 'sent';
  const state = {
    schemaVersion: STATE_SCHEMA_VERSION,
    generatedAt: nowIso,
    lastObservedFingerprint: fingerprint,
    lastObservedStatus: status,
    lastDeliveredFingerprint: delivered
      ? fingerprint
      : previousState?.lastDeliveredFingerprint ?? null,
    lastDeliveredStatus: delivered
      ? status
      : previousState?.lastDeliveredStatus ?? null,
    lastDeliveredAt: delivered
      ? nowIso
      : previousState?.lastDeliveredAt ?? null,
    lastDeliveryStatus: delivery.status,
    lastDeliveryReason: delivery.reason,
    lastPublisherNRestarts: Number.isFinite(publisher?.nRestarts)
      ? publisher.nRestarts
      : previousState?.lastPublisherNRestarts ?? null,
    sourceStatuses,
  };
  await writeJson(stateFile, state);
  return state;
}

export async function runPublicFeedAlertWatch({
  env = process.env,
  repoRoot = process.cwd(),
  now = Date.now(),
  freshnessMonitorImpl = runPublicFeedFreshnessMonitor,
  systemctlShowText = null,
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
} = {}) {
  const generatedAt = new Date(now).toISOString();
  const stateFile = resolveStateFile(env);
  const outputFile = resolveOutputFile(env);
  const previousState = projectAlertState(readJsonFile(stateFile));
  const freshnessRaw = await freshnessMonitorImpl({ env, repoRoot, now });
  const freshness = summarizeFreshness(freshnessRaw);
  const publisher = inspectPublisherUnit({ env, systemctlShowText, spawnSyncImpl });
  const relayLiveness = summarizeRelayLivenessReport({ env, now });
  const relaySnapshot = summarizeRelaySnapshotReport({ env, now });
  const watchClosure = summarizeWatchClosureVerdict({ env, now });
  const restartChurn = restartChurnBlocker({ publisher, previousState });
  const observedBlockers = [
    ...publisher.blockers,
    ...(restartChurn ? [restartChurn] : []),
    ...(freshness.status === 'pass'
      ? []
      : freshness.blockers.length > 0
        ? freshness.blockers.map((blocker) => FRESHNESS_BLOCKER_CLASSES.has(blocker)
            ? `public_feed:${blocker}`
            : 'public_feed:unclassified_blocker')
        : ['public_feed:status_fail']),
    ...relayLiveness.blockers,
    ...relaySnapshot.blockers,
    ...watchClosure.blockers,
  ];
  const observedStatus = observedBlockers.length === 0 ? 'pass' : 'fail';
  const observedSeverity = maxSeverity(
    publisher.severity,
    restartChurn ? 'warning' : 'none',
    freshness.status === 'pass' ? 'none' : 'critical',
    relayLiveness.severity,
    relaySnapshot.severity,
    watchClosure.severity,
  );
  const fingerprint = fingerprintFor({
    status: observedStatus,
    blockers: observedBlockers,
    publisher,
    freshness,
    relayLiveness,
    relaySnapshot,
    watchClosure,
  });
  const deliveryDecision = shouldDeliverAlert({
    env,
    now,
    status: observedStatus,
    fingerprint,
    previousState,
  });

  const summary = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    status: observedStatus,
    observedStatus,
    severity: observedSeverity,
    blockers: observedBlockers,
    fingerprint,
    stateFileRole: 'state',
    outputFileRole: 'latest',
    publisher,
    freshness,
    relayLiveness,
    relaySnapshot,
    watchClosure,
    delivery: {
      status: 'pending',
      reason: deliveryDecision.reason,
      heartbeatMs: deliveryDecision.heartbeatMs,
      channels: [],
      error: null,
    },
  };

  const delivery = await deliverAlert({
    env,
    summary,
    deliveryDecision,
    fetchImpl,
    spawnSyncImpl,
  });
  summary.delivery = {
    ...summary.delivery,
    ...delivery,
  };
  if (['failed', 'missing_channel'].includes(delivery.status)) {
    summary.status = 'fail';
    summary.severity = maxSeverity(summary.severity, 'critical');
    summary.blockers.push(`alert_delivery_${delivery.status}`);
  }

  summary.state = await persistState({
    stateFile,
    nowIso: generatedAt,
    fingerprint,
    status: observedStatus,
    publisher,
    sourceStatuses: sourceStatusesFor({
      publisher,
      freshness,
      relayLiveness,
      relaySnapshot,
      watchClosure,
    }),
    delivery,
    previousState,
  });

  await writeJson(outputFile, summary);
  return summary;
}

async function main() {
  const summary = await runPublicFeedAlertWatch();
  console.info(JSON.stringify(alertConsoleProjection(summary), null, 2));
  if (summary.status !== 'pass') {
    process.exit(1);
  }
}

function alertConsoleProjection(summary) {
  return {
    status: summary.status,
    observedStatus: summary.observedStatus,
    severity: summary.severity,
    blockers: summary.blockers,
    fingerprint: summary.fingerprint,
    delivery: summary.delivery,
    outputFileRole: summary.outputFileRole,
  };
}

function unhandledErrorClass() {
  return 'alert_watch_unhandled_error';
}

export const publicFeedAlertWatchInternal = {
  REPORT_SCHEMA_VERSION,
  STATE_SCHEMA_VERSION,
  boolEnv,
  fingerprintFor,
  inspectPublisherUnit,
  maxSeverity,
  runPublicFeedAlertWatch,
  shouldDeliverAlert,
  summarizeFreshness,
  summarizeRelayLivenessReport,
  summarizeRelaySnapshotReport,
  summarizeWatchClosureVerdict,
  watchClosureProvenanceBlockers,
  signedWebhookHeaders,
  alertConsoleProjection,
  unhandledErrorClass,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('[vh:public-feed-alert-watch] failed', unhandledErrorClass());
    process.exit(1);
  });
}
