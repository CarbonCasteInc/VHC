import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { FeedItem } from '@vh/data-model';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import { FEED_PAGE_SIZE, useFeedStore } from '../../hooks/useFeedStore';
import { useAppStore } from '../../store';
import { useDiscoveryStore } from '../../store/discovery';
import { useNewsStore } from '../../store/news';
import { feedItemMatchesDetailId } from '../../utils/feedItemIdentity';
import { FeedContent } from './FeedContent';
import { FeedShellChrome } from './FeedShellChrome';
import { StorylineFocusPanel } from './StorylineFocusPanel';
import { useFeedShellRouteState } from './useFeedShellRouteState';

const TOP_SCROLL_THRESHOLD_PX = 24;
const PULL_REFRESH_THRESHOLD_PX = 72;
const DIRECT_STORY_LOAD_RETRY_MS = 1_000;
const DIRECT_STORY_LOAD_MAX_ATTEMPTS = 12;
const PUBLIC_NEWS_REFRESH_INITIAL_LIMIT = FEED_PAGE_SIZE;
const PUBLIC_NEWS_REFRESH_LOAD_MORE_STEP = FEED_PAGE_SIZE;
const PUBLIC_NEWS_REFRESH_MAX_LIMIT = 250;

export interface FeedShellProps {
  /** Discovery feed hook result (injected for testability). */
  readonly feedResult: UseDiscoveryFeedResult;
}

function normalizeDirectNewsStoryId(detailId: string | null, storyId: string | null): string | null {
  const normalizedStoryId = storyId?.trim();
  if (normalizedStoryId) {
    return normalizedStoryId;
  }

  const normalizedDetailId = detailId?.trim();
  if (!normalizedDetailId?.startsWith('news:')) {
    return null;
  }

  const candidate = normalizedDetailId.slice('news:'.length).trim();
  return candidate && !candidate.includes(':') ? candidate : null;
}

function hasBrowserPublicNewsRelay(): boolean {
  const origin = typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : '';
  return /^https?:\/\//.test(origin);
}

