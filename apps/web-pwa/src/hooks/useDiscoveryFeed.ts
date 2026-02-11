import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, FilterChip, SortMode } from '@vh/data-model';
import {
  useDiscoveryStore,
  composeFeed,
  type DiscoveryState,
} from '../store/discovery';

/**
 * Derived discovery feed hook.
 *
 * Composes the visible feed from the discovery store by applying:
 * 1. Filter chip → kind subset
 * 2. Sort mode → ordering
 *
 * The hook is feature-flagged behind VITE_FEED_V2_ENABLED.
 * When the flag is off, it returns an empty feed with no-op actions.
 *
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §2–4
 */

export interface UseDiscoveryFeedResult {
  /** The composed, filtered, sorted feed. */
  readonly feed: ReadonlyArray<FeedItem>;
  /** Active filter chip. */
  readonly filter: FilterChip;
  /** Active sort mode. */
  readonly sortMode: SortMode;
  /** Whether the store is loading. */
  readonly loading: boolean;
  /** Last error, if any. */
  readonly error: string | null;
  /** Change filter chip. */
  setFilter: (filter: FilterChip) => void;
  /** Change sort mode. */
  setSortMode: (mode: SortMode) => void;
}

const EMPTY_FEED: ReadonlyArray<FeedItem> = [];

const NOOP_RESULT: UseDiscoveryFeedResult = {
  feed: EMPTY_FEED,
  filter: 'ALL',
  sortMode: 'LATEST',
  loading: false,
  error: null,
  setFilter: () => undefined,
  setSortMode: () => undefined,
};

/** Read the feature flag. */
function isFeedV2Enabled(): boolean {
  const viteValue = (import.meta as unknown as { env?: { VITE_FEED_V2_ENABLED?: string } })
    .env?.VITE_FEED_V2_ENABLED;
  /* v8 ignore next 1 -- browser runtime may not expose process */
  const nodeValue = typeof process !== 'undefined' ? process.env?.VITE_FEED_V2_ENABLED : undefined;
  return (nodeValue ?? viteValue) === 'true';
}

// Selectors (stable references for zustand)
const selectItems = (s: DiscoveryState) => s.items;
const selectFilter = (s: DiscoveryState) => s.filter;
const selectSortMode = (s: DiscoveryState) => s.sortMode;
const selectRankingConfig = (s: DiscoveryState) => s.rankingConfig;
const selectLoading = (s: DiscoveryState) => s.loading;
const selectError = (s: DiscoveryState) => s.error;
const selectSetFilter = (s: DiscoveryState) => s.setFilter;
const selectSetSortMode = (s: DiscoveryState) => s.setSortMode;

export function useDiscoveryFeed(): UseDiscoveryFeedResult {
  if (!isFeedV2Enabled()) {
    return NOOP_RESULT;
  }

  /* eslint-disable react-hooks/rules-of-hooks -- flag is stable at module level */
  const items = useStore(useDiscoveryStore, selectItems);
  const filter = useStore(useDiscoveryStore, selectFilter);
  const sortMode = useStore(useDiscoveryStore, selectSortMode);
  const rankingConfig = useStore(useDiscoveryStore, selectRankingConfig);
  const loading = useStore(useDiscoveryStore, selectLoading);
  const error = useStore(useDiscoveryStore, selectError);
  const setFilter = useStore(useDiscoveryStore, selectSetFilter);
  const setSortMode = useStore(useDiscoveryStore, selectSetSortMode);

  const feed = useMemo(
    () => composeFeed(items, filter, sortMode, rankingConfig, Date.now()),
    [items, filter, sortMode, rankingConfig],
  );

  return { feed, filter, sortMode, loading, error, setFilter, setSortMode };
  /* eslint-enable react-hooks/rules-of-hooks */
}
