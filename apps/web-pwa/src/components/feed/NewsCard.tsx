import React from 'react';
import type { FeedItem } from '@vh/data-model';

export interface NewsCardProps {
  /** Discovery feed item; expected kind: NEWS_STORY. */
  readonly item: FeedItem;
}

function formatIsoTimestamp(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    return 'unknown';
  }
  return new Date(timestampMs).toISOString();
}

function formatHotness(hotness: number): string {
  if (!Number.isFinite(hotness)) {
    return '0.00';
  }
  return hotness.toFixed(2);
}

/**
 * Clustered story card for discovery feed NEWS_STORY items.
 *
 * Spec context: docs/specs/spec-topic-discovery-ranking-v0.md
 */
export const NewsCard: React.FC<NewsCardProps> = ({ item }) => {
  const latestActivity = formatIsoTimestamp(item.latest_activity_at);
  const createdAt = formatIsoTimestamp(item.created_at);

  return (
    <article
      data-testid={`news-card-${item.topic_id}`}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-label="News story"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
          News
        </span>
        <span className="text-xs text-slate-500" data-testid={`news-card-hotness-${item.topic_id}`}>
          Hotness {formatHotness(item.hotness)}
        </span>
      </header>

      <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>

      <p className="mt-1 text-xs text-slate-500">
        Created {createdAt} • Updated {latestActivity}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
        <span data-testid={`news-card-eye-${item.topic_id}`}>👁️ {item.eye}</span>
        <span data-testid={`news-card-lightbulb-${item.topic_id}`}>💡 {item.lightbulb}</span>
        <span data-testid={`news-card-comments-${item.topic_id}`}>💬 {item.comments}</span>
      </div>
    </article>
  );
};

export default NewsCard;
