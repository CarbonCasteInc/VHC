/**
 * ArticleFeedCard — feed card for ARTICLE-kind items in the discovery feed.
 *
 * Renders a published article summary in the unified feed.
 * Follows the same pattern as NewsCard / TopicCard / SocialNotificationCard.
 */

import React from 'react';
import type { FeedItem } from '@vh/data-model';

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
 * Feature-gated at the feed level (VITE_FEED_V2_ENABLED).
 */
export const ArticleFeedCard: React.FC<ArticleFeedCardProps> = ({ item }) => {
  const publishedDate = formatTimestamp(item.created_at);

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

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
        <span data-testid={`article-card-eye-${item.topic_id}`}>
          👁️ {item.eye}
        </span>
        <span data-testid={`article-card-lightbulb-${item.topic_id}`}>
          💡 {item.lightbulb}
        </span>
        <span data-testid={`article-card-comments-${item.topic_id}`}>
          💬 {item.comments}
        </span>
      </div>
    </article>
  );
};

export default ArticleFeedCard;
