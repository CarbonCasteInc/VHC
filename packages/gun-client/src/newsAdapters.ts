import {
  assertCanonicalNewsTopicId,
  isCanonicalNewsTopicIdShape,
  StoryBundleSchema,
  type StoryBundle,
} from '@vh/data-model';
import { createGuardedChain, type ChainWithGet } from './chain';
import { writeWithDurability, type DurableWriteResult } from './durableWrite';
import { readGunTimeoutMs } from './runtimeConfig';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_VALIDATION_EVENT,
  buildSignedSystemWriterRecord,
  validateSystemWriterRecord,
  type SystemWriterRecordFields,
  type SystemWriterValidationFailure,
} from './systemWriter';
import type { VennClient } from './types';
import { resolveRelayRestEndpointFromPeer } from './relayRestFallback';

export type NewsLatestIndex = Record<string, number>;
export type NewsHotIndex = Record<string, number>;
export interface NewsLatestIndexPage {
  readonly index: NewsLatestIndex;
  readonly nextCursor: number | null;
  readonly recordCount: number;
  readonly sourceKeyCount?: number;
  readonly composition?: unknown;
  readonly stories?: Record<string, StoryBundle>;
  readonly storyStates?: Record<string, Record<string, unknown>>;
  readonly relayRestDiagnostics?: RelayRestReadDiagnostics;
  readonly directGunLatestIndexCount?: number;
}
export interface NewsLatestIndexReadOptions {
  readonly limit?: number;
  readonly before?: number;
}
export interface RelayRestEndpointDiagnostic {
  readonly endpoint: string;
  readonly ok: boolean;
  readonly status: number | null;
  readonly classification: string;
  readonly contentType?: string | null;
  readonly bodyExcerpt?: string;
  readonly error?: string;
}
export interface RelayRestReadDiagnostics {
  readonly endpointsAttempted: string[];
  readonly httpStatusCounts: Record<string, number>;
  readonly successCount: number;
  readonly nonOkResponses: RelayRestEndpointDiagnostic[];
  readonly networkFailures: RelayRestEndpointDiagnostic[];
  readonly cloudflare1033Count: number;
  readonly vhRelay502Count: number;
}
export interface NewsHotIndexReadOptions {
  readonly limit?: number;
}
export interface NewsStoryRootReadOptions {
  readonly limit?: number;
}
export type NewsSynthesisLifecycleStatus =
  | 'pending'
  | 'in_progress'
  | 'accepted_available'
  | 'retryable_failure'
  | 'terminal_unavailable'
  | 'suppressed';
export type NewsFrameTableReadinessState =
  | 'frame_table_pending'
  | 'frame_table_ready'
  | 'frame_table_unavailable';

export interface NewsSynthesisLifecycleRecord extends Record<string, unknown> {
  readonly schemaVersion: 'vh-news-synthesis-lifecycle-v1';
  readonly story_id: string;
  readonly topic_id: string;
  readonly source_set_revision: string;
  readonly source_count: number;
  readonly canonical_source_count: number;
  readonly status: NewsSynthesisLifecycleStatus;
  readonly retryable: boolean;
  readonly reason?: string;
  readonly synthesis_id?: string;
  readonly epoch?: number;
  readonly frame_table_state: NewsFrameTableReadinessState;
  readonly updated_at: number;
}

export interface NewsHotnessConfig {
  readonly version: 'storycluster-hot-v1';
  readonly decayHalfLifeHours: number;
  readonly breakingWindowHours: number;
  readonly breakingVelocityBoost: number;
  readonly weights: {
    readonly coverage: number;
    readonly velocity: number;
    readonly confidence: number;
    readonly sourceDiversity: number;
    readonly freshness: number;
  };
}

export const DEFAULT_NEWS_HOTNESS_CONFIG: NewsHotnessConfig = {
  version: 'storycluster-hot-v1',
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

const HOTNESS_ROUNDING_SCALE = 1_000_000;
const MS_PER_HOUR = 3_600_000;

const FORBIDDEN_NEWS_KEYS = new Set<string>([
  'identity',
  'identity_id',
  'nullifier',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'session_token',
  'auth_token',
  'oauth_token',
  'authorization',
  'bearer_token',
  'devicepub',
  'device_pub',
  'epub',
  'email',
  'wallet',
  'address'
]);

const STORY_BUNDLE_JSON_KEY = '__story_bundle_json';
const NEWS_SYNTHESIS_LIFECYCLE_SCHEMA_VERSION = 'vh-news-synthesis-lifecycle-v1';
const DEFAULT_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';
const LEGACY_SYSTEM_SIGNATURE_KEYS = [
  '_system',
  '_Signature',
  '_WriterId',
  '_IssuedAt',
] as const;
const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_READ_TIMEOUT_MS', 'VH_GUN_READ_TIMEOUT_MS'],
  2_500,
);
const RELAY_REST_READ_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_NEWS_RELAY_REST_READ_TIMEOUT_MS', 'VH_NEWS_RELAY_REST_READ_TIMEOUT_MS'],
  10_000,
);
const RELAY_REST_INDEX_LIMIT = readGunTimeoutMs(
  ['VITE_VH_NEWS_RELAY_REST_INDEX_LIMIT', 'VH_NEWS_RELAY_REST_INDEX_LIMIT'],
  80,
  4,
);
const ROOT_INDEX_SETTLE_MS = 150;
const REST_DIAGNOSTIC_EXCERPT_MAX = 320;
const SECRET_TEXT_PATTERNS = [
  /sk-[A-Za-z0-9_*=\\-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /"?(?:api[_-]?key|token|authorization|secret)"?\s*[:=]\s*"[^"]+"/gi,
] as const;

function normalizeLatestIndexReadLimit(limit: unknown, fallback = RELAY_REST_INDEX_LIMIT): number {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeLatestIndexBeforeCursor(before: unknown): number | null {
  const parsed = Number(before);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function filterLatestIndexWindow(
  index: NewsLatestIndex,
  options: NewsLatestIndexReadOptions = {},
): NewsLatestIndex {
  const limit = normalizeLatestIndexReadLimit(options.limit);
  const before = normalizeLatestIndexBeforeCursor(options.before);
  const entries = Object.entries(index)
    .filter(([, timestamp]) => before === null || timestamp < before)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
  return Object.fromEntries(entries);
}

function redactRelayRestExcerpt(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  const redacted = SECRET_TEXT_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, (match) => {
      if (match.toLowerCase().startsWith('bearer ')) {
        return 'Bearer [REDACTED]';
      }
      const [name] = match.split(/[:=]/);
      return `${name ?? 'secret'}:"[REDACTED]"`;
    }),
    compact,
  );
  return redacted.length > REST_DIAGNOSTIC_EXCERPT_MAX
    ? `${redacted.slice(0, REST_DIAGNOSTIC_EXCERPT_MAX - 3)}...`
    : redacted;
}

function classifyRelayRestHttpFailure(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (
    status === 530 &&
    (lower.includes('error 1033') || lower.includes('cloudflare tunnel') || lower.includes('cloudflare'))
  ) {
    return 'cloudflare-1033';
  }
  if (status === 502) {
    return 'vh-relay-502';
  }
  return `http-${status}`;
}

function relayRestNetworkClassification(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/i.test(message)) return 'timeout';
  if (/fetch failed|getaddrinfo|econnrefused|enotfound|network/i.test(message)) return 'network';
  return 'error';
}

function createRelayRestReadDiagnostics(endpoints: readonly string[]): RelayRestReadDiagnostics {
  return {
    endpointsAttempted: [...endpoints],
    httpStatusCounts: {},
    successCount: 0,
    nonOkResponses: [],
    networkFailures: [],
    cloudflare1033Count: 0,
    vhRelay502Count: 0,
  };
}

function incrementRelayRestStatus(diagnostics: RelayRestReadDiagnostics, status: number): void {
  const key = String(status);
  diagnostics.httpStatusCounts[key] = (diagnostics.httpStatusCounts[key] ?? 0) + 1;
}

function recordRelayRestSuccess(diagnostics: RelayRestReadDiagnostics, status: number): void {
  incrementRelayRestStatus(diagnostics, status);
  (diagnostics as { successCount: number }).successCount += 1;
}

function recordRelayRestNonOk(
  diagnostics: RelayRestReadDiagnostics,
  {
    endpoint,
    status,
    contentType,
    body,
  }: {
    readonly endpoint: string;
    readonly status: number;
    readonly contentType: string | null;
    readonly body: string;
  },
): void {
  incrementRelayRestStatus(diagnostics, status);
  const classification = classifyRelayRestHttpFailure(status, body);
  if (classification === 'cloudflare-1033') {
    (diagnostics as { cloudflare1033Count: number }).cloudflare1033Count += 1;
  }
  if (classification === 'vh-relay-502') {
    (diagnostics as { vhRelay502Count: number }).vhRelay502Count += 1;
  }
  diagnostics.nonOkResponses.push({
    endpoint,
    ok: false,
    status,
    classification,
    contentType,
    bodyExcerpt: redactRelayRestExcerpt(body),
  });
}

function recordRelayRestNetworkFailure(
  diagnostics: RelayRestReadDiagnostics,
  endpoint: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  diagnostics.networkFailures.push({
    endpoint,
    ok: false,
    status: null,
    classification: relayRestNetworkClassification(error),
    error: redactRelayRestExcerpt(message),
  });
}

function createRelayRestTimeoutDiagnostics(
  endpoints: readonly string[],
  label: string,
  timeoutMs: number,
): RelayRestReadDiagnostics {
  const diagnostics = createRelayRestReadDiagnostics(endpoints);
  for (const endpoint of endpoints) {
    recordRelayRestNetworkFailure(diagnostics, endpoint, new Error(`${label}-timeout:${timeoutMs}`));
  }
  return diagnostics;
}

function latestIndexWindowNextCursor(index: NewsLatestIndex): number | null {
  const timestamps = Object.values(index)
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= 0)
    .sort((left, right) => left - right);
  return timestamps[0] ?? null;
}

