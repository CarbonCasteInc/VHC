import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useStore } from 'zustand';
import type { FeedItem } from '@vh/data-model';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import { useFeedStore } from '../../hooks/useFeedStore';
import { useDiscoveryStore } from '../../store/discovery';
import { useNewsStore } from '../../store/news';
import { feedItemMatchesDetailId } from '../../utils/feedItemIdentity';
import { FilterChips } from './FilterChips';
import { SortControls } from './SortControls';
import { useExpandedCardStore } from './expandedCardStore';
import { FeedContent } from './FeedContent';
import { StorylineFocusPanel } from './StorylineFocusPanel';
import {
  areSearchValuesEqual,
  buildFeedSearch,
  normalizeFeedDetailSearchValue,
  normalizeFeedFilterSearchValue,
  normalizeFeedSortSearchValue,
  normalizeStorySearchValue,
  normalizeStorylineSearchValue,
} from './feedSearch';

const TOP_SCROLL_THRESHOLD_PX = 24;
const PULL_REFRESH_THRESHOLD_PX = 72;

function getBootSearchSnapshot(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const snapshot = (window as Window & { __VH_BOOT_SEARCH__?: string }).__VH_BOOT_SEARCH__;
  if (typeof snapshot !== 'string') {
    return null;
  }

  const normalized = snapshot.trim();
  return normalized ? normalized : null;
}

function clearBootSearchSnapshot(): void {
  if (typeof window === 'undefined') {
    return;
  }

  delete (window as Window & { __VH_BOOT_SEARCH__?: string }).__VH_BOOT_SEARCH__;
}

function readCurrentSearch(locationSearch: unknown): Record<string, unknown> {
  const search =
    locationSearch && typeof locationSearch === 'object'
      ? { ...(locationSearch as Record<string, unknown>) }
      : {};

  if (typeof window === 'undefined') {
    return search;
  }

  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of params.entries()) {
    search[key] = value;
  }

  return search;
}

