import type { StoryBundle } from '@vh/data-model';
import {
  getNewsHotIndexChain,
  getNewsLatestIndexChain,
  parseNewsLatestIndexEntryRecord,
  readNewsStoryWithRelayRestFallback,
  type ChainWithGet,
  type VennClient
} from '@vh/gun-client';
import type { StoreApi } from 'zustand';
import type { NewsState } from './types';
import { loadStorylinesForStories } from './storylines';
import { recordGunMessageActivity } from '../../hooks/useHealthMonitor';

const hydratedStores = new WeakSet<StoreApi<NewsState>>();
const NEWS_HYDRATION_INDEX_LIMIT = readPositiveIntEnv('VITE_VH_NEWS_HYDRATION_INDEX_LIMIT', 80);
const NEWS_HYDRATION_STORY_READ_CONCURRENCY = readPositiveIntEnv(
  'VITE_VH_NEWS_HYDRATION_STORY_READ_CONCURRENCY',
  8,
);
const NEWS_HYDRATION_SUBSCRIBE_LATEST_INDEX = readBooleanEnv(
  'VITE_VH_NEWS_HYDRATION_SUBSCRIBE_LATEST_INDEX',
  true,
);
const NEWS_HYDRATION_SUBSCRIBE_HOT_INDEX = readBooleanEnv(
  'VITE_VH_NEWS_HYDRATION_SUBSCRIBE_HOT_INDEX',
  true,
);

const pendingStoryReadsByStore = new WeakMap<StoreApi<NewsState>, Set<string>>();
const fetchedStoryTimestampsByStore = new WeakMap<StoreApi<NewsState>, Map<string, number>>();
const storyReadQueuesByStore = new WeakMap<StoreApi<NewsState>, StoryReadQueueState>();
const latestIndexEventVersionsByStore = new WeakMap<StoreApi<NewsState>, Map<string, number>>();
const PROTOCOL_INDEX_FIELDS = [
  '_protocolVersion',
  '_writerKind',
  '_systemWriterId',
  '_systemSignature',
  '_systemIssuedAt',
  '_authorScheme',
  'signedWriteEnvelope',
];

interface StoryReadJob {
  client: VennClient;
  store: StoreApi<NewsState>;
  storyId: string;
  latestActivityAt: number;
}

interface StoryReadQueueState {
  active: number;
  queue: StoryReadJob[];
}

/* c8 ignore start -- environment-source branching is runtime-host defensive; behavior is covered via callers. */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
    ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
    ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}
/* c8 ignore stop */

function carriesProtocolIndexFields(value: unknown): boolean {
  /* v8 ignore next 3 -- callers guard object-ness before checking protocol fields. */
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return PROTOCOL_INDEX_FIELDS.some((field) => field in record);
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

  if (value && typeof value === 'object') {
    const record = value as {
      cluster_window_end?: unknown;
      latest_activity_at?: unknown;
      created_at?: unknown;
    };

    if ('cluster_window_end' in record) {
      return parseLatestTimestamp(record.cluster_window_end);
    }
    if ('latest_activity_at' in record) {
      return parseLatestTimestamp(record.latest_activity_at);
    }
    if ('created_at' in record) {
      return parseLatestTimestamp(record.created_at);
    }
  }

  return null;
}

function parseLatestIndexSubscriptionTimestamp(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return parseLatestTimestamp(value);
  }

  if (carriesProtocolIndexFields(value)) {
    return null;
  }

  return parseLatestTimestamp(value);
}

function parseHotnessScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 1_000_000) / 1_000_000;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed * 1_000_000) / 1_000_000;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    if (carriesProtocolIndexFields(value)) {
      return null;
    }
    if ('hotness' in (value as Record<string, unknown>)) {
      return parseHotnessScore((value as { hotness?: unknown }).hotness);
    }
  }

  return null;
}

function canSubscribe<T>(chain: ChainWithGet<T>): chain is ChainWithGet<T> & Required<Pick<ChainWithGet<T>, 'map' | 'on'>> {
  const mapped = chain.map?.();
  return Boolean(mapped && typeof mapped.on === 'function');
}

function getPendingStoryReads(store: StoreApi<NewsState>): Set<string> {
  const existing = pendingStoryReadsByStore.get(store);
  if (existing) {
    return existing;
  }
  const created = new Set<string>();
  pendingStoryReadsByStore.set(store, created);
  return created;
}

function getFetchedStoryTimestamps(store: StoreApi<NewsState>): Map<string, number> {
  const existing = fetchedStoryTimestampsByStore.get(store);
  if (existing) {
    return existing;
  }
  const created = new Map<string, number>();
  fetchedStoryTimestampsByStore.set(store, created);
  return created;
}

function getStoryReadQueue(store: StoreApi<NewsState>): StoryReadQueueState {
  const existing = storyReadQueuesByStore.get(store);
  if (existing) {
    return existing;
  }
  const created = { active: 0, queue: [] };
  storyReadQueuesByStore.set(store, created);
  return created;
}

function getLatestIndexEventVersions(store: StoreApi<NewsState>): Map<string, number> {
  const existing = latestIndexEventVersionsByStore.get(store);
  if (existing) {
    return existing;
  }
  const created = new Map<string, number>();
  latestIndexEventVersionsByStore.set(store, created);
  return created;
}

function markLatestIndexEvent(store: StoreApi<NewsState>, storyId: string): number {
  const versions = getLatestIndexEventVersions(store);
  const next = (versions.get(storyId) ?? 0) + 1;
  versions.set(storyId, next);
  return next;
}

