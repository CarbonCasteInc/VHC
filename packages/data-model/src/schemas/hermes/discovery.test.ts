import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECAY_HALF_LIFE_HOURS,
  DEFAULT_FEED_PERSONALIZATION_CONFIG,
  DEFAULT_HOTNESS_WEIGHTS,
  DEFAULT_PERSONALIZATION_WEIGHTS,
  DEFAULT_RANKING_CONFIG,
  FEED_KINDS,
  FeedItemSchema,
  FeedKindSchema,
  FeedPersonalizationConfigSchema,
  FILTER_CHIPS,
  FILTER_TO_KINDS,
  FilterChipSchema,
  HotnessWeightsSchema,
  PersonalizationWeightsSchema,
  RankingConfigSchema,
  SORT_MODES,
  SortModeSchema,
} from './discovery';

const now = Date.now();

const validFeedItem = {
  topic_id: 'topic-abc-123',
  kind: 'NEWS_STORY' as const,
  title: 'Breaking: Important civic update',
  created_at: now - 3_600_000,
  latest_activity_at: now,
  hotness: 12.5,
  eye: 42,
  lightbulb: 7,
  comments: 3,
};

describe('FeedKindSchema', () => {
  it.each(FEED_KINDS)('accepts %s', (kind) => {
    expect(FeedKindSchema.parse(kind)).toBe(kind);
  });

  it('rejects invalid kind', () => {
    expect(FeedKindSchema.safeParse('INVALID').success).toBe(false);
  });

  it('rejects lowercase variants', () => {
    expect(FeedKindSchema.safeParse('news_story').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(FeedKindSchema.safeParse('').success).toBe(false);
  });
});

describe('SortModeSchema', () => {
  it.each(SORT_MODES)('accepts %s', (mode) => {
    expect(SortModeSchema.parse(mode)).toBe(mode);
  });

  it('rejects invalid sort mode', () => {
    expect(SortModeSchema.safeParse('POPULAR').success).toBe(false);
  });
});

describe('FilterChipSchema', () => {
  it.each(FILTER_CHIPS)('accepts %s', (chip) => {
    expect(FilterChipSchema.parse(chip)).toBe(chip);
  });

  it('rejects invalid filter', () => {
    expect(FilterChipSchema.safeParse('TRENDING').success).toBe(false);
  });
});

describe('FeedItemSchema', () => {
  it('accepts a valid feed item', () => {
    const parsed = FeedItemSchema.parse(validFeedItem);
    expect(parsed.topic_id).toBe('topic-abc-123');
    expect(parsed.kind).toBe('NEWS_STORY');
  });

  it('accepts NEWS_STORY item with story_id identity field', () => {
    const parsed = FeedItemSchema.parse({ ...validFeedItem, story_id: 'story-abc-123' });
    expect(parsed.story_id).toBe('story-abc-123');
  });

  it('accepts optional storyline, entity, and category metadata for feed ranking', () => {
    const parsed = FeedItemSchema.parse({
      ...validFeedItem,
      story_id: 'story-abc-123',
      storyline_id: 'storyline-abc-123',
      entity_keys: ['budget vote', 'city council'],
      categories: ['transportation', 'city hall'],
    });
    expect(parsed.storyline_id).toBe('storyline-abc-123');
    expect(parsed.entity_keys).toEqual(['budget vote', 'city council']);
    expect(parsed.categories).toEqual(['transportation', 'city hall']);
  });

  it('accepts NEWS_STORY item without story_id during migration', () => {
    const parsed = FeedItemSchema.parse(validFeedItem);
    expect(parsed.story_id).toBeUndefined();
  });

  it('rejects empty story_id when provided', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, story_id: '' }).success).toBe(false);
  });

  it('rejects empty storyline_id when provided', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, storyline_id: '' }).success).toBe(false);
  });

  it('rejects blank entity keys when provided', () => {
    expect(
      FeedItemSchema.safeParse({ ...validFeedItem, entity_keys: ['valid', ''] }).success,
    ).toBe(false);
  });

  it('accepts item with optional my_activity_score', () => {
    const parsed = FeedItemSchema.parse({ ...validFeedItem, my_activity_score: 5.0 });
    expect(parsed.my_activity_score).toBe(5.0);
  });

  it('accepts item without my_activity_score', () => {
    const parsed = FeedItemSchema.parse(validFeedItem);
    expect(parsed.my_activity_score).toBeUndefined();
  });

  it('accepts zero engagement counts', () => {
    const parsed = FeedItemSchema.parse({
      ...validFeedItem,
      eye: 0,
      lightbulb: 0,
      comments: 0,
    });
    expect(parsed.eye).toBe(0);
  });

  it('accepts negative hotness', () => {
    const parsed = FeedItemSchema.parse({ ...validFeedItem, hotness: -1.5 });
    expect(parsed.hotness).toBe(-1.5);
  });

  it('accepts zero hotness', () => {
    const parsed = FeedItemSchema.parse({ ...validFeedItem, hotness: 0 });
    expect(parsed.hotness).toBe(0);
  });

  it('rejects empty topic_id', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, topic_id: '' }).success).toBe(false);
  });

  it('rejects empty title', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, title: '' }).success).toBe(false);
  });

  it('rejects negative eye count', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, eye: -1 }).success).toBe(false);
  });

  it('rejects negative lightbulb count', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, lightbulb: -1 }).success).toBe(false);
  });

  it('rejects negative comments count', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, comments: -1 }).success).toBe(false);
  });

  it('rejects negative created_at', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, created_at: -1 }).success).toBe(false);
  });

  it('rejects negative latest_activity_at', () => {
    expect(
      FeedItemSchema.safeParse({ ...validFeedItem, latest_activity_at: -1 }).success,
    ).toBe(false);
  });

  it('rejects negative my_activity_score', () => {
    expect(
      FeedItemSchema.safeParse({ ...validFeedItem, my_activity_score: -0.1 }).success,
    ).toBe(false);
  });

  it('rejects non-integer eye', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, eye: 1.5 }).success).toBe(false);
  });

  it('rejects non-integer lightbulb', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, lightbulb: 0.5 }).success).toBe(false);
  });

  it('rejects non-integer comments', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, comments: 2.2 }).success).toBe(false);
  });

  it('rejects non-integer created_at', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, created_at: 1.5 }).success).toBe(false);
  });

  it('rejects Infinity hotness', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, hotness: Infinity }).success).toBe(false);
  });

  it('rejects NaN hotness', () => {
    expect(FeedItemSchema.safeParse({ ...validFeedItem, hotness: NaN }).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(FeedItemSchema.safeParse({}).success).toBe(false);
    expect(FeedItemSchema.safeParse({ topic_id: 'x' }).success).toBe(false);
  });

  it('rejects invalid kind', () => {
    expect(
      FeedItemSchema.safeParse({ ...validFeedItem, kind: 'BLOG_POST' }).success,
    ).toBe(false);
  });

  it.each(FEED_KINDS)('accepts kind %s', (kind) => {
    const parsed = FeedItemSchema.parse({ ...validFeedItem, kind });
    expect(parsed.kind).toBe(kind);
  });

  it('strips unknown properties', () => {
    const parsed = FeedItemSchema.parse({
      ...validFeedItem,
      unknownField: 'should-be-stripped',
    });
    expect((parsed as Record<string, unknown>).unknownField).toBeUndefined();
  });
});