function normalizeRelayLatestIndexNextCursor(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function filterHotIndexWindow(
  index: NewsHotIndex,
  options: NewsHotIndexReadOptions = {},
): NewsHotIndex {
  const limit = normalizeLatestIndexReadLimit(options.limit);
  const entries = Object.entries(index)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
  return Object.fromEntries(entries);
}

export interface SystemWriterStoryBundleRecord extends Record<string, unknown>, SystemWriterRecordFields {
  readonly [STORY_BUNDLE_JSON_KEY]: string;
  readonly story_id: string;
  readonly created_at: number;
  readonly schemaVersion: StoryBundle['schemaVersion'];
}

export interface SystemWriterLatestIndexRecord extends Record<string, unknown>, SystemWriterRecordFields {
  readonly story_id: string;
  readonly latest_activity_at: number;
  readonly product_state_schema_version?: 'vh-news-product-feed-index-v1';
  readonly topic_id?: string;
  readonly source_set_revision?: string;
  readonly source_count?: number;
  readonly canonical_source_count?: number;
  readonly story_created_at?: number;
  readonly cluster_window_start?: number;
}

export type NewsLatestIndexEntryRecord = Pick<
  SystemWriterLatestIndexRecord,
  | 'story_id'
  | 'latest_activity_at'
  | 'product_state_schema_version'
  | 'topic_id'
  | 'source_set_revision'
  | 'source_count'
  | 'canonical_source_count'
  | 'story_created_at'
  | 'cluster_window_start'
>;

export interface SystemWriterHotIndexRecord extends Record<string, unknown>, SystemWriterRecordFields {
  readonly story_id: string;
  readonly hotness: number;
  readonly product_state_schema_version?: 'vh-news-product-feed-index-v1';
  readonly topic_id?: string;
  readonly source_set_revision?: string;
  readonly source_count?: number;
  readonly canonical_source_count?: number;
  readonly story_created_at?: number;
  readonly cluster_window_start?: number;
}

export type NewsHotIndexEntryRecord = Pick<
  SystemWriterHotIndexRecord,
  | 'story_id'
  | 'hotness'
  | 'product_state_schema_version'
  | 'topic_id'
  | 'source_set_revision'
  | 'source_count'
  | 'canonical_source_count'
  | 'story_created_at'
  | 'cluster_window_start'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isForbiddenNewsKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (FORBIDDEN_NEWS_KEYS.has(normalized)) {
    return true;
  }
  if (normalized.startsWith('identity_')) {
    return true;
  }
  if (normalized.endsWith('_token')) {
    return true;
  }
  if (normalized.includes('oauth') || normalized.includes('bearer') || normalized.includes('nullifier')) {
    return true;
  }
  return false;
}

/**
 * Defensive privacy guard for public StoryBundle payloads.
 * Rejects identity/token fields even when nested.
 */
export function hasForbiddenNewsPayloadFields(payload: unknown): boolean {
  const seen = new Set<unknown>();

  const walk = (value: unknown): boolean => {
    if (!isRecord(value)) {
      return false;
    }

    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.some((entry) => walk(entry));
    }

    for (const [key, nested] of Object.entries(value)) {
      if (isForbiddenNewsKey(key)) {
        return true;
      }
      if (walk(nested)) {
        return true;
      }
    }

    return false;
  };

  return walk(payload);
}

function assertNoNewsIdentityOrTokenFields(payload: unknown): void {
  if (hasForbiddenNewsPayloadFields(payload)) {
    throw new Error('News payload contains forbidden identity/token fields');
  }
}

function storyPath(storyId: string): string {
  return `vh/news/stories/${storyId}/`;
}

function storiesPath(): string {
  return 'vh/news/stories/';
}

function latestIndexPath(): string {
  return 'vh/news/index/latest/';
}

function latestIndexEntryPath(storyId: string): string {
  return `vh/news/index/latest/${storyId}/`;
}

function hotIndexPath(): string {
  return 'vh/news/index/hot/';
}

function hotIndexEntryPath(storyId: string): string {
  return `vh/news/index/hot/${storyId}/`;
}

function synthesisLifecycleLatestPath(storyId: string): string {
  return `vh/news/stories/${storyId}/synthesis_lifecycle/latest/`;
}

function sanitizeLeaseScope(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized.length > 0 ? normalized.slice(0, 160) : null;
}

function resolveNewsIngestionLeaseScope(client: VennClient): string | null {
  return sanitizeLeaseScope(client.config.newsIngestionLeaseScope);
}

function ingestionLeasePath(client: VennClient): string {
  const scope = resolveNewsIngestionLeaseScope(client);
  return scope
    ? `vh/news/runtime/lease/ingester/${scope}/`
    : 'vh/news/runtime/lease/ingester/';
}

function removalPath(urlHash: string): string {
  return `vh/news/removed/${urlHash}/`;
}

function readOnce<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, READ_ONCE_TIMEOUT_MS);

    chain.once((data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve((data ?? null) as T | null);
    });
  });
}

function readSettledRoot<T>(
  chain: ChainWithGet<T>,
  canSettle: (value: T | null) => boolean,
): Promise<T | null> {
  const subscribe = chain.on;
  const unsubscribe = chain.off;
  if (typeof subscribe !== 'function' || typeof unsubscribe !== 'function') {
    return readOnce(chain);
  }

  return new Promise<T | null>((resolve) => {
    let settled = false;
    let latest: T | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      unsubscribe.call(chain, onData);
      resolve(latest);
    };

    const onData = (data: T | undefined) => {
      latest = (data ?? null) as T | null;
      if (canSettle(latest)) {
        if (settleTimer) {
          clearTimeout(settleTimer);
        }
        settleTimer = setTimeout(finish, ROOT_INDEX_SETTLE_MS);
      }
    };

    const timeout = setTimeout(finish, READ_ONCE_TIMEOUT_MS);
    subscribe.call(chain, onData);
  });
}

function hasSettledLatestIndexPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Object.entries(value).some(([storyId, entry]) => storyId !== '_' && parseLatestTimestamp(entry) !== null) ||
    extractIndexChildKeys(value).length > 0
  );
}

function hasSettledHotIndexPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Object.entries(value).some(([storyId, entry]) => storyId !== '_' && parseHotnessScore(entry) !== null) ||
    extractIndexChildKeys(value).length > 0
  );
}

function hasSettledStoryRootPayload(value: unknown): boolean {
  return isRecord(value) && extractIndexChildKeys(value).length > 0;
}

function extractIndexChildKeys(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  const keys = new Set<string>();
  for (const key of Object.keys(value)) {
    if (key !== '_') {
      keys.add(key);
    }
  }

  const metadata = value._;
  if (isRecord(metadata)) {
    const fieldState = metadata['>'];
    if (isRecord(fieldState)) {
      for (const key of Object.keys(fieldState)) {
        if (key !== '_') {
          keys.add(key);
        }
      }
    }
  }

  return [...keys].sort();
}

async function readIndexedEntries(
  chain: ChainWithGet<unknown>,
  raw: unknown,
  parseEntry: (storyId: string, value: unknown) => Promise<number | null>,
  blockedStoryIds: ReadonlySet<string> = new Set(),
): Promise<Record<string, number>> {
  const keys = extractIndexChildKeys(raw);
  if (keys.length === 0) {
    return {};
  }

  const entries = await Promise.all(keys.map(async (storyId) => {
    if (blockedStoryIds.has(storyId)) {
      return null;
    }
    const value = await readOnce(chain.get(storyId) as unknown as ChainWithGet<unknown>);
    const parsed = await parseEntry(storyId, value);
    return parsed === null ? null : ([storyId, parsed] as const);
  }));

  const output: Record<string, number> = {};
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    output[entry[0]] = entry[1];
  }
  return output;
}

function hasMissingIndexChildEntries(
  raw: unknown,
  parsedIndex: Readonly<Record<string, number>>,
  blockedStoryIds: ReadonlySet<string>,
): boolean {
  return extractIndexChildKeys(raw).some((storyId) =>
    !blockedStoryIds.has(storyId) && parsedIndex[storyId] === undefined,
  );
}

function readMappedChildKeys(
  chain: ChainWithGet<unknown>,
  options: {
    readonly limit: number;
    readonly timeoutMs?: number;
    readonly existingKeys?: ReadonlySet<string>;
  },
): Promise<string[]> {
  const mapped = chain.map?.();
  if (!mapped || typeof mapped.on !== 'function') {
    return Promise.resolve([]);
  }
  const subscribe = mapped.on.bind(mapped);

  const limit = Math.max(0, Math.floor(options.limit));
  if (limit <= 0) {
    return Promise.resolve([]);
  }

  const timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? READ_ONCE_TIMEOUT_MS));
  const existingKeys = options.existingKeys ?? new Set<string>();
  return new Promise((resolve) => {
    const keys = new Set<string>();
    let settled = false;
    const finish = () => {
      /* v8 ignore next 3 -- defensive against duplicate map completion after listener cleanup or timer races. */
      if (settled) {
        return;
      }
      settled = true;
      try {
        mapped.off?.();
      } catch {
        // Best-effort cleanup for Gun map listeners.
      }
      resolve([...keys].sort().slice(0, limit));
    };
    const timeout = setTimeout(finish, timeoutMs);
    try {
      subscribe((data: unknown, key?: string) => {
        if (settled || !key || key === '_' || !key.trim()) {
          return;
        }
        if (data === null || data === undefined) {
          return;
        }
        const normalizedKey = key.trim();
        keys.add(normalizedKey);
        const mergedCount = new Set([...existingKeys, ...keys]).size;
        if (mergedCount >= limit) {
          clearTimeout(timeout);
          finish();
        }
      });
    } catch {
      clearTimeout(timeout);
      finish();
    }
  });
}

const NEWS_PUT_ACK_TIMEOUT_MS = 1000;
const NEWS_ACK_WARN_INTERVAL_MS = 15_000;
let lastNewsAckWarnAt = Number.NEGATIVE_INFINITY;
let suppressedNewsAckWarns = 0;

function warnNewsAckTimeout(): void {
  const now = Date.now();
  if (now - lastNewsAckWarnAt < NEWS_ACK_WARN_INTERVAL_MS) {
    suppressedNewsAckWarns += 1;
    return;
  }

  const suffix =
    suppressedNewsAckWarns > 0
      ? ` (suppressed ${suppressedNewsAckWarns} repeats)`
      : '';
  suppressedNewsAckWarns = 0;
  lastNewsAckWarnAt = now;
  console.warn(`[vh:news] put ack timed out, requiring readback confirmation${suffix}`);
}

async function putWithAck<T>(
  chain: ChainWithGet<T>,
  value: T,
  options: {
    readonly writeClass: string;
    readonly timeoutError?: string;
    readonly readback?: () => Promise<unknown>;
    readonly readbackPredicate?: (observed: unknown) => boolean;
    readonly requireReadback?: boolean;
  },
): Promise<DurableWriteResult> {
  return writeWithDurability({
    chain,
    value,
    writeClass: options.writeClass,
    timeoutMs: NEWS_PUT_ACK_TIMEOUT_MS,
    timeoutError: options.timeoutError,
    readback: options.readback,
    readbackPredicate: options.readbackPredicate,
    requireReadback: Boolean(options.requireReadback && options.readback && options.readbackPredicate),
    onAckTimeout: warnNewsAckTimeout,
  });
}

function newsWriteRequiresReadback(client: VennClient): boolean {
  return client.config.requireNewsWriteReadback !== false;
}

async function clearWithAck<T>(chain: ChainWithGet<T>): Promise<void> {
  await putWithAck(chain as unknown as ChainWithGet<T | null>, null as T | null, {
    writeClass: 'news-clear',
    timeoutError: 'news clear timed out and readback did not confirm removal',
    readback: () => readOnce(chain as unknown as ChainWithGet<T | null>),
    readbackPredicate: (observed) => observed === null,
  });
}

async function clearMapEntryWithAck(
  chain: ChainWithGet<Record<string, unknown>>,
  storyId: string,
): Promise<void> {
  await putWithAck(chain, { [storyId]: null }, {
    writeClass: 'news-map-clear',
    timeoutError: 'news map clear timed out and readback did not confirm removal',
    readback: () => readOnce(chain.get(storyId) as unknown as ChainWithGet<unknown>),
    readbackPredicate: (observed) => observed === null,
  });
}

/**
 * Latest-index migration parser.
 *
 * Supports:
 * - target activity timestamps (number/string scalar)
 * - transitional objects (`cluster_window_end`, `latest_activity_at`)
 * - legacy objects (`created_at`)
 */
function parseLatestTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
    return null;
  }

  if (isRecord(value)) {
    if ('cluster_window_end' in value) {
      return parseLatestTimestamp(value.cluster_window_end);
    }
    if ('latest_activity_at' in value) {
      return parseLatestTimestamp(value.latest_activity_at);
    }
    if ('created_at' in value) {
      return parseLatestTimestamp(value.created_at);
    }
  }

  return null;
}

function parseHotnessScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value * HOTNESS_ROUNDING_SCALE) / HOTNESS_ROUNDING_SCALE;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed * HOTNESS_ROUNDING_SCALE) / HOTNESS_ROUNDING_SCALE;
    }
    return null;
  }

  if (isRecord(value) && 'hotness' in value) {
    return parseHotnessScore(value.hotness);
  }

  return null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function normalizeUnitInterval(value: unknown, fallback: number): number {
  if (typeof value !== 'number') {
    return clamp01(fallback);
  }
  return clamp01(value);
}

function computeSourceDiversityScore(sourceCount: number): number {
  if (!Number.isFinite(sourceCount) || sourceCount <= 0) {
    return 0;
  }

  const normalized = Math.log1p(sourceCount) / Math.log(8);
  return clamp01(normalized);
}

function stripGunMetadata(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const { _, ...rest } = data as Record<string, unknown> & { _?: unknown };
  return rest;
}

function encodeStoryBundleForGun(story: StoryBundle): Record<string, unknown> {
  return {
    [STORY_BUNDLE_JSON_KEY]: JSON.stringify(story),
    story_id: story.story_id,
    created_at: story.created_at,
    schemaVersion: story.schemaVersion
  };
}

function latestIndexProductMetadataForStory(story: StoryBundle): Omit<
  NewsLatestIndexEntryRecord,
  'story_id' | 'latest_activity_at'
> {
  return {
    product_state_schema_version: 'vh-news-product-feed-index-v1',
    topic_id: story.topic_id,
    source_set_revision: story.provenance_hash,
    source_count: story.sources.length,
    canonical_source_count: canonicalSourceCount(story),
    story_created_at: Math.max(0, Math.floor(story.created_at)),
    cluster_window_start: Math.max(0, Math.floor(story.cluster_window_start)),
  };
}

async function signSystemWriterRecord<T extends Record<string, unknown>>(
  client: VennClient,
  path: string,
  payload: T,
  missingSignerError: string,
): Promise<T & SystemWriterRecordFields> {
  return buildSignedSystemWriterRecord({
    path,
    payload,
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId: client.config.systemWriterId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError,
  });
}

async function buildSystemWriterStoryRecord(
  client: VennClient,
  story: StoryBundle,
): Promise<SystemWriterStoryBundleRecord> {
  return signSystemWriterRecord(
    client,
    storyPath(story.story_id),
    encodeStoryBundleForGun(story),
    'system writer signer is required for news story writes',
  ) as Promise<SystemWriterStoryBundleRecord>;
}

async function buildSystemWriterLatestIndexRecord(
  client: VennClient,
  storyId: string,
  latestActivityAt: number,
  story?: StoryBundle,
): Promise<SystemWriterLatestIndexRecord> {
  const metadata = story && story.story_id === storyId
    ? latestIndexProductMetadataForStory(story)
    : {};
  return signSystemWriterRecord(
    client,
    latestIndexEntryPath(storyId),
    {
      story_id: storyId,
      latest_activity_at: latestActivityAt,
      ...metadata,
    },
    'system writer signer is required for news latest-index writes',
  ) as Promise<SystemWriterLatestIndexRecord>;
}

async function buildSystemWriterHotIndexRecord(
  client: VennClient,
  storyId: string,
  hotness: number,
  story?: StoryBundle,
): Promise<SystemWriterHotIndexRecord> {
  const metadata = story && story.story_id === storyId
    ? latestIndexProductMetadataForStory(story)
    : {};
  return signSystemWriterRecord(
    client,
    hotIndexEntryPath(storyId),
    {
      story_id: storyId,
      hotness,
      ...metadata,
    },
    'system writer signer is required for news hot-index writes',
  ) as Promise<SystemWriterHotIndexRecord>;
}

async function buildSystemWriterSynthesisLifecycleRecord(
  client: VennClient,
  record: NewsSynthesisLifecycleRecord,
): Promise<NewsSynthesisLifecycleRecord & SystemWriterRecordFields> {
  return signSystemWriterRecord(
    client,
    synthesisLifecycleLatestPath(record.story_id),
    record,
    'system writer signer is required for news synthesis lifecycle writes',
  ) as Promise<NewsSynthesisLifecycleRecord & SystemWriterRecordFields>;
}

function decodeStoryBundlePayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }

  const encoded = payload[STORY_BUNDLE_JSON_KEY];
  if (typeof encoded !== 'string') {
    return payload;
  }

  try {
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

function parseLegacyStoryBundle(data: unknown): StoryBundle | null {
  const payload = decodeStoryBundlePayload(data);
  if (hasForbiddenNewsPayloadFields(payload)) {
    return null;
  }
  const parsed = StoryBundleSchema.safeParse(payload);
  if (!parsed.success || !isCanonicalNewsTopicIdShape(parsed.data.topic_id)) {
    return null;
  }
  return parsed.data;
}

function parseRelayLatestIndexStories(value: unknown, index: NewsLatestIndex): Record<string, StoryBundle> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const stories: Record<string, StoryBundle> = {};
  for (const [storyId, candidate] of Object.entries(value)) {
    if (!(storyId in index)) {
      continue;
    }
    const parsed = parseLegacyStoryBundle(candidate);
    if (parsed?.story_id === storyId) {
      stories[storyId] = parsed;
    }
  }
  return Object.keys(stories).length > 0 ? stories : undefined;
}

function parseRelayLatestIndexRecordTimestampForEmbeddedStory(
  storyId: string,
  value: unknown,
  before: number | null,
): number | null {
  const record = parseLatestIndexEntryPayload(stripGunMetadata(value), storyId);
  const timestamp = record?.latest_activity_at;
  if (timestamp === undefined || (before !== null && timestamp >= before)) {
    return null;
  }
  return timestamp;
}

function normalizeLifecycleStatus(value: unknown): NewsSynthesisLifecycleStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  switch (value) {
    case 'pending':
    case 'in_progress':
    case 'accepted_available':
    case 'retryable_failure':
    case 'terminal_unavailable':
    case 'suppressed':
      return value;
    default:
      return null;
  }
}

function normalizeFrameTableState(value: unknown): NewsFrameTableReadinessState | null {
  if (typeof value !== 'string') {
    return null;
  }
  switch (value) {
    case 'frame_table_pending':
    case 'frame_table_ready':
    case 'frame_table_unavailable':
      return value;
    default:
      return null;
  }
}

function normalizeLifecycleString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseNewsSynthesisLifecyclePayload(payload: unknown, storyId: string): NewsSynthesisLifecycleRecord | null {
  if (!isRecord(payload) || hasForbiddenNewsPayloadFields(payload)) {
    return null;
  }
  const schemaVersion = payload.schemaVersion;
  const normalizedStoryId = normalizeLifecycleString(payload.story_id);
  const topicId = normalizeLifecycleString(payload.topic_id);
  const sourceSetRevision = normalizeLifecycleString(payload.source_set_revision);
  const status = normalizeLifecycleStatus(payload.status);
  const frameTableState = normalizeFrameTableState(payload.frame_table_state);
  const sourceCount = Number(payload.source_count);
  const canonicalSourceCount = Number(payload.canonical_source_count);
  const updatedAt = Number(payload.updated_at);
  const epoch = payload.epoch === undefined ? undefined : Number(payload.epoch);
  if (
    schemaVersion !== NEWS_SYNTHESIS_LIFECYCLE_SCHEMA_VERSION
    || normalizedStoryId !== storyId
    || !topicId
    || !sourceSetRevision
    || !status
    || !frameTableState
    || !Number.isFinite(sourceCount)
    || sourceCount < 0
    || !Number.isFinite(canonicalSourceCount)
    || canonicalSourceCount < 0
    || !Number.isFinite(updatedAt)
    || updatedAt < 0
    || (epoch !== undefined && (!Number.isFinite(epoch) || epoch < 0))
  ) {
    return null;
  }
  return {
    schemaVersion: NEWS_SYNTHESIS_LIFECYCLE_SCHEMA_VERSION,
    story_id: normalizedStoryId,
    topic_id: topicId,
    source_set_revision: sourceSetRevision,
    source_count: Math.floor(sourceCount),
    canonical_source_count: Math.floor(canonicalSourceCount),
    status,
    retryable: payload.retryable === true,
    ...(normalizeLifecycleString(payload.reason) ? { reason: normalizeLifecycleString(payload.reason)! } : {}),
    ...(normalizeLifecycleString(payload.synthesis_id) ? { synthesis_id: normalizeLifecycleString(payload.synthesis_id)! } : {}),
    ...(epoch !== undefined ? { epoch: Math.floor(epoch) } : {}),
    frame_table_state: frameTableState,
    updated_at: Math.floor(updatedAt),
  };
}

function isSystemWriterMarkedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value._writerKind === SYSTEM_WRITER_KIND;
}

function isLegacyMarkedRecord(value: Record<string, unknown>): boolean {
  return value._writerKind === 'legacy';
}

function carriesLumaProtocolFields(value: unknown): boolean {
  return isRecord(value) && (
    '_protocolVersion' in value
    || '_writerKind' in value
    || '_systemWriterId' in value
    || '_systemSignature' in value
    || '_systemIssuedAt' in value
    || carriesLegacySystemSignatureFields(value)
    || '_authorScheme' in value
    || 'signedWriteEnvelope' in value
  );
}

function carriesLegacySystemSignatureFields(value: Record<string, unknown>): boolean {
  return LEGACY_SYSTEM_SIGNATURE_KEYS.some((key) => key in value);
}

const SYSTEM_WRITER_STORY_VALIDATION_KEYS = new Set([
  STORY_BUNDLE_JSON_KEY,
  'story_id',
  'created_at',
  'schemaVersion',
  '_system',
  '_Signature',
  '_WriterId',
  '_IssuedAt',
  '_protocolVersion',
  '_writerKind',
  '_systemWriterId',
  '_systemIssuedAt',
  '_systemSignature',
]);

const SYSTEM_WRITER_SIGNED_METADATA_VALIDATION_KEYS = [
  '_system',
  '_Signature',
  '_WriterId',
  '_IssuedAt',
  '_protocolVersion',
  '_writerKind',
  '_systemWriterId',
  '_systemIssuedAt',
  '_systemSignature',
] as const;

const SYSTEM_WRITER_INDEX_METADATA_VALIDATION_KEYS = [
  'product_state_schema_version',
  'topic_id',
  'source_set_revision',
  'source_count',
  'canonical_source_count',
  'story_created_at',
  'cluster_window_start',
] as const;

const SYSTEM_WRITER_LATEST_INDEX_VALIDATION_KEYS = new Set([
  ...SYSTEM_WRITER_SIGNED_METADATA_VALIDATION_KEYS,
  ...SYSTEM_WRITER_INDEX_METADATA_VALIDATION_KEYS,
  'story_id',
  'latest_activity_at',
]);

