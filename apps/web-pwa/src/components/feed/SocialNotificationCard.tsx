import React from 'react';
import type { FeedItem } from '@vh/data-model';
import type { SocialNotification } from '@vh/data-model';
import { getNotification, getAllNotifications } from '../../store/linkedSocial/accountStore';

export interface SocialNotificationCardProps {
  /** Discovery feed item; expected kind: SOCIAL_NOTIFICATION. */
  readonly item: FeedItem;
}

/* ── Platform display config ─────────────────────────────────── */

const PROVIDER_DISPLAY: Record<string, { label: string; icon: string; badgeClass: string }> = {
  x: { label: 'X', icon: '𝕏', badgeClass: 'bg-slate-100 text-slate-700' },
  reddit: { label: 'Reddit', icon: '🟠', badgeClass: 'bg-orange-100 text-orange-700' },
  youtube: { label: 'YouTube', icon: '▶️', badgeClass: 'bg-red-100 text-red-700' },
  tiktok: { label: 'TikTok', icon: '🎵', badgeClass: 'bg-pink-100 text-pink-700' },
  instagram: { label: 'Instagram', icon: '📷', badgeClass: 'bg-fuchsia-100 text-fuchsia-700' },
  other: { label: 'Social', icon: '🔗', badgeClass: 'bg-gray-100 text-gray-700' },
};

const DEFAULT_PLATFORM = { label: 'Social', icon: '🔗', badgeClass: 'bg-gray-100 text-gray-700' };

/* ── Mock fallback (kept for flag-off / data-unavailable path) ── */

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

/* ── Notification lookup ─────────────────────────────────────── */

/**
 * Find a SocialNotification matching a FeedItem's topic_id.
 * Looks up by notification ID first, then scans by topic_id.
 */
export function findNotificationForItem(topicId: string): SocialNotification | null {
  // Direct ID lookup (most notifications use topic_id as their ID)
  const direct = getNotification(topicId);
  if (direct) return direct;

  // Scan by topic_id field
  const all = getAllNotifications();
  return all.find((n) => n.topic_id === topicId) ?? null;
}

/* ── Card component ──────────────────────────────────────────── */

/**
 * Social notification card.
 * When real notification data is available (from linkedSocial store),
 * renders with actual provider info and preview text.
 * Falls back to mock presentation when data is unavailable.
 */
export const SocialNotificationCard: React.FC<SocialNotificationCardProps> = ({
  item,
}) => {
  const notification = findNotificationForItem(item.topic_id);

  if (notification) {
    return <RealNotificationCard item={item} notification={notification} />;
  }

  return <MockNotificationCard item={item} />;
};

/* ── Real data card ──────────────────────────────────────────── */

interface RealCardProps {
  readonly item: FeedItem;
  readonly notification: SocialNotification;
}

const RealNotificationCard: React.FC<RealCardProps> = ({ item, notification }) => {
  const platform = PROVIDER_DISPLAY[notification.providerId] ?? DEFAULT_PLATFORM;

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
        <span className="text-xs text-violet-800" data-testid={`social-card-type-${item.topic_id}`}>
          {notification.type}
        </span>
      </header>

      <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>

      {notification.previewText && (
        <p className="mt-1 text-sm text-slate-600" data-testid={`social-card-preview-${item.topic_id}`}>
          {notification.previewText}
        </p>
      )}

      {notification.linkUrl && (
        <a
          href={notification.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-violet-600 underline"
          data-testid={`social-card-link-${item.topic_id}`}
        >
          View on {platform.label}
        </a>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
        <span data-testid={`social-card-eye-${item.topic_id}`}>👁️ {item.eye}</span>
        <span data-testid={`social-card-lightbulb-${item.topic_id}`}>💡 {item.lightbulb}</span>
        <span data-testid={`social-card-comments-${item.topic_id}`}>💬 {item.comments}</span>
      </div>
    </article>
  );
};

/* ── Mock fallback card ──────────────────────────────────────── */

interface MockCardProps {
  readonly item: FeedItem;
}

const MockNotificationCard: React.FC<MockCardProps> = ({ item }) => {
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
