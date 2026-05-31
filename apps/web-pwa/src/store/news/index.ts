import { create, type StoreApi } from 'zustand';
import {
  readNewsHotIndexWithRelayRestFallback,
  readNewsLatestIndexWithRelayRestFallback,
  readNewsLatestIndexPageWithRelayRestFallback,
  readNewsStoryViaRelayRest,
  readNewsStoryWithRelayRestFallback,
  type VennClient,
} from '@vh/gun-client';
import type { StoryBundle, StorylineGroup } from '@vh/data-model';
import { resolveClientFromAppStore } from '../clientResolver';
import { hydrateNewsStore } from './hydration';
import { loadStorylinesForStories } from './storylines';
import { createStorylineRecord, removeOrphanedStoryline } from './storylineState';
import type { NewsState, NewsDeps, NewsRefreshRequest } from './types';
import {
  buildSeedIndex,
  dedupeStories,
  filterStoriesToConfiguredSources,
  isStoryFromConfiguredSources,
  mirrorStoriesIntoDiscovery,
  parseStories,
  parseStory,
  sanitizeHotIndex,
  sanitizeLatestIndex,
  sortStories,
} from './storeHelpers';

export type { NewsState, NewsDeps, NewsRefreshRequest } from './types';

const INITIAL_STATE: Pick<NewsState,
  'stories' | 'latestIndex' | 'latestIndexCursor' | 'hotIndex' | 'storylinesById' | 'hydrated' | 'loading' | 'error'> = {
  stories: [],
  latestIndex: {},
  latestIndexCursor: null,
  hotIndex: {},
  storylinesById: {},
  hydrated: false,
  loading: false,
  error: null
};

function selectLatestStoryIds(latestIndex: Record<string, number>, limit = 50): string[] {
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  return Object.entries(latestIndex)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.floor(limit))
    .map(([storyId]) => storyId);
}

function normalizeRefreshRequest(request: number | NewsRefreshRequest | undefined): Required<NewsRefreshRequest> {
  const limit = request === undefined ? 50 : typeof request === 'number' ? request : request.limit ?? 50;
  const before = typeof request === 'number' ? undefined : request?.before;
  return {
    limit: Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : 0,
    before: Number.isFinite(before) && (before as number) >= 0 ? Math.floor(before as number) : Number.POSITIVE_INFINITY,
  };
}

function readNewsStoreNumber(
  keys: ReadonlyArray<string>,
  fallback: number,
  min: number,
): number {
  for (const key of keys) {
    const nodeValue =
      typeof process !== 'undefined'
        ? process.env?.[key]
        : undefined;
    const viteValue = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key];
    const raw = nodeValue ?? viteValue;
    if (!raw) {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= min) {
      return Math.floor(parsed);
    }
  }
  return fallback;
}

const NEWS_REFRESH_TIMEOUT_MS = readNewsStoreNumber(
  ['VITE_NEWS_REFRESH_TIMEOUT_MS', 'VH_NEWS_REFRESH_TIMEOUT_MS'],
  35_000,
  1_000,
);

const NEWS_OPTIONAL_INDEX_TIMEOUT_MS = readNewsStoreNumber(
  ['VITE_NEWS_OPTIONAL_INDEX_TIMEOUT_MS', 'VH_NEWS_OPTIONAL_INDEX_TIMEOUT_MS'],
  3_000,
  250,
);

const NEWS_OPTIONAL_STORYLINES_TIMEOUT_MS = readNewsStoreNumber(
  ['VITE_NEWS_OPTIONAL_STORYLINES_TIMEOUT_MS', 'VH_NEWS_OPTIONAL_STORYLINES_TIMEOUT_MS'],
  5_000,
  250,
);

const NEWS_REFRESH_STORY_LIST_TIMEOUT_MS = readNewsStoreNumber(
  ['VITE_NEWS_REFRESH_STORY_LIST_TIMEOUT_MS', 'VH_NEWS_REFRESH_STORY_LIST_TIMEOUT_MS'],
  Math.max(12_000, NEWS_REFRESH_TIMEOUT_MS - NEWS_OPTIONAL_INDEX_TIMEOUT_MS - NEWS_OPTIONAL_STORYLINES_TIMEOUT_MS - 1_000),
  500,
);

