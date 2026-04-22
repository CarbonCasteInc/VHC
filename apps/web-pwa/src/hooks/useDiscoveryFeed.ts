import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, FeedPersonalizationConfig, FilterChip, SortMode } from '@vh/data-model';
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
 * 2. Local personalization → muted-topic/category exclusions
 * 3. Sort mode → ordering, with HOTTEST applying preference boosts
 *
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §2–4
 */

export interface UseDiscoveryFeedResult {
  /** The composed, filtered, sorted feed. */
  readonly feed: ReadonlyArray<FeedItem>;
  /** Active storyline focus, if any. */
  readonly selectedStorylineId: string | null;
  /** Preference scaffold for later category/topic controls. */
  readonly personalization: FeedPersonalizationConfig;
  /** Active filter chip. */
  readonly filter: FilterChip;
  /** Active sort mode. */
  readonly sortMode: SortMode;
  /** Whether the store is loading. */
  readonly loading: boolean;
  /** Last error, if any. */
  readonly error: string | null;
  /** Update private, local feed tuning preferences. */
  setPersonalization: (config: FeedPersonalizationConfig) => void;
  /** Change filter chip. */
  setFilter: (filter: FilterChip) => void;
  /** Focus a specific storyline in discovery. */
  focusStoryline: (storylineId: string) => void;
  /** Clear storyline focus. */
  clearStorylineFocus: () => void;
  /** Change sort mode. */
  setSortMode: (mode: SortMode) => void;
}

// Selectors (stable references for zustand)
const selectItems = (s: DiscoveryState) => s.items;
const selectFilter = (s: DiscoveryState) => s.filter;
const selectSortMode = (s: DiscoveryState) => s.sortMode;
const selectRankingConfig = (s: DiscoveryState) => s.rankingConfig;
const selectPersonalization = (s: DiscoveryState) => s.personalization;
const selectSelectedStorylineId = (s: DiscoveryState) => s.selectedStorylineId;
const selectLoading = (s: DiscoveryState) => s.loading;
const selectError = (s: DiscoveryState) => s.error;
const selectSetFilter = (s: DiscoveryState) => s.setFilter;
const selectSetPersonalization = (s: DiscoveryState) => s.setPersonalization;
const selectFocusStoryline = (s: DiscoveryState) => s.focusStoryline;
const selectClearStorylineFocus = (s: DiscoveryState) => s.clearStorylineFocus;
const selectSetSortMode = (s: DiscoveryState) => s.setSortMode;

export function useDiscoveryFeed(): UseDiscoveryFeedResult {
  const items = useStore(useDiscoveryStore, selectItems);
  const filter = useStore(useDiscoveryStore, selectFilter);
  const sortMode = useStore(useDiscoveryStore, selectSortMode);
  const rankingConfig = useStore(useDiscoveryStore, selectRankingConfig);
  const personalization = useStore(useDiscoveryStore, selectPersonalization);
  const selectedStorylineId = useStore(useDiscoveryStore, selectSelectedStorylineId);
  const loading = useStore(useDiscoveryStore, selectLoading);
  const error = useStore(useDiscoveryStore, selectError);
  const setFilter = useStore(useDiscoveryStore, selectSetFilter);
  const setPersonalization = useStore(useDiscoveryStore, selectSetPersonalization);
  const focusStoryline = useStore(useDiscoveryStore, selectFocusStoryline);
  const clearStorylineFocus = useStore(useDiscoveryStore, selectClearStorylineFocus);
  const setSortMode = useStore(useDiscoveryStore, selectSetSortMode);

  const feed = useMemo(
    () =>
      composeFeed(
        items,
        filter,
        sortMode,
        rankingConfig,
        Date.now(),
        selectedStorylineId,
        personalization,
      ),
    [items, filter, sortMode, rankingConfig, selectedStorylineId, personalization],
  );

  return {
    feed,
    selectedStorylineId,
    personalization,
    filter,
    sortMode,
    loading,
    error,
    setPersonalization,
    setFilter,
    focusStoryline,
    clearStorylineFocus,
    setSortMode,
  };
}
