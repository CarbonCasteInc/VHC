import { create, type StoreApi } from 'zustand';
import {
  DEFAULT_RANKING_CONFIG,
  FeedItemSchema,
  type FeedItem,
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
  'items' | 'filter' | 'sortMode' | 'rankingConfig' | 'loading' | 'error'
> = {
  items: [],
  filter: 'ALL',
  sortMode: 'LATEST',
  rankingConfig: { ...DEFAULT_RANKING_CONFIG },
  loading: false,
  error: null,
};

// ---- Helpers ----

/** Deduplicate items by topic_id, keeping the latest version. */
function dedupeByTopicId(items: FeedItem[]): FeedItem[] {
  const map = new Map<string, FeedItem>();
  for (const item of items) {
    map.set(item.topic_id, item);
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
      set({ items: dedupeByTopicId(validated), error: null });
    },

    mergeItems(items: FeedItem[]) {
      const validated = parseItems(items);
      const merged = [...get().items, ...validated];
      set({ items: dedupeByTopicId(merged), error: null });
    },

    setFilter(filter: FilterChip) {
      set({ filter });
    },

    setSortMode(mode: SortMode) {
      set({ sortMode: mode });
    },

    setRankingConfig(config: RankingConfig) {
      set({ rankingConfig: config });
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