const SYSTEM_WRITER_HOT_INDEX_VALIDATION_KEYS = new Set([
  ...SYSTEM_WRITER_SIGNED_METADATA_VALIDATION_KEYS,
  ...SYSTEM_WRITER_INDEX_METADATA_VALIDATION_KEYS,
  'story_id',
  'hotness',
]);

const SYSTEM_WRITER_LIFECYCLE_COMMON_VALIDATION_KEYS = new Set([
  ...SYSTEM_WRITER_SIGNED_METADATA_VALIDATION_KEYS,
  'schemaVersion',
  'story_id',
  'topic_id',
  'source_set_revision',
  'source_count',
  'canonical_source_count',
  'status',
  'retryable',
  'reason',
  'frame_table_state',
  'updated_at',
]);

const SYSTEM_WRITER_LIFECYCLE_SYNTHESIS_STATUSES = new Set([
  'accepted_available',
  'suppressed',
]);

function normalizeSystemWriterStoryRecordForValidation(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  if ('_authorScheme' in payload || 'signedWriteEnvelope' in payload || hasForbiddenNewsPayloadFields(payload)) {
    return null;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SYSTEM_WRITER_STORY_VALIDATION_KEYS.has(key)) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function normalizeSystemWriterRecordForValidation(
  payload: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> | null {
  if ('_authorScheme' in payload || 'signedWriteEnvelope' in payload || hasForbiddenNewsPayloadFields(payload)) {
    return null;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (allowedKeys.has(key)) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function normalizeSystemWriterLifecycleRecordForValidation(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const normalized = normalizeSystemWriterRecordForValidation(
    payload,
    SYSTEM_WRITER_LIFECYCLE_COMMON_VALIDATION_KEYS,
  );
  if (!normalized) {
    return null;
  }

  if (SYSTEM_WRITER_LIFECYCLE_SYNTHESIS_STATUSES.has(String(payload.status))) {
    if ('synthesis_id' in payload) {
      normalized.synthesis_id = payload.synthesis_id;
    }
    if ('epoch' in payload) {
      normalized.epoch = payload.epoch;
    }
  }
  return normalized;
}

function carriesLumaProtocolFieldsForIndexEntry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const carriesSystemOrUserFields =
    '_systemWriterId' in value
    || '_systemSignature' in value
    || '_systemIssuedAt' in value
    || carriesLegacySystemSignatureFields(value)
    || '_authorScheme' in value
    || 'signedWriteEnvelope' in value;

  if (isLegacyMarkedRecord(value)) {
    return carriesSystemOrUserFields
      || ('_protocolVersion' in value && value._protocolVersion !== SYSTEM_WRITER_PROTOCOL_VERSION);
  }

  return '_protocolVersion' in value || '_writerKind' in value || carriesSystemOrUserFields;
}

function blocksLegacyIndexFallback(value: unknown): boolean {
  const payload = stripGunMetadata(value);
  return isSystemWriterMarkedRecord(payload) || carriesLumaProtocolFieldsForIndexEntry(payload);
}

function emitSystemWriterValidationFailure(
  failure: SystemWriterValidationFailure,
): void {
  console.warn(`[vh:news] ${SYSTEM_WRITER_VALIDATION_EVENT}`, failure);
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(
      new CustomEvent(SYSTEM_WRITER_VALIDATION_EVENT, { detail: failure })
    );
  }
}

async function parseStoryBundleFromStoredRecord(
  client: VennClient,
  storyId: string,
  data: unknown,
): Promise<StoryBundle | null> {
  const payload = stripGunMetadata(data);
  if (isSystemWriterMarkedRecord(payload)) {
    const validationRecord = normalizeSystemWriterStoryRecordForValidation(payload);
    if (!validationRecord) {
      return null;
    }
    const validation = await validateSystemWriterRecord({
      path: storyPath(storyId),
      record: validationRecord,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }

    const parsed = parseLegacyStoryBundle(payload);
    return parsed?.story_id === storyId ? parsed : null;
  }

  if (carriesLumaProtocolFields(payload)) {
    return null;
  }

  const parsed = parseLegacyStoryBundle(payload);
  return parsed?.story_id === storyId ? parsed : null;
}

async function parseStoryBundleRepairCandidateFromStoredRecord(
  client: VennClient,
  storyId: string,
  data: unknown,
): Promise<StoryBundle | null> {
  const payload = stripGunMetadata(data);
  if (!isSystemWriterMarkedRecord(payload)) {
    return null;
  }
  if ('_authorScheme' in payload || 'signedWriteEnvelope' in payload || hasForbiddenNewsPayloadFields(payload)) {
    return null;
  }

  const parsed = parseLegacyStoryBundle(payload);
  if (!parsed || parsed.story_id !== storyId) {
    return null;
  }

  const needsMirrorRepair =
    payload.story_id !== parsed.story_id
    || payload.created_at !== parsed.created_at
    || payload.schemaVersion !== parsed.schemaVersion;
  if (!needsMirrorRepair) {
    return null;
  }

  const reconstructed = {
    ...payload,
    story_id: parsed.story_id,
    created_at: parsed.created_at,
    schemaVersion: parsed.schemaVersion,
  };
  const validation = await validateSystemWriterRecord({
    path: storyPath(storyId),
    record: reconstructed,
    pin: client.config.systemWriterPin,
    verify: client.config.systemWriterVerify,
  });
  return validation.valid ? parsed : null;
}

async function parseNewsSynthesisLifecycleFromStoredRecord(
  client: VennClient,
  storyId: string,
  data: unknown,
): Promise<NewsSynthesisLifecycleRecord | null> {
  const payload = stripGunMetadata(data);
  if (isSystemWriterMarkedRecord(payload)) {
    const validationRecord = normalizeSystemWriterLifecycleRecordForValidation(payload);
    if (!validationRecord) {
      return null;
    }
    const validation = await validateSystemWriterRecord({
      path: synthesisLifecycleLatestPath(storyId),
      record: validationRecord,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }
    return parseNewsSynthesisLifecyclePayload(validationRecord, storyId);
  }

  if (carriesLumaProtocolFields(payload)) {
    return null;
  }

  return parseNewsSynthesisLifecyclePayload(payload, storyId);
}

function parseNewsSynthesisLifecycleFromRelayPayload(
  storyId: string,
  data: unknown,
): NewsSynthesisLifecycleRecord | null {
  const payload = stripGunMetadata(data);
  if (isSystemWriterMarkedRecord(payload)) {
    const validationRecord = normalizeSystemWriterLifecycleRecordForValidation(payload);
    return validationRecord
      ? parseNewsSynthesisLifecyclePayload(validationRecord, storyId)
      : null;
  }

  if (carriesLumaProtocolFields(payload)) {
    return null;
  }

  return parseNewsSynthesisLifecyclePayload(payload, storyId);
}

function normalizeOptionalIndexInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function parseProductIndexMetadata(payload: Record<string, unknown>): Omit<
  NewsLatestIndexEntryRecord,
  'story_id' | 'latest_activity_at'
> {
  const topicId = typeof payload.topic_id === 'string' && payload.topic_id.trim()
    ? payload.topic_id.trim()
    : undefined;
  const sourceSetRevision = typeof payload.source_set_revision === 'string' && payload.source_set_revision.trim()
    ? payload.source_set_revision.trim()
    : undefined;
  const sourceCount = normalizeOptionalIndexInt(payload.source_count);
  const canonicalSourceCount = normalizeOptionalIndexInt(payload.canonical_source_count);
  const storyCreatedAt = normalizeOptionalIndexInt(payload.story_created_at);
  const clusterWindowStart = normalizeOptionalIndexInt(payload.cluster_window_start);

  return {
    ...(payload.product_state_schema_version === 'vh-news-product-feed-index-v1'
      ? { product_state_schema_version: 'vh-news-product-feed-index-v1' as const }
      : {}),
    ...(topicId ? { topic_id: topicId } : {}),
    ...(sourceSetRevision ? { source_set_revision: sourceSetRevision } : {}),
    ...(sourceCount !== undefined ? { source_count: sourceCount } : {}),
    ...(canonicalSourceCount !== undefined ? { canonical_source_count: canonicalSourceCount } : {}),
    ...(storyCreatedAt !== undefined ? { story_created_at: storyCreatedAt } : {}),
    ...(clusterWindowStart !== undefined ? { cluster_window_start: clusterWindowStart } : {}),
  };
}

function parseLatestIndexEntryPayload(
  payload: unknown,
  storyId: string,
): NewsLatestIndexEntryRecord | null {
  const latestActivityAt = parseLatestTimestamp(payload);
  if (latestActivityAt === null) {
    return null;
  }

  if (!isRecord(payload)) {
    return {
      story_id: storyId,
      latest_activity_at: latestActivityAt,
    };
  }

  const payloadStoryId = typeof payload.story_id === 'string' ? payload.story_id.trim() : '';
  if (payloadStoryId && payloadStoryId !== storyId) {
    return null;
  }

  return {
    story_id: payloadStoryId || storyId,
    latest_activity_at: latestActivityAt,
    ...parseProductIndexMetadata(payload),
  };
}

function parseHotIndexEntryPayload(
  payload: unknown,
  storyId: string,
): NewsHotIndexEntryRecord | null {
  const hotness = parseHotnessScore(payload);
  if (hotness === null) {
    return null;
  }

  if (!isRecord(payload)) {
    return {
      story_id: storyId,
      hotness,
    };
  }

  const payloadStoryId = typeof payload.story_id === 'string' ? payload.story_id.trim() : '';
  if (payloadStoryId && payloadStoryId !== storyId) {
    return null;
  }

  return {
    story_id: payloadStoryId || storyId,
    hotness,
    ...parseProductIndexMetadata(payload),
  };
}

async function parseLatestIndexEntryRecordFromStoredRecord(
  client: VennClient,
  storyId: string,
  value: unknown,
): Promise<NewsLatestIndexEntryRecord | null> {
  const payload = stripGunMetadata(value);
  if (isSystemWriterMarkedRecord(payload)) {
    const validationRecord = normalizeSystemWriterRecordForValidation(
      payload,
      SYSTEM_WRITER_LATEST_INDEX_VALIDATION_KEYS,
    );
    if (!validationRecord) {
      return null;
    }
    const validation = await validateSystemWriterRecord({
      path: latestIndexEntryPath(storyId),
      record: validationRecord,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }
    if (validationRecord.story_id !== storyId) {
      return null;
    }
    return parseLatestIndexEntryPayload(validationRecord, storyId);
  }

  if (carriesLumaProtocolFieldsForIndexEntry(payload)) {
    return null;
  }

  return parseLatestIndexEntryPayload(payload, storyId);
}

function parseNewsIndexEntryFromStoredRecord(
  client: VennClient,
  kind: 'latest',
  storyId: string,
  value: unknown,
): Promise<NewsLatestIndexEntryRecord | null>;
function parseNewsIndexEntryFromStoredRecord(
  client: VennClient,
  kind: 'hot',
  storyId: string,
  value: unknown,
): Promise<NewsHotIndexEntryRecord | null>;
async function parseNewsIndexEntryFromStoredRecord(
  client: VennClient,
  kind: 'latest' | 'hot',
  storyId: string,
  value: unknown,
): Promise<NewsLatestIndexEntryRecord | NewsHotIndexEntryRecord | null> {
  return kind === 'latest'
    ? parseLatestIndexEntryRecordFromStoredRecord(client, storyId, value)
    : parseHotIndexEntryRecordFromStoredRecord(client, storyId, value);
}

async function parseLatestIndexEntry(
  client: VennClient,
  storyId: string,
  value: unknown,
): Promise<number | null> {
  return (await parseNewsIndexEntryFromStoredRecord(client, 'latest', storyId, value))?.latest_activity_at ?? null;
}

export async function parseNewsLatestIndexEntryRecord(
  client: VennClient,
  storyId: string,
  value: unknown,
): Promise<number | null> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    return null;
  }
  return parseLatestIndexEntry(client, normalizedId, value);
}

export async function parseNewsLatestIndexProductRecord(
  client: VennClient,
  storyId: string,
  value: unknown,
): Promise<NewsLatestIndexEntryRecord | null> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    return null;
  }
  return parseNewsIndexEntryFromStoredRecord(client, 'latest', normalizedId, value);
}

async function parseHotIndexEntry(
  client: VennClient,
  storyId: string,
  value: unknown,
): Promise<number | null> {
  return (await parseNewsIndexEntryFromStoredRecord(client, 'hot', storyId, value))?.hotness ?? null;
}

export async function parseNewsHotIndexProductRecord(
  client: VennClient,
  storyId: string,
  value: unknown,
): Promise<NewsHotIndexEntryRecord | null> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    return null;
  }
  return parseNewsIndexEntryFromStoredRecord(client, 'hot', normalizedId, value);
}

