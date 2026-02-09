import { describe, expect, it } from 'vitest';
import type { FeedItem, RankingConfig } from '@vh/data-model';
import { DEFAULT_RANKING_CONFIG } from '@vh/data-model';
import {
  batchComputeHotness,
  computeHotness,
  createWeights,
  decayLambda,
  freshnessDecay,
  sortByHottest,
  sortByLatest,
  sortByMyActivity,
} from './HotnessRanker';

const NOW = 1_700_000_000_000; // pinned reference time

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-1',
    kind: 'NEWS_STORY',
    title: 'Test item',
    created_at: NOW - 7_200_000,
    latest_activity_at: NOW - 3_600_000,
    hotness: 0,
    eye: 10,
    lightbulb: 5,
    comments: 3,
    ...overrides,
  };
}

describe('decayLambda', () => {
  it('computes correct lambda for 48h half-life', () => {
    const lambda = decayLambda(48);
    expect(lambda).toBeCloseTo(Math.LN2 / 48, 10);
  });

  it('computes correct lambda for 24h half-life', () => {
    const lambda = decayLambda(24);
    expect(lambda).toBeCloseTo(Math.LN2 / 24, 10);
  });

  it('larger half-life produces smaller lambda', () => {
    expect(decayLambda(96)).toBeLessThan(decayLambda(48));
  });
});

describe('freshnessDecay', () => {
  it('returns 1.0 for perfectly fresh item (age = 0)', () => {
    expect(freshnessDecay(NOW, NOW, 48)).toBe(1.0);
  });

  it('returns ~0.5 at exactly one half-life', () => {
    const halfLifeMs = 48 * 3_600_000;
    const result = freshnessDecay(NOW - halfLifeMs, NOW, 48);
    expect(result).toBeCloseTo(0.5, 10);
  });

  it('returns ~0.25 at two half-lives', () => {
    const twoHalfLives = 2 * 48 * 3_600_000;
    const result = freshnessDecay(NOW - twoHalfLives, NOW, 48);
    expect(result).toBeCloseTo(0.25, 10);
  });

  it('returns 1.0 for future activity (clamped age = 0)', () => {
    expect(freshnessDecay(NOW + 1_000, NOW, 48)).toBe(1.0);
  });

  it('is deterministic', () => {
    const a = freshnessDecay(NOW - 5_000_000, NOW, 48);
    const b = freshnessDecay(NOW - 5_000_000, NOW, 48);
    expect(a).toBe(b);
  });

  it('older items decay more', () => {
    const fresh = freshnessDecay(NOW - 1_000_000, NOW, 48);
    const stale = freshnessDecay(NOW - 10_000_000, NOW, 48);
    expect(fresh).toBeGreaterThan(stale);
  });
});

