import {
  HermesCommentModerationSchema,
  HermesCommentSchema,
  HermesThreadSchema,
  TopicSynthesisCorrectionSchema,
  TopicSynthesisV2Schema,
  migrateCommentToV1,
  type StorylineGroup,
} from '@vh/data-model';
import type { HermesComment, HermesCommentModeration, HermesThread } from '@vh/types';
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
  launchContent?: {
    syntheses?: unknown[];
    synthesisCorrections?: unknown[];
    forum?: {
      threads?: unknown[];
      comments?: unknown[];
      commentModerations?: unknown[];
    };
  };
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

function normalizeSyntheses(snapshot: PublishedStoreSnapshot) {
  const syntheses = snapshot.launchContent?.syntheses;
  if (!Array.isArray(syntheses)) {
    return [];
  }

  return syntheses.flatMap((value) => {
    const result = TopicSynthesisV2Schema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

function normalizeSynthesisCorrections(snapshot: PublishedStoreSnapshot) {
  const corrections = snapshot.launchContent?.synthesisCorrections;
  if (!Array.isArray(corrections)) {
    return [];
  }

  return corrections.flatMap((value) => {
    const result = TopicSynthesisCorrectionSchema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

function normalizeThreads(snapshot: PublishedStoreSnapshot): HermesThread[] {
  const threads = snapshot.launchContent?.forum?.threads;
  if (!Array.isArray(threads)) {
    return [];
  }

  return threads.flatMap((value) => {
    const result = HermesThreadSchema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

function normalizeComments(snapshot: PublishedStoreSnapshot): HermesComment[] {
  const comments = snapshot.launchContent?.forum?.comments;
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments.flatMap((value) => {
    const result = HermesCommentSchema.safeParse(value);
    return result.success ? [migrateCommentToV1(result.data)] : [];
  });
}

function normalizeCommentModerations(snapshot: PublishedStoreSnapshot): HermesCommentModeration[] {
  const moderations = snapshot.launchContent?.forum?.commentModerations;
  if (!Array.isArray(moderations)) {
    return [];
  }

  return moderations.flatMap((value) => {
    const result = HermesCommentModerationSchema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

function hasLaunchContentRuntime(snapshot: PublishedStoreSnapshot): boolean {
  const launchContent = snapshot.launchContent;
  return Boolean(
    launchContent
    && (
      Array.isArray(launchContent.syntheses)
      || Array.isArray(launchContent.synthesisCorrections)
      || Array.isArray(launchContent.forum?.threads)
      || Array.isArray(launchContent.forum?.comments)
      || Array.isArray(launchContent.forum?.commentModerations)
    ),
  );
}

async function applyLaunchContentRuntime(
  snapshot: PublishedStoreSnapshot,
  log: (...args: unknown[]) => void,
): Promise<void> {
  if (!hasLaunchContentRuntime(snapshot)) {
    return;
  }

  const [
    { useSynthesisStore },
    { useForumStore },
  ] = await Promise.all([
    import('./synthesis'),
    import('./hermesForum'),
  ]);

  const syntheses = normalizeSyntheses(snapshot);
  const corrections = normalizeSynthesisCorrections(snapshot);
  const threads = normalizeThreads(snapshot);
  const comments = normalizeComments(snapshot);
  const commentModerations = normalizeCommentModerations(snapshot);

  for (const synthesis of syntheses) {
    useSynthesisStore.getState().setTopicSynthesis(synthesis.topic_id, synthesis);
  }
  for (const correction of corrections) {
    useSynthesisStore.getState().setTopicCorrection(correction.topic_id, correction);
  }

  if (threads.length > 0 || comments.length > 0 || commentModerations.length > 0) {
    useForumStore.setState((state) => {
      const nextThreads = new Map(state.threads);
      for (const thread of threads) {
        nextThreads.set(thread.id, thread);
      }

      const nextComments = new Map(state.comments);
      for (const comment of comments) {
        const existing = nextComments.get(comment.threadId) ?? [];
        const withoutDuplicate = existing.filter((candidate) => candidate.id !== comment.id);
        nextComments.set(
          comment.threadId,
          [...withoutDuplicate, comment].sort((left, right) => left.timestamp - right.timestamp),
        );
      }

      const nextCommentModeration = new Map(state.commentModeration);
      for (const moderation of commentModerations) {
        const existing = new Map(nextCommentModeration.get(moderation.thread_id) ?? []);
        existing.set(moderation.comment_id, moderation);
        nextCommentModeration.set(moderation.thread_id, existing);
      }

      return {
        ...state,
        threads: nextThreads,
        comments: nextComments,
        commentModeration: nextCommentModeration,
      };
    });
  }

  log('[vh:web-pwa] applied launch content snapshot runtime', {
    syntheses: syntheses.length,
    synthesisCorrections: corrections.length,
    threads: threads.length,
    comments: comments.length,
    commentModerations: commentModerations.length,
  });
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
  await applyLaunchContentRuntime(snapshot, log);
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
  normalizeSyntheses,
  normalizeSynthesisCorrections,
  normalizeThreads,
  normalizeComments,
  normalizeCommentModerations,
  hasLaunchContentRuntime,
  buildSnapshotKey,
};
