import type {
  FeedItem,
  FilterChip,
  SortMode,
  RankingConfig,
} from '@vh/data-model';

/**
 * Discovery store state and actions.
 * Canonical spec: docs/specs/spec-topic-discovery-ranking-v0.md §2–4
 */
export interface DiscoveryState {
  /** All known feed items (unfiltered, unranked source of truth). */
  readonly items: ReadonlyArray<FeedItem>;

  /** Active filter chip. */
  readonly filter: FilterChip;

  /** Active sort mode. */
  readonly sortMode: SortMode;

  /** Ranking configuration (weights + decay). */
  readonly rankingConfig: RankingConfig;

  /** Whether the store is currently loading data. */
  readonly loading: boolean;

  /** Last error message, if any. */
  readonly error: string | null;

  // ---- Actions ----

  /** Replace the full item set (e.g. after fetch / hydration). */
  setItems(items: FeedItem[]): void;

  /** Add items without duplicates (merge by topic_id). */
  mergeItems(items: FeedItem[]): void;

  /** Change the active filter chip. */
  setFilter(filter: FilterChip): void;

  /** Change the active sort mode. */
  setSortMode(mode: SortMode): void;

  /** Update ranking config at runtime. */
  setRankingConfig(config: RankingConfig): void;

  /** Set loading state. */
  setLoading(loading: boolean): void;

  /** Set error state. */
  setError(error: string | null): void;

  /** Reset store to initial state. */
  reset(): void;
}

export interface DiscoveryDeps {
  now: () => number;
}