async function parseHotIndexEntryRecordFromStoredRecord(
  client: VennClient,
  storyId: string,
  value: unknown,
): Promise<NewsHotIndexEntryRecord | null> {
  const payload = stripGunMetadata(value);
  if (isSystemWriterMarkedRecord(payload)) {
    const validationRecord = normalizeSystemWriterRecordForValidation(
      payload,
      SYSTEM_WRITER_HOT_INDEX_VALIDATION_KEYS,
    );
    if (!validationRecord) {
      return null;
    }
    const validation = await validateSystemWriterRecord({
      path: hotIndexEntryPath(storyId),
      record: validationRecord,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }
    if (validationRecord.story_id !== storyId) {
      return null;
    }
    return parseHotIndexEntryPayload(validationRecord, storyId);
  }

  if (carriesLumaProtocolFieldsForIndexEntry(payload)) {
    return null;
  }

  return parseHotIndexEntryPayload(payload, storyId);
}

async function readNewsLatestIndexEntry(
  client: VennClient,
  storyId: string,
): Promise<number | null> {
  const raw = await readOnce(getNewsLatestIndexChain(client).get(storyId) as unknown as ChainWithGet<unknown>);
  if (raw === null) {
    return null;
  }
  return parseLatestIndexEntry(client, storyId, raw);
}

export async function readNewsLatestIndexProductRecord(
  client: VennClient,
  storyId: string,
): Promise<NewsLatestIndexEntryRecord | null> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    return null;
  }
  const raw = await readOnce(getNewsLatestIndexChain(client).get(normalizedId) as unknown as ChainWithGet<unknown>);
  if (raw === null) {
    return null;
  }
  return parseLatestIndexEntryRecordFromStoredRecord(client, normalizedId, raw);
}

async function readNewsHotIndexEntry(
  client: VennClient,
  storyId: string,
): Promise<number | null> {
  const raw = await readOnce(getNewsHotIndexChain(client).get(storyId) as unknown as ChainWithGet<unknown>);
  if (raw === null) {
    return null;
  }
  return parseHotIndexEntry(client, storyId, raw);
}

export async function readNewsHotIndexProductRecord(
  client: VennClient,
  storyId: string,
): Promise<NewsHotIndexEntryRecord | null> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    return null;
  }
  const raw = await readOnce(getNewsHotIndexChain(client).get(normalizedId) as unknown as ChainWithGet<unknown>);
  if (raw === null) {
    return null;
  }
  return parseHotIndexEntryRecordFromStoredRecord(client, normalizedId, raw);
}

function sanitizeStoryBundle(data: unknown): StoryBundle {
  assertNoNewsIdentityOrTokenFields(data);
  return StoryBundleSchema.parse(data);
}

async function enforceCreatedAtFirstWriteWins(client: VennClient, story: StoryBundle): Promise<StoryBundle> {
  const existing = await readNewsStory(client, story.story_id);
  if (!existing) {
    return story;
  }

  if (existing.created_at === story.created_at) {
    return story;
  }

  return {
    ...story,
    created_at: existing.created_at,
  };
}

/**
 * Deterministic hotness scorer for StoryBundle publication.
 *
 * Inputs are versioned via `NewsHotnessConfig` and deterministic for
 * identical `(story, nowMs, config)` tuples.
 */
export function computeStoryHotness(
  story: StoryBundle,
  nowMs: number = Date.now(),
  config: NewsHotnessConfig = DEFAULT_NEWS_HOTNESS_CONFIG,
): number {
  const latestActivityAt = Math.max(0, Math.floor(story.cluster_window_end));
  const normalizedNow = Number.isFinite(nowMs) && nowMs >= 0 ? Math.floor(nowMs) : latestActivityAt;
  const ageHours = Math.max(0, normalizedNow - latestActivityAt) / MS_PER_HOUR;

  const halfLifeHours = Math.max(0.25, config.decayHalfLifeHours);
  const freshness = Math.pow(2, -ageHours / halfLifeHours);

  const coverage = normalizeUnitInterval(story.cluster_features.coverage_score, 0.35);
  const velocity = normalizeUnitInterval(story.cluster_features.velocity_score, 0.2);
  const confidence = normalizeUnitInterval(story.cluster_features.confidence_score, 0.5);
  const sourceDiversity = computeSourceDiversityScore(story.sources.length);

  const weightedBase =
    config.weights.coverage * coverage +
    config.weights.velocity * velocity +
    config.weights.confidence * confidence +
    config.weights.sourceDiversity * sourceDiversity +
    config.weights.freshness * freshness;

  const breakingWindowHours = Math.max(0, config.breakingWindowHours);
  const inBreakingWindow = ageHours <= breakingWindowHours;
  const breakingMultiplier = inBreakingWindow
    ? 1 + Math.max(0, config.breakingVelocityBoost) * velocity
    : 1;

  const score = weightedBase * breakingMultiplier;
  return Math.round(Math.max(0, score) * HOTNESS_ROUNDING_SCALE) / HOTNESS_ROUNDING_SCALE;
}

/**
 * Root chain for `vh/news/stories/*`.
 */
export function getNewsStoriesChain(client: VennClient): ChainWithGet<StoryBundle> {
  const chain = client.mesh.get('news').get('stories') as unknown as ChainWithGet<StoryBundle>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, storiesPath());
}

/**
 * Chain for a single `vh/news/stories/<storyId>` node.
 */
export function getNewsStoryChain(client: VennClient, storyId: string): ChainWithGet<StoryBundle> {
  const chain = client.mesh.get('news').get('stories').get(storyId) as unknown as ChainWithGet<StoryBundle>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, storyPath(storyId));
}

export function getNewsSynthesisLifecycleChain(
  client: VennClient,
  storyId: string,
): ChainWithGet<NewsSynthesisLifecycleRecord> {
  const chain = client.mesh
    .get('news')
    .get('stories')
    .get(storyId)
    .get('synthesis_lifecycle')
    .get('latest') as unknown as ChainWithGet<NewsSynthesisLifecycleRecord>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, synthesisLifecycleLatestPath(storyId));
}

/**
 * Root chain for `vh/news/index/latest/*`.
 */
export function getNewsLatestIndexChain(client: VennClient): ChainWithGet<number> {
  const chain = client.mesh.get('news').get('index').get('latest') as unknown as ChainWithGet<number>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, latestIndexPath());
}

/**
 * Root chain for `vh/news/index/hot/*`.
 */
export function getNewsHotIndexChain(client: VennClient): ChainWithGet<number> {
  const chain = client.mesh.get('news').get('index').get('hot') as unknown as ChainWithGet<number>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, hotIndexPath());
}

export interface NewsIngestionLease {
  readonly holder_id: string;
  readonly lease_token: string;
  readonly acquired_at: number;
  readonly heartbeat_at: number;
  readonly expires_at: number;
}

