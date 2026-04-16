/**
 * ArticleFeedCard — feed card for ARTICLE-kind items in the discovery feed.
 *
 * Renders a published article summary in the unified feed.
 * Follows the same pattern as NewsCard / TopicCard / SocialNotificationCard.
 */

import React from 'react';
import type { FeedItem } from '@vh/data-model';
import { useFeedEngagementMetrics } from '../../hooks/useFeedEngagementMetrics';
import { useViewTracking } from '../../hooks/useViewTracking';
import { FeedEngagement } from '../feed/FeedEngagement';

export interface ArticleFeedCardProps {
  /** Discovery feed item; expected kind: ARTICLE. */
  readonly item: FeedItem;
}

function formatTimestamp(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    return 'unknown';
  }
  return new Date(timestampMs).toLocaleDateString();
}

/**
 * Article card for discovery feed ARTICLE items.
 * Rendered in the discovery feed (V2 feed is now the permanent path).
 */
export const ArticleFeedCard: React.FC<ArticleFeedCardProps> = ({ item }) => {
  const publishedDate = formatTimestamp(item.created_at);
  const engagement = useFeedEngagementMetrics({
    topicId: item.topic_id,
    eye: item.eye,
    lightbulb: item.lightbulb,
    comments: item.comments,
  });
  useViewTracking(item.topic_id, true);

  return (
    <article
      data-testid={`article-card-${item.topic_id}`}
      className="rounded-xl border border-teal-200 bg-teal-50 p-4 shadow-sm"
      aria-label="Article"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded-full bg-teal-200 px-2 py-0.5 text-xs font-semibold text-teal-800">
          📝 Article
        </span>
        <span
          className="text-xs text-teal-700"
          data-testid={`article-card-date-${item.topic_id}`}
        >
          {publishedDate}
        </span>
      </header>

      <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>

      <p className="mt-1 text-xs text-slate-600">
        Published article from the community.
      </p>

      <FeedEngagement
        topicId={item.topic_id}
        eye={engagement.eye}
        lightbulb={engagement.lightbulb}
        comments={engagement.comments}
        testIdPrefix="article-card"
        ariaLabel="Article engagement"
        className="mt-3"
        compact
      />
    </article>
  );
};

export default ArticleFeedCard;
