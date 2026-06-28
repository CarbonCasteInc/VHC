import React from 'react';
import type { FeedItem } from '@vh/data-model';
import { useIntersectionLoader } from '../../hooks/useIntersectionLoader';
import { NewsCardWithRemoval } from './NewsCardWithRemoval';
import { TopicCard } from './TopicCard';
import { SocialNotificationCard } from './SocialNotificationCard';
import { ArticleFeedCard } from '../docs/ArticleFeedCard';
import { ReceiptFeedCard } from './ReceiptFeedCard';
import { getFeedItemKey, getFeedItemTestIdSuffix } from '../../utils/feedItemIdentity';

export interface FeedContentProps {
  readonly feed: ReadonlyArray<FeedItem>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly loadMore: () => void;
  readonly emptyState?: FeedEmptyState;
  readonly errorActionLabel?: string;
  readonly onErrorAction?: () => void;
}

export interface FeedEmptyState {
  readonly title: string;
  readonly description?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

export const FeedContent: React.FC<FeedContentProps> = ({
  feed,
  loading,
  error,
  hasMore,
  loadingMore,
  loadMore,
  emptyState,
  errorActionLabel,
  onErrorAction,
}) => {
  const showLoadSentinel = hasMore && !loadingMore;
  const sentinelRef = useIntersectionLoader<HTMLLIElement>({
    enabled: showLoadSentinel,
    loading: loadingMore,
    onLoadMore: loadMore,
  });

  if (error) {
    const showErrorAction = Boolean(errorActionLabel && onErrorAction);
    return (
      <div
        role="alert"
        data-testid="feed-error"
        className="rounded-[1.5rem] border border-rose-200/80 bg-rose-50/90 p-4 text-sm text-rose-700 shadow-sm shadow-rose-900/5 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-semibold text-rose-900 dark:text-rose-50">Feed unavailable</p>
            <p className="mt-1 break-words">{error}</p>
          </div>
          {showErrorAction && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-rose-300/80 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 transition hover:border-rose-400 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/70 dark:text-rose-100 dark:hover:bg-rose-900"
              onClick={onErrorAction}
              data-testid="feed-error-action"
            >
              {errorActionLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        data-testid="feed-loading"
        role="status"
        aria-live="polite"
        className="rounded-[1.5rem] border border-slate-200/80 bg-white/85 px-4 py-5 text-sm text-slate-500 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300"
      >
        <p className="text-center font-medium">Loading feed...</p>
        <div className="mt-4 space-y-3" aria-hidden="true" data-testid="feed-loading-skeleton">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60"
            >
              <div className="h-3 w-24 rounded-full bg-slate-200 dark:bg-slate-800" />
              <div className="mt-3 h-4 w-4/5 rounded-full bg-slate-200 dark:bg-slate-800" />
              <div className="mt-2 h-3 w-3/5 rounded-full bg-slate-100 dark:bg-slate-800/70" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (feed.length === 0) {
    const title = emptyState?.title ?? 'No items to show.';
    const description = emptyState?.description;
    const showAction = emptyState?.actionLabel && emptyState.onAction;
    return (
      <div
        data-testid="feed-empty"
        className="rounded-[1.5rem] border border-dashed border-slate-200/90 bg-white/82 px-4 py-10 text-center text-sm text-slate-500 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
      >
        <p className="font-semibold text-slate-700 dark:text-slate-100">{title}</p>
        {description && <p className="mx-auto mt-2 max-w-sm">{description}</p>}
        {showAction && (
          <button
            type="button"
            className="mt-4 rounded-full border border-slate-300/80 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            onClick={emptyState.onAction}
          >
            {emptyState.actionLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul data-testid="feed-list" className="space-y-3">
        {feed.map((item) => (
          <FeedItemRow key={getFeedItemKey(item)} item={item} />
        ))}

        {showLoadSentinel && (
          <li
            ref={sentinelRef}
            data-testid="feed-load-sentinel"
            className="rounded-full border border-slate-200/80 bg-white/90 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400"
            aria-hidden="true"
          >
            Scroll for more…
          </li>
        )}
      </ul>

      {loadingMore && (
        <p
          data-testid="feed-loading-more"
          className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"
          aria-live="polite"
        >
          Loading more…
        </p>
      )}
    </div>
  );
};

interface FeedItemRowProps {
  readonly item: FeedItem;
}

const FeedItemRow: React.FC<FeedItemRowProps> = ({ item }) => {
  return (
    <li data-testid={`feed-item-${getFeedItemTestIdSuffix(item)}`}>
      <FeedItemCard item={item} />
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

export default FeedContent;