function buildSearchHref(pathname: string, search: Record<string, unknown>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, String(entry));
      }
      continue;
    }

    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
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
  const expandCard = useStore(useExpandedCardStore, (state) => state.expand);
  const collapseCard = useStore(useExpandedCardStore, (state) => state.collapse);
  const deferredFeedRef = useRef<ReadonlyArray<FeedItem> | null>(null);
  const lastModeRef = useRef<{ filter: typeof filter; sortMode: typeof sortMode } | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const pullTriggeredRef = useRef(false);
  const previousSearchFilterRef = useRef<typeof filter | null>(null);
  const previousSearchSortModeRef = useRef<typeof sortMode | null>(null);
  const previousSearchDetailIdRef = useRef<string | null>(null);
  const previousSearchStorylineIdRef = useRef<string | null>(null);
  const storylineOpenedFromFeedRef = useRef(false);
  const hydratingFilterFromRouteRef = useRef(false);
  const hydratingSortFromRouteRef = useRef(false);
  const hydratingDetailFromRouteRef = useRef(false);
  const pendingStorylineOpenRouteSyncRef = useRef(false);
  const focusedStoryIdRef = useRef<string | null>(null);
  const hydratingFromRouteRef = useRef(false);
  const [searchVersion, setSearchVersion] = useState(0);
  const [isNearTop, setIsNearTop] = useState(true);
  const [hasDeferredUpdates, setHasDeferredUpdates] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (window.location.search) {
      clearBootSearchSnapshot();
      return;
    }

    const bootSearch = getBootSearchSnapshot();
    if (!bootSearch) {
      return;
    }

    const nextHref = `${location.pathname}${bootSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextHref);
    clearBootSearchSnapshot();
    setSearchVersion((value) => value + 1);
  }, [location.pathname]);

  const currentSearch = useMemo(() => readCurrentSearch(location.search), [location.search, searchVersion]);
  const searchFilter = normalizeFeedFilterSearchValue(currentSearch);
  const searchSortMode = normalizeFeedSortSearchValue(currentSearch);
  const searchDetailId = normalizeFeedDetailSearchValue(currentSearch);
  const searchStorylineId = normalizeStorylineSearchValue(currentSearch);
  const searchStoryId = normalizeStorySearchValue(currentSearch);
  const routeFilter = searchFilter ?? 'ALL';
  const routeSortMode = searchSortMode ?? 'LATEST';
  const focusedStoryline = selectedStorylineId ? storylinesById[selectedStorylineId] ?? null : null;
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
  const commitSearch = useCallback(
    (nextSearch: Record<string, unknown>, replace: boolean) => {
      if (typeof window !== 'undefined' && import.meta.env.MODE !== 'test') {
        const nextHref = buildSearchHref(location.pathname, nextSearch);
        window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', nextHref);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }

      void router.navigate({
        to: location.pathname,
        search: nextSearch as never,
        replace,
      });
    },
    [location.pathname, router],
  );

  const applyDeferredFeed = useCallback(
    (resetPagination: boolean) => {
      const deferred = deferredFeedRef.current;
      if (!deferred) return;
      setDiscoveryFeed(deferred, {
        resetPagination,
        ensureVisibleDetailId: expandedStoryId ?? searchDetailId,
        ensureVisibleStoryId: searchStoryId,
      });
      deferredFeedRef.current = null;
      setHasDeferredUpdates(false);
    },
    [expandedStoryId, searchDetailId, searchStoryId, setDiscoveryFeed],
  );

  const handleClearStoryline = useCallback(() => {
    storylineOpenedFromFeedRef.current = false;
    pendingStorylineOpenRouteSyncRef.current = false;
    focusedStoryIdRef.current = null;
    clearStorylineFocus();
  }, [clearStorylineFocus]);

  const handleOpenStoryFromStoryline = useCallback(
    (storyId: string) => {
      if (!selectedStorylineId) return;
      focusedStoryIdRef.current = null;
      const nextSearch = buildFeedSearch(currentSearch, {
        filter,
        sortMode,
        detailId: expandedStoryId,
        selectedStorylineId,
        selectedStoryId: storyId,
      });
      commitSearch(nextSearch, false);
    },
    [commitSearch, currentSearch, expandedStoryId, filter, selectedStorylineId, sortMode],
  );

  const handleBackFromStoryline = useCallback(() => {
    if (typeof window === 'undefined') {
      handleClearStoryline();
      return;
    }
    window.history.back();
  }, [handleClearStoryline]);

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
    if (typeof window === 'undefined') return;
    const handlePopstate = () => setSearchVersion((value) => value + 1);
    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, []);

  useEffect(() => {
    const previousSearchFilter = previousSearchFilterRef.current;
    previousSearchFilterRef.current = searchFilter;

    if (routeFilter === filter) {
      hydratingFilterFromRouteRef.current = false;
      return;
    }

    if (previousSearchFilter === searchFilter) {
      return;
    }

    hydratingFilterFromRouteRef.current = true;
    setFilter(routeFilter);
  }, [filter, routeFilter, searchFilter, setFilter]);

  useEffect(() => {
    const previousSearchSortMode = previousSearchSortModeRef.current;
    previousSearchSortModeRef.current = searchSortMode;

    if (routeSortMode === sortMode) {
      hydratingSortFromRouteRef.current = false;
      return;
    }

    if (previousSearchSortMode === searchSortMode) {
      return;
    }

    hydratingSortFromRouteRef.current = true;
    setSortMode(routeSortMode);
  }, [routeSortMode, searchSortMode, setSortMode, sortMode]);

  useEffect(() => {
    const previousSearchDetailId = previousSearchDetailIdRef.current;
    previousSearchDetailIdRef.current = searchDetailId;

    if (searchDetailId === expandedStoryId) {
      hydratingDetailFromRouteRef.current = false;
      return;
    }

    if (previousSearchDetailId === searchDetailId) {
      return;
    }

    hydratingDetailFromRouteRef.current = true;
    if (searchDetailId) {
      expandCard(searchDetailId);
      return;
    }

    collapseCard();
  }, [collapseCard, expandCard, expandedStoryId, searchDetailId]);

  useEffect(() => {
    const previousSearchStorylineId = previousSearchStorylineIdRef.current;
    previousSearchStorylineIdRef.current = searchStorylineId;

    if (searchStorylineId === selectedStorylineId) {
      hydratingFromRouteRef.current = false;
      pendingStorylineOpenRouteSyncRef.current = false;
      return;
    }

    if (previousSearchStorylineId === searchStorylineId) return;
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
    if (hydratingFilterFromRouteRef.current) {
      if (routeFilter === filter) {
        hydratingFilterFromRouteRef.current = false;
      }
      return;
    }

    if (hydratingSortFromRouteRef.current) {
      if (routeSortMode === sortMode) {
        hydratingSortFromRouteRef.current = false;
      }
      return;
    }

    if (hydratingDetailFromRouteRef.current) {
      if (searchDetailId === expandedStoryId) {
        hydratingDetailFromRouteRef.current = false;
      }
      return;
    }

    if (hydratingFromRouteRef.current) {
      if (searchStorylineId === selectedStorylineId) {
        hydratingFromRouteRef.current = false;
      }
      return;
    }

    if (pendingStorylineOpenRouteSyncRef.current) {
      if (searchStorylineId === selectedStorylineId) pendingStorylineOpenRouteSyncRef.current = false;
      return;
    }
    let replace = false;
    if (searchStorylineId !== selectedStorylineId) {
      const openingStoryline = Boolean(selectedStorylineId);
      if (openingStoryline) {
        storylineOpenedFromFeedRef.current = true;
        pendingStorylineOpenRouteSyncRef.current = true;
      } else {
        storylineOpenedFromFeedRef.current = false;
      }
      replace = !openingStoryline;
    }

    const nextSearch = buildFeedSearch(currentSearch, {
      filter,
      sortMode,
      detailId: expandedStoryId,
      selectedStorylineId,
      selectedStoryId: searchStoryId,
    });
    if (areSearchValuesEqual(currentSearch, nextSearch)) {
      return;
    }
    commitSearch(nextSearch, replace);
  }, [
    commitSearch,
    expandedStoryId,
    filter,
    currentSearch,
    routeFilter,
    routeSortMode,
    searchDetailId,
    searchStoryId,
    searchStorylineId,
    selectedStorylineId,
    sortMode,
  ]);

  useEffect(() => {
    if (typeof document === 'undefined' || !selectedStorylineId || !searchStoryId) {
      focusedStoryIdRef.current = null;
      return;
    }
    if (focusedStoryIdRef.current === searchStoryId) return;
    const target = document.querySelector<HTMLElement>(`[data-story-id="${searchStoryId}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus({ preventScroll: true });
    focusedStoryIdRef.current = searchStoryId;
  }, [pagedFeed, searchStoryId, selectedStorylineId]);

  useEffect(() => {
    const updateNearTop = () => {
      if (typeof window === 'undefined') {
        setIsNearTop(true);
        return;
      }
      setIsNearTop(window.scrollY <= TOP_SCROLL_THRESHOLD_PX);
    };

    updateNearTop();
    if (typeof window === 'undefined') return;
    window.addEventListener('scroll', updateNearTop, { passive: true });
    return () => window.removeEventListener('scroll', updateNearTop);
  }, []);

  useLayoutEffect(() => {
    const modeChanged =
      lastModeRef.current?.filter !== filter ||
      lastModeRef.current?.sortMode !== sortMode;
    lastModeRef.current = { filter, sortMode };

    const detailToEnsure = expandedStoryId ?? searchDetailId;
    const pagedFeedHasDetail =
      detailToEnsure !== null &&
      pagedFeed.some((item) => feedItemMatchesDetailId(item, detailToEnsure));
    const pagedFeedHasFocusedStory =
      searchStoryId !== null &&
      pagedFeed.some((item) => item.kind === 'NEWS_STORY' && item.story_id?.trim() === searchStoryId);
    const mustPrimeRestoredRouteState =
      (detailToEnsure !== null && !pagedFeedHasDetail) ||
      (searchStoryId !== null && !pagedFeedHasFocusedStory);
    const deferUpdates = (expandedStoryId !== null || !isNearTop) && !mustPrimeRestoredRouteState;
    if (deferUpdates && !modeChanged) {
      deferredFeedRef.current = feed;
      setHasDeferredUpdates(true);
      return;
    }

    setDiscoveryFeed(feed, {
      resetPagination: modeChanged,
      ensureVisibleDetailId: expandedStoryId ?? searchDetailId,
      ensureVisibleStoryId: searchStoryId,
    });
    deferredFeedRef.current = null;
    setHasDeferredUpdates(false);
  }, [
    expandedStoryId,
    feed,
    filter,
    isNearTop,
    searchDetailId,
    searchStoryId,
    setDiscoveryFeed,
    sortMode,
  ]);

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
          selectedStoryId={searchStoryId}
          onBack={showBackFromStoryline ? handleBackFromStoryline : undefined}
          onClear={handleClearStoryline}
          onOpenStory={handleOpenStoryFromStoryline}
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