function readBrowserOnline(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
    return true;
  }
  return navigator.onLine;
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
  } = feedResult;

  const pagedFeed = useStore(useFeedStore, (state) => state.discoveryFeed);
  const hasMore = useStore(useFeedStore, (state) => state.hasMore);
  const loadMore = useStore(useFeedStore, (state) => state.loadMore);
  const loadingMore = useStore(useFeedStore, (state) => state.loading);
  const setDiscoveryFeed = useStore(useFeedStore, (state) => state.setDiscoveryFeed);
  const discoveryItems = useStore(useDiscoveryStore, (state) => state.items);
  const publicNewsClientReady = useStore(useAppStore, (state) => state.client !== null);
  const refreshLatest = useStore(useNewsStore, (state) => state.refreshLatest);
  const ensureStory = useStore(useNewsStore, (state) => state.ensureStory);
  const storylinesById = useStore(useNewsStore, (state) => state.storylinesById);
  const loadedPublicNewsStoryCount = useStore(useNewsStore, (state) => state.stories.length);
  const publicNewsLatestIndex = useStore(useNewsStore, (state) => state.latestIndex);
  const publicNewsLatestIndexCursor = useStore(useNewsStore, (state) => state.latestIndexCursor);
  const publicNewsLoading = useStore(useNewsStore, (state) => state.loading);
  const publicRelayReady = hasBrowserPublicNewsRelay();
  const publicRelayColdStartReady = publicRelayReady && loadedPublicNewsStoryCount === 0;
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
  const initialPublicNewsRefreshRef = useRef(false);
  const mountedRef = useRef(true);
  const touchStartYRef = useRef<number | null>(null);
  const pullTriggeredRef = useRef(false);
  const [isNearTop, setIsNearTop] = useState(true);
  const [hasDeferredUpdates, setHasDeferredUpdates] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newsRefreshLimit, setNewsRefreshLimit] = useState(PUBLIC_NEWS_REFRESH_INITIAL_LIMIT);
  const [meshLoadingMore, setMeshLoadingMore] = useState(false);
  const [meshPaginationExhausted, setMeshPaginationExhausted] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(readBrowserOnline);

  const focusedStoryline = selectedStorylineId ? storylinesById[selectedStorylineId] ?? null : null;
  const directRouteStoryId = useMemo(
    () => normalizeDirectNewsStoryId(searchDetailId, searchStoryId),
    [searchDetailId, searchStoryId],
  );
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
        ? feed.filter(
            (item) =>
              item.kind === 'NEWS_STORY' && item.storyline_id?.trim() === selectedStorylineId,
          ).length
        : 0,
    [feed, selectedStorylineId],
  );
  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    for (const item of discoveryItems) {
      for (const category of item.categories ?? []) {
        const normalized = category.trim();
        if (normalized) {
          categories.add(normalized);
        }
      }
    }
    return [...categories].sort((left, right) => left.localeCompare(right)).slice(0, 8);
  }, [discoveryItems]);
  const availableTopics = useMemo(() => {
    const topics = new Set<string>();
    for (const item of discoveryItems) {
      for (const entityKey of item.entity_keys ?? []) {
        const normalized = entityKey.trim();
        if (normalized) {
          topics.add(normalized);
        }
      }
    }
    return [...topics].sort((left, right) => left.localeCompare(right)).slice(0, 8);
  }, [discoveryItems]);

  const toggleListValue = useCallback((values: ReadonlyArray<string>, value: string): string[] => {
    const normalized = value.trim();
    const target = normalized.toLowerCase();
    const withoutValue = values.filter((entry) => entry.trim().toLowerCase() !== target);
    if (withoutValue.length !== values.length) {
      return withoutValue;
    }
    return [...values, normalized];
  }, []);

  const removeListValue = useCallback((values: ReadonlyArray<string>, value: string): string[] => {
    const target = value.trim().toLowerCase();
    return values.filter((entry) => entry.trim().toLowerCase() !== target);
  }, []);

  const handlePreferredCategoryToggle = useCallback(
    (category: string) => {
      setPersonalization({
        ...personalization,
        preferredCategories: toggleListValue(personalization.preferredCategories, category),
        mutedCategories: removeListValue(personalization.mutedCategories, category),
      });
    },
    [personalization, removeListValue, setPersonalization, toggleListValue],
  );

  const handleMutedCategoryToggle = useCallback(
    (category: string) => {
      setPersonalization({
        ...personalization,
        preferredCategories: removeListValue(personalization.preferredCategories, category),
        mutedCategories: toggleListValue(personalization.mutedCategories, category),
      });
    },
    [personalization, removeListValue, setPersonalization, toggleListValue],
  );

  const handlePreferredTopicToggle = useCallback(
    (topic: string) => {
      setPersonalization({
        ...personalization,
        preferredTopics: toggleListValue(personalization.preferredTopics, topic),
        mutedTopics: removeListValue(personalization.mutedTopics, topic),
      });
    },
    [personalization, removeListValue, setPersonalization, toggleListValue],
  );

  const handleMutedTopicToggle = useCallback(
    (topic: string) => {
      setPersonalization({
        ...personalization,
        preferredTopics: removeListValue(personalization.preferredTopics, topic),
        mutedTopics: toggleListValue(personalization.mutedTopics, topic),
      });
    },
    [personalization, removeListValue, setPersonalization, toggleListValue],
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
    if (refreshing || !browserOnline) return;
    setRefreshing(true);
    setMeshPaginationExhausted(false);
    setNewsRefreshLimit(PUBLIC_NEWS_REFRESH_INITIAL_LIMIT);
    try {
      await refreshLatest(PUBLIC_NEWS_REFRESH_INITIAL_LIMIT);
      applyDeferredFeed(true);
    } finally {
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [applyDeferredFeed, browserOnline, refreshLatest, refreshing]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateBrowserOnline = () => {
      setBrowserOnline(readBrowserOnline());
    };

    updateBrowserOnline();
    window.addEventListener('online', updateBrowserOnline);
    window.addEventListener('offline', updateBrowserOnline);
    return () => {
      window.removeEventListener('online', updateBrowserOnline);
      window.removeEventListener('offline', updateBrowserOnline);
    };
  }, []);

  useEffect(() => {
    if (
      initialPublicNewsRefreshRef.current ||
      !browserOnline ||
      (!publicNewsClientReady && !publicRelayColdStartReady) ||
      loading ||
      publicNewsLoading
    ) {
      return;
    }

    initialPublicNewsRefreshRef.current = true;
    setMeshPaginationExhausted(false);
    setNewsRefreshLimit(PUBLIC_NEWS_REFRESH_INITIAL_LIMIT);
    setRefreshing(true);

    void refreshLatest(PUBLIC_NEWS_REFRESH_INITIAL_LIMIT)
      .then(() => {
        if (mountedRef.current) {
          applyDeferredFeed(true);
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          setRefreshing(false);
        }
      });
  }, [
    applyDeferredFeed,
    browserOnline,
    loading,
    loadedPublicNewsStoryCount,
    publicNewsClientReady,
    publicRelayColdStartReady,
    publicNewsLoading,
    refreshLatest,
  ]);

  const hasPublicNewsCursor =
    typeof publicNewsLatestIndexCursor === 'number' && Number.isFinite(publicNewsLatestIndexCursor);
  const canRequestMorePublicNews =
    !hasMore &&
    browserOnline &&
    !loading &&
    !error &&
    newsCount > 0 &&
    loadedPublicNewsStoryCount > 0 &&
    hasPublicNewsCursor &&
    !meshPaginationExhausted &&
    newsRefreshLimit < PUBLIC_NEWS_REFRESH_MAX_LIMIT;

  const handleLoadMore = useCallback(() => {
    if (hasMore) {
      loadMore();
      return;
    }

    if (!canRequestMorePublicNews || meshLoadingMore || refreshing) {
      return;
    }

    const previousStoryIds = new Set(
      useNewsStore.getState().stories.map((story) => story.story_id),
    );
    const loadedLatestActivityValues = Object.values(publicNewsLatestIndex)
      .filter((value) => Number.isFinite(value) && value >= 0);
    const fallbackBeforeCursor = loadedLatestActivityValues.length > 0
      ? Math.min(...loadedLatestActivityValues)
      : null;
    const beforeCursor = typeof publicNewsLatestIndexCursor === 'number' && Number.isFinite(publicNewsLatestIndexCursor)
      ? publicNewsLatestIndexCursor
      : fallbackBeforeCursor;
    if (beforeCursor === null) {
      setMeshPaginationExhausted(true);
      return;
    }
    const nextLimit = Math.min(
      PUBLIC_NEWS_REFRESH_MAX_LIMIT,
      newsRefreshLimit + PUBLIC_NEWS_REFRESH_LOAD_MORE_STEP,
    );

    setMeshLoadingMore(true);
    void refreshLatest({ limit: PUBLIC_NEWS_REFRESH_LOAD_MORE_STEP, before: beforeCursor })
      .then(() => {
        const nextStories = useNewsStore.getState().stories;
        const discoveredAdditionalStory = nextStories.some(
          (story) => !previousStoryIds.has(story.story_id),
        );
        setNewsRefreshLimit(nextLimit);
        if (!discoveredAdditionalStory || nextLimit >= PUBLIC_NEWS_REFRESH_MAX_LIMIT) {
          setMeshPaginationExhausted(true);
        }
        applyDeferredFeed(false);
      })
      .finally(() => {
        setMeshLoadingMore(false);
      });
  }, [
    applyDeferredFeed,
    canRequestMorePublicNews,
    hasMore,
    loadMore,
    meshLoadingMore,
    newsRefreshLimit,
    publicNewsLatestIndex,
    publicNewsLatestIndexCursor,
    refreshLatest,
    refreshing,
  ]);

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
    const visibleFeedIsUnderfilled = pagedFeed.length < Math.min(feed.length, FEED_PAGE_SIZE);
    const shouldApplyCurrentWindow = refreshing || meshLoadingMore || visibleFeedIsUnderfilled;
    const deferUpdates =
      (expandedStoryId !== null || (!isNearTop && !shouldApplyCurrentWindow)) &&
      !mustPrimeRestoredRouteState;
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
    meshLoadingMore,
    pagedFeed.length,
    refreshing,
    searchDetailId,
    searchStoryId,
    setDiscoveryFeed,
    sortMode,
  ]);

  useEffect(() => {
    if (!directRouteStoryId) {
      return;
    }

    const storyAlreadyComposed =
      feed.some(
        (item) =>
          item.kind === 'NEWS_STORY' &&
          item.story_id?.trim() === directRouteStoryId,
      ) ||
      pagedFeed.some(
        (item) =>
          item.kind === 'NEWS_STORY' &&
          item.story_id?.trim() === directRouteStoryId,
      );
    if (storyAlreadyComposed) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const loadDirectStory = () => {
      if (cancelled || attempts >= DIRECT_STORY_LOAD_MAX_ATTEMPTS) {
        return;
      }
      attempts += 1;
      void ensureStory(directRouteStoryId).then((loaded) => {
        if (cancelled || loaded || attempts >= DIRECT_STORY_LOAD_MAX_ATTEMPTS) {
          return;
        }
        retryTimer = setTimeout(loadDirectStory, DIRECT_STORY_LOAD_RETRY_MS);
      });
    };

    loadDirectStory();
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [directRouteStoryId, ensureStory, feed, pagedFeed]);

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

  const feedContentLoading =
    loading || (browserOnline && pagedFeed.length === 0 && (refreshing || publicNewsLoading));
  const feedEmptyState = !browserOnline
    ? {
        title: "You're offline",
        description: 'Reconnect to refresh the public news mesh.',
      }
    : undefined;

  return (
    <div
      className="mx-auto flex max-w-[760px] flex-col gap-4"
      data-testid="feed-shell"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <FeedShellChrome
        filter={filter}
        sortMode={sortMode}
        personalization={personalization}
        availableCategories={availableCategories}
        availableTopics={availableTopics}
        selectedStorylineId={selectedStorylineId}
        totalItems={totalItems}
        newsCount={newsCount}
        topicCount={topicCount}
        focusedStoryCount={focusedStoryCount}
        refreshing={refreshing}
        hasDeferredUpdates={hasDeferredUpdates}
        onFilterSelect={setFilter}
        onSortSelect={setSortMode}
        onPreferredCategoryToggle={handlePreferredCategoryToggle}
        onMutedCategoryToggle={handleMutedCategoryToggle}
        onPreferredTopicToggle={handlePreferredTopicToggle}
        onMutedTopicToggle={handleMutedTopicToggle}
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

      <div className="rounded-[1.5rem] border border-white/70 bg-white/70 p-2.5 shadow-[0_22px_58px_-44px_rgba(15,23,42,0.34)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/55 sm:p-3">
        <FeedContent
          feed={pagedFeed}
          loading={feedContentLoading}
          error={error}
          hasMore={hasMore || canRequestMorePublicNews}
          loadingMore={loadingMore || meshLoadingMore}
          loadMore={handleLoadMore}
          emptyState={feedEmptyState}
          errorActionLabel="Retry"
          onErrorAction={() => void handleRefresh()}
        />
      </div>
    </div>
  );
};

export default FeedShell;
