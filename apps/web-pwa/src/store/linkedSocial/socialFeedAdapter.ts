/**
 * Social notification → FeedItem adapter.
 *
 * Converts ingested SocialNotification records into FeedItem format
 * for injection into the discovery feed composition layer.
 *
 * Feature-gated behind VITE_LINKED_SOCIAL_ENABLED (default false).
 */

import type { FeedItem, SocialNotification } from '@vh/data-model';
import { getAllNotifications } from './accountStore';

/* ── Feature flag ───────────────────────────────────────────── */

let _flagOverride: boolean | null = null;

/** Override the feature flag for testing. Pass null to restore default. */
export function _setFlagForTesting(value: boolean | null): void {
  _flagOverride = value;
}

export function isLinkedSocialFeedEnabled(): boolean {
  if (_flagOverride !== null) return _flagOverride;
  /* v8 ignore next 2 -- browser runtime resolves import.meta differently */
  const viteValue = (
    import.meta as unknown as { env?: { VITE_LINKED_SOCIAL_ENABLED?: string } }
  ).env?.VITE_LINKED_SOCIAL_ENABLED;
  /* v8 ignore next 4 -- browser runtime may not expose process */
  const nodeValue =
    typeof process !== 'undefined'
      ? process.env?.VITE_LINKED_SOCIAL_ENABLED
      : undefined;
  /* v8 ignore next 1 -- ?? fallback only reachable in-browser */
  return (nodeValue ?? viteValue) === 'true';
}

/* ── Adapter ────────────────────────────────────────────────── */

/**
 * Convert a SocialNotification to a FeedItem.
 * Maps notification fields to feed-visible fields only.
 */
export function notificationToFeedItem(n: SocialNotification): FeedItem {
  return {
    topic_id: n.topic_id,
    kind: 'SOCIAL_NOTIFICATION',
    title: n.title,
    created_at: n.createdAt,
    latest_activity_at: n.seenAt ?? n.createdAt,
    hotness: 0,
    eye: 0,
    lightbulb: 0,
    comments: 0,
  };
}

/**
 * Get all social notifications as FeedItems.
 * Returns empty array when VITE_LINKED_SOCIAL_ENABLED is off.
 * Excludes dismissed notifications.
 */
export function getSocialFeedItems(): ReadonlyArray<FeedItem> {
  if (!isLinkedSocialFeedEnabled()) return [];

  return getAllNotifications()
    .filter((n) => n.dismissedAt == null)
    .map(notificationToFeedItem);
}
