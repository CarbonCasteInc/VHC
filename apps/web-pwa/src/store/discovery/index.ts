import { create, type StoreApi } from 'zustand';
import {
  DEFAULT_FEED_PERSONALIZATION_CONFIG,
  DEFAULT_RANKING_CONFIG,
  FeedItemSchema,
  type FeedItem,
  type FeedPersonalizationConfig,
  type FilterChip,
  type SortMode,
  type RankingConfig,
} from '@vh/data-model';
import type { DiscoveryState, DiscoveryDeps } from './types';

export type { DiscoveryState } from './types';
export { composeFeed, computeHotness, filterItems, sortItems } from './ranking';

// ---- Initial state (shared by real + mock) ----

const INITIAL_STATE: Pick<
  DiscoveryState,
  | 'items'
  | 'filter'
  | 'sortMode'
  | 'rankingConfig'
  | 'personalization'
  | 'loading'
  | 'error'
  | 'selectedStorylineId'
> = {
  items: [],
  filter: 'ALL',
  sortMode: 'LATEST',
  rankingConfig: { ...DEFAULT_RANKING_CONFIG },
  personalization: { ...DEFAULT_FEED_PERSONALIZATION_CONFIG },
  loading: false,
  error: null,
  selectedStorylineId: null,
};

// ---- Helpers ----

/**
 * Deduplicate discovery items while preserving distinct NEWS_STORY headlines.
 *
 * PR0 contract freeze:
 * - NEWS_STORY canonical identity is `story_id` when present.
 * - Migration fallback (when story_id is absent):
 *   kind + topic_id + created_at + normalized title
 *   (multiple clustered stories can share topic_id and remain visible)
 * - Other kinds: kind + topic_id
 */
function dedupeFeedItems(items: FeedItem[]): FeedItem[] {
  const map = new Map<string, FeedItem>();

  for (const item of items) {
    const normalizedStoryId = item.story_id?.trim();
    const key =
      item.kind === 'NEWS_STORY' && normalizedStoryId
        ? [item.kind, normalizedStoryId].join('|')
        : item.kind === 'NEWS_STORY'
          ? [
              item.kind,
              item.topic_id,
              Math.max(0, Math.floor(item.created_at)),
              item.title.trim().toLowerCase(),
            ].join('|')
          : [item.kind, item.topic_id].join('|');

    map.set(key, item);
  }

  return Array.from(map.values());
}

/** Parse + validate items defensively. Returns only valid items. */
function parseItems(raw: unknown[]): FeedItem[] {
  const result: FeedItem[] = [];
  for (const entry of raw) {
    const parsed = FeedItemSchema.safeParse(entry);
    if (parsed.success) {
      result.push(parsed.data);
    }
  }
  return result;
}

// ---- Store factory ----

export function createDiscoveryStore(
  overrides?: Partial<DiscoveryDeps>,
): StoreApi<DiscoveryState> {
  const deps: DiscoveryDeps = {
    now: Date.now,
    ...overrides,
  };

  return create<DiscoveryState>((set, get) => ({
    ...INITIAL_STATE,

    setItems(items: FeedItem[]) {
      const validated = parseItems(items);
      set({ items: dedupeFeedItems(validated), error: null });
    },

    mergeItems(items: FeedItem[]) {
      const validated = parseItems(items);
      const merged = [...get().items, ...validated];
      set({ items: dedupeFeedItems(merged), error: null });
    },

    syncNewsItems(items: FeedItem[]) {
      const validated = parseItems(items).filter((item) => item.kind === 'NEWS_STORY');
      const nonNewsItems = get().items.filter((item) => item.kind !== 'NEWS_STORY');
      set({ items: dedupeFeedItems([...nonNewsItems, ...validated]), error: null });
    },

    setFilter(filter: FilterChip) {
      set({ filter, selectedStorylineId: null });
    },

    focusStoryline(storylineId: string) {
      const normalizedStorylineId = storylineId.trim();
      if (!normalizedStorylineId) {
        return;
      }
      set({ selectedStorylineId: normalizedStorylineId, error: null });
    },

    clearStorylineFocus() {
      set({ selectedStorylineId: null });
    },

    setSortMode(mode: SortMode) {
      set({ sortMode: mode });
    },

    setRankingConfig(config: RankingConfig) {
      set({ rankingConfig: config });
    },

    setPersonalization(config: FeedPersonalizationConfig) {
      set({
        personalization: {
          ...DEFAULT_FEED_PERSONALIZATION_CONFIG,
          ...config,
          preferredCategories: [...(config.preferredCategories ?? [])],
          preferredTopics: [...(config.preferredTopics ?? [])],
          mutedCategories: [...(config.mutedCategories ?? [])],
          mutedTopics: [...(config.mutedTopics ?? [])],
        },
      });
    },

    setLoading(loading: boolean) {
      set({ loading });
    },

    setError(error: string | null) {
      set({ error });
    },

    reset() {
      set({ ...INITIAL_STATE });
    },
  }));
}

// ---- Mock factory (E2E obligation) ----

export function createMockDiscoveryStore(
  seed?: FeedItem[],
): StoreApi<DiscoveryState> {
  const store = createDiscoveryStore({ now: Date.now });
  if (seed && seed.length > 0) {
    store.getState().setItems(seed);
  }
  return store;
}

// ---- Singleton export ----

/* v8 ignore start -- runtime env fallback (node test vs browser build) */
const isE2E =
  ((typeof process !== 'undefined' ? process.env?.VITE_E2E_MODE : undefined) ??
    (import.meta as unknown as { env?: { VITE_E2E_MODE?: string } }).env
      ?.VITE_E2E_MODE) === 'true';
/* v8 ignore stop */

export const useDiscoveryStore: StoreApi<DiscoveryState> = isE2E
  ? createMockDiscoveryStore()
  : createDiscoveryStore();