function sanitizeLeaseId(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function sanitizeLeaseTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`);
  }

  return Math.floor(value);
}

function sanitizeNewsIngestionLease(value: unknown): NewsIngestionLease {
  if (!isRecord(value)) {
    throw new Error('lease payload must be an object');
  }

  return {
    holder_id: sanitizeLeaseId(value.holder_id, 'holder_id'),
    lease_token: sanitizeLeaseId(value.lease_token, 'lease_token'),
    acquired_at: sanitizeLeaseTimestamp(value.acquired_at, 'acquired_at'),
    heartbeat_at: sanitizeLeaseTimestamp(value.heartbeat_at, 'heartbeat_at'),
    expires_at: sanitizeLeaseTimestamp(value.expires_at, 'expires_at'),
  };
}

function parseNewsIngestionLease(value: unknown): NewsIngestionLease | null {
  if (!isRecord(value)) {
    return null;
  }

  try {
    return sanitizeNewsIngestionLease(stripGunMetadata(value));
  } catch {
    return null;
  }
}

/**
 * Chain for `vh/news/runtime/lease/ingester`.
 */
export function getNewsIngestionLeaseChain(client: VennClient): ChainWithGet<NewsIngestionLease> {
  const scope = resolveNewsIngestionLeaseScope(client);
  const chain = client.mesh
    .get('news')
    .get('runtime')
    .get('lease')
    .get('ingester');
  const scopedChain = (scope ? chain.get(scope) : chain) as unknown as ChainWithGet<NewsIngestionLease>;

  return createGuardedChain(scopedChain, client.hydrationBarrier, client.topologyGuard, ingestionLeasePath(client));
}

/**
 * Read current ingestion lease holder record.
 */
export async function readNewsIngestionLease(client: VennClient): Promise<NewsIngestionLease | null> {
  const raw = await readOnce(getNewsIngestionLeaseChain(client));
  if (raw === null) {
    return null;
  }
  return parseNewsIngestionLease(raw);
}

/**
 * Write ingestion lease holder record.
 */
export async function writeNewsIngestionLease(
  client: VennClient,
  lease: NewsIngestionLease,
): Promise<NewsIngestionLease> {
  const sanitized = sanitizeNewsIngestionLease(lease);
  await putWithAck(getNewsIngestionLeaseChain(client), sanitized, {
    writeClass: 'news-ingestion-lease',
    timeoutError: 'news ingestion lease write timed out and readback did not confirm persistence',
    readback: () => readNewsIngestionLease(client),
    readbackPredicate: (observed) => {
      const candidate = observed as NewsIngestionLease | null;
      return Boolean(
        candidate
        && candidate.holder_id === sanitized.holder_id
        && candidate.lease_token === sanitized.lease_token
        && candidate.acquired_at === sanitized.acquired_at
        && candidate.heartbeat_at === sanitized.heartbeat_at
        && candidate.expires_at === sanitized.expires_at
      );
    },
  });
  return sanitized;
}

/**
 * Read and validate a StoryBundle from mesh.
 */
export async function readNewsStory(client: VennClient, storyId: string): Promise<StoryBundle | null> {
  const raw = await readOnce(getNewsStoryChain(client, storyId));
  if (raw === null) {
    return null;
  }
  const parsed = await parseStoryBundleFromStoredRecord(client, storyId, raw);
  if (!parsed) {
    return null;
  }
  try {
    await assertCanonicalNewsTopicId(parsed);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Read a system-written story body that is not product-visible yet but can be
 * safely reconstructed for daemon repair.
 *
 * This intentionally does not loosen `readNewsStory`: malformed system rows
 * remain hidden from product readers. A repair candidate is returned only when
 * the embedded StoryBundle is valid for the requested path and the existing
 * `_systemSignature` verifies after restoring the required top-level story
 * mirror fields that older Gun merge writes may have lost.
 */
export async function readNewsStoryRepairCandidate(
  client: VennClient,
  storyId: string,
): Promise<StoryBundle | null> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    return null;
  }
  const raw = await readOnce(getNewsStoryChain(client, normalizedId));
  if (raw === null) {
    return null;
  }
  return parseStoryBundleRepairCandidateFromStoredRecord(client, normalizedId, raw);
}

export async function readNewsStoryIds(
  client: VennClient,
  options: NewsStoryRootReadOptions = {},
): Promise<string[]> {
  const limit = normalizeLatestIndexReadLimit(options.limit, 200);
  const storyRoot = getNewsStoriesChain(client) as unknown as ChainWithGet<unknown>;
  const raw = await readSettledRoot(
    storyRoot,
    hasSettledStoryRootPayload,
  );
  const rootKeys = extractIndexChildKeys(raw);
  if (rootKeys.length >= limit) {
    return rootKeys.slice(0, limit);
  }

  const mappedKeys = await readMappedChildKeys(storyRoot, {
    limit,
    existingKeys: new Set(rootKeys),
    timeoutMs: rootKeys.length > 0 ? Math.min(READ_ONCE_TIMEOUT_MS, 1_000) : READ_ONCE_TIMEOUT_MS,
  });
  if (mappedKeys.length === 0) {
    return rootKeys.slice(0, limit);
  }
  return [...new Set([...rootKeys, ...mappedKeys])].sort().slice(0, limit);
}

/* v8 ignore start -- bounded async race helper; callers cover outcomes while stale settlement branches are host-scheduler defensive. */
function timeoutAsNull<T>(work: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      /* v8 ignore next 3 -- defensive for timers firing after an already-settled read. */
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    work.then(
      (value) => {
        /* v8 ignore next 2 -- defensive for late promise resolution after timeout fallback. */
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        /* v8 ignore next 2 -- defensive for late promise rejection after timeout fallback. */
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
/* v8 ignore stop */

function resolveRelayRestEndpointsFromPeers(client: VennClient, path: string): string[] {
  const endpoints: string[] = [];
  for (const peer of client.config.peers) {
    const endpoint = resolveRelayRestEndpointFromPeer(peer, path);
    if (endpoint && !endpoints.includes(endpoint)) {
      endpoints.push(endpoint);
    }
  }
  return endpoints;
}

function resolveLatestIndexRelayRestRead(
  client: VennClient,
  options: NewsLatestIndexReadOptions = {},
): {
  readonly limit: number;
  readonly before: number | null;
  readonly endpoints: string[];
} {
  const limit = normalizeLatestIndexReadLimit(options.limit);
  const before = normalizeLatestIndexBeforeCursor(options.before);
  const query = new URLSearchParams({ limit: String(limit) });
  if (before !== null) {
    query.set('before', String(before));
  }
  return {
    limit,
    before,
    endpoints: resolveRelayRestEndpointsFromPeers(
      client,
      `/vh/news/latest-index?${query.toString()}`,
    ),
  };
}

/**
 * Read a StoryBundle through the relay's same-origin REST fallback.
 *
 * This keeps direct story routes usable when a browser's Gun live subscription
 * lags behind the persisted public mesh.
 */
export async function readNewsStoryViaRelayRest(
  client: VennClient,
  storyId: string,
): Promise<StoryBundle | null> {
  const normalizedStoryId = storyId.trim();
  if (!normalizedStoryId || typeof fetch !== 'function') {
    return null;
  }
  const endpoints = resolveRelayRestEndpointsFromPeers(
    client,
    `/vh/news/story?story_id=${encodeURIComponent(normalizedStoryId)}`,
  );
  if (endpoints.length === 0) {
    return null;
  }

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RELAY_REST_READ_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json() as { record?: unknown; story?: unknown };
      const parsed = await parseStoryBundleFromStoredRecord(
        client,
        normalizedStoryId,
        payload.record ?? payload.story,
      );
      if (!parsed) {
        continue;
      }
      try {
        await assertCanonicalNewsTopicId(parsed);
        return parsed;
      } catch {
        continue;
      }
    } catch {
      continue;
    /* v8 ignore next -- cleanup-only finally branch is outcome-neutral and covered through success/failure calls. */
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

export async function readNewsStoryWithRelayRestFallback(
  client: VennClient,
  storyId: string,
): Promise<StoryBundle | null> {
  const normalizedStoryId = storyId.trim();
  if (!normalizedStoryId) {
    return null;
  }
  const direct = await timeoutAsNull(
    readNewsStory(client, normalizedStoryId),
    Math.max(READ_ONCE_TIMEOUT_MS + 1_000, RELAY_REST_READ_TIMEOUT_MS),
  );
  if (direct) {
    return direct;
  }
  return timeoutAsNull(
    readNewsStoryViaRelayRest(client, normalizedStoryId),
    RELAY_REST_READ_TIMEOUT_MS + 1_000,
  );
}

/**
 * Validate and write StoryBundle to `vh/news/stories/<storyId>`.
 *
 * `created_at` is immutable by story identity: once a story exists,
 * subsequent re-ingest writes preserve the first observed `created_at`.
 */
export async function writeNewsStory(client: VennClient, story: unknown): Promise<StoryBundle> {
  const sanitized = sanitizeStoryBundle(story);
  await assertCanonicalNewsTopicId(sanitized);
  const normalized = await enforceCreatedAtFirstWriteWins(client, sanitized);
  const encoded = await buildSystemWriterStoryRecord(client, normalized);
  await putWithAck(
    getNewsStoryChain(client, normalized.story_id) as unknown as ChainWithGet<Record<string, unknown>>,
    encoded,
    {
      writeClass: 'news-story',
      timeoutError: 'news story write timed out and readback did not confirm persistence',
      readback: () => readNewsStory(client, normalized.story_id),
      readbackPredicate: (observed) => {
        const candidate = observed as StoryBundle | null;
        return Boolean(
          candidate
          && candidate.story_id === normalized.story_id
          && candidate.provenance_hash === normalized.provenance_hash
          && candidate.cluster_window_end === normalized.cluster_window_end
        );
      },
      requireReadback: newsWriteRequiresReadback(client),
    }
  );
  return normalized;
}

function canonicalSourceCount(story: StoryBundle): number {
  return (story.primary_sources ?? story.sources).length;
}

export function buildNewsSynthesisLifecycleRecord(input: {
  readonly story: StoryBundle;
  readonly status: NewsSynthesisLifecycleStatus;
  readonly frameTableState?: NewsFrameTableReadinessState;
  readonly retryable?: boolean;
  readonly reason?: string;
  readonly synthesisId?: string;
  readonly epoch?: number;
  readonly updatedAt?: number;
}): NewsSynthesisLifecycleRecord {
  const status = input.status;
  const frameTableState = input.frameTableState
    ?? (status === 'accepted_available' ? 'frame_table_unavailable' : 'frame_table_pending');
  const reason = input.reason?.trim();
  const synthesisId = input.synthesisId?.trim();
  const epoch = input.epoch;
  return {
    schemaVersion: NEWS_SYNTHESIS_LIFECYCLE_SCHEMA_VERSION,
    story_id: input.story.story_id,
    topic_id: input.story.topic_id,
    source_set_revision: input.story.provenance_hash,
    source_count: input.story.sources.length,
    canonical_source_count: canonicalSourceCount(input.story),
    status,
    retryable: input.retryable ?? status === 'retryable_failure',
    ...(reason ? { reason } : {}),
    ...(synthesisId ? { synthesis_id: synthesisId } : {}),
    ...(epoch !== undefined ? { epoch: Math.max(0, Math.floor(epoch)) } : {}),
    frame_table_state: frameTableState,
    updated_at: Math.max(0, Math.floor(input.updatedAt ?? Date.now())),
  };
}

export async function readNewsSynthesisLifecycleStatus(
  client: VennClient,
  storyId: string,
): Promise<NewsSynthesisLifecycleRecord | null> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    return null;
  }
  const raw = await readOnce(getNewsSynthesisLifecycleChain(client, normalizedId) as unknown as ChainWithGet<unknown>);
  if (raw === null) {
    return null;
  }
  return parseNewsSynthesisLifecycleFromStoredRecord(client, normalizedId, raw);
}

export async function readNewsSynthesisLifecycleStatusViaRelayRest(
  client: VennClient,
  storyId: string,
): Promise<NewsSynthesisLifecycleRecord | null> {
  const normalizedId = storyId.trim();
  if (!normalizedId || typeof fetch !== 'function') {
    return null;
  }
  const query = new URLSearchParams({ story_id: normalizedId });
  const endpoints = resolveRelayRestEndpointsFromPeers(
    client,
    `/vh/news/synthesis-lifecycle?${query.toString()}`,
  );
  if (endpoints.length === 0) {
    return null;
  }

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RELAY_REST_READ_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json() as { record?: unknown; lifecycle?: unknown };
      const relayParsed = parseNewsSynthesisLifecycleFromRelayPayload(normalizedId, payload.lifecycle);
      if (relayParsed) {
        return relayParsed;
      }
      const parsed = isRecord(payload.record)
        ? await parseNewsSynthesisLifecycleFromStoredRecord(client, normalizedId, payload.record)
        : null;
      if (parsed) {
        return parsed;
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

export async function readNewsSynthesisLifecycleStatusWithRelayRestFallback(
  client: VennClient,
  storyId: string,
): Promise<NewsSynthesisLifecycleRecord | null> {
  const relayed = await timeoutAsNull(
    readNewsSynthesisLifecycleStatusViaRelayRest(client, storyId),
    RELAY_REST_READ_TIMEOUT_MS + 1_000,
  );
  if (relayed) {
    return relayed;
  }
  return readNewsSynthesisLifecycleStatus(client, storyId);
}

export async function writeNewsSynthesisLifecycleStatus(
  client: VennClient,
  record: unknown,
): Promise<NewsSynthesisLifecycleRecord> {
  assertNoNewsIdentityOrTokenFields(record);
  if (!isRecord(record)) {
    throw new Error('news synthesis lifecycle record is required');
  }
  const storyId = normalizeLifecycleString(record.story_id);
  if (!storyId) {
    throw new Error('news synthesis lifecycle story_id is required');
  }
  const sanitized = parseNewsSynthesisLifecyclePayload(record, storyId);
  if (!sanitized) {
    throw new Error('news synthesis lifecycle record is invalid');
  }
  const encoded = await buildSystemWriterSynthesisLifecycleRecord(client, sanitized);
  await putWithAck(
    getNewsSynthesisLifecycleChain(client, sanitized.story_id) as unknown as ChainWithGet<Record<string, unknown>>,
    encoded,
    {
      writeClass: 'news-synthesis-lifecycle',
      timeoutError: 'news synthesis lifecycle write timed out and readback did not confirm persistence',
      readback: () => readNewsSynthesisLifecycleStatus(client, sanitized.story_id),
      readbackPredicate: (observed) => {
        const candidate = observed as NewsSynthesisLifecycleRecord | null;
        return Boolean(
          candidate
          && candidate.story_id === sanitized.story_id
          && candidate.source_set_revision === sanitized.source_set_revision
          && candidate.status === sanitized.status
          && candidate.updated_at === sanitized.updated_at
        );
      },
      requireReadback: newsWriteRequiresReadback(client),
    },
  );
  return sanitized;
}

/**
 * Remove a StoryBundle node from `vh/news/stories/<storyId>`.
 */
export async function removeNewsStory(client: VennClient, storyId: string): Promise<void> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    throw new Error('storyId is required');
  }
  await clearMapEntryWithAck(
    getNewsStoriesChain(client) as unknown as ChainWithGet<Record<string, unknown>>,
    normalizedId,
  );
  await clearWithAck(
    getNewsStoryChain(client, normalizedId) as unknown as ChainWithGet<Record<string, unknown>>,
  );
}

/**
 * Read `vh/news/index/latest/*` and coerce to `{ [storyId]: latestActivityMs }`.
 *
 * Compatibility contract:
 * - target semantics: scalar activity timestamp (`cluster_window_end`)
 * - legacy semantics: `{ created_at: ... }` payloads remain readable
 */
export async function readNewsLatestIndex(client: VennClient): Promise<NewsLatestIndex> {
  const latestChain = getNewsLatestIndexChain(client) as unknown as ChainWithGet<unknown>;
  const raw = await readSettledRoot(
    latestChain,
    hasSettledLatestIndexPayload,
  );
  if (!isRecord(raw)) {
    return {};
  }

  const index: NewsLatestIndex = {};
  const blockedStoryIds = new Set<string>();
  for (const [storyId, value] of Object.entries(raw)) {
    if (storyId === '_') {
      continue;
    }
    if (blocksLegacyIndexFallback(value)) {
      blockedStoryIds.add(storyId);
    }
    const timestamp = await parseLatestIndexEntry(client, storyId, value);
    if (timestamp !== null) {
      index[storyId] = timestamp;
    }
  }
  if (!hasMissingIndexChildEntries(raw, index, blockedStoryIds)) {
    return index;
  }
  return {
    ...await readIndexedEntries(
      latestChain,
      raw,
      (storyId, value) => parseLatestIndexEntry(client, storyId, value),
      blockedStoryIds,
    ),
    ...index,
  };
}

/**
 * Read latest-index records through the relay's same-origin REST fallback.
 *
 * Browsers can occasionally observe an empty or partial Gun root while the
 * public relay has persisted child records. The returned records are still
 * validated locally with the pinned system-writer key before becoming index
 * evidence.
 */
export async function readNewsLatestIndexViaRelayRest(
  client: VennClient,
  options: NewsLatestIndexReadOptions = {},
): Promise<NewsLatestIndex> {
  const page = await readNewsLatestIndexPageViaRelayRest(client, options);
  return page.index;
}

export async function readNewsLatestIndexPageViaRelayRest(
  client: VennClient,
  options: NewsLatestIndexReadOptions = {},
): Promise<NewsLatestIndexPage> {
  if (typeof fetch !== 'function') {
    return {
      index: {},
      nextCursor: null,
      recordCount: 0,
      relayRestDiagnostics: createRelayRestReadDiagnostics([]),
    };
  }
  const { before, endpoints } = resolveLatestIndexRelayRestRead(client, options);
  const relayRestDiagnostics = createRelayRestReadDiagnostics(endpoints);
  if (endpoints.length === 0) {
    return { index: {}, nextCursor: null, recordCount: 0, relayRestDiagnostics };
  }

  const index: NewsLatestIndex = {};
  const stories: Record<string, StoryBundle> = {};
  const storyStates: Record<string, Record<string, unknown>> = {};
  let nextCursor: number | null = null;
  let sourceKeyCount: number | undefined;
  let composition: unknown;
  const endpointPayloads = await Promise.all(endpoints.map(async (endpoint) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RELAY_REST_READ_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        recordRelayRestNonOk(relayRestDiagnostics, {
          endpoint,
          status: response.status,
          contentType: response.headers?.get?.('content-type') ?? null,
          body,
        });
        return null;
      }
      recordRelayRestSuccess(relayRestDiagnostics, response.status);
      return await response.json() as {
        records?: unknown;
        index?: unknown;
        next_cursor?: unknown;
        record_count?: unknown;
        source_key_count?: unknown;
        composition?: unknown;
        stories?: unknown;
        story_states?: unknown;
      };
    } catch (error) {
      recordRelayRestNetworkFailure(relayRestDiagnostics, endpoint, error);
      return null;
    /* v8 ignore next -- cleanup-only finally branch is outcome-neutral and covered through success/failure calls. */
    } finally {
      clearTimeout(timeout);
    }
  }));

  for (const payload of endpointPayloads) {
    if (!payload) {
      continue;
    }
    try {
      const records = isRecord(payload.records)
        ? payload.records
        : isRecord(payload.index)
          ? payload.index
          : null;
      if (!records) {
        continue;
      }

      const relayRecordTimestamps: NewsLatestIndex = {};
      for (const [storyId, value] of Object.entries(records)) {
        const relayTimestamp = parseRelayLatestIndexRecordTimestampForEmbeddedStory(
          storyId,
          value,
          before,
        );
        if (relayTimestamp !== null) {
          relayRecordTimestamps[storyId] = Math.max(
            relayRecordTimestamps[storyId] ?? 0,
            relayTimestamp,
          );
        }
        try {
          const timestamp = await parseLatestIndexEntry(client, storyId, value);
          if (timestamp !== null && (before === null || timestamp < before)) {
            index[storyId] = Math.max(index[storyId] ?? 0, timestamp);
          }
        } /* v8 ignore next -- keep the public feed partial when one persisted row has an anomalous parser failure. */ catch {}
      }
      const payloadStories = parseRelayLatestIndexStories(payload.stories, {
        ...relayRecordTimestamps,
        ...index,
      });
      for (const [storyId, story] of Object.entries(payloadStories ?? {})) {
        stories[storyId] = story;
        if (!(storyId in index)) {
          const relayTimestamp = relayRecordTimestamps[storyId];
          /* v8 ignore next 3 -- embedded stories only pass parsing when the relay row already supplied a timestamp. */
          if (relayTimestamp === undefined) {
            index[storyId] = story.cluster_window_end;
          } else {
            index[storyId] = relayTimestamp;
          }
        }
      }
      if (isRecord(payload.story_states)) {
        for (const [storyId, storyState] of Object.entries(payload.story_states)) {
          if (typeof storyId === 'string' && storyId.trim() && isRecord(storyState)) {
            storyStates[storyId] = storyState;
          }
        }
      }
      const payloadNextCursor = normalizeRelayLatestIndexNextCursor(payload.next_cursor);
      if (payloadNextCursor !== null) {
        nextCursor = Math.max(nextCursor ?? payloadNextCursor, payloadNextCursor);
      }
      const payloadSourceKeyCount = Number(payload.source_key_count);
      if (Number.isFinite(payloadSourceKeyCount) && payloadSourceKeyCount >= 0) {
        sourceKeyCount = Math.max(sourceKeyCount ?? 0, Math.floor(payloadSourceKeyCount));
      }
      if (composition === undefined && payload.composition !== undefined) {
        composition = payload.composition;
      }
    } catch {
      continue;
    }
  }
  return {
    index,
    nextCursor: nextCursor ?? latestIndexWindowNextCursor(index),
    recordCount: Object.keys(index).length,
    relayRestDiagnostics,
    ...(sourceKeyCount === undefined ? {} : { sourceKeyCount }),
    ...(composition === undefined ? {} : { composition }),
    ...(Object.keys(stories).length === 0 ? {} : { stories }),
    ...(Object.keys(storyStates).length === 0 ? {} : { storyStates }),
  };
}

