import React from 'react';
import type { FeedItem } from '@vh/data-model';

export interface SocialNotificationCardProps {
  /** Discovery feed item; expected kind: SOCIAL_NOTIFICATION. */
  readonly item: FeedItem;
}

const PLATFORM_MOCKS = [
  { label: 'Bluesky', icon: '🦋', badgeClass: 'bg-sky-100 text-sky-700' },
  { label: 'Mastodon', icon: '🐘', badgeClass: 'bg-indigo-100 text-indigo-700' },
  { label: 'Nostr', icon: '⚡', badgeClass: 'bg-violet-100 text-violet-700' },
] as const;

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function pickMockPlatform(topicId: string): (typeof PLATFORM_MOCKS)[number] {
  if (!topicId) {
    return PLATFORM_MOCKS[0];
  }
  const index = stableHash(topicId) % PLATFORM_MOCKS.length;
  return PLATFORM_MOCKS[index as 0 | 1 | 2];
}

export function createMockHandle(topicId: string): string {
  const sanitized = topicId.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (sanitized.length === 0) {
    return '@community';
  }
  return `@${sanitized.slice(0, 12)}`;
}

/**
 * Social notification shell card.
 * Wave 1 boundary: mock presentation only, no OAuth/token or live ingestion.
 */
export const SocialNotificationCard: React.FC<SocialNotificationCardProps> = ({
  item,
}) => {
  const platform = pickMockPlatform(item.topic_id);
  const handle = createMockHandle(item.topic_id);

  return (
    <article
      data-testid={`social-card-${item.topic_id}`}
      className="rounded-xl border border-violet-200 bg-violet-50 p-4 shadow-sm"
      aria-label="Social notification"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span
          data-testid={`social-card-platform-${item.topic_id}`}
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${platform.badgeClass}`}
        >
          {platform.icon} {platform.label}
        </span>
        <span className="text-xs text-violet-800">Mock social preview</span>
      </header>

      <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>

      <p className="mt-1 text-xs text-slate-600" data-testid={`social-card-handle-${item.topic_id}`}>
        {handle} mentioned this topic.
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
        <span data-testid={`social-card-eye-${item.topic_id}`}>👁️ {item.eye}</span>
        <span data-testid={`social-card-lightbulb-${item.topic_id}`}>💡 {item.lightbulb}</span>
        <span data-testid={`social-card-comments-${item.topic_id}`}>💬 {item.comments}</span>
      </div>
    </article>
  );
};

export default SocialNotificationCard;
