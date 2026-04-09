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
          <FeedItemRow key={getFeedItemKey(item)} item={item} />
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
