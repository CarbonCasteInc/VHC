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
}

export const FeedContent: React.FC<FeedContentProps> = ({
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
        className="rounded-[1.5rem] border border-rose-200/80 bg-rose-50/90 p-4 text-sm text-rose-700 shadow-sm shadow-rose-900/5 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100"
      >
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div
        data-testid="feed-loading"
        className="rounded-[1.5rem] border border-slate-200/80 bg-white/85 px-4 py-10 text-center text-sm text-slate-500 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300"
      >
        Loading feed…
      </div>
    );
  }

  if (feed.length === 0) {
    return (
      <div
        data-testid="feed-empty"
        className="rounded-[1.5rem] border border-dashed border-slate-200/90 bg-white/82 px-4 py-10 text-center text-sm text-slate-500 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
      >
        No items to show.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul data-testid="feed-list" className="space-y-5">
        {feed.map((item) => (
          <FeedItemRow key={getFeedItemKey(item)} item={item} />
        ))}

        {hasMore && (
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