function isCurrentLatestIndexEvent(
  store: StoreApi<NewsState>,
  storyId: string,
  version: number,
): boolean {
  return getLatestIndexEventVersions(store).get(storyId) === version;
}

function pruneLatestWindow(store: StoreApi<NewsState>): void {
  const latestIndex = store.getState().latestIndex;
  const entries = Object.entries(latestIndex);
  if (entries.length <= NEWS_HYDRATION_INDEX_LIMIT) {
    return;
  }

  const keep = new Set(
    entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, NEWS_HYDRATION_INDEX_LIMIT)
      .map(([storyId]) => storyId),
  );
  for (const [storyId] of entries) {
    if (keep.has(storyId)) {
      continue;
    }
    store.getState().removeLatestIndex(storyId);
    store.getState().removeHotIndex(storyId);
    store.getState().removeStory(storyId);
    getFetchedStoryTimestamps(store).delete(storyId);
  }
}

async function runStoryReadJob(job: StoryReadJob): Promise<void> {
  const { client, store, storyId, latestActivityAt } = job;
  const pending = getPendingStoryReads(store);
  const fetchedTimestamps = getFetchedStoryTimestamps(store);
  try {
    if (store.getState().latestIndex[storyId] !== latestActivityAt) {
      return;
    }
    const story = await readNewsStoryWithRelayRestFallback(client, storyId);
    if (!story || store.getState().latestIndex[storyId] !== latestActivityAt) {
      return;
    }
    store.getState().upsertStory(story);
    fetchedTimestamps.set(storyId, latestActivityAt);
    const storylines = await loadStorylinesForStories(client, [story]);
    for (const storyline of storylines) {
      store.getState().upsertStoryline(storyline);
    }
  } catch {
    // Live hydration is best-effort; refreshLatest performs explicit bounded reads.
  } finally {
    pending.delete(storyId);
  }
}

function drainStoryReadQueue(queueState: StoryReadQueueState): void {
  while (
    queueState.active < NEWS_HYDRATION_STORY_READ_CONCURRENCY &&
    queueState.queue.length > 0
  ) {
    const job = queueState.queue.shift()!;
    queueState.active += 1;
    void runStoryReadJob(job).finally(() => {
      queueState.active -= 1;
      drainStoryReadQueue(queueState);
    });
  }
}

function loadStoryFromIndex(
  client: VennClient,
  store: StoreApi<NewsState>,
  storyId: string,
  latestActivityAt: number,
): void {
  const pending = getPendingStoryReads(store);
  if (pending.has(storyId)) {
    return;
  }
  const fetchedTimestamps = getFetchedStoryTimestamps(store);
  if (fetchedTimestamps.get(storyId) === latestActivityAt) {
    return;
  }

  pending.add(storyId);
  const queue = getStoryReadQueue(store);
  queue.queue.push({ client, store, storyId, latestActivityAt });
  drainStoryReadQueue(queue);
}

/**
 * Attach live Gun subscriptions to keep the news store fresh.
 * Returns true when hydration is attached, false when no client/subscribe support exists.
 */
export function hydrateNewsStore(resolveClient: () => VennClient | null, store: StoreApi<NewsState>): boolean {
  if (hydratedStores.has(store)) {
    return true;
  }

  const client = resolveClient();
  if (!client) {
    return false;
  }

  const latestChain = NEWS_HYDRATION_SUBSCRIBE_LATEST_INDEX
    ? getNewsLatestIndexChain(client)
    : null;
  const hotChain = NEWS_HYDRATION_SUBSCRIBE_HOT_INDEX
    ? getNewsHotIndexChain(client)
    : null;

  if (
    (latestChain !== null && !canSubscribe(latestChain)) ||
    (hotChain !== null && !canSubscribe(hotChain))
  ) {
    return false;
  }

  hydratedStores.add(store);

  if (latestChain !== null) {
    latestChain.map!().on!((data: unknown, key?: string) => {
      recordGunMessageActivity();
      if (!key) {
        return;
      }
      const eventVersion = markLatestIndexEvent(store, key);
      if (data === null) {
        store.getState().removeLatestIndex(key);
        store.getState().removeHotIndex(key);
        store.getState().removeStory(key);
        getFetchedStoryTimestamps(store).delete(key);
        return;
      }
      const timestamp = parseLatestIndexSubscriptionTimestamp(data);
      if (carriesProtocolIndexFields(data)) {
        void parseNewsLatestIndexEntryRecord(client, key, data)
          .then((timestamp) => {
            if (timestamp === null || !isCurrentLatestIndexEvent(store, key, eventVersion)) {
              return;
            }
            store.getState().upsertLatestIndex(key, timestamp);
            pruneLatestWindow(store);
            if (key in store.getState().latestIndex) {
              loadStoryFromIndex(client, store, key, timestamp);
            }
          })
          .catch(() => undefined);
        return;
      }
      if (timestamp === null) {
        return;
      }
      store.getState().upsertLatestIndex(key, timestamp);
      pruneLatestWindow(store);
      if (key in store.getState().latestIndex) {
        loadStoryFromIndex(client, store, key, timestamp);
      }
    });
  }

  if (hotChain !== null) {
    hotChain.map!().on!((data: unknown, key?: string) => {
      recordGunMessageActivity();
      if (!key) {
        return;
      }
      const hotness = parseHotnessScore(data);
      if (hotness === null) {
        if (data === null) {
          store.getState().removeHotIndex(key);
        }
        return;
      }
      store.getState().upsertHotIndex(key, hotness);
    });
  }

  return true;
}
