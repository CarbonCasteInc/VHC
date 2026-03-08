import { create, type StoreApi } from 'zustand';
import {
  readLatestStoryIds,
  readNewsHotIndex,
  readNewsLatestIndex,
  readNewsStory,
} from '@vh/gun-client';
import type { StoryBundle } from '@vh/data-model';
import { resolveClientFromAppStore } from '../clientResolver';
import { hydrateNewsStore } from './hydration';
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

const INITIAL_STATE: Pick<NewsState, 'stories' | 'latestIndex' | 'hotIndex' | 'hydrated' | 'loading' | 'error'> = {
  stories: [],
  latestIndex: {},
  hotIndex: {},
  hydrated: false,
  loading: false,
  error: null
};

export function createNewsStore(overrides?: Partial<NewsDeps>): StoreApi<NewsState> {
  const defaults: NewsDeps = {
    resolveClient: resolveClientFromAppStore
  };
  const deps: NewsDeps = {
    ...defaults,
    ...overrides
  };

  let storeRef!: StoreApi<NewsState>;

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
        const deduped = dedupeStories([...state.stories, validated], state.stories);
        return {
          stories: sortStories(deduped, state.latestIndex),
          error: null,
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

    async refreshLatest(limit = 50) {
      const client = deps.resolveClient();
      if (!client) {
        set({ loading: false, error: null });
        return;
      }

      get().startHydration();
      set({ loading: true, error: null });

      try {
        const [latestIndex, hotIndex] = await Promise.all([
          readNewsLatestIndex(client).then(sanitizeLatestIndex),
          readNewsHotIndex(client).then(sanitizeHotIndex),
        ]);

        const storyIds = await readLatestStoryIds(client, limit);
        const stories = await Promise.all(storyIds.map((storyId) => readNewsStory(client, storyId)));
        const validStories = parseStories(stories);
        const filteredStories = filterStoriesToConfiguredSources(validStories);

        let mergedStories: StoryBundle[] = [];
        set((state) => {
          mergedStories = dedupeStories(filteredStories, state.stories);
          return {
            latestIndex,
            hotIndex,
            stories: sortStories(mergedStories, latestIndex),
            loading: false,
            error: null,
          };
        });

        void mirrorStoriesIntoDiscovery(mergedStories, hotIndex);
      } catch (error: unknown) {
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