export async function readNewsLatestIndexWithRelayRestFallback(
  client: VennClient,
  options: NewsLatestIndexReadOptions = {},
): Promise<NewsLatestIndex> {
  const page = await readNewsLatestIndexPageWithRelayRestFallback(client, options);
  return page.index;
}

export async function readNewsLatestIndexPageWithRelayRestFallback(
  client: VennClient,
  options: NewsLatestIndexReadOptions = {},
): Promise<NewsLatestIndexPage> {
  const relayTimeoutMs = RELAY_REST_READ_TIMEOUT_MS + 1_000;
  const relayTimeoutFallback = {
    index: {},
    nextCursor: null,
    recordCount: 0,
    relayRestDiagnostics: typeof fetch === 'function'
      ? createRelayRestTimeoutDiagnostics(
        resolveLatestIndexRelayRestRead(client, options).endpoints,
        'news-latest-index-relay-rest-read',
        relayTimeoutMs,
      )
      : createRelayRestReadDiagnostics([]),
  };
  const relayed = await timeoutAsNull(
    readNewsLatestIndexPageViaRelayRest(client, options),
    relayTimeoutMs,
  ) ?? relayTimeoutFallback;
  if (relayed && Object.keys(relayed.index).length > 0) {
    return relayed;
  }
  const direct = await timeoutAsNull(
    readNewsLatestIndex(client),
    Math.max(READ_ONCE_TIMEOUT_MS + 1_000, RELAY_REST_READ_TIMEOUT_MS),
  );
  /* v8 ignore next -- direct null only occurs on bounded direct-read timeout; empty fallback is defensive. */
  const index = direct ? filterLatestIndexWindow(direct, options) : {};
  return {
    index,
    nextCursor: latestIndexWindowNextCursor(index),
    recordCount: Object.keys(index).length,
    directGunLatestIndexCount: Object.keys(index).length,
    relayRestDiagnostics: relayed.relayRestDiagnostics,
  };
}

/**
 * Read `vh/news/index/hot/*` and coerce to `{ [storyId]: hotness }`.
 */
export async function readNewsHotIndex(client: VennClient): Promise<NewsHotIndex> {
  const hotChain = getNewsHotIndexChain(client) as unknown as ChainWithGet<unknown>;
  const raw = await readSettledRoot(
    hotChain,
    hasSettledHotIndexPayload,
  );
  if (!isRecord(raw)) {
    return {};
  }

  const index: NewsHotIndex = {};
  const blockedStoryIds = new Set<string>();
  for (const [storyId, value] of Object.entries(raw)) {
    if (storyId === '_') {
      continue;
    }
    if (blocksLegacyIndexFallback(value)) {
      blockedStoryIds.add(storyId);
    }
    const hotness = await parseHotIndexEntry(client, storyId, value);
    if (hotness !== null) {
      index[storyId] = hotness;
    }
  }
  if (!hasMissingIndexChildEntries(raw, index, blockedStoryIds)) {
    return index;
  }
  return {
    ...await readIndexedEntries(
      hotChain,
      raw,
      (storyId, value) => parseHotIndexEntry(client, storyId, value),
      blockedStoryIds,
    ),
    ...index,
  };
}

