import React from 'react';
import type { FeedItem } from '@vh/data-model';

export interface TopicCardProps {
  /** Discovery feed item; expected kind: USER_TOPIC. */
  readonly item: FeedItem;
}

function formatActivityScore(score: number | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return '0.0';
  }
  return score.toFixed(1);
}

/**
 * User topic/thread card for discovery feed USER_TOPIC items.
 */
export const TopicCard: React.FC<TopicCardProps> = ({ item }) => {
  const myActivity = formatActivityScore(item.my_activity_score);

  return (
    <article
      data-testid={`topic-card-${item.topic_id}`}
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm"
      aria-label="User topic"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-800">
          Topic
        </span>
        <span className="text-xs text-emerald-900" data-testid={`topic-card-activity-${item.topic_id}`}>
          My activity {myActivity}
        </span>
      </header>

      <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>

      <p className="mt-1 text-xs text-slate-600">Active thread with community responses.</p>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
        <span data-testid={`topic-card-eye-${item.topic_id}`}>👁️ {item.eye}</span>
        <span data-testid={`topic-card-lightbulb-${item.topic_id}`}>💡 {item.lightbulb}</span>
        <span data-testid={`topic-card-comments-${item.topic_id}`}>💬 {item.comments}</span>
      </div>
    </article>
  );
};

export default TopicCard;
