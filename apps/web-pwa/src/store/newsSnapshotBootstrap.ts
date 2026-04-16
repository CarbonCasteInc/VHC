import type { StorylineGroup } from '@vh/data-model';
import type { StoreApi } from 'zustand';
import type { NewsState } from './news';
import { mirrorStoriesIntoDiscovery } from './news/storeHelpers';

interface PublishedStoreSnapshot {
  stories?: unknown[];
  storylines?: unknown[];
  latestIndex?: Record<string, number>;
  hotIndex?: Record<string, number>;
  generatedAt?: string;
  runId?: string;
  schemaVersion?: string;
}

const SNAPSHOT_BOOTSTRAP_TIMEOUT_MS = 5_000;
const DEFAULT_SNAPSHOT_REFRESH_MS = 60_000;
const MIN_SNAPSHOT_REFRESH_MS = 5_000;
let bootstrapPromise: Promise<boolean> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshKey: string | null = null;
let refreshInFlight = false;
let lastAppliedSnapshotKey: string | null = null;

function readEnvVar(name: string): string | undefined {
  const nodeValue = typeof process !== 'undefined'
    ? process.env?.[name]
    : undefined;
  const viteValue = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name];
  return nodeValue ?? viteValue;
}

function readSnapshotBootstrapUrl(): string | null {
  const raw = readEnvVar('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL');
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseSnapshotRefreshMs(raw: string | undefined): number | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return DEFAULT_SNAPSHOT_REFRESH_MS;
  }

  const normalized = raw.trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SNAPSHOT_REFRESH_MS;
  }
  return Math.max(MIN_SNAPSHOT_REFRESH_MS, parsed);
}

function readSnapshotRefreshMs(): number | null {
  return parseSnapshotRefreshMs(
    readEnvVar('VITE_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS')
      ?? readEnvVar('VH_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS'),
  );
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
    cache: 'no-store',
    signal: AbortSignal.timeout(SNAPSHOT_BOOTSTRAP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`snapshot-bootstrap-http-${response.status}`);
  }
  return await response.json() as PublishedStoreSnapshot;
}

function buildSnapshotKey(snapshot: PublishedStoreSnapshot): string {
  const latestIndex = snapshot.latestIndex && typeof snapshot.latestIndex === 'object'
    ? snapshot.latestIndex
    : {};
  const storyIds = Array.isArray(snapshot.stories)
    ? snapshot.stories
      .map((story) => typeof (story as { story_id?: unknown })?.story_id === 'string'
        ? (story as { story_id: string }).story_id
        : '')
      .filter(Boolean)
      .sort()
    : [];
  return JSON.stringify({
    schemaVersion: snapshot.schemaVersion ?? null,
    generatedAt: snapshot.generatedAt ?? null,
    runId: snapshot.runId ?? null,
    stories: storyIds,
    latestIndex,
  });
}

async function applySnapshot(
  newsStore: StoreApi<NewsState>,
  snapshot: PublishedStoreSnapshot,
  snapshotUrl: string,
  log: (...args: unknown[]) => void,
  action: 'bootstrapped' | 'refreshed',
): Promise<boolean> {
  const snapshotKey = buildSnapshotKey(snapshot);
  const changed = snapshotKey !== lastAppliedSnapshotKey;
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
  lastAppliedSnapshotKey = snapshotKey;
  if (changed) {
    log(`[vh:web-pwa] ${action} news snapshot`, snapshotUrl);
  }
  return changed;
}

async function fetchAndApplySnapshot(
  newsStore: StoreApi<NewsState>,
  {
    fetchImpl,
    log,
    snapshotUrl,
  }: {
    fetchImpl: typeof fetch;
    log: (...args: unknown[]) => void;
    snapshotUrl: string;
  },
): Promise<boolean> {
  const snapshot = await fetchSnapshot(snapshotUrl, fetchImpl);
  return applySnapshot(newsStore, snapshot, snapshotUrl, log, 'refreshed');
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
      await applySnapshot(newsStore, snapshot, snapshotUrl, log, 'bootstrapped');
      return true;
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }

  return await bootstrapPromise;
}

export function stopNewsSnapshotRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  refreshTimer = null;
  refreshKey = null;
  refreshInFlight = false;
}

export function startNewsSnapshotRefreshIfConfigured(
  newsStore: StoreApi<NewsState>,
  {
    fetchImpl = fetch,
    log = console.info,
    warn = console.warn,
  }: {
    fetchImpl?: typeof fetch;
    log?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
  } = {},
): boolean {
  const snapshotUrl = readSnapshotBootstrapUrl();
  if (!snapshotUrl) {
    return false;
  }

  const refreshMs = readSnapshotRefreshMs();
  if (refreshMs === null) {
    stopNewsSnapshotRefresh();
    return false;
  }

  const nextRefreshKey = `${snapshotUrl}:${refreshMs}`;
  if (refreshTimer && refreshKey === nextRefreshKey) {
    return true;
  }

  stopNewsSnapshotRefresh();
  refreshKey = nextRefreshKey;
  refreshTimer = setInterval(() => {
    if (refreshInFlight) {
      return;
    }
    refreshInFlight = true;
    void fetchAndApplySnapshot(newsStore, {
      fetchImpl,
      log,
      snapshotUrl,
    })
      .catch((error) => {
        warn('[vh:web-pwa] snapshot refresh failed:', error);
      })
      .finally(() => {
        refreshInFlight = false;
      });
  }, refreshMs);
  return true;
}

export const newsSnapshotBootstrapInternal = {
  readSnapshotBootstrapUrl,
  readSnapshotRefreshMs,
  parseSnapshotRefreshMs,
  normalizeStorylines,
  buildSnapshotKey,
};