describe('computeHotness', () => {
  const config = DEFAULT_RANKING_CONFIG;

  it('is deterministic (same inputs → same output)', () => {
    const item = makeFeedItem();
    const a = computeHotness(item, NOW, config);
    const b = computeHotness(item, NOW, config);
    expect(a).toBe(b);
  });

  it('returns finite number', () => {
    const result = computeHotness(makeFeedItem(), NOW, config);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('higher engagement produces higher hotness (all else equal)', () => {
    const low = computeHotness(makeFeedItem({ eye: 1, lightbulb: 1, comments: 1 }), NOW, config);
    const high = computeHotness(
      makeFeedItem({ eye: 100, lightbulb: 100, comments: 100 }),
      NOW,
      config,
    );
    expect(high).toBeGreaterThan(low);
  });

  it('fresher items score higher (all else equal)', () => {
    const fresh = computeHotness(makeFeedItem({ latest_activity_at: NOW }), NOW, config);
    const stale = computeHotness(
      makeFeedItem({ latest_activity_at: NOW - 7 * 24 * 3_600_000 }),
      NOW,
      config,
    );
    expect(fresh).toBeGreaterThan(stale);
  });

  it('zero engagement still gets freshness score', () => {
    const result = computeHotness(
      makeFeedItem({ eye: 0, lightbulb: 0, comments: 0, latest_activity_at: NOW }),
      NOW,
      config,
    );
    expect(result).toBeGreaterThan(0);
    // Should equal just w_freshness * 1.0 = 3.0
    expect(result).toBeCloseTo(config.weights.freshness, 10);
  });

  it('respects custom weights', () => {
    const eyeOnly: RankingConfig = {
      weights: { eye: 10.0, lightbulb: 0, comments: 0, freshness: 0 },
      decayHalfLifeHours: 48,
    };
    const item = makeFeedItem({ eye: 10, lightbulb: 100, comments: 100 });
    const result = computeHotness(item, NOW, eyeOnly);
    expect(result).toBeCloseTo(10.0 * Math.log1p(10), 10);
  });

  it('respects custom decay half-life', () => {
    const shortDecay: RankingConfig = {
      weights: { eye: 0, lightbulb: 0, comments: 0, freshness: 1 },
      decayHalfLifeHours: 1,
    };
    const longDecay: RankingConfig = {
      weights: { eye: 0, lightbulb: 0, comments: 0, freshness: 1 },
      decayHalfLifeHours: 1000,
    };
    const item = makeFeedItem({ latest_activity_at: NOW - 3_600_000 });
    const short = computeHotness(item, NOW, shortDecay);
    const long = computeHotness(item, NOW, longDecay);
    expect(short).toBeLessThan(long);
  });

  it('matches manual calculation', () => {
    const item = makeFeedItem({
      eye: 10,
      lightbulb: 5,
      comments: 3,
      latest_activity_at: NOW,
    });
    const w = config.weights;
    const expected =
      w.eye * Math.log1p(10) +
      w.lightbulb * Math.log1p(5) +
      w.comments * Math.log1p(3) +
      w.freshness * 1.0;
    expect(computeHotness(item, NOW, config)).toBeCloseTo(expected, 10);
  });
});

describe('sortByLatest', () => {
  it('sorts by latest_activity_at descending', () => {
    const items = [
      makeFeedItem({ topic_id: 'a', latest_activity_at: 100 }),
      makeFeedItem({ topic_id: 'b', latest_activity_at: 300 }),
      makeFeedItem({ topic_id: 'c', latest_activity_at: 200 }),
    ];
    const sorted = sortByLatest(items);
    expect(sorted.map((i) => i.topic_id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate original array', () => {
    const items = [
      makeFeedItem({ topic_id: 'a', latest_activity_at: 100 }),
      makeFeedItem({ topic_id: 'b', latest_activity_at: 200 }),
    ];
    const copy = [...items];
    sortByLatest(items);
    expect(items).toEqual(copy);
  });

  it('handles empty array', () => {
    expect(sortByLatest([])).toEqual([]);
  });

  it('handles single item', () => {
    const items = [makeFeedItem()];
    expect(sortByLatest(items)).toHaveLength(1);
  });
});

describe('sortByHottest', () => {
  it('sorts by hotness descending', () => {
    const items = [
      makeFeedItem({ topic_id: 'a', hotness: 1.0 }),
      makeFeedItem({ topic_id: 'b', hotness: 3.0 }),
      makeFeedItem({ topic_id: 'c', hotness: 2.0 }),
    ];
    const sorted = sortByHottest(items);
    expect(sorted.map((i) => i.topic_id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate original array', () => {
    const items = [
      makeFeedItem({ topic_id: 'a', hotness: 5 }),
      makeFeedItem({ topic_id: 'b', hotness: 10 }),
    ];
    const copy = [...items];
    sortByHottest(items);
    expect(items).toEqual(copy);
  });

  it('handles empty array', () => {
    expect(sortByHottest([])).toEqual([]);
  });
});

describe('sortByMyActivity', () => {
  it('sorts by my_activity_score descending', () => {
    const items = [
      makeFeedItem({ topic_id: 'a', my_activity_score: 1.0 }),
      makeFeedItem({ topic_id: 'b', my_activity_score: 5.0 }),
      makeFeedItem({ topic_id: 'c', my_activity_score: 3.0 }),
    ];
    const sorted = sortByMyActivity(items);
    expect(sorted.map((i) => i.topic_id)).toEqual(['b', 'c', 'a']);
  });

  it('pushes items without score to end', () => {
    const items = [
      makeFeedItem({ topic_id: 'a' }),
      makeFeedItem({ topic_id: 'b', my_activity_score: 2.0 }),
      makeFeedItem({ topic_id: 'c' }),
    ];
    const sorted = sortByMyActivity(items);
    expect(sorted[0].topic_id).toBe('b');
  });

  it('does not mutate original array', () => {
    const items = [
      makeFeedItem({ topic_id: 'a', my_activity_score: 1 }),
      makeFeedItem({ topic_id: 'b', my_activity_score: 2 }),
    ];
    const copy = [...items];
    sortByMyActivity(items);
    expect(items).toEqual(copy);
  });

  it('handles empty array', () => {
    expect(sortByMyActivity([])).toEqual([]);
  });

  it('handles all items missing score', () => {
    const items = [makeFeedItem({ topic_id: 'a' }), makeFeedItem({ topic_id: 'b' })];
    const sorted = sortByMyActivity(items);
    expect(sorted).toHaveLength(2);
  });
});

describe('batchComputeHotness', () => {
  const config = DEFAULT_RANKING_CONFIG;

  it('returns new array with updated hotness', () => {
    const items = [makeFeedItem({ topic_id: 'a' }), makeFeedItem({ topic_id: 'b' })];
    const result = batchComputeHotness(items, NOW, config);
    expect(result).toHaveLength(2);
    expect(result[0].hotness).not.toBe(0);
    expect(result[1].hotness).not.toBe(0);
  });

  it('does not mutate original items', () => {
    const items = [makeFeedItem({ hotness: 0 })];
    const originalHotness = items[0].hotness;
    batchComputeHotness(items, NOW, config);
    expect(items[0].hotness).toBe(originalHotness);
  });

  it('is deterministic across calls', () => {
    const items = [makeFeedItem(), makeFeedItem({ topic_id: 'b', eye: 50 })];
    const a = batchComputeHotness(items, NOW, config);
    const b = batchComputeHotness(items, NOW, config);
    expect(a[0].hotness).toBe(b[0].hotness);
    expect(a[1].hotness).toBe(b[1].hotness);
  });

  it('handles empty array', () => {
    expect(batchComputeHotness([], NOW, config)).toEqual([]);
  });

  it('preserves all non-hotness fields', () => {
    const item = makeFeedItem({ my_activity_score: 7 });
    const [result] = batchComputeHotness([item], NOW, config);
    expect(result.topic_id).toBe(item.topic_id);
    expect(result.kind).toBe(item.kind);
    expect(result.title).toBe(item.title);
    expect(result.eye).toBe(item.eye);
    expect(result.my_activity_score).toBe(7);
  });
});

describe('createWeights', () => {
  it('returns default weights with no overrides', () => {
    const w = createWeights();
    expect(w).toEqual({ eye: 1.0, lightbulb: 2.0, comments: 1.5, freshness: 3.0 });
  });

  it('applies partial overrides', () => {
    const w = createWeights({ eye: 5.0 });
    expect(w.eye).toBe(5.0);
    expect(w.lightbulb).toBe(2.0);
  });

  it('applies full overrides', () => {
    const w = createWeights({ eye: 0, lightbulb: 0, comments: 0, freshness: 0 });
    expect(w).toEqual({ eye: 0, lightbulb: 0, comments: 0, freshness: 0 });
  });
});
