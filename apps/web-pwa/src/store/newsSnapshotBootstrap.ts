import type { StorylineGroup } from '@vh/data-model';
import type { StoreApi } from 'zustand';
import type { NewsState } from './news';
import { mirrorStoriesIntoDiscovery } from './news/storeHelpers';

interface PublishedStoreSnapshot {
  stories?: unknown[];
  storylines?: unknown[];
  latestIndex?: Record<string, number>;
  hotIndex?: Record<string, number>;
}

const SNAPSHOT_BOOTSTRAP_TIMEOUT_MS = 5_000;
let bootstrapPromise: Promise<boolean> | null = null;

function readSnapshotBootstrapUrl(): string | null {
  const nodeValue = typeof process !== 'undefined'
    ? process.env?.VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL
    : undefined;
  const viteValue = (import.meta as unknown as { env?: { VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL?: string } }).env
    ?.VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL;
  const raw = nodeValue ?? viteValue;
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function isStorylineGroup(value: unknown): value is StorylineGroup {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { storyline_id?: unknown }).storyline_id === 'string'
    && typeof (value as { topic_id?: unknown }).topic_id === 'string',
  );
}

function normalizeStorylines(storylines: unknown): StorylineGroup[] {
  if (!Array.isArray(storylines)) {
    return [];
  }
  return storylines.filter(isStorylineGroup);
}

async function fetchSnapshot(url: string, fetchImpl: typeof fetch): Promise<PublishedStoreSnapshot> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(SNAPSHOT_BOOTSTRAP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`snapshot-bootstrap-http-${response.status}`);
  }
  return await response.json() as PublishedStoreSnapshot;
}

export async function bootstrapNewsSnapshotIfConfigured(
  newsStore: StoreApi<NewsState>,
  {
    fetchImpl = fetch,
    log = console.info,
  }: {
    fetchImpl?: typeof fetch;
    log?: (...args: unknown[]) => void;
  } = {},
): Promise<boolean> {
  const snapshotUrl = readSnapshotBootstrapUrl();
  if (!snapshotUrl) {
    return false;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const snapshot = await fetchSnapshot(snapshotUrl, fetchImpl);
      const storylines = normalizeStorylines(snapshot.storylines);
      const state = newsStore.getState();
      state.setStorylines(storylines);
      state.setStories(Array.isArray(snapshot.stories) ? snapshot.stories as any[] : []);
      state.setLatestIndex(snapshot.latestIndex ?? {});
      state.setHotIndex(snapshot.hotIndex ?? {});
      const refreshedState = newsStore.getState();
      await mirrorStoriesIntoDiscovery(
        [...refreshedState.stories],
        refreshedState.hotIndex,
        refreshedState.storylinesById,
      );
      log('[vh:web-pwa] bootstrapped news snapshot', snapshotUrl);
      return true;
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  return await bootstrapPromise;
}

export const newsSnapshotBootstrapInternal = {
  readSnapshotBootstrapUrl,
  normalizeStorylines,
};
