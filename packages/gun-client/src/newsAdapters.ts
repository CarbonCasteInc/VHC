import {
  assertCanonicalNewsTopicId,
  isCanonicalNewsTopicIdShape,
  StoryBundleSchema,
  type StoryBundle,
} from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import { readGunTimeoutMs } from './runtimeConfig';
import type { VennClient } from './types';

export type NewsLatestIndex = Record<string, number>;
export type NewsHotIndex = Record<string, number>;

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
const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_READ_TIMEOUT_MS', 'VH_GUN_READ_TIMEOUT_MS'],
  2_500,
);
const ROOT_INDEX_SETTLE_MS = 150;

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

function hotIndexPath(): string {
  return 'vh/news/index/hot/';
}

function ingestionLeasePath(): string {
  return 'vh/news/runtime/lease/ingester/';
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
  parseEntry: (value: unknown) => number | null,
): Promise<Record<string, number>> {
  const keys = extractIndexChildKeys(raw);
  if (keys.length === 0) {
    return {};
  }

  const entries = await Promise.all(keys.map(async (storyId) => {
    const value = await readOnce(chain.get(storyId) as unknown as ChainWithGet<unknown>);
    const parsed = parseEntry(value);
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
  console.warn(`[vh:news] put ack timed out, proceeding without ack${suffix}`);
}

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      warnNewsAckTimeout();
      resolve();
    }, NEWS_PUT_ACK_TIMEOUT_MS);

    chain.put(value, (ack?: ChainAck) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (ack?.err) {
        reject(new Error(ack.err));
        return;
      }
      resolve();
    });
  });
}

async function clearWithAck<T>(chain: ChainWithGet<T>): Promise<void> {
  await putWithAck(chain as unknown as ChainWithGet<T | null>, null as T | null);
}

async function clearMapEntryWithAck(
  chain: ChainWithGet<Record<string, unknown>>,
  storyId: string,
): Promise<void> {
  await putWithAck(chain, { [storyId]: null });
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

function parseStoryBundle(data: unknown): StoryBundle | null {
  const payload = decodeStoryBundlePayload(stripGunMetadata(data));
  if (hasForbiddenNewsPayloadFields(payload)) {
    return null;
  }
  const parsed = StoryBundleSchema.safeParse(payload);
  if (!parsed.success || !isCanonicalNewsTopicIdShape(parsed.data.topic_id)) {
    return null;
  }
  return parsed.data;
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
  const chain = client.mesh
    .get('news')
    .get('runtime')
    .get('lease')
    .get('ingester') as unknown as ChainWithGet<NewsIngestionLease>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, ingestionLeasePath());
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
  await putWithAck(getNewsIngestionLeaseChain(client), sanitized);
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
  const parsed = parseStoryBundle(raw);
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
 * Validate and write StoryBundle to `vh/news/stories/<storyId>`.
 *
 * `created_at` is immutable by story identity: once a story exists,
 * subsequent re-ingest writes preserve the first observed `created_at`.
 */
export async function writeNewsStory(client: VennClient, story: unknown): Promise<StoryBundle> {
  const sanitized = sanitizeStoryBundle(story);
  await assertCanonicalNewsTopicId(sanitized);
  const normalized = await enforceCreatedAtFirstWriteWins(client, sanitized);
  const encoded = encodeStoryBundleForGun(normalized);
  await putWithAck(
    getNewsStoryChain(client, normalized.story_id) as unknown as ChainWithGet<Record<string, unknown>>,
    encoded
  );
  return normalized;
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
  for (const [storyId, value] of Object.entries(raw)) {
    if (storyId === '_') {
      continue;
    }
    const timestamp = parseLatestTimestamp(value);
    if (timestamp !== null) {
      index[storyId] = timestamp;
    }
  }
  if (Object.keys(index).length > 0) {
    return index;
  }
  return readIndexedEntries(latestChain, raw, parseLatestTimestamp);
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
  for (const [storyId, value] of Object.entries(raw)) {
    if (storyId === '_') {
      continue;
    }
    const hotness = parseHotnessScore(value);
    if (hotness !== null) {
      index[storyId] = hotness;
    }
  }
  if (Object.keys(index).length > 0) {
    return index;
  }
  return readIndexedEntries(hotChain, raw, parseHotnessScore);
}

/**
 * Write latest-index entry for a story.
 */
export async function writeNewsLatestIndexEntry(
  client: VennClient,
  storyId: string,
  latestTimestamp: number
): Promise<void> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    throw new Error('storyId is required');
  }
  const normalizedLatestTimestamp = Math.max(0, Math.floor(latestTimestamp));
  await putWithAck(getNewsLatestIndexChain(client).get(normalizedId), normalizedLatestTimestamp);
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
): Promise<number> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    throw new Error('storyId is required');
  }

  const normalizedHotness = parseHotnessScore(hotnessScore) ?? 0;
  await putWithAck(getNewsHotIndexChain(client).get(normalizedId), normalizedHotness);
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
  await writeNewsLatestIndexEntry(client, sanitized.story_id, sanitized.cluster_window_end);
  await writeNewsHotIndexEntry(client, sanitized.story_id, computeStoryHotness(sanitized));
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
  extractIndexChildKeys,
  readIndexedEntries,
};
