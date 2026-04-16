import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { FeedItem } from '@vh/data-model';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import { useFeedStore } from '../../hooks/useFeedStore';
import { useDiscoveryStore } from '../../store/discovery';
import { useNewsStore } from '../../store/news';
import { feedItemMatchesDetailId } from '../../utils/feedItemIdentity';
import { FeedContent } from './FeedContent';
import { FeedShellChrome } from './FeedShellChrome';
import { StorylineFocusPanel } from './StorylineFocusPanel';
import { useFeedShellRouteState } from './useFeedShellRouteState';

const TOP_SCROLL_THRESHOLD_PX = 24;
const PULL_REFRESH_THRESHOLD_PX = 72;

export interface FeedShellProps {
  /** Discovery feed hook result (injected for testability). */
  readonly feedResult: UseDiscoveryFeedResult;
}

/**
 * Shell container for the V2 discovery feed.
 * Composes route state, feed paging, refresh safety, and feed chrome.
 *
 * V2 feed is now the permanent path (Wave 1 flag retired).
 * This component does NOT gate itself - it is unconditionally mounted.
 *
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §2
 */
export const FeedShell: React.FC<FeedShellProps> = ({ feedResult }) => {
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
  const {
    expandedStoryId,
    searchDetailId,
    searchStoryId,
    showBackFromStoryline,
    handleClearStoryline,
    handleOpenStoryFromStoryline,
    handleBackFromStoryline,
  } = useFeedShellRouteState({
    pagedFeed,
    filter,
    sortMode,
    selectedStorylineId,
    setFilter,
    setSortMode,
    focusStoryline,
    clearStorylineFocus,
  });

  const deferredFeedRef = useRef<ReadonlyArray<FeedItem> | null>(null);
  const lastModeRef = useRef<{ filter: typeof filter; sortMode: typeof sortMode } | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const pullTriggeredRef = useRef(false);
  const [isNearTop, setIsNearTop] = useState(true);
  const [hasDeferredUpdates, setHasDeferredUpdates] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const focusedStoryline = selectedStorylineId ? storylinesById[selectedStorylineId] ?? null : null;
  const totalItems = pagedFeed.length;
  const newsCount = useMemo(
    () => pagedFeed.filter((item) => item.kind === 'NEWS_STORY').length,
    [pagedFeed],
  );
  const topicCount = useMemo(
    () => pagedFeed.filter((item) => item.kind === 'USER_TOPIC').length,
    [pagedFeed],
  );
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
      ensureVisibleDetailId: detailToEnsure,
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
      className="mx-auto flex max-w-[780px] flex-col gap-5"
      data-testid="feed-shell"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <FeedShellChrome
        filter={filter}
        sortMode={sortMode}
        selectedStorylineId={selectedStorylineId}
        totalItems={totalItems}
        newsCount={newsCount}
        topicCount={topicCount}
        focusedStoryCount={focusedStoryCount}
        refreshing={refreshing}
        hasDeferredUpdates={hasDeferredUpdates}
        onFilterSelect={setFilter}
        onSortSelect={setSortMode}
        onRefresh={() => void handleRefresh()}
        onApplyDeferredFeed={() => applyDeferredFeed(true)}
      />

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

      <div className="rounded-[2rem] border border-white/70 bg-white/70 p-3 shadow-[0_28px_70px_-42px_rgba(15,23,42,0.36)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/55 sm:p-4">
        <FeedContent
          feed={pagedFeed}
          loading={loading}
          error={error}
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMore={loadMore}
        />
      </div>
    </div>
  );
};

export default FeedShell;
