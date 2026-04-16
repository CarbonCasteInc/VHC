import { describe, expect, it } from 'vitest';
import type { FeedItem, RankingConfig, SortMode } from '@vh/data-model';
import { DEFAULT_RANKING_CONFIG } from '@vh/data-model';
import {
  freshnessDecay,
  computeHotness,
  filterItems,
  sortItems,
  composeFeed,
} from './ranking';

// ---- Test fixtures ----

const NOW = 1_700_000_000_000; // fixed timestamp for determinism
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

const CONFIG: RankingConfig = { ...DEFAULT_RANKING_CONFIG };

// ---- freshnessDecay ----

describe('freshnessDecay', () => {
  it('returns 1.0 when age is zero', () => {
    expect(freshnessDecay(NOW, NOW, 48)).toBe(1.0);
  });

  it('returns 0.5 at exactly one half-life', () => {
    const halfLifeHours = 48;
    const activityAt = NOW - halfLifeHours * HOUR_MS;
    expect(freshnessDecay(activityAt, NOW, halfLifeHours)).toBeCloseTo(0.5, 10);
  });

  it('returns 0.25 at two half-lives', () => {
    const halfLifeHours = 48;
    const activityAt = NOW - 2 * halfLifeHours * HOUR_MS;
    expect(freshnessDecay(activityAt, NOW, halfLifeHours)).toBeCloseTo(0.25, 10);
  });

  it('approaches zero for very old items', () => {
    const activityAt = NOW - 365 * 24 * HOUR_MS; // 1 year old
    expect(freshnessDecay(activityAt, NOW, 48)).toBeLessThan(0.001);
  });

  it('clamps negative age to zero (future timestamp)', () => {
    const futureActivity = NOW + 10 * HOUR_MS;
    expect(freshnessDecay(futureActivity, NOW, 48)).toBe(1.0);
  });

  it('handles very short half-life', () => {
    const activityAt = NOW - 1 * HOUR_MS;
    const result = freshnessDecay(activityAt, NOW, 0.5);
    expect(result).toBeCloseTo(0.25, 5);
  });
});

// ---- computeHotness ----

describe('computeHotness', () => {
  it('returns a finite number for valid input', () => {
    const item = makeFeedItem();
    const score = computeHotness(item, CONFIG, NOW);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    const item = makeFeedItem();
    const a = computeHotness(item, CONFIG, NOW);
    const b = computeHotness(item, CONFIG, NOW);
    expect(a).toBe(b);
  });

  it('increases with more engagement', () => {
    const low = makeFeedItem({ eye: 1, lightbulb: 0, comments: 0 });
    const high = makeFeedItem({ eye: 100, lightbulb: 50, comments: 30 });
    expect(computeHotness(high, CONFIG, NOW)).toBeGreaterThan(
      computeHotness(low, CONFIG, NOW),
    );
  });

  it('decreases with age (fresher items score higher)', () => {
    const fresh = makeFeedItem({ latest_activity_at: NOW });
    const stale = makeFeedItem({ latest_activity_at: NOW - 96 * HOUR_MS });
    expect(computeHotness(fresh, CONFIG, NOW)).toBeGreaterThan(
      computeHotness(stale, CONFIG, NOW),
    );
  });

  it('returns 0 when all weights are zero', () => {
    const zeroConfig: RankingConfig = {
      weights: { eye: 0, lightbulb: 0, comments: 0, freshness: 0 },
      decayHalfLifeHours: 48,
    };
    const item = makeFeedItem({ eye: 100, lightbulb: 50, comments: 30 });
    expect(computeHotness(item, zeroConfig, NOW)).toBe(0);
  });

  it('handles zero engagement counts', () => {
    const item = makeFeedItem({ eye: 0, lightbulb: 0, comments: 0 });
    const score = computeHotness(item, CONFIG, NOW);
    // Only freshness component should contribute
    expect(score).toBeGreaterThan(0);
  });

  it('respects individual weight coefficients', () => {
    const item = makeFeedItem({
      eye: 10,
      lightbulb: 0,
      comments: 0,
      latest_activity_at: NOW,
    });
    const eyeOnlyConfig: RankingConfig = {
      weights: { eye: 5, lightbulb: 0, comments: 0, freshness: 0 },
      decayHalfLifeHours: 48,
    };
    const expected = 5 * Math.log1p(10);
    expect(computeHotness(item, eyeOnlyConfig, NOW)).toBeCloseTo(expected, 10);
  });
});

// ---- filterItems ----

