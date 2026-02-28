import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useStore } from 'zustand';
import type { FeedItem } from '@vh/data-model';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import { useFeedStore } from '../../hooks/useFeedStore';
import { useIntersectionLoader } from '../../hooks/useIntersectionLoader';
import { useNewsStore } from '../../store/news';
import { FilterChips } from './FilterChips';
import { SortControls } from './SortControls';
import { NewsCardWithRemoval } from './NewsCardWithRemoval';
import { TopicCard } from './TopicCard';
import { SocialNotificationCard } from './SocialNotificationCard';
import { ArticleFeedCard } from '../docs/ArticleFeedCard';
import { ReceiptFeedCard } from './ReceiptFeedCard';
import { useExpandedCardStore } from './expandedCardStore';

const TOP_SCROLL_THRESHOLD_PX = 24;
const PULL_REFRESH_THRESHOLD_PX = 72;

function toFeedItemKey(item: FeedItem): string {
  const normalizedTitle = item.title.trim().replace(/\s+/g, ' ').toLowerCase();
  return [
    item.kind,
    item.topic_id,
    normalizedTitle,
  ].join('|');
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
  const { feed, filter, sortMode, loading, error, setFilter, setSortMode } =
    feedResult;

  const pagedFeed = useStore(useFeedStore, (state) => state.discoveryFeed);
  const hasMore = useStore(useFeedStore, (state) => state.hasMore);
  const loadMore = useStore(useFeedStore, (state) => state.loadMore);
  const loadingMore = useStore(useFeedStore, (state) => state.loading);
  const setDiscoveryFeed = useStore(useFeedStore, (state) => state.setDiscoveryFeed);
  const refreshLatest = useStore(useNewsStore, (state) => state.refreshLatest);
  const expandedStoryId = useStore(useExpandedCardStore, (state) => state.expandedStoryId);
  const deferredFeedRef = useRef<ReadonlyArray<FeedItem> | null>(null);
  const lastModeRef = useRef<{ filter: typeof filter; sortMode: typeof sortMode } | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const pullTriggeredRef = useRef(false);
  const [isNearTop, setIsNearTop] = useState(true);
  const [hasDeferredUpdates, setHasDeferredUpdates] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

// ---- Internal sub-components ----

interface FeedContentProps {
  readonly feed: ReadonlyArray<FeedItem>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly loadMore: () => void;
}

const FeedContent: React.FC<FeedContentProps> = ({
  feed,
  loading,
  error,
  hasMore,
  loadingMore,
  loadMore,
}) => {
  const sentinelRef = useIntersectionLoader<HTMLLIElement>({
    enabled: hasMore,
    loading: loadingMore,
    onLoadMore: loadMore,
  });

  if (error) {
    return (
      <div
        role="alert"
        data-testid="feed-error"
        className="rounded bg-red-50 p-3 text-sm text-red-700"
      >
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div
        data-testid="feed-loading"
        className="py-8 text-center text-sm text-slate-400"
      >
        Loading feed…
      </div>
    );
  }

  if (feed.length === 0) {
    return (
      <div
        data-testid="feed-empty"
        className="py-8 text-center text-sm text-slate-400"
      >
        No items to show.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ul data-testid="feed-list" className="space-y-3">
        {feed.map((item) => (
          <FeedItemRow
            key={toFeedItemKey(item)}
            item={item}
          />
        ))}

        {hasMore && (
          <li
            ref={sentinelRef}
            data-testid="feed-load-sentinel"
            className="py-1 text-center text-xs text-slate-500"
            aria-hidden="true"
          >
            Scroll for more…
          </li>
        )}
      </ul>

      {loadingMore && (
        <p
          data-testid="feed-loading-more"
          className="text-center text-xs text-slate-500"
          aria-live="polite"
        >
          Loading more…
        </p>
      )}
    </div>
  );
};

// ---- Feed item renderer ----

interface FeedItemRowProps {
  readonly item: FeedItem;
}

const FeedItemRow: React.FC<FeedItemRowProps> = ({ item }) => {
  // NEWS_STORY cards own their click interaction (headline flip in-place).
  if (item.kind === 'NEWS_STORY') {
    return (
      <li data-testid={`feed-item-${item.topic_id}`}>
        <FeedItemCard item={item} />
      </li>
    );
  }

  return (
    <li data-testid={`feed-item-${item.topic_id}`}>
      <Link
        to="/hermes/$threadId"
        params={{ threadId: item.topic_id }}
        className="block no-underline"
        data-testid={`feed-link-${item.topic_id}`}
      >
        <FeedItemCard item={item} />
      </Link>
    </li>
  );
};

interface FeedItemCardProps {
  readonly item: FeedItem;
}

const FeedItemCard: React.FC<FeedItemCardProps> = ({ item }) => {
  switch (item.kind) {
    case 'NEWS_STORY':
      return <NewsCardWithRemoval item={item} />;
    case 'USER_TOPIC':
      return <TopicCard item={item} />;
    case 'SOCIAL_NOTIFICATION':
      return <SocialNotificationCard item={item} />;
    case 'ARTICLE':
      return <ArticleFeedCard item={item} />;
    case 'ACTION_RECEIPT':
      return <ReceiptFeedCard item={item} />;
    default:
      return (
        <article
          data-testid={`feed-item-unknown-${item.topic_id}`}
          className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Unsupported feed item kind.
        </article>
      );
  }
};

export default FeedShell;
