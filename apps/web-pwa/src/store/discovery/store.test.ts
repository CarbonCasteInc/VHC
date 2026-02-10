import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import type { FeedItem, RankingConfig } from '@vh/data-model';
import { DEFAULT_RANKING_CONFIG } from '@vh/data-model';
import { createDiscoveryStore, createMockDiscoveryStore, composeFeed } from './index';
import type { DiscoveryState } from './types';
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

  it('initializes loading as false', () => {
    expect(store.getState().loading).toBe(false);
  });

  it('initializes error as null', () => {
    expect(store.getState().error).toBeNull();
  });

  // ---- setItems ----

  describe('setItems', () => {
    it('replaces items with validated data', () => {
      const items = [makeFeedItem({ topic_id: 'a' }), makeFeedItem({ topic_id: 'b' })];
      store.getState().setItems(items);
      expect(store.getState().items).toHaveLength(2);
    });

    it('deduplicates items by topic_id (last wins)', () => {
      const items = [
        makeFeedItem({ topic_id: 'dup', eye: 1 }),
        makeFeedItem({ topic_id: 'dup', eye: 99 }),
      ];
      store.getState().setItems(items);
      const result = store.getState().items;
      expect(result).toHaveLength(1);
      expect(result[0].eye).toBe(99);
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

    it('deduplicates on merge (new overwrites old)', () => {
      store.getState().setItems([makeFeedItem({ topic_id: 'x', eye: 1 })]);
      store.getState().mergeItems([makeFeedItem({ topic_id: 'x', eye: 99 })]);
      const result = store.getState().items;
      expect(result).toHaveLength(1);
      expect(result[0].eye).toBe(99);
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
    vi.stubEnv('VITE_FEED_V2_ENABLED', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('hook returns noop result when flag is off', async () => {
    vi.stubEnv('VITE_FEED_V2_ENABLED', 'false');
    const { useDiscoveryFeed } = await import('../../hooks/useDiscoveryFeed');
    const result = useDiscoveryFeed();
    expect(result.feed).toHaveLength(0);
    expect(result.filter).toBe('ALL');
    expect(result.sortMode).toBe('LATEST');
    expect(result.loading).toBe(false);
    expect(result.error).toBeNull();
    expect(typeof result.setFilter).toBe('function');
    expect(typeof result.setSortMode).toBe('function');
  });

  it('noop actions do not throw', async () => {
    vi.stubEnv('VITE_FEED_V2_ENABLED', 'false');
    const { useDiscoveryFeed } = await import('../../hooks/useDiscoveryFeed');
    const result = useDiscoveryFeed();
    result.setFilter('NEWS');
    result.setSortMode('HOTTEST');
  });
});
