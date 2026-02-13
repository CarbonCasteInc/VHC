import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  notificationToFeedItem,
  getSocialFeedItems,
  isLinkedSocialFeedEnabled,
  _setFlagForTesting,
} from './socialFeedAdapter';
import {
  ingestNotification,
  dismissNotification,
  _resetStoreForTesting,
} from './accountStore';
import { createMockNotification, _resetMockCounter } from './mockFactories';

beforeEach(() => {
  _resetStoreForTesting();
  _resetMockCounter();
  _setFlagForTesting(null);
});

afterEach(() => {
  _setFlagForTesting(null);
  vi.unstubAllEnvs();
});

/* ── isLinkedSocialFeedEnabled ──────────────────────────────── */

describe('isLinkedSocialFeedEnabled', () => {
  it('returns false when flag is not set', () => {
    vi.stubEnv('VITE_LINKED_SOCIAL_ENABLED', '');
    expect(isLinkedSocialFeedEnabled()).toBe(false);
  });

  it('returns false when flag is "false"', () => {
    vi.stubEnv('VITE_LINKED_SOCIAL_ENABLED', 'false');
    expect(isLinkedSocialFeedEnabled()).toBe(false);
  });

  it('returns true when flag is "true"', () => {
    vi.stubEnv('VITE_LINKED_SOCIAL_ENABLED', 'true');
    expect(isLinkedSocialFeedEnabled()).toBe(true);
  });

  it('respects _setFlagForTesting override', () => {
    vi.stubEnv('VITE_LINKED_SOCIAL_ENABLED', 'false');
    _setFlagForTesting(true);
    expect(isLinkedSocialFeedEnabled()).toBe(true);
    _setFlagForTesting(null);
    expect(isLinkedSocialFeedEnabled()).toBe(false);
  });
});

/* ── notificationToFeedItem ─────────────────────────────────── */

describe('notificationToFeedItem', () => {
  it('converts a notification to a FeedItem with correct fields', () => {
    const notif = createMockNotification({
      topic_id: 'topic-42',
      title: 'Someone mentioned your topic',
      createdAt: 1_700_000_000_000,
    });

    const item = notificationToFeedItem(notif);
    expect(item.topic_id).toBe('topic-42');
    expect(item.kind).toBe('SOCIAL_NOTIFICATION');
    expect(item.title).toBe('Someone mentioned your topic');
    expect(item.created_at).toBe(1_700_000_000_000);
    expect(item.latest_activity_at).toBe(1_700_000_000_000);
    expect(item.hotness).toBe(0);
    expect(item.eye).toBe(0);
    expect(item.lightbulb).toBe(0);
    expect(item.comments).toBe(0);
  });

  it('uses seenAt as latest_activity_at when available', () => {
    const notif = createMockNotification({
      createdAt: 1_700_000_000_000,
      seenAt: 1_700_000_005_000,
    });

    const item = notificationToFeedItem(notif);
    expect(item.latest_activity_at).toBe(1_700_000_005_000);
  });
});

/* ── getSocialFeedItems ─────────────────────────────────────── */

describe('getSocialFeedItems', () => {
  it('returns empty array when flag is off', () => {
    _setFlagForTesting(false);
    ingestNotification(createMockNotification());
    expect(getSocialFeedItems()).toEqual([]);
  });

  it('returns feed items for ingested notifications when flag is on', () => {
    _setFlagForTesting(true);
    ingestNotification(createMockNotification({ topic_id: 'topic-1' }));
    ingestNotification(createMockNotification({ topic_id: 'topic-2' }));

    const items = getSocialFeedItems();
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe('SOCIAL_NOTIFICATION');
    expect(items[1].kind).toBe('SOCIAL_NOTIFICATION');
  });

  it('excludes dismissed notifications', () => {
    _setFlagForTesting(true);
    const n = ingestNotification(createMockNotification({ topic_id: 'topic-x' }));
    expect(n).not.toBeNull();
    dismissNotification(n!.id);

    expect(getSocialFeedItems()).toEqual([]);
  });

  it('returns empty array when no notifications exist', () => {
    _setFlagForTesting(true);
    expect(getSocialFeedItems()).toEqual([]);
  });

  it('returns items that pass FeedItem shape validation', () => {
    _setFlagForTesting(true);
    ingestNotification(createMockNotification({ topic_id: 'valid-topic' }));

    const items = getSocialFeedItems();
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(typeof item.topic_id).toBe('string');
    expect(typeof item.kind).toBe('string');
    expect(typeof item.title).toBe('string');
    expect(typeof item.created_at).toBe('number');
    expect(typeof item.latest_activity_at).toBe('number');
  });
});