const NEWS_REFRESH_STORY_READ_CONCURRENCY = readNewsStoreNumber(
  ['VITE_NEWS_REFRESH_STORY_READ_CONCURRENCY', 'VH_NEWS_REFRESH_STORY_READ_CONCURRENCY'],
  16,
  1,
);

const NEWS_DIRECT_STORY_READ_ATTEMPTS = readNewsStoreNumber(
  ['VITE_NEWS_DIRECT_STORY_READ_ATTEMPTS', 'VH_NEWS_DIRECT_STORY_READ_ATTEMPTS'],
  4,
  1,
);

const NEWS_DIRECT_STORY_READ_RETRY_MS = readNewsStoreNumber(
  ['VITE_NEWS_DIRECT_STORY_READ_RETRY_MS', 'VH_NEWS_DIRECT_STORY_READ_RETRY_MS'],
  500,
  0,
);

async function withNewsRefreshTimeout<T>(work: Promise<T>): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`News refresh timed out after ${NEWS_REFRESH_TIMEOUT_MS}ms`)),
          NEWS_REFRESH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function withOptionalNewsTimeout<T>(
  work: Promise<T>,
  fallback: T,
  timeoutMs: number,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work.catch(() => fallback),
      new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLatestStoriesBounded(
  client: VennClient,
  storyIds: readonly string[],
  embeddedStories: Readonly<Record<string, StoryBundle>> = {},
): Promise<Array<StoryBundle | null>> {
  if (storyIds.length === 0) {
    return [];
  }

  const results = new Array<StoryBundle | null>(storyIds.length);
  const pendingIndexes: number[] = [];
  for (let index = 0; index < storyIds.length; index += 1) {
    const storyId = storyIds[index]!;
    const embeddedStory = parseStory(embeddedStories[storyId]);
    if (embeddedStory && isStoryFromConfiguredSources(embeddedStory)) {
      results[index] = embeddedStory;
    } else {
      pendingIndexes.push(index);
    }
  }
  if (pendingIndexes.length === 0) {
    return results;
  }

  let nextIndex = 0;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const workerCount = Math.max(
    1,
    Math.min(Math.floor(NEWS_REFRESH_STORY_READ_CONCURRENCY), pendingIndexes.length),
  );
  const workers = Promise.all(Array.from({ length: workerCount }, async () => {
    while (!timedOut && nextIndex < pendingIndexes.length) {
      const currentIndex = pendingIndexes[nextIndex]!;
      nextIndex += 1;
      try {
        results[currentIndex] = await readConfiguredStoryByIdRelayFirst(
          client,
          storyIds[currentIndex]!,
        );
      /* v8 ignore next 3 -- readConfiguredStoryByIdRelayFirst fails closed for normal read/validation errors. */
      } catch {
        results[currentIndex] = null;
      }
    }
  }));

  try {
    await Promise.race([
      workers,
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          resolve();
        }, NEWS_REFRESH_STORY_LIST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
  return results;
}

async function readConfiguredStoryById(
  client: VennClient,
  storyId: string,
  options: { readonly attempts?: number } = {},
): Promise<StoryBundle | null> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? NEWS_DIRECT_STORY_READ_ATTEMPTS));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const story = parseStory(await readNewsStoryWithRelayRestFallback(client, storyId));
      if (story) {
        return isStoryFromConfiguredSources(story) ? story : null;
      }
    } catch {
      // Cold public routes can briefly surface an old or partial record before
      // the signed story body hydrates. Retries preserve fail-closed validation.
    }
    if (attempt < attempts - 1) {
      await delay(NEWS_DIRECT_STORY_READ_RETRY_MS);
    }
  }
  return null;
}

async function readConfiguredStoryByIdRelayFirst(
  client: VennClient,
  storyId: string,
): Promise<StoryBundle | null> {
  try {
    const relayed = parseStory(await readNewsStoryViaRelayRest(client, storyId));
    if (relayed) {
      return isStoryFromConfiguredSources(relayed) ? relayed : null;
    }
  } catch {
    // Fall back to the slower Gun-first path below.
  }
  return readConfiguredStoryById(client, storyId, { attempts: 1 });
}

function hasIndexEntries(index: Record<string, number>): boolean {
  return Object.keys(index).length > 0;
}