describe('filterItems', () => {
  const news = makeFeedItem({ topic_id: 'n1', kind: 'NEWS_STORY' });
  const topic = makeFeedItem({ topic_id: 't1', kind: 'USER_TOPIC' });
  const social = makeFeedItem({ topic_id: 's1', kind: 'SOCIAL_NOTIFICATION' });
  const allItems = [news, topic, social];

  it('ALL returns every item', () => {
    expect(filterItems(allItems, 'ALL')).toHaveLength(3);
  });

  it('NEWS returns only NEWS_STORY', () => {
    const result = filterItems(allItems, 'NEWS');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('NEWS_STORY');
  });

  it('TOPICS returns only USER_TOPIC', () => {
    const result = filterItems(allItems, 'TOPICS');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('USER_TOPIC');
  });

  it('SOCIAL returns only SOCIAL_NOTIFICATION', () => {
    const result = filterItems(allItems, 'SOCIAL');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('SOCIAL_NOTIFICATION');
  });

  it('returns empty array when no items match', () => {
    const onlyNews = [news];
    expect(filterItems(onlyNews, 'SOCIAL')).toHaveLength(0);
  });

  it('preserves order of matching items', () => {
    const items = [
      makeFeedItem({ topic_id: 'n1', kind: 'NEWS_STORY' }),
      makeFeedItem({ topic_id: 'n2', kind: 'NEWS_STORY' }),
    ];
    const result = filterItems(items, 'NEWS');
    expect(result[0].topic_id).toBe('n1');
    expect(result[1].topic_id).toBe('n2');
  });

  it('handles empty input', () => {
    expect(filterItems([], 'ALL')).toHaveLength(0);
  });

  it('composeFeed can focus a single storyline within the filtered feed', () => {
    const focused = makeFeedItem({
      topic_id: 'storyline-a',
      storyline_id: 'storyline-transit',
      title: 'Transit vote advances',
      hotness: 0.8,
    });
    const unfocused = makeFeedItem({
      topic_id: 'storyline-b',
      storyline_id: 'storyline-budget',
      title: 'Budget talks stall',
      hotness: 0.9,
    });

    const result = composeFeed(
      [focused, unfocused],
      'ALL',
      'HOTTEST',
      CONFIG,
      NOW,
      'storyline-transit',
    );

    expect(result).toEqual([focused]);
  });
});

// ---- sortItems ----

