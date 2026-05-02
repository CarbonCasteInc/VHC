import { create, type StoreApi } from 'zustand';
import {
  readNewsHotIndex,
  readNewsLatestIndex,
  readNewsStory,
} from '@vh/gun-client';
import type { StoryBundle, StorylineGroup } from '@vh/data-model';
import { resolveClientFromAppStore } from '../clientResolver';
import { hydrateNewsStore } from './hydration';
import { loadStorylinesForStories } from './storylines';
import { createStorylineRecord, removeOrphanedStoryline } from './storylineState';
import type { NewsState, NewsDeps } from './types';
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

export type { NewsState, NewsDeps } from './types';

const INITIAL_STATE: Pick<NewsState,
  'stories' | 'latestIndex' | 'hotIndex' | 'storylinesById' | 'hydrated' | 'loading' | 'error'> = {
  stories: [],
  latestIndex: {},
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
  15_000,
  1_000,
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
        const story = parseStory(await readNewsStory(client, normalizedStoryId));
        if (!story || !isStoryFromConfiguredSources(story)) {
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
      } catch {
        return false;
      }
    },

    async refreshLatest(limit = 50) {
      const client = deps.resolveClient();
      if (!client) {
        set({ loading: false, error: null });
        return;
      }

      get().startHydration();
      const generation = ++refreshGeneration;
      set({ loading: true, error: null });

      try {
        const { filteredStories, hotIndex, latestIndex, storylines } =
          await withNewsRefreshTimeout((async () => {
            const [nextLatestIndex, nextHotIndex] = await Promise.all([
              readNewsLatestIndex(client).then(sanitizeLatestIndex),
              readNewsHotIndex(client).then(sanitizeHotIndex),
            ]);

            const storyIds = selectLatestStoryIds(nextLatestIndex, limit);
            const stories = await Promise.all(storyIds.map((storyId) => readNewsStory(client, storyId)));
            const validStories = parseStories(stories);
            const nextFilteredStories = filterStoriesToConfiguredSources(validStories);
            const nextStorylines = await loadStorylinesForStories(client, nextFilteredStories);

            return {
              filteredStories: nextFilteredStories,
              hotIndex: nextHotIndex,
              latestIndex: nextLatestIndex,
              storylines: nextStorylines,
            };
          })());

        if (generation !== refreshGeneration) {
          return;
        }

        let mergedStories: StoryBundle[] = [];
        set((state) => {
          mergedStories = dedupeStories(filteredStories, state.stories);
          return {
            latestIndex,
            hotIndex,
            storylinesById: createStorylineRecord(storylines),
            stories: sortStories(mergedStories, latestIndex),
            loading: false,
            error: null,
          };
        });

        void mirrorStoriesIntoDiscovery(mergedStories, hotIndex, createStorylineRecord(storylines));
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