export function createNewsStore(overrides?: Partial<NewsDeps>): StoreApi<NewsState> {
  const defaults: NewsDeps = {
    resolveClient: resolveClientFromAppStore
  };
  const deps: NewsDeps = {
    ...defaults,
    ...overrides
  };

  let storeRef!: StoreApi<NewsState>;
  let refreshGeneration = 0;

  const mirrorCurrentStories = async () => {
    const state = storeRef.getState();
    await mirrorStoriesIntoDiscovery([...state.stories], state.hotIndex, state.storylinesById);
  };

  const startHydration = () => {
    const started = hydrateNewsStore(deps.resolveClient, storeRef);
    if (started && !storeRef.getState().hydrated) {
      storeRef.setState({ hydrated: true });
    }
  };

  const store = create<NewsState>((set, get) => ({
    ...INITIAL_STATE,

    setStories(stories: StoryBundle[]) {
      const validated = filterStoriesToConfiguredSources(parseStories(stories));
      set((state) => {
        const deduped = dedupeStories(validated, state.stories);
        return {
          stories: sortStories(deduped, state.latestIndex),
          storylinesById: createStorylineRecord(
            Object.values(state.storylinesById).filter((storyline) =>
              deduped.some((story) => story.storyline_id === storyline.storyline_id),
            ),
          ),
          error: null,
        };
      });
    },

    upsertStory(story: StoryBundle) {
      const validated = parseStory(story);
      if (!validated || !isStoryFromConfiguredSources(validated)) {
        return;
      }
      set((state) => {
        const previousStory = state.stories.find((entry) => entry.story_id === validated.story_id);
        const deduped = dedupeStories([...state.stories, validated], state.stories);
        return {
          stories: sortStories(deduped, state.latestIndex),
          storylinesById: removeOrphanedStoryline(
            state.storylinesById,
            deduped,
            previousStory?.storyline_id,
          ),
          error: null,
        };
      });
    },

    removeStory(storyId: string) {
      const normalizedStoryId = storyId.trim();
      if (!normalizedStoryId) {
        return;
      }

      set((state) => {
        const removedStory = state.stories.find((story) => story.story_id === normalizedStoryId);
        const stories = state.stories.filter((story) => story.story_id !== normalizedStoryId);
        if (stories.length === state.stories.length) {
          return {};
        }

        const nextLatestIndex = { ...state.latestIndex };
        delete nextLatestIndex[normalizedStoryId];
        const nextHotIndex = { ...state.hotIndex };
        delete nextHotIndex[normalizedStoryId];

        return {
          stories: sortStories(stories, nextLatestIndex),
          latestIndex: nextLatestIndex,
          hotIndex: nextHotIndex,
          storylinesById: removeOrphanedStoryline(
            state.storylinesById,
            stories,
            removedStory?.storyline_id,
          ),
        };
      });
    },

    setLatestIndex(index: Record<string, number>) {
      const sanitized = sanitizeLatestIndex(index);
      set((state) => ({
        latestIndex: sanitized,
        latestIndexCursor: null,
        stories: sortStories([...state.stories], sanitized),
        error: null
      }));
    },

    upsertLatestIndex(storyId: string, latestActivityAt: number) {
      const normalizedStoryId = storyId.trim();
      if (!normalizedStoryId || !Number.isFinite(latestActivityAt) || latestActivityAt < 0) {
        return;
      }

      set((state) => {
        const nextIndex = {
          ...state.latestIndex,
          [normalizedStoryId]: Math.floor(latestActivityAt)
        };
        return {
          latestIndex: nextIndex,
          stories: sortStories([...state.stories], nextIndex)
        };
      });
    },

    removeLatestIndex(storyId: string) {
      const normalizedStoryId = storyId.trim();
      if (!normalizedStoryId) {
        return;
      }

      set((state) => {
        if (!(normalizedStoryId in state.latestIndex)) {
          return {};
        }

        const nextIndex = { ...state.latestIndex };
        delete nextIndex[normalizedStoryId];
        return {
          latestIndex: nextIndex,
          stories: sortStories([...state.stories], nextIndex),
        };
      });
    },

    setHotIndex(index: Record<string, number>) {
      const sanitized = sanitizeHotIndex(index);
      set({
        hotIndex: sanitized,
        error: null,
      });
    },

    upsertHotIndex(storyId: string, hotness: number) {
      const normalizedStoryId = storyId.trim();
      if (!normalizedStoryId || !Number.isFinite(hotness) || hotness < 0) {
        return;
      }

      set((state) => ({
        hotIndex: {
          ...state.hotIndex,
          [normalizedStoryId]: Math.round(hotness * 1_000_000) / 1_000_000,
        },
      }));
    },

    removeHotIndex(storyId: string) {
      const normalizedStoryId = storyId.trim();
      if (!normalizedStoryId) {
        return;
      }

      set((state) => {
        if (!(normalizedStoryId in state.hotIndex)) {
          return {};
        }

        const nextHotIndex = { ...state.hotIndex };
        delete nextHotIndex[normalizedStoryId];
        return { hotIndex: nextHotIndex };
      });
    },

    setStorylines(storylines: StorylineGroup[]) {
      set({
        storylinesById: createStorylineRecord(storylines),
        error: null,
      });
    },

    upsertStoryline(storyline: StorylineGroup) {
      set((state) => ({
        storylinesById: {
          ...state.storylinesById,
          [storyline.storyline_id]: storyline,
        },
      }));
    },

    removeStoryline(storylineId: string) {
      const normalizedStorylineId = storylineId.trim();
      if (!normalizedStorylineId) {
        return;
      }

      set((state) => {
        if (!(normalizedStorylineId in state.storylinesById)) {
          return {};
        }

        const nextStorylines = { ...state.storylinesById };
        delete nextStorylines[normalizedStorylineId];
        return { storylinesById: nextStorylines };
      });
    },

    async ensureStory(storyId: string) {
      const normalizedStoryId = storyId.trim();
      if (!normalizedStoryId) {
        return false;
      }

      const existingStory = get().stories.find((story) => story.story_id === normalizedStoryId);
      if (existingStory) {
        get().upsertLatestIndex(existingStory.story_id, existingStory.cluster_window_end);
        await mirrorCurrentStories();
        return true;
      }

      const client = deps.resolveClient();
      if (!client) {
        return false;
      }

      get().startHydration();

      try {
        let story = await readConfiguredStoryById(client, normalizedStoryId, { attempts: 1 });
        if (!story) {
          const latestIndex: Record<string, number> = await readNewsLatestIndexWithRelayRestFallback(client)
            .then(sanitizeLatestIndex)
            .catch(() => ({}));
          const indexedTimestamp = latestIndex[normalizedStoryId];
          if (typeof indexedTimestamp === 'number' && Number.isFinite(indexedTimestamp)) {
            get().upsertLatestIndex(normalizedStoryId, indexedTimestamp);
            story = await readConfiguredStoryById(client, normalizedStoryId);
          }
        }

        if (!story) {
          return false;
        }

        get().upsertLatestIndex(story.story_id, story.cluster_window_end);
        get().upsertStory(story);

        try {
          const storylines = await loadStorylinesForStories(client, [story]);
          for (const storyline of storylines) {
            get().upsertStoryline(storyline);
          }
        } catch {
          // Direct story hydration should not fail just because related coverage is slow.
        }

        await mirrorCurrentStories();
        return true;
      /* v8 ignore next 3 -- direct story hydration guards its own read paths; this protects unexpected store-side failures. */
      } catch {
        return false;
      }
    },

    async refreshLatest(request = 50) {
      const client = deps.resolveClient();
      if (!client) {
        set({ loading: false, error: null });
        return;
      }

      const refreshRequest = normalizeRefreshRequest(request);
      const isCursorWindow = Number.isFinite(refreshRequest.before);
      get().startHydration();
      const generation = ++refreshGeneration;
      set({ loading: true, error: null });

      try {
        const { filteredStories, hotIndex, latestIndex, latestIndexCursor, storylines } =
          await withNewsRefreshTimeout((async () => {
            const latestPage = await readNewsLatestIndexPageWithRelayRestFallback(client, {
              limit: refreshRequest.limit,
              ...(isCursorWindow ? { before: refreshRequest.before } : {}),
            });
            const nextLatestIndex = sanitizeLatestIndex(latestPage.index);
            const nextLatestIndexCursor = latestPage.nextCursor;

            const currentState = get();
            const shouldPreserveExistingFeed =
              !hasIndexEntries(nextLatestIndex) &&
              currentState.stories.length > 0 &&
              hasIndexEntries(currentState.latestIndex);
            if (shouldPreserveExistingFeed) {
              return {
                filteredStories: [...currentState.stories],
                hotIndex: { ...currentState.hotIndex },
                latestIndex: { ...currentState.latestIndex },
                latestIndexCursor: currentState.latestIndexCursor,
                storylines: Object.values(currentState.storylinesById),
              };
            }

            const effectiveLatestIndex = isCursorWindow
              ? { ...currentState.latestIndex, ...nextLatestIndex }
              : nextLatestIndex;
            const effectiveLatestIndexCursor = nextLatestIndexCursor;
            const storyIds = selectLatestStoryIds(
              isCursorWindow ? nextLatestIndex : effectiveLatestIndex,
              refreshRequest.limit,
            );
            const stories = await readLatestStoriesBounded(client, storyIds, latestPage.stories ?? {});
            const validStories = parseStories(stories);
            const nextFilteredStories = filterStoriesToConfiguredSources(validStories);
            const hotIndexLimit = Math.max(
              refreshRequest.limit,
              Object.keys(effectiveLatestIndex).length,
            );
            const [nextHotIndex, nextStorylines] = await Promise.all([
              withOptionalNewsTimeout(
                readNewsHotIndexWithRelayRestFallback(client, { limit: hotIndexLimit }).then(sanitizeHotIndex),
                {},
                NEWS_OPTIONAL_INDEX_TIMEOUT_MS,
              ),
              withOptionalNewsTimeout(
                loadStorylinesForStories(client, nextFilteredStories),
                [],
                NEWS_OPTIONAL_STORYLINES_TIMEOUT_MS,
              ),
            ]);

            return {
              filteredStories: nextFilteredStories,
              hotIndex: nextHotIndex,
              latestIndex: effectiveLatestIndex,
              latestIndexCursor: effectiveLatestIndexCursor,
              storylines: nextStorylines,
            };
          })());

        if (generation !== refreshGeneration) {
          return;
        }

        let mergedStories: StoryBundle[] = [];
        let mergedStorylinesById: Record<string, StorylineGroup> = {};
        set((state) => {
          mergedStories = dedupeStories(
            isCursorWindow ? [...state.stories, ...filteredStories] : filteredStories,
            state.stories,
          );
          mergedStorylinesById = isCursorWindow
            ? createStorylineRecord([...Object.values(state.storylinesById), ...storylines])
            : createStorylineRecord(storylines);
          const mergedHotIndex = isCursorWindow
            ? { ...state.hotIndex, ...hotIndex }
            : hotIndex;
          return {
            latestIndex,
            latestIndexCursor,
            hotIndex: mergedHotIndex,
            storylinesById: mergedStorylinesById,
            stories: sortStories(mergedStories, latestIndex),
            loading: false,
            error: null,
          };
        });

        await mirrorStoriesIntoDiscovery(mergedStories, get().hotIndex, mergedStorylinesById);
      } catch (error: unknown) {
        if (generation !== refreshGeneration) {
          return;
        }
        set({
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to refresh latest news'
        });
      }
    },

    startHydration() {
      startHydration();
    },

    setLoading(loading: boolean) {
      set({ loading });
    },

    setError(error: string | null) {
      set({ error });
    },

    reset() {
      set({ ...INITIAL_STATE });
    }
  }));

  storeRef = store;
  return store;
}

export function createMockNewsStore(seedStories: StoryBundle[] = []): StoreApi<NewsState> {
  const store = createNewsStore({
    resolveClient: () => null
  });

  const validated = parseStories(seedStories);
  if (validated.length > 0) {
    const index = buildSeedIndex(validated);
    store.getState().setLatestIndex(index);
    store.getState().setStories(validated);
  }

  return store;
}

const isE2E =
  (import.meta as unknown as { env?: { VITE_E2E_MODE?: string } }).env
    ?.VITE_E2E_MODE === 'true';

/* v8 ignore start -- environment branch depends on Vite import.meta at module-eval time */
export const useNewsStore: StoreApi<NewsState> = isE2E
  ? createMockNewsStore()
  : createNewsStore();
/* v8 ignore stop */

if (
  typeof window !== 'undefined' &&
  (window as { __VH_EXPOSE_NEWS_STORE__?: boolean }).__VH_EXPOSE_NEWS_STORE__ === true
) {
  (window as { __VH_NEWS_STORE__?: StoreApi<NewsState> }).__VH_NEWS_STORE__ = useNewsStore;
}
