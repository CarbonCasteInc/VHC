import type { StoryBundle } from '@vh/data-model';
import {
  getNewsHotIndexChain,
  getNewsLatestIndexChain,
  readNewsStory,
  type ChainWithGet,
  type VennClient
} from '@vh/gun-client';
import type { StoreApi } from 'zustand';
import type { NewsState } from './types';
import { loadStorylinesForStories } from './storylines';
import { recordGunMessageActivity } from '../../hooks/useHealthMonitor';

const hydratedStores = new WeakSet<StoreApi<NewsState>>();
const NEWS_HYDRATION_INDEX_LIMIT = readPositiveIntEnv('VITE_VH_NEWS_HYDRATION_INDEX_LIMIT', 80);

const pendingStoryReadsByStore = new WeakMap<StoreApi<NewsState>, Set<string>>();
const fetchedStoryTimestampsByStore = new WeakMap<StoreApi<NewsState>, Map<string, number>>();

/* c8 ignore start -- environment-source branching is runtime-host defensive; behavior is covered via callers. */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
    ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
/* c8 ignore stop */

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

  if (value && typeof value === 'object' && 'hotness' in (value as Record<string, unknown>)) {
    return parseHotnessScore((value as { hotness?: unknown }).hotness);
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
  void readNewsStory(client, storyId)
    .then((story) => {
      if (!story) {
        return null;
      }
      store.getState().upsertStory(story);
      fetchedTimestamps.set(storyId, latestActivityAt);
      return loadStorylinesForStories(client, [story]);
    })
    .then((storylines) => {
      if (!storylines) {
        return;
      }
      for (const storyline of storylines) {
        store.getState().upsertStoryline(storyline);
      }
    })
    .catch(() => {})
    .finally(() => {
      pending.delete(storyId);
    });
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

  const latestChain = getNewsLatestIndexChain(client);
  const hotChain = getNewsHotIndexChain(client);

  if (
    !canSubscribe(latestChain) ||
    !canSubscribe(hotChain)
  ) {
    return false;
  }

  hydratedStores.add(store);

  latestChain.map!().on!((data: unknown, key?: string) => {
    recordGunMessageActivity();
    if (!key) {
      return;
    }
    const timestamp = parseLatestTimestamp(data);
    if (timestamp === null) {
      if (data === null) {
        store.getState().removeLatestIndex(key);
        store.getState().removeHotIndex(key);
        store.getState().removeStory(key);
        getFetchedStoryTimestamps(store).delete(key);
      }
      return;
    }
    store.getState().upsertLatestIndex(key, timestamp);
    pruneLatestWindow(store);
    if (key in store.getState().latestIndex) {
      loadStoryFromIndex(client, store, key, timestamp);
    }
  });

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

  return true;
}