describe('sortItems', () => {
  it('LATEST sorts by latest_activity_at descending', () => {
    const old = makeFeedItem({ topic_id: 'a', latest_activity_at: NOW - 2 * HOUR_MS });
    const recent = makeFeedItem({ topic_id: 'b', latest_activity_at: NOW });
    const result = sortItems([old, recent], 'LATEST', CONFIG, NOW);
    expect(result[0].topic_id).toBe('b');
    expect(result[1].topic_id).toBe('a');
  });

  it('LATEST uses topic_id as stable tiebreaker', () => {
    const a = makeFeedItem({ topic_id: 'alpha', latest_activity_at: NOW });
    const b = makeFeedItem({ topic_id: 'beta', latest_activity_at: NOW });
    const result = sortItems([b, a], 'LATEST', CONFIG, NOW);
    expect(result[0].topic_id).toBe('alpha');
    expect(result[1].topic_id).toBe('beta');
  });

  it('HOTTEST sorts by indexed hotness descending', () => {
    const low = makeFeedItem({ topic_id: 'low', hotness: 0.2 });
    const high = makeFeedItem({ topic_id: 'high', hotness: 0.9 });

    const result = sortItems([low, high], 'HOTTEST', CONFIG, NOW);
    expect(result[0].topic_id).toBe('high');
    expect(result[1].topic_id).toBe('low');
  });

  it('HOTTEST uses topic_id as stable tiebreaker', () => {
    const a = makeFeedItem({ topic_id: 'alpha' });
    const b = makeFeedItem({ topic_id: 'beta' });
    const result = sortItems([b, a], 'HOTTEST', CONFIG, NOW);
    expect(result[0].topic_id).toBe('alpha');
    expect(result[1].topic_id).toBe('beta');
  });

  it('HOTTEST falls back to computed hotness when indexed hotness is invalid', () => {
    const low = makeFeedItem({
      topic_id: 'fallback-low',
      hotness: Number.NaN,
      eye: 1,
      lightbulb: 0,
      comments: 0,
      latest_activity_at: NOW - 12 * HOUR_MS,
    });
    const high = makeFeedItem({
      topic_id: 'fallback-high',
      hotness: Number.NaN,
      eye: 80,
      lightbulb: 20,
      comments: 10,
      latest_activity_at: NOW,
    });

    const result = sortItems([low, high], 'HOTTEST', CONFIG, NOW);
    expect(result[0].topic_id).toBe('fallback-high');
    expect(result[1].topic_id).toBe('fallback-low');
  });

  it('HOTTEST handles blank/stop-word titles via topic fallback deterministically', () => {
    const alpha = makeFeedItem({
      topic_id: 'x',
      title: '   ',
      hotness: 0.9,
    });
    const beta = makeFeedItem({
      topic_id: 'y',
      title: 'the and of',
      hotness: 0.8,
    });

    const result = sortItems([beta, alpha], 'HOTTEST', CONFIG, NOW);
    expect(result.map((item) => item.topic_id)).toEqual(['x', 'y']);
  });

  it('HOTTEST diversification prevents one storyline from monopolizing top window', () => {
    const alpha1 = makeFeedItem({
      topic_id: 'alpha-1',
      title: 'Alpha policy update one',
      storyline_id: 'storyline-alpha',
      hotness: 1.0,
    });
    const alpha2 = makeFeedItem({
      topic_id: 'alpha-2',
      title: 'Alpha policy update two',
      storyline_id: 'storyline-alpha',
      hotness: 0.95,
    });
    const alpha3 = makeFeedItem({
      topic_id: 'alpha-3',
      title: 'Alpha policy update three',
      storyline_id: 'storyline-alpha',
      hotness: 0.9,
    });
    const alpha4 = makeFeedItem({
      topic_id: 'alpha-4',
      title: 'Alpha policy update four',
      storyline_id: 'storyline-alpha',
      hotness: 0.85,
    });
    const budget = makeFeedItem({
      topic_id: 'budget',
      title: 'Budget vote passes senate',
      hotness: 0.8,
    });
    const wildfire = makeFeedItem({
      topic_id: 'wildfire',
      title: 'Wildfire alert grows rapidly',
      hotness: 0.79,
    });

    const result = sortItems(
      [alpha1, alpha2, alpha3, alpha4, budget, wildfire],
      'HOTTEST',
      CONFIG,
      NOW,
    );

    const topFour = result.slice(0, 4).map((item) => item.topic_id);
    const alphaCount = topFour.filter((topicId) => topicId.startsWith('alpha-')).length;

    expect(alphaCount).toBeLessThanOrEqual(2);
    expect(topFour).toEqual(['alpha-1', 'budget', 'alpha-2', 'wildfire']);
  });

  it('HOTTEST diversification falls back to default settings when config omits overrides', () => {
    const configWithoutDiversification: RankingConfig = {
      ...CONFIG,
      hottestDiversification: undefined,
    };
    const alpha = makeFeedItem({
      topic_id: 'alpha',
      title: 'Alpha policy update',
      hotness: 1,
    });
    const beta = makeFeedItem({
      topic_id: 'beta',
      title: 'Beta policy update',
      hotness: 0.9,
    });

    const result = sortItems([beta, alpha], 'HOTTEST', configWithoutDiversification, NOW);

    expect(result.map((item) => item.topic_id)).toEqual(['alpha', 'beta']);
  });

  it('HOTTEST promotes an eligible tail item before breaking the storyline cap', () => {
    const alphaItems = Array.from({ length: 12 }, (_, index) =>
      makeFeedItem({
        topic_id: `alpha-${index + 1}`,
        title: `Alpha policy update ${index + 1}`,
        storyline_id: 'storyline-alpha',
        hotness: 1 - index * 0.01,
      }),
    );
    const tailItems = Array.from({ length: 10 }, (_, index) =>
      makeFeedItem({
        topic_id: `tail-${index + 1}`,
        title: `Distinct developing story ${index + 1}`,
        storyline_id: `storyline-tail-${index + 1}`,
        hotness: 0.7 - index * 0.01,
      }),
    );

    const result = sortItems([...alphaItems, ...tailItems], 'HOTTEST', CONFIG, NOW);
    const topWindow = result.slice(0, 12);
    const alphaCount = topWindow.filter((item) => item.storyline_id === 'storyline-alpha').length;
    const promotedTailCount = topWindow.filter((item) => item.topic_id.startsWith('tail-')).length;

    expect(alphaCount).toBeLessThanOrEqual(2);
    expect(promotedTailCount).toBeGreaterThanOrEqual(1);
  });

  it('HOTTEST does not over-group generic recap titles when entity keys distinguish storylines', () => {
    const alpha1 = makeFeedItem({
      topic_id: 'alpha-1',
      title: 'What to know about the ceasefire talks',
      entity_keys: ['geneva ceasefire', 'missile strike'],
      hotness: 1.0,
    });
    const alpha2 = makeFeedItem({
      topic_id: 'alpha-2',
      title: 'What to know about the latest truce push',
      entity_keys: ['geneva ceasefire', 'fuel depots'],
      hotness: 0.98,
    });
    const alpha3 = makeFeedItem({
      topic_id: 'alpha-3',
      title: 'What to know about the next ceasefire session',
      entity_keys: ['geneva ceasefire', 'shipping lanes'],
      hotness: 0.97,
    });
    const blackout = makeFeedItem({
      topic_id: 'blackout-1',
      title: 'What to know about the capital blackout',
      entity_keys: ['capital blackout', 'substation outage'],
      hotness: 0.96,
    });
    const port = makeFeedItem({
      topic_id: 'port-1',
      title: 'What to know about the port strike',
      entity_keys: ['port strike', 'cargo backlog'],
      hotness: 0.95,
    });
    const hospital = makeFeedItem({
      topic_id: 'hospital-1',
      title: 'What to know about the hospital cyberattack',
      entity_keys: ['hospital cyberattack', 'ambulance diversion'],
      hotness: 0.94,
    });

    const result = sortItems(
      [alpha1, alpha2, alpha3, blackout, port, hospital],
      'HOTTEST',
      CONFIG,
      NOW,
    );
    const topFive = result.slice(0, 5).map((item) => item.topic_id);
    const alphaCount = topFive.filter((topicId) =>
      topicId.startsWith('alpha-'),
    ).length;

    expect(alphaCount).toBeLessThanOrEqual(2);
    expect(topFive).toEqual([
      'alpha-1',
      'blackout-1',
      'alpha-2',
      'port-1',
      'hospital-1',
    ]);
  });

  it('HOTTEST uses storyline_id authority even when titles do not overlap lexically', () => {
    const storylineOne = makeFeedItem({
      topic_id: 'storyline-1-a',
      title: 'Markets brace for tariff vote',
      storyline_id: 'storyline-1',
      hotness: 1.0,
    });
    const storylineTwo = makeFeedItem({
      topic_id: 'storyline-1-b',
      title: 'Central bank officials face criticism',
      storyline_id: 'storyline-1',
      hotness: 0.95,
    });
    const other = makeFeedItem({
      topic_id: 'wildfire-1',
      title: 'Wildfire alert expands overnight',
      storyline_id: 'storyline-2',
      hotness: 0.9,
    });

    const result = sortItems([storylineOne, storylineTwo, other], 'HOTTEST', CONFIG, NOW);

    expect(result.map((item) => item.topic_id).slice(0, 3)).toEqual([
      'storyline-1-a',
      'wildfire-1',
      'storyline-1-b',
    ]);
  });

  it('HOTTEST prefers entity_keys over title tokens for overlap penalties', () => {
    const first = makeFeedItem({
      topic_id: 'flood-1',
      title: 'Update one',
      entity_keys: ['river flood', 'emergency shelter'],
      hotness: 1.0,
    });
    const second = makeFeedItem({
      topic_id: 'flood-2',
      title: 'Update two',
      entity_keys: ['river flood', 'evacuation zone'],
      hotness: 0.98,
    });
    const third = makeFeedItem({
      topic_id: 'tech-1',
      title: 'Chipmaker releases earnings',
      entity_keys: ['earnings report', 'chipmaker'],
      hotness: 0.97,
    });

    const result = sortItems([first, second, third], 'HOTTEST', CONFIG, NOW);

    expect(result.map((item) => item.topic_id).slice(0, 3)).toEqual([
      'flood-1',
      'tech-1',
      'flood-2',
    ]);
  });

  it('MY_ACTIVITY sorts by my_activity_score descending', () => {
    const low = makeFeedItem({ topic_id: 'low', my_activity_score: 1 });
    const high = makeFeedItem({ topic_id: 'high', my_activity_score: 10 });
    const result = sortItems([low, high], 'MY_ACTIVITY', CONFIG, NOW);
    expect(result[0].topic_id).toBe('high');
    expect(result[1].topic_id).toBe('low');
  });

  it('MY_ACTIVITY treats missing score as 0', () => {
    const withScore = makeFeedItem({ topic_id: 'scored', my_activity_score: 1 });
    const noScore = makeFeedItem({ topic_id: 'unscored' });
    const result = sortItems([noScore, withScore], 'MY_ACTIVITY', CONFIG, NOW);
    expect(result[0].topic_id).toBe('scored');
    expect(result[1].topic_id).toBe('unscored');
  });

  it('MY_ACTIVITY uses topic_id as stable tiebreaker', () => {
    const a = makeFeedItem({ topic_id: 'alpha', my_activity_score: 5 });
    const b = makeFeedItem({ topic_id: 'beta', my_activity_score: 5 });
    const result = sortItems([b, a], 'MY_ACTIVITY', CONFIG, NOW);
    expect(result[0].topic_id).toBe('alpha');
    expect(result[1].topic_id).toBe('beta');
  });

  it('MY_ACTIVITY falls back to tiebreaker when both scores are missing', () => {
    const a = makeFeedItem({ topic_id: 'alpha', my_activity_score: undefined });
    const b = makeFeedItem({ topic_id: 'beta', my_activity_score: undefined });
    const result = sortItems([b, a], 'MY_ACTIVITY', CONFIG, NOW);
    expect(result[0].topic_id).toBe('alpha');
    expect(result[1].topic_id).toBe('beta');
  });

  it('throws on unknown sort mode', () => {
    expect(() =>
      sortItems([makeFeedItem()], 'UNKNOWN' as unknown as SortMode, CONFIG, NOW),
    ).toThrow('Unknown sort mode: UNKNOWN');
  });

  it('does not mutate the input array', () => {
    const items = [
      makeFeedItem({ topic_id: 'b', latest_activity_at: NOW }),
      makeFeedItem({ topic_id: 'a', latest_activity_at: NOW - HOUR_MS }),
    ];
    const original = [...items];
    sortItems(items, 'LATEST', CONFIG, NOW);
    expect(items[0].topic_id).toBe(original[0].topic_id);
    expect(items[1].topic_id).toBe(original[1].topic_id);
  });

  it('handles empty array', () => {
    expect(sortItems([], 'LATEST', CONFIG, NOW)).toHaveLength(0);
  });

  it('handles single item', () => {
    const item = makeFeedItem({ topic_id: 'solo' });
    const result = sortItems([item], 'HOTTEST', CONFIG, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].topic_id).toBe('solo');
  });
});

