import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useStore } from 'zustand';
import type { FeedItem, FilterChip, SortMode } from '@vh/data-model';
import { useExpandedCardStore } from './expandedCardStore';
import {
  buildSearchHref,
  clearBootSearchSnapshot,
  getBootSearchSnapshot,
  readCurrentSearch,
} from './feedShellBrowserSearch';
import {
  areSearchValuesEqual,
  buildFeedSearch,
  normalizeFeedDetailSearchValue,
  normalizeFeedFilterSearchValue,
  normalizeFeedSortSearchValue,
  normalizeStorySearchValue,
  normalizeStorylineSearchValue,
} from './feedSearch';

interface FeedShellRouteStateParams {
  readonly pagedFeed: ReadonlyArray<FeedItem>;
  readonly filter: FilterChip;
  readonly sortMode: SortMode;
  readonly selectedStorylineId: string | null;
  setFilter: (filter: FilterChip) => void;
  setSortMode: (mode: SortMode) => void;
  focusStoryline: (storylineId: string) => void;
  clearStorylineFocus: () => void;
}

interface FeedShellRouteState {
  readonly expandedStoryId: string | null;
  readonly searchDetailId: string | null;
  readonly searchStorylineId: string | null;
  readonly searchStoryId: string | null;
  readonly showBackFromStoryline: boolean;
  handleClearStoryline: () => void;
  handleOpenStoryFromStoryline: (storyId: string) => void;
  handleBackFromStoryline: () => void;
}

export function useFeedShellRouteState({
  pagedFeed,
  filter,
  sortMode,
  selectedStorylineId,
  setFilter,
  setSortMode,
  focusStoryline,
  clearStorylineFocus,
}: FeedShellRouteStateParams): FeedShellRouteState {
  const router = useRouter();
  const { location } = useRouterState();
  const expandedStoryId = useStore(useExpandedCardStore, (state) => state.expandedStoryId);
  const expandCard = useStore(useExpandedCardStore, (state) => state.expand);
  const collapseCard = useStore(useExpandedCardStore, (state) => state.collapse);
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
    currentSearch,
    expandedStoryId,
    filter,
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

  return {
    expandedStoryId,
    searchDetailId,
    searchStorylineId,
    searchStoryId,
    showBackFromStoryline,
    handleClearStoryline,
    handleOpenStoryFromStoryline,
    handleBackFromStoryline,
  };
}