/**
 * Read hot-index records through the relay's REST fallback.
 *
 * This mirrors latest-index relay read behavior so product hot ranking is not
 * lost when a browser or public gate observes a sparse Gun root.
 */
export async function readNewsHotIndexViaRelayRest(
  client: VennClient,
  options: NewsHotIndexReadOptions = {},
): Promise<NewsHotIndex> {
  if (typeof fetch !== 'function') {
    return {};
  }
  const limit = normalizeLatestIndexReadLimit(options.limit);
  const endpoints = resolveRelayRestEndpointsFromPeers(
    client,
    `/vh/news/hot-index?limit=${encodeURIComponent(String(limit))}`,
  );
  if (endpoints.length === 0) {
    return {};
  }

  const index: NewsHotIndex = {};
  const endpointPayloads = await Promise.all(endpoints.map(async (endpoint) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RELAY_REST_READ_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }
      return await response.json() as { records?: unknown; index?: unknown };
    } catch {
      return null;
    /* v8 ignore next -- cleanup-only finally branch is outcome-neutral and covered through success/failure calls. */
    } finally {
      clearTimeout(timeout);
    }
  }));

  for (const payload of endpointPayloads) {
    if (!payload) {
      continue;
    }
    try {
      const records = isRecord(payload.records)
        ? payload.records
        : isRecord(payload.index)
          ? payload.index
          : null;
      if (!records) {
        continue;
      }

      for (const [storyId, value] of Object.entries(records)) {
        try {
          const hotness = await parseHotIndexEntry(client, storyId, value);
          if (hotness !== null) {
            index[storyId] = Math.max(index[storyId] ?? 0, hotness);
          }
        } /* v8 ignore next -- keep the public feed partial when one persisted row has an anomalous parser failure. */ catch {}
      }
    } catch {
      continue;
    }
  }
  return filterHotIndexWindow(index, options);
}

export async function readNewsHotIndexWithRelayRestFallback(
  client: VennClient,
  options: NewsHotIndexReadOptions = {},
): Promise<NewsHotIndex> {
  const relayed = await timeoutAsNull(
    readNewsHotIndexViaRelayRest(client, options),
    RELAY_REST_READ_TIMEOUT_MS + 1_000,
  );
  if (relayed && Object.keys(relayed).length > 0) {
    return filterHotIndexWindow(relayed, options);
  }
  const direct = await timeoutAsNull(
    readNewsHotIndex(client),
    Math.max(READ_ONCE_TIMEOUT_MS + 1_000, RELAY_REST_READ_TIMEOUT_MS),
  );
  /* v8 ignore next -- direct null only occurs on bounded direct-read timeout; empty fallback is defensive. */
  return direct ? filterHotIndexWindow(direct, options) : {};
}

/**
 * Write latest-index entry for a story.
 */
export async function writeNewsLatestIndexEntry(
  client: VennClient,
  storyId: string,
  latestTimestamp: number,
  story?: StoryBundle,
): Promise<void> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    throw new Error('storyId is required');
  }
  if (story && story.story_id !== normalizedId) {
    throw new Error('latest-index story metadata must match storyId');
  }
  const normalizedLatestTimestamp = Math.max(0, Math.floor(latestTimestamp));
  const encoded = await buildSystemWriterLatestIndexRecord(client, normalizedId, normalizedLatestTimestamp, story);
  const chain = getNewsLatestIndexChain(client).get(normalizedId) as unknown as ChainWithGet<Record<string, unknown>>;
  const expectedMetadata = story ? latestIndexProductMetadataForStory(story) : null;
  await putWithAck(chain, encoded, {
    writeClass: 'news-latest-index',
    timeoutError: 'news latest-index write timed out and readback did not confirm persistence',
    readback: () => expectedMetadata
      ? readNewsLatestIndexProductRecord(client, normalizedId)
      : readNewsLatestIndexEntry(client, normalizedId),
    readbackPredicate: (observed) => {
      if (!expectedMetadata) {
        return observed === normalizedLatestTimestamp;
      }
      const record = observed as NewsLatestIndexEntryRecord | null;
      return Boolean(
        record
        && record.story_id === normalizedId
        && record.latest_activity_at === normalizedLatestTimestamp
        && record.product_state_schema_version === expectedMetadata.product_state_schema_version
        && record.topic_id === expectedMetadata.topic_id
        && record.source_set_revision === expectedMetadata.source_set_revision
        && record.source_count === expectedMetadata.source_count
        && record.canonical_source_count === expectedMetadata.canonical_source_count
        && record.story_created_at === expectedMetadata.story_created_at
        && record.cluster_window_start === expectedMetadata.cluster_window_start
      );
    },
    requireReadback: newsWriteRequiresReadback(client),
  });
}

/**
 * Remove latest-index entry for a story.
 */
export async function removeNewsLatestIndexEntry(
  client: VennClient,
  storyId: string,
): Promise<void> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    throw new Error('storyId is required');
  }
  await clearMapEntryWithAck(
    getNewsLatestIndexChain(client) as unknown as ChainWithGet<Record<string, unknown>>,
    normalizedId,
  );
  await clearWithAck(getNewsLatestIndexChain(client).get(normalizedId));
}

/**
 * Write hot-index entry for a story.
 */
export async function writeNewsHotIndexEntry(
  client: VennClient,
  storyId: string,
  hotnessScore: number,
  story?: StoryBundle,
): Promise<number> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    throw new Error('storyId is required');
  }
  if (story && story.story_id !== normalizedId) {
    throw new Error('hot-index story metadata must match storyId');
  }

  const normalizedHotness = parseHotnessScore(hotnessScore) ?? 0;
  const encoded = await buildSystemWriterHotIndexRecord(client, normalizedId, normalizedHotness, story);
  const chain = getNewsHotIndexChain(client).get(normalizedId) as unknown as ChainWithGet<Record<string, unknown>>;
  const expectedMetadata = story ? latestIndexProductMetadataForStory(story) : null;
  await putWithAck(chain, encoded, {
    writeClass: 'news-hot-index',
    timeoutError: 'news hot-index write timed out and readback did not confirm persistence',
    readback: () => expectedMetadata
      ? readNewsHotIndexProductRecord(client, normalizedId)
      : readNewsHotIndexEntry(client, normalizedId),
    readbackPredicate: (observed) => {
      if (!expectedMetadata) {
        return observed === normalizedHotness;
      }
      const record = observed as NewsHotIndexEntryRecord | null;
      return Boolean(
        record
        && record.story_id === normalizedId
        && record.hotness === normalizedHotness
        && record.product_state_schema_version === expectedMetadata.product_state_schema_version
        && record.topic_id === expectedMetadata.topic_id
        && record.source_set_revision === expectedMetadata.source_set_revision
        && record.source_count === expectedMetadata.source_count
        && record.canonical_source_count === expectedMetadata.canonical_source_count
        && record.story_created_at === expectedMetadata.story_created_at
        && record.cluster_window_start === expectedMetadata.cluster_window_start
      );
    },
    requireReadback: newsWriteRequiresReadback(client),
  });
  return normalizedHotness;
}

/**
 * Remove hot-index entry for a story.
 */
export async function removeNewsHotIndexEntry(
  client: VennClient,
  storyId: string,
): Promise<void> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    throw new Error('storyId is required');
  }
  await clearMapEntryWithAck(
    getNewsHotIndexChain(client) as unknown as ChainWithGet<Record<string, unknown>>,
    normalizedId,
  );
  await clearWithAck(getNewsHotIndexChain(client).get(normalizedId));
}

/**
 * Convenience writer for publishing bundle + latest index atomically at app level.
 *
 * PR1 semantics: latest index is activity-based and keyed by `cluster_window_end`.
 * PR5 semantics: hot index is deterministic and keyed by computed story hotness.
 */
export async function writeNewsBundle(client: VennClient, story: unknown): Promise<StoryBundle> {
  const sanitized = await writeNewsStory(client, story);
  await writeNewsLatestIndexEntry(client, sanitized.story_id, sanitized.cluster_window_end, sanitized);
  await writeNewsHotIndexEntry(client, sanitized.story_id, computeStoryHotness(sanitized), sanitized);
  return sanitized;
}

/**
 * Remove a published story bundle and its discovery indexes.
 */
export async function removeNewsBundle(client: VennClient, storyId: string): Promise<void> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    throw new Error('storyId is required');
  }

  await removeNewsStory(client, normalizedId);
  await removeNewsLatestIndexEntry(client, normalizedId);
  await removeNewsHotIndexEntry(client, normalizedId);
}

// ---- Removal ledger adapters ----

export interface RemovalEntry {
  readonly urlHash: string;
  readonly canonicalUrl: string;
  readonly removedAt: number;
  readonly reason: string;
  readonly removedBy: string | null;
  readonly note: string | null;
}

export function parseRemovalEntry(value: unknown): RemovalEntry | null {
  const raw = stripGunMetadata(value);
  if (!isRecord(raw)) return null;
  const { urlHash, canonicalUrl, removedAt, reason, removedBy, note } = raw as Record<string, unknown>;
  if (typeof urlHash !== 'string' || typeof canonicalUrl !== 'string') return null;
  if (typeof removedAt !== 'number' || !Number.isFinite(removedAt)) return null;
  if (typeof reason !== 'string') return null;
  return {
    urlHash, canonicalUrl, removedAt, reason,
    removedBy: typeof removedBy === 'string' ? removedBy : null,
    note: typeof note === 'string' ? note : null,
  };
}

/**
 * Chain for `vh/news/removed/<urlHash>`.
 */
export function getNewsRemovalChain(client: VennClient, urlHash: string): ChainWithGet<RemovalEntry> {
  const chain = client.mesh
    .get('news')
    .get('removed')
    .get(urlHash) as unknown as ChainWithGet<RemovalEntry>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, removalPath(urlHash));
}

/**
 * Read and validate a RemovalEntry from mesh.
 */
export async function readNewsRemoval(client: VennClient, urlHash: string): Promise<RemovalEntry | null> {
  const raw = await readOnce(getNewsRemovalChain(client, urlHash));
  return parseRemovalEntry(raw);
}

/**
 * Read latest index, sorted by newest first.
 */
export async function readLatestStoryIds(client: VennClient, limit = 50): Promise<string[]> {
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const index = await readNewsLatestIndex(client);
  return Object.entries(index)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.floor(limit))
    .map(([storyId]) => storyId);
}

export const newsAdapterInternal = {
  readSettledRoot,
  hasSettledLatestIndexPayload,
  hasSettledHotIndexPayload,
  hasSettledStoryRootPayload,
  extractIndexChildKeys,
  readIndexedEntries,
  readMappedChildKeys,
  parseRelayLatestIndexStories,
  parseNewsSynthesisLifecyclePayload,
  parseNewsSynthesisLifecycleFromRelayPayload,
  parseLatestIndexEntryPayload,
  parseHotIndexEntryPayload,
};