// ---- composeFeed ----

describe('composeFeed', () => {
  const items = [
    makeFeedItem({ topic_id: 'n1', kind: 'NEWS_STORY', latest_activity_at: NOW }),
    makeFeedItem({
      topic_id: 'n2',
      kind: 'NEWS_STORY',
      latest_activity_at: NOW - HOUR_MS,
    }),
    makeFeedItem({
      topic_id: 't1',
      kind: 'USER_TOPIC',
      latest_activity_at: NOW - 2 * HOUR_MS,
    }),
    makeFeedItem({
      topic_id: 's1',
      kind: 'SOCIAL_NOTIFICATION',
      latest_activity_at: NOW - 3 * HOUR_MS,
    }),
  ];

  it('filters and sorts in one pass (NEWS + LATEST)', () => {
    const result = composeFeed(items, 'NEWS', 'LATEST', CONFIG, NOW);
    expect(result).toHaveLength(2);
    expect(result[0].topic_id).toBe('n1');
    expect(result[1].topic_id).toBe('n2');
  });

  it('ALL + LATEST returns all items sorted', () => {
    const result = composeFeed(items, 'ALL', 'LATEST', CONFIG, NOW);
    expect(result).toHaveLength(4);
    expect(result[0].topic_id).toBe('n1');
  });

  it('returns empty for non-matching filter', () => {
    const newsOnly = [makeFeedItem({ topic_id: 'n1', kind: 'NEWS_STORY' })];
    const result = composeFeed(newsOnly, 'SOCIAL', 'LATEST', CONFIG, NOW);
    expect(result).toHaveLength(0);
  });

  it('deterministic ranking with fixed inputs', () => {
    const a = composeFeed(items, 'ALL', 'HOTTEST', CONFIG, NOW);
    const b = composeFeed(items, 'ALL', 'HOTTEST', CONFIG, NOW);
    expect(a.map((i) => i.topic_id)).toEqual(b.map((i) => i.topic_id));
  });

  it('MY_ACTIVITY filter + sort combined', () => {
    const scored = [
      makeFeedItem({
        topic_id: 'n1',
        kind: 'NEWS_STORY',
        my_activity_score: 3,
      }),
      makeFeedItem({
        topic_id: 'n2',
        kind: 'NEWS_STORY',
        my_activity_score: 7,
      }),
      makeFeedItem({
        topic_id: 't1',
        kind: 'USER_TOPIC',
        my_activity_score: 10,
      }),
    ];
    const result = composeFeed(scored, 'NEWS', 'MY_ACTIVITY', CONFIG, NOW);
    expect(result).toHaveLength(2);
    expect(result[0].topic_id).toBe('n2');
    expect(result[1].topic_id).toBe('n1');
  });
});
