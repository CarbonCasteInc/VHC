import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useStore } from 'zustand';
import type { FeedItem } from '@vh/data-model';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import { useFeedStore } from '../../hooks/useFeedStore';
import { useDiscoveryStore } from '../../store/discovery';
import { useNewsStore } from '../../store/news';
import { FilterChips } from './FilterChips';
import { SortControls } from './SortControls';
import { useExpandedCardStore } from './expandedCardStore';
import { FeedContent } from './FeedContent';
import { StorylineFocusPanel } from './StorylineFocusPanel';

const TOP_SCROLL_THRESHOLD_PX = 24;
const PULL_REFRESH_THRESHOLD_PX = 72;

function normalizeStorylineSearchValue(search: unknown): string | null {
  if (!search || typeof search !== 'object') {
    return null;
  }

  const candidate = (search as { storyline?: unknown }).storyline;
  if (typeof candidate !== 'string') {
    return null;
  }

  const normalized = candidate.trim();
  return normalized ? normalized : null;
}

function buildStorylineSearch(
  search: unknown,
  selectedStorylineId: string | null,
): Record<string, unknown> {
  const nextSearch =
    search && typeof search === 'object' ? { ...(search as Record<string, unknown>) } : {};

  if (selectedStorylineId) {
    nextSearch.storyline = selectedStorylineId;
    return nextSearch;
  }

  delete nextSearch.storyline;
  return nextSearch;
}

export interface FeedShellProps {
  /** Discovery feed hook result (injected for testability). */
  readonly feedResult: UseDiscoveryFeedResult;
}

/**
 * Shell container for the V2 discovery feed.
 * Composes FilterChips + SortControls + feed item list.
 *
 * V2 feed is now the permanent path (Wave 1 flag retired).
 * This component does NOT gate itself — it is unconditionally mounted.
 *
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §2
 */
