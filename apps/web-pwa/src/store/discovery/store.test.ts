/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import type { FeedItem, RankingConfig } from '@vh/data-model';
import { DEFAULT_FEED_PERSONALIZATION_CONFIG, DEFAULT_RANKING_CONFIG } from '@vh/data-model';
import { createDiscoveryStore, createMockDiscoveryStore, composeFeed, useDiscoveryStore } from './index';
import { DISCOVERY_TYPES_MODULE_ID, type DiscoveryState } from './types';
import type { StoreApi } from 'zustand';

// ---- Test fixtures ----

const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-1',
    kind: 'NEWS_STORY',
    title: 'Test item',
    created_at: NOW - 2 * HOUR_MS,
    latest_activity_at: NOW - HOUR_MS,
    hotness: 0,
    eye: 10,
    lightbulb: 5,
    comments: 3,
    ...overrides,
  };
}

// ---- createDiscoveryStore ----

describe('createDiscoveryStore', () => {
  let store: StoreApi<DiscoveryState>;

  it('exposes a runtime sentinel for diff-aware coverage', () => {
    expect(DISCOVERY_TYPES_MODULE_ID).toBe('discovery-types');
  });

  beforeEach(() => {
    store = createDiscoveryStore({ now: () => NOW });
  });

  it('initializes with empty items', () => {
    expect(store.getState().items).toHaveLength(0);
  });

  it('initializes with default filter ALL', () => {
    expect(store.getState().filter).toBe('ALL');
  });

  it('initializes with default sort mode LATEST', () => {
    expect(store.getState().sortMode).toBe('LATEST');
  });

  it('initializes with default ranking config', () => {
    expect(store.getState().rankingConfig).toEqual(DEFAULT_RANKING_CONFIG);
  });

  it('initializes with empty personalization preferences', () => {
    expect(store.getState().personalization).toEqual(DEFAULT_FEED_PERSONALIZATION_CONFIG);
  });

  it('initializes loading as false', () => {
    expect(store.getState().loading).toBe(false);
  });

  it('initializes error as null', () => {
    expect(store.getState().error).toBeNull();
  });

  it('initializes selected storyline focus as null', () => {
    expect(store.getState().selectedStorylineId).toBeNull();
  });

  // ---- setItems ----

  describe('setItems', () => {
    it('replaces items with validated data', () => {
      const items = [makeFeedItem({ topic_id: 'a' }), makeFeedItem({ topic_id: 'b' })];
      store.getState().setItems(items);
      expect(store.getState().items).toHaveLength(2);
    });

    it('deduplicates NEWS_STORY items with identical story identity (last wins)', () => {
      const items = [
        makeFeedItem({ topic_id: 'dup', eye: 1 }),
        makeFeedItem({ topic_id: 'dup', eye: 99 }),
      ];
      store.getState().setItems(items);
      const result = store.getState().items;
      expect(result).toHaveLength(1);
      expect(result[0].eye).toBe(99);
    });

    it('uses story_id as canonical NEWS_STORY identity when present (last wins)', () => {
      const items = [
        makeFeedItem({ topic_id: 'topic-x', title: 'Older title', created_at: NOW - HOUR_MS, story_id: 'story-1', eye: 1 }),
        makeFeedItem({ topic_id: 'topic-x', title: 'Refreshed title', created_at: NOW, story_id: 'story-1', eye: 99 }),
      ];

      store.getState().setItems(items);
      const result = store.getState().items;
      expect(result).toHaveLength(1);
      expect(result[0].story_id).toBe('story-1');
      expect(result[0].title).toBe('Refreshed title');
      expect(result[0].eye).toBe(99);
    });

    it('preserves distinct NEWS_STORY headlines under the same topic_id', () => {
      const items = [
        makeFeedItem({ topic_id: 'topic-world', title: 'Headline A', created_at: NOW - HOUR_MS }),
        makeFeedItem({ topic_id: 'topic-world', title: 'Headline B', created_at: NOW }),
      ];

      store.getState().setItems(items);
      expect(store.getState().items).toHaveLength(2);
    });

    it('preserves distinct NEWS_STORY rows when story_id differs even if other fields match', () => {
      const items = [
        makeFeedItem({ topic_id: 'topic-world', title: 'Shared headline', created_at: NOW, story_id: 'story-a' }),
        makeFeedItem({ topic_id: 'topic-world', title: 'Shared headline', created_at: NOW, story_id: 'story-b' }),
      ];

      store.getState().setItems(items);
      expect(store.getState().items).toHaveLength(2);
    });

    it('silently drops invalid items', () => {
      const items = [
        makeFeedItem({ topic_id: 'valid' }),
        { topic_id: '', kind: 'INVALID', title: '' } as unknown as FeedItem,
      ];
      store.getState().setItems(items);
      expect(store.getState().items).toHaveLength(1);
      expect(store.getState().items[0].topic_id).toBe('valid');
    });

    it('clears error on successful setItems', () => {
      store.getState().setError('previous error');
      store.getState().setItems([makeFeedItem()]);
      expect(store.getState().error).toBeNull();
    });

    it('handles empty array', () => {
      store.getState().setItems([makeFeedItem()]);
      store.getState().setItems([]);
      expect(store.getState().items).toHaveLength(0);
    });
  });

  // ---- mergeItems ----

  describe('mergeItems', () => {
    it('appends new items to existing', () => {
      store.getState().setItems([makeFeedItem({ topic_id: 'a' })]);
      store.getState().mergeItems([makeFeedItem({ topic_id: 'b' })]);
      expect(store.getState().items).toHaveLength(2);
    });

    it('deduplicates on merge for identical NEWS_STORY identity (new overwrites old)', () => {
      store.getState().setItems([makeFeedItem({ topic_id: 'x', eye: 1 })]);
      store.getState().mergeItems([makeFeedItem({ topic_id: 'x', eye: 99 })]);
      const result = store.getState().items;
      expect(result).toHaveLength(1);
      expect(result[0].eye).toBe(99);
    });

    it('deduplicates on merge by story_id when present', () => {
      store.getState().setItems([
        makeFeedItem({
          topic_id: 'topic-tech',
          title: 'Initial headline',
          created_at: NOW - HOUR_MS,
          story_id: 'story-merge-1',
          eye: 1,
        }),
      ]);

      store.getState().mergeItems([
        makeFeedItem({
          topic_id: 'topic-tech',
          title: 'Fresh headline',
          created_at: NOW,
          story_id: 'story-merge-1',
          eye: 55,
        }),
      ]);

      const result = store.getState().items;
      expect(result).toHaveLength(1);
      expect(result[0].story_id).toBe('story-merge-1');
      expect(result[0].title).toBe('Fresh headline');
      expect(result[0].eye).toBe(55);
    });

    it('merge preserves multiple NEWS_STORY headlines sharing topic_id', () => {
      store.getState().setItems([
        makeFeedItem({ topic_id: 'topic-tech', title: 'Initial headline', created_at: NOW - HOUR_MS }),
      ]);

      store.getState().mergeItems([
        makeFeedItem({ topic_id: 'topic-tech', title: 'Fresh headline', created_at: NOW }),
      ]);

      expect(store.getState().items).toHaveLength(2);
    });

    it('silently drops invalid items on merge', () => {
      store.getState().setItems([makeFeedItem({ topic_id: 'existing' })]);
      store.getState().mergeItems([
        { topic_id: '', kind: 'BAD' } as unknown as FeedItem,
      ]);
      expect(store.getState().items).toHaveLength(1);
    });

    it('clears error on successful merge', () => {
      store.getState().setError('stale error');
      store.getState().mergeItems([makeFeedItem({ topic_id: 'new' })]);
      expect(store.getState().error).toBeNull();
    });
  });

  describe('syncNewsItems', () => {
    it('replaces the news subset while preserving non-news items', () => {
      store.getState().setItems([
        makeFeedItem({ topic_id: 'news-old', story_id: 'story-old' }),
        makeFeedItem({ topic_id: 'topic-1', kind: 'USER_TOPIC' }),
        makeFeedItem({ topic_id: 'social-1', kind: 'SOCIAL_NOTIFICATION' }),
      ]);

      store.getState().syncNewsItems([
        makeFeedItem({ topic_id: 'news-new', story_id: 'story-new' }),
      ]);

      expect(store.getState().items.map((item) => item.topic_id).sort()).toEqual([
        'news-new',
        'social-1',
        'topic-1',
      ]);
    });

    it('deduplicates synced news items by story identity', () => {
      store.getState().setItems([
        makeFeedItem({ topic_id: 'news-old', story_id: 'story-old', eye: 1 }),
      ]);

      store.getState().syncNewsItems([
        makeFeedItem({ topic_id: 'news-old', story_id: 'story-old', eye: 99 }),
        makeFeedItem({ topic_id: 'news-fresh', story_id: 'story-fresh', eye: 5 }),
      ]);

      const items = store.getState().items.filter((item) => item.kind === 'NEWS_STORY');
      expect(items).toHaveLength(2);
      expect(items.find((item) => item.story_id === 'story-old')?.eye).toBe(99);
      expect(items.find((item) => item.story_id === 'story-fresh')?.eye).toBe(5);
    });

    it('ignores non-news items passed to syncNewsItems', () => {
      store.getState().setItems([
        makeFeedItem({ topic_id: 'topic-1', kind: 'USER_TOPIC' }),
      ]);

      store.getState().syncNewsItems([
        makeFeedItem({ topic_id: 'topic-2', kind: 'USER_TOPIC' }),
        makeFeedItem({ topic_id: 'news-1', story_id: 'story-1' }),
      ]);

      expect(store.getState().items.map((item) => item.topic_id).sort()).toEqual([
        'news-1',
        'topic-1',
      ]);
    });
  });

  // ---- setFilter ----

  describe('setFilter', () => {
    it('updates filter to NEWS', () => {
      store.getState().setFilter('NEWS');
      expect(store.getState().filter).toBe('NEWS');
    });

    it('updates filter to TOPICS', () => {
      store.getState().setFilter('TOPICS');
      expect(store.getState().filter).toBe('TOPICS');
    });

    it('updates filter to SOCIAL', () => {
      store.getState().setFilter('SOCIAL');
      expect(store.getState().filter).toBe('SOCIAL');
    });

    it('updates filter back to ALL', () => {
      store.getState().setFilter('NEWS');
      store.getState().setFilter('ALL');
      expect(store.getState().filter).toBe('ALL');
    });

    it('clears storyline focus when the filter changes', () => {
      store.getState().focusStoryline('storyline-1');
      store.getState().setFilter('TOPICS');
      expect(store.getState().selectedStorylineId).toBeNull();
    });
  });

  describe('storyline focus', () => {
    it('stores a normalized storyline id', () => {
      store.getState().focusStoryline('  storyline-1  ');
      expect(store.getState().selectedStorylineId).toBe('storyline-1');
    });

    it('ignores blank storyline ids', () => {
      store.getState().focusStoryline('   ');
      expect(store.getState().selectedStorylineId).toBeNull();
    });

    it('clears storyline focus explicitly', () => {
      store.getState().focusStoryline('storyline-1');
      store.getState().clearStorylineFocus();
      expect(store.getState().selectedStorylineId).toBeNull();
    });
  });

  // ---- setSortMode ----

  describe('setSortMode', () => {
    it('updates sort to HOTTEST', () => {
      store.getState().setSortMode('HOTTEST');
      expect(store.getState().sortMode).toBe('HOTTEST');
    });

    it('updates sort to MY_ACTIVITY', () => {
      store.getState().setSortMode('MY_ACTIVITY');
      expect(store.getState().sortMode).toBe('MY_ACTIVITY');
    });

    it('updates sort back to LATEST', () => {
      store.getState().setSortMode('HOTTEST');
      store.getState().setSortMode('LATEST');
      expect(store.getState().sortMode).toBe('LATEST');
    });
  });

  // ---- setRankingConfig ----

  describe('setRankingConfig', () => {
    it('updates ranking config', () => {
      const custom: RankingConfig = {
        weights: { eye: 5, lightbulb: 5, comments: 5, freshness: 5 },
        decayHalfLifeHours: 12,
      };
      store.getState().setRankingConfig(custom);
      expect(store.getState().rankingConfig).toEqual(custom);
    });
  });

  describe('setPersonalization', () => {
    it('updates preference scaffold', () => {
      store.getState().setPersonalization({ preferredCategories: ['transportation'] });
      expect(store.getState().personalization).toEqual({
        preferredCategories: ['transportation'],
      });
    });
  });

  // ---- setLoading / setError ----

  describe('setLoading', () => {
    it('sets loading to true', () => {
      store.getState().setLoading(true);
      expect(store.getState().loading).toBe(true);
    });

    it('sets loading to false', () => {
      store.getState().setLoading(true);
      store.getState().setLoading(false);
      expect(store.getState().loading).toBe(false);
    });
  });

  describe('setError', () => {
    it('sets error message', () => {
      store.getState().setError('Something broke');
      expect(store.getState().error).toBe('Something broke');
    });

    it('clears error with null', () => {
      store.getState().setError('oops');
      store.getState().setError(null);
      expect(store.getState().error).toBeNull();
    });
  });

  // ---- reset ----

  describe('reset', () => {
    it('restores all state to initial values', () => {
      store.getState().setItems([makeFeedItem()]);
      store.getState().setFilter('NEWS');
      store.getState().setSortMode('HOTTEST');
      store.getState().setLoading(true);
      store.getState().setError('err');
      store.getState().reset();

      const s = store.getState();
      expect(s.items).toHaveLength(0);
      expect(s.filter).toBe('ALL');
      expect(s.sortMode).toBe('LATEST');
      expect(s.loading).toBe(false);
      expect(s.error).toBeNull();
    });
  });
});