describe('HotnessWeightsSchema', () => {
  it('accepts valid weights', () => {
    const parsed = HotnessWeightsSchema.parse(DEFAULT_HOTNESS_WEIGHTS);
    expect(parsed.eye).toBe(1.0);
    expect(parsed.lightbulb).toBe(2.0);
  });

  it('accepts zero weights', () => {
    const parsed = HotnessWeightsSchema.parse({
      eye: 0,
      lightbulb: 0,
      comments: 0,
      freshness: 0,
    });
    expect(parsed.eye).toBe(0);
  });

  it('rejects negative weight', () => {
    expect(
      HotnessWeightsSchema.safeParse({ ...DEFAULT_HOTNESS_WEIGHTS, eye: -1 }).success,
    ).toBe(false);
  });

  it('rejects Infinity weight', () => {
    expect(
      HotnessWeightsSchema.safeParse({ ...DEFAULT_HOTNESS_WEIGHTS, freshness: Infinity }).success,
    ).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(HotnessWeightsSchema.safeParse({ eye: 1.0 }).success).toBe(false);
  });
});

describe('FeedPersonalizationConfigSchema', () => {
  it('accepts preferred and muted category/topic preferences', () => {
    const parsed = FeedPersonalizationConfigSchema.parse({
      preferredCategories: ['politics'],
      preferredTopics: ['election-law'],
      mutedCategories: ['sports'],
      mutedTopics: ['celebrity-trial'],
    });

    expect(parsed).toEqual({
      preferredCategories: ['politics'],
      preferredTopics: ['election-law'],
      mutedCategories: ['sports'],
      mutedTopics: ['celebrity-trial'],
    });
  });

  it('rejects blank preference tokens', () => {
    expect(
      FeedPersonalizationConfigSchema.safeParse({
        ...DEFAULT_FEED_PERSONALIZATION_CONFIG,
        preferredCategories: [''],
      }).success,
    ).toBe(false);
  });

  it('passes default feed personalization config', () => {
    expect(
      FeedPersonalizationConfigSchema.safeParse(DEFAULT_FEED_PERSONALIZATION_CONFIG).success,
    ).toBe(true);
  });
});

