import { create, type StoreApi } from 'zustand';
import { StoryBundleSchema, type FeedItem, type StoryBundle } from '@vh/data-model';
import {
  hasForbiddenNewsPayloadFields,
  readLatestStoryIds,
  readNewsLatestIndex,
  readNewsStory
} from '@vh/gun-client';
import { resolveClientFromAppStore } from '../clientResolver';
import { hydrateNewsStore } from './hydration';
import type { NewsState, NewsDeps } from './types';

export type { NewsState, NewsDeps } from './types';

const INITIAL_STATE: Pick<NewsState, 'stories' | 'latestIndex' | 'hydrated' | 'loading' | 'error'> = {
  stories: [],
  latestIndex: {},
  hydrated: false,
  loading: false,
  error: null
};

function readConfiguredFeedSourceIds(): Set<string> | null {
  const nodeValue =
    typeof process !== 'undefined'
      ? process.env?.VITE_NEWS_FEED_SOURCES
      : undefined;
  const viteValue = (import.meta as unknown as { env?: { VITE_NEWS_FEED_SOURCES?: string } }).env
    ?.VITE_NEWS_FEED_SOURCES;
  const raw = nodeValue ?? viteValue;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const sourceIds = new Set<string>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const sourceId = (entry as { id?: unknown }).id;
      if (typeof sourceId === 'string' && sourceId.trim()) {
        sourceIds.add(sourceId.trim());
      }
    }

    return sourceIds.size > 0 ? sourceIds : null;
  } catch {
    return null;
  }
}

const CONFIGURED_FEED_SOURCE_IDS = readConfiguredFeedSourceIds();

function isStoryFromConfiguredSources(story: StoryBundle): boolean {
  if (!CONFIGURED_FEED_SOURCE_IDS) {
    return true;
  }

  return story.sources.every((source) =>
    CONFIGURED_FEED_SOURCE_IDS.has(source.source_id),
  );
}

function filterStoriesToConfiguredSources(stories: StoryBundle[]): StoryBundle[] {
  if (!CONFIGURED_FEED_SOURCE_IDS) {
    return stories;
  }

  return stories.filter(isStoryFromConfiguredSources);
}

function parseStory(story: unknown): StoryBundle | null {
  if (hasForbiddenNewsPayloadFields(story)) {
    return null;
  }
  const parsed = StoryBundleSchema.safeParse(story);
  return parsed.success ? parsed.data : null;
}

function parseStories(stories: unknown[]): StoryBundle[] {
  const parsed: StoryBundle[] = [];
  for (const story of stories) {
    const result = parseStory(story);
    if (result) {
      parsed.push(result);
    }
  }
  return parsed;
}

function dedupeStories(stories: StoryBundle[]): StoryBundle[] {
  const map = new Map<string, StoryBundle>();
  for (const story of stories) {
    map.set(story.story_id, story);
  }
  return Array.from(map.values());
}

function sanitizeLatestIndex(index: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [storyId, createdAt] of Object.entries(index)) {
    if (!storyId.trim()) {
      continue;
    }
    if (!Number.isFinite(createdAt) || createdAt < 0) {
      continue;
    }
    next[storyId.trim()] = Math.floor(createdAt);
  }
  return next;
}

function sortStories(stories: StoryBundle[], latestIndex: Record<string, number>): StoryBundle[] {
  return [...stories].sort((a, b) => {
    const aRank = latestIndex[a.story_id] ?? a.created_at;
    const bRank = latestIndex[b.story_id] ?? b.created_at;
    return bRank - aRank || a.story_id.localeCompare(b.story_id);
  });
}

function buildSeedIndex(stories: StoryBundle[]): Record<string, number> {
  const index: Record<string, number> = {};
  for (const story of stories) {
    index[story.story_id] = story.created_at;
  }
  return index;
}

function storyToDiscoveryItem(story: StoryBundle): FeedItem {
  return {
    topic_id: story.topic_id,
    kind: 'NEWS_STORY',
    title: story.headline,
    created_at: Math.max(0, Math.floor(story.created_at)),
    latest_activity_at: Math.max(0, Math.floor(story.cluster_window_end)),
    hotness: 0,
    eye: 0,
    lightbulb: Math.max(0, Math.floor(story.sources.length)),
    comments: 0,
  };
}

async function mirrorStoriesIntoDiscovery(stories: StoryBundle[]): Promise<void> {
  try {
    const { useDiscoveryStore } = await import('../discovery');
    useDiscoveryStore.getState().mergeItems(stories.map(storyToDiscoveryItem));
  } catch (error) {
    console.warn('[vh:news] failed to mirror stories into discovery store', error);
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

  const startHydration = () => {
    const started = hydrateNewsStore(deps.resolveClient, storeRef);
    if (started && !storeRef.getState().hydrated) {
      storeRef.setState({ hydrated: true });
    }
  };

  const store = create<NewsState>((set, get) => ({
    ...INITIAL_STATE,

    setStories(stories: StoryBundle[]) {
      const validated = filterStoriesToConfiguredSources(
        dedupeStories(parseStories(stories)),
      );
      set((state) => ({
        stories: sortStories(validated, state.latestIndex),
        error: null
      }));
    },

    upsertStory(story: StoryBundle) {
      const validated = parseStory(story);
      if (!validated || !isStoryFromConfiguredSources(validated)) {
        return;
      }
      set((state) => {
        const deduped = dedupeStories([...state.stories, validated]);
        return {
          stories: sortStories(deduped, state.latestIndex),
          error: null
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

    upsertLatestIndex(storyId: string, createdAt: number) {
      const normalizedStoryId = storyId.trim();
      if (!normalizedStoryId || !Number.isFinite(createdAt) || createdAt < 0) {
        return;
      }

      set((state) => {
        const nextIndex = {
          ...state.latestIndex,
          [normalizedStoryId]: Math.floor(createdAt)
        };
        return {
          latestIndex: nextIndex,
          stories: sortStories([...state.stories], nextIndex)
        };
      });
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
        const latestIndex = sanitizeLatestIndex(await readNewsLatestIndex(client));
        const storyIds = await readLatestStoryIds(client, limit);
        const stories = await Promise.all(storyIds.map((storyId) => readNewsStory(client, storyId)));
        const validStories = dedupeStories(parseStories(stories));
        const filteredStories = filterStoriesToConfiguredSources(validStories);

        set({
          latestIndex,
          stories: sortStories(filteredStories, latestIndex),
          loading: false,
          error: null
        });

        void mirrorStoriesIntoDiscovery(filteredStories);
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