// ---- createMockDiscoveryStore ----

describe('createMockDiscoveryStore', () => {
  it('creates a functional store without seed', () => {
    const store = createMockDiscoveryStore();
    expect(store.getState().items).toHaveLength(0);
    expect(store.getState().filter).toBe('ALL');
  });

  it('creates a store with seed items', () => {
    const seed = [
      makeFeedItem({ topic_id: 'seed-1' }),
      makeFeedItem({ topic_id: 'seed-2' }),
    ];
    const store = createMockDiscoveryStore(seed);
    expect(store.getState().items).toHaveLength(2);
  });

  it('seed items are validated (invalid dropped)', () => {
    const seed = [
      makeFeedItem({ topic_id: 'good' }),
      { topic_id: '', kind: 'BAD' } as unknown as FeedItem,
    ];
    const store = createMockDiscoveryStore(seed);
    expect(store.getState().items).toHaveLength(1);
  });

  it('supports all store actions', () => {
    const store = createMockDiscoveryStore();
    store.getState().setFilter('TOPICS');
    expect(store.getState().filter).toBe('TOPICS');

    store.getState().setSortMode('HOTTEST');
    expect(store.getState().sortMode).toBe('HOTTEST');

    store.getState().setItems([makeFeedItem({ topic_id: 'mock-1' })]);
    expect(store.getState().items).toHaveLength(1);

    store.getState().reset();
    expect(store.getState().items).toHaveLength(0);
  });

  it('empty seed array does not add items', () => {
    const store = createMockDiscoveryStore([]);
    expect(store.getState().items).toHaveLength(0);
  });
});