describe('PersonalizationWeightsSchema', () => {
  it('accepts default personalization ranking weights', () => {
    const parsed = PersonalizationWeightsSchema.parse(DEFAULT_PERSONALIZATION_WEIGHTS);

    expect(parsed.preferredCategoryBoost).toBe(0.25);
    expect(parsed.preferredTopicBoost).toBe(0.35);
  });

  it('rejects negative personalization ranking weights', () => {
    expect(
      PersonalizationWeightsSchema.safeParse({
        ...DEFAULT_PERSONALIZATION_WEIGHTS,
        preferredTopicBoost: -0.1,
      }).success,
    ).toBe(false);
  });
});

describe('RankingConfigSchema', () => {
  it('accepts valid config', () => {
    const parsed = RankingConfigSchema.parse(DEFAULT_RANKING_CONFIG);
    expect(parsed.decayHalfLifeHours).toBe(48);
    expect(parsed.version).toBe('ranking-v0');
    expect(parsed.hottestDiversification?.storylineCap).toBe(2);
    expect(parsed.personalization?.preferredTopicBoost).toBe(0.35);
  });

  it('rejects zero half-life', () => {
    expect(
      RankingConfigSchema.safeParse({
        ...DEFAULT_RANKING_CONFIG,
        decayHalfLifeHours: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects negative half-life', () => {
    expect(
      RankingConfigSchema.safeParse({
        ...DEFAULT_RANKING_CONFIG,
        decayHalfLifeHours: -12,
      }).success,
    ).toBe(false);
  });
});

describe('DEFAULT_RANKING_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_RANKING_CONFIG.weights).toEqual(DEFAULT_HOTNESS_WEIGHTS);
    expect(DEFAULT_RANKING_CONFIG.decayHalfLifeHours).toBe(DEFAULT_DECAY_HALF_LIFE_HOURS);
    expect(DEFAULT_RANKING_CONFIG.version).toBe('ranking-v0');
    expect(DEFAULT_RANKING_CONFIG.hottestDiversification).toEqual({
      window: 12,
      storylineCap: 2,
      adjacentEntityOverlapPenalty: 0.35,
    });
    expect(DEFAULT_RANKING_CONFIG.personalization).toEqual(DEFAULT_PERSONALIZATION_WEIGHTS);
  });

  it('passes its own schema validation', () => {
    expect(RankingConfigSchema.safeParse(DEFAULT_RANKING_CONFIG).success).toBe(true);
  });
});

describe('FILTER_TO_KINDS', () => {
  it('ALL includes every FeedKind', () => {
    expect(FILTER_TO_KINDS.ALL).toEqual(FEED_KINDS);
  });

  it('NEWS maps to NEWS_STORY only', () => {
    expect(FILTER_TO_KINDS.NEWS).toEqual(['NEWS_STORY']);
  });

  it('TOPICS maps to USER_TOPIC only', () => {
    expect(FILTER_TO_KINDS.TOPICS).toEqual(['USER_TOPIC']);
  });

  it('SOCIAL maps to SOCIAL_NOTIFICATION only', () => {
    expect(FILTER_TO_KINDS.SOCIAL).toEqual(['SOCIAL_NOTIFICATION']);
  });

  it('ARTICLES maps to ARTICLE only', () => {
    expect(FILTER_TO_KINDS.ARTICLES).toEqual(['ARTICLE']);
  });

  it('covers all filter chips', () => {
    for (const chip of FILTER_CHIPS) {
      expect(FILTER_TO_KINDS[chip]).toBeDefined();
      expect(FILTER_TO_KINDS[chip].length).toBeGreaterThan(0);
    }
  });
});