export const FeedShell: React.FC<FeedShellProps> = ({ feedResult }) => {
  const router = useRouter();
  const { location } = useRouterState();
  const {
    feed,
    selectedStorylineId,
    filter,
    sortMode,
    loading,
    error,
    setFilter,
    focusStoryline,
    clearStorylineFocus,
    setSortMode,
  } = feedResult;

  const pagedFeed = useStore(useFeedStore, (state) => state.discoveryFeed);
  const hasMore = useStore(useFeedStore, (state) => state.hasMore);
  const loadMore = useStore(useFeedStore, (state) => state.loadMore);
  const loadingMore = useStore(useFeedStore, (state) => state.loading);
  const setDiscoveryFeed = useStore(useFeedStore, (state) => state.setDiscoveryFeed);
  const discoveryItems = useStore(useDiscoveryStore, (state) => state.items);
  const refreshLatest = useStore(useNewsStore, (state) => state.refreshLatest);
  const storylinesById = useStore(useNewsStore, (state) => state.storylinesById);
  const expandedStoryId = useStore(useExpandedCardStore, (state) => state.expandedStoryId);
  const deferredFeedRef = useRef<ReadonlyArray<FeedItem> | null>(null);
  const lastModeRef = useRef<{ filter: typeof filter; sortMode: typeof sortMode } | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const pullTriggeredRef = useRef(false);
  const previousSearchStorylineIdRef = useRef<string | null>(null);
  const storylineOpenedFromFeedRef = useRef(false);
  const pendingStorylineOpenRouteSyncRef = useRef(false);
  const hydratingFromRouteRef = useRef(false);
  const [isNearTop, setIsNearTop] = useState(true);
  const [hasDeferredUpdates, setHasDeferredUpdates] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const searchStorylineId = normalizeStorylineSearchValue(location.search);
  const focusedStoryline = selectedStorylineId
    ? storylinesById[selectedStorylineId] ?? null
    : null;
  const focusedStoryCount = useMemo(
    () =>
      selectedStorylineId
        ? discoveryItems.filter(
            (item) =>
              item.kind === 'NEWS_STORY' && item.storyline_id?.trim() === selectedStorylineId,
          ).length
        : 0,
    [discoveryItems, selectedStorylineId],
  );
  const showBackFromStoryline =
    Boolean(selectedStorylineId) &&
    searchStorylineId === selectedStorylineId &&
    storylineOpenedFromFeedRef.current;

  const applyDeferredFeed = useCallback(
    (resetPagination: boolean) => {
      const deferred = deferredFeedRef.current;
      if (!deferred) {
        return;
      }

      setDiscoveryFeed(deferred, { resetPagination });
      deferredFeedRef.current = null;
      setHasDeferredUpdates(false);
    },
    [setDiscoveryFeed],
  );

  const handleClearStoryline = useCallback(() => {
    storylineOpenedFromFeedRef.current = false;
    pendingStorylineOpenRouteSyncRef.current = false;
    clearStorylineFocus();
  }, [clearStorylineFocus]);

  const handleBackFromStoryline = useCallback(() => {
    window.history.back();
  }, []);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshLatest();
      applyDeferredFeed(true);
    } finally {
      setRefreshing(false);
    }
  }, [applyDeferredFeed, refreshLatest, refreshing]);

  useEffect(() => {
    const previousSearchStorylineId = previousSearchStorylineIdRef.current;
    previousSearchStorylineIdRef.current = searchStorylineId;

    if (searchStorylineId === selectedStorylineId) {
      hydratingFromRouteRef.current = false;
      pendingStorylineOpenRouteSyncRef.current = false;
      return;
    }

    const searchChanged = previousSearchStorylineId !== searchStorylineId;
    if (!searchChanged) {
      return;
    }

    storylineOpenedFromFeedRef.current = false;
    pendingStorylineOpenRouteSyncRef.current = false;
    hydratingFromRouteRef.current = true;
    if (searchStorylineId) {
      focusStoryline(searchStorylineId);
      return;
    }

    clearStorylineFocus();
  }, [clearStorylineFocus, focusStoryline, searchStorylineId, selectedStorylineId]);

  useEffect(() => {
    if (hydratingFromRouteRef.current) {
      if (searchStorylineId === selectedStorylineId) {
        hydratingFromRouteRef.current = false;
      }
      return;
    }

    if (pendingStorylineOpenRouteSyncRef.current) {
      return;
    }

    if (searchStorylineId === selectedStorylineId) {
      return;
    }

    const openingStoryline = Boolean(selectedStorylineId);
    if (openingStoryline) {
      storylineOpenedFromFeedRef.current = true;
      pendingStorylineOpenRouteSyncRef.current = true;
    } else {
      storylineOpenedFromFeedRef.current = false;
    }

    const nextSearch = buildStorylineSearch(location.search, selectedStorylineId);
    void router.navigate({
      to: location.pathname,
      search: nextSearch as never,
      replace: !openingStoryline,
    });
  }, [location.pathname, location.search, router, searchStorylineId, selectedStorylineId]);

  useEffect(() => {
    const updateNearTop = () => {
      if (typeof window === 'undefined') {
        setIsNearTop(true);
        return;
      }
      setIsNearTop(window.scrollY <= TOP_SCROLL_THRESHOLD_PX);
    };

    updateNearTop();
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('scroll', updateNearTop, { passive: true });
    return () => window.removeEventListener('scroll', updateNearTop);
  }, []);

  useLayoutEffect(() => {
    const modeChanged =
      lastModeRef.current?.filter !== filter ||
      lastModeRef.current?.sortMode !== sortMode;
    lastModeRef.current = { filter, sortMode };

    const deferUpdates = expandedStoryId !== null || !isNearTop;
    if (deferUpdates && !modeChanged) {
      deferredFeedRef.current = feed;
      setHasDeferredUpdates(true);
      return;
    }

    setDiscoveryFeed(feed, { resetPagination: modeChanged });
    deferredFeedRef.current = null;
    setHasDeferredUpdates(false);
  }, [expandedStoryId, feed, filter, isNearTop, setDiscoveryFeed, sortMode]);

  const onTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (expandedStoryId !== null || !isNearTop || refreshing) return;
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
      pullTriggeredRef.current = false;
    },
    [expandedStoryId, isNearTop, refreshing],
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      const startY = touchStartYRef.current;
      if (startY === null || pullTriggeredRef.current) return;

      const currentY = event.touches[0]?.clientY;
      if (typeof currentY !== 'number') return;
      const delta = currentY - startY;
      if (delta < PULL_REFRESH_THRESHOLD_PX) return;

      pullTriggeredRef.current = true;
      void handleRefresh();
    },
    [handleRefresh],
  );

  const onTouchEnd = useCallback(() => {
    touchStartYRef.current = null;
    pullTriggeredRef.current = false;
  }, []);

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="feed-shell"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterChips active={filter} onSelect={setFilter} />
        <div className="flex items-center gap-2">
          <SortControls active={sortMode} onSelect={setSortMode} />
          <button
            type="button"
            onClick={() => void handleRefresh()}
            data-testid="feed-refresh-button"
            className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {hasDeferredUpdates && (
        <div
          data-testid="feed-refresh-prompt"
          className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        >
          New headlines are ready. Pull down or press Refresh to load them.
          <button
            type="button"
            className="ml-2 underline underline-offset-2"
            onClick={() => applyDeferredFeed(true)}
          >
            Load now
          </button>
        </div>
      )}

      {focusedStoryline && (
        <StorylineFocusPanel
          storyline={focusedStoryline}
          visibleStoryCount={focusedStoryCount}
          onBack={showBackFromStoryline ? handleBackFromStoryline : undefined}
          onClear={handleClearStoryline}
        />
      )}

      {/* Feed content area */}
      <FeedContent
        feed={pagedFeed}
        loading={loading}
        error={error}
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadMore={loadMore}
      />
    </div>
  );
};

export default FeedShell;