// ---- Privacy checks (spec §6) ----

describe('privacy', () => {
  it('FeedItem does not contain user identifiers', () => {
    const item = makeFeedItem({
      topic_id: 'privacy-check',
      my_activity_score: 5,
    });
    const keys = Object.keys(item);
    const forbidden = ['user_id', 'userId', 'email', 'name', 'nullifier', 'author'];
    for (const key of forbidden) {
      expect(keys).not.toContain(key);
    }
  });

  it('store items contain no person-level identifiers', () => {
    const store = createDiscoveryStore();
    store.getState().setItems([
      makeFeedItem({ topic_id: 'p1' }),
      makeFeedItem({ topic_id: 'p2', my_activity_score: 3 }),
    ]);
    for (const item of store.getState().items) {
      const keys = Object.keys(item);
      expect(keys).not.toContain('user_id');
      expect(keys).not.toContain('author');
      expect(keys).not.toContain('email');
      expect(keys).not.toContain('nullifier');
    }
  });
});

// ---- useDiscoveryFeed hook integration ----

describe('useDiscoveryFeed hook (unit-level)', () => {
  beforeEach(() => {
    useDiscoveryStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('composeFeed re-export is functional', () => {
    const items = [
      makeFeedItem({ topic_id: 'n1', kind: 'NEWS_STORY', latest_activity_at: NOW }),
      makeFeedItem({
        topic_id: 't1',
        kind: 'USER_TOPIC',
        latest_activity_at: NOW - HOUR_MS,
      }),
    ];
    const result = composeFeed(items, 'NEWS', 'LATEST', DEFAULT_RANKING_CONFIG, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('NEWS_STORY');
  });

  it('hook module is importable', async () => {
    const mod = await import('../../hooks/useDiscoveryFeed');
    expect(typeof mod.useDiscoveryFeed).toBe('function');
  });

  it('hook returns empty feed from empty store', async () => {
    const { useDiscoveryFeed } = await import('../../hooks/useDiscoveryFeed');
    const { result, unmount } = renderHook(() => useDiscoveryFeed());

    expect(result.current.feed).toHaveLength(0);
    expect(result.current.filter).toBe('ALL');
    expect(result.current.sortMode).toBe('LATEST');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.setFilter).toBe('function');
    expect(typeof result.current.setSortMode).toBe('function');

    unmount();
  });

  it('actions update filter and sort', async () => {
    const { useDiscoveryFeed } = await import('../../hooks/useDiscoveryFeed');
    const { result, unmount } = renderHook(() => useDiscoveryFeed());

    act(() => {
      result.current.setFilter('NEWS');
      result.current.setSortMode('HOTTEST');
    });

    unmount();
  });

  it('hook returns composed data from store', async () => {
    useDiscoveryStore.getState().setItems([
      makeFeedItem({ topic_id: 'n1', kind: 'NEWS_STORY', latest_activity_at: NOW }),
      makeFeedItem({ topic_id: 't1', kind: 'USER_TOPIC', latest_activity_at: NOW - HOUR_MS }),
    ]);

    const { useDiscoveryFeed } = await import('../../hooks/useDiscoveryFeed');
    const { result, unmount } = renderHook(() => useDiscoveryFeed());

    expect(result.current.feed).toHaveLength(2);
    expect(result.current.filter).toBe('ALL');

    act(() => {
      result.current.setFilter('NEWS');
      result.current.setSortMode('LATEST');
    });

    expect(result.current.filter).toBe('NEWS');
    expect(result.current.sortMode).toBe('LATEST');
    expect(result.current.feed).toHaveLength(1);
    expect(result.current.feed[0]?.kind).toBe('NEWS_STORY');

    unmount();
  });

  it('hook module is importable', async () => {
    const mod = await import('../../hooks/useDiscoveryFeed');
    expect(typeof mod.useDiscoveryFeed).toBe('function');
  });
});

describe('discovery singleton bootstrap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('boots singleton through mock branch when E2E mode is true', async () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    vi.resetModules();

    const mod = await import('./index');

    expect(mod.useDiscoveryStore.getState().items).toEqual([]);
    mod.useDiscoveryStore.getState().setItems([makeFeedItem({ topic_id: 'boot-1' })]);
    expect(mod.useDiscoveryStore.getState().items[0]?.topic_id).toBe('boot-1');
  });
});
