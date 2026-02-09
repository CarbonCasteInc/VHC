import { describe, expect, it } from 'vitest';
import {
  ClusterFeaturesSchema,
  FeedSourceSchema,
  RawFeedItemSchema,
  STORY_BUNDLE_VERSION,
  StoryBundleSchema,
  StoryBundleSourceSchema,
} from './storyBundle';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

const validFeedSource = {
  id: 'src-reuters',
  name: 'Reuters',
  rssUrl: 'https://feeds.reuters.com/rss/topNews',
  trustTier: 'primary' as const,
  enabled: true,
};

const validRawFeedItem = {
  sourceId: 'src-reuters',
  url: 'https://reuters.com/article/123',
  title: 'Breaking: markets rise',
  publishedAt: 1700000000000,
  summary: 'Markets went up today.',
  author: 'Jane Doe',
};

const validBundleSource = {
  source_id: 'src-reuters',
  publisher: 'Reuters',
  url: 'https://reuters.com/article/123',
  url_hash: 'abc123hash',
  published_at: 1700000000000,
  title: 'Breaking: markets rise',
};

const validClusterFeatures = {
  entity_keys: ['markets', 'stocks'],
  time_bucket: '2024-01-15T00',
  semantic_signature: 'sig-abc-123',
};

const validStoryBundle = {
  schemaVersion: STORY_BUNDLE_VERSION,
  story_id: 'story-001',
  topic_id: 'topic-markets',
  headline: 'Global markets surge on positive data',
  summary_hint: 'A brief summary hint.',
  cluster_window_start: 1700000000000,
  cluster_window_end: 1700003600000,
  sources: [validBundleSource],
  cluster_features: validClusterFeatures,
  provenance_hash: 'prov-hash-xyz',
  created_at: 1700003600001,
};

/* ------------------------------------------------------------------ */
/*  FeedSourceSchema                                                  */
/* ------------------------------------------------------------------ */

describe('FeedSourceSchema', () => {
  it('accepts a valid feed source with all fields', () => {
    const result = FeedSourceSchema.parse(validFeedSource);
    expect(result.id).toBe('src-reuters');
    expect(result.trustTier).toBe('primary');
  });

  it('accepts a feed source without optional trustTier', () => {
    const { trustTier: _, ...noTier } = validFeedSource;
    const result = FeedSourceSchema.parse(noTier);
    expect(result.trustTier).toBeUndefined();
  });

  it('rejects empty id', () => {
    expect(
      FeedSourceSchema.safeParse({ ...validFeedSource, id: '' }).success
    ).toBe(false);
  });

  it('rejects empty name', () => {
    expect(
      FeedSourceSchema.safeParse({ ...validFeedSource, name: '' }).success
    ).toBe(false);
  });

  it('rejects invalid rssUrl', () => {
    expect(
      FeedSourceSchema.safeParse({ ...validFeedSource, rssUrl: 'not-a-url' })
        .success
    ).toBe(false);
  });

  it('rejects invalid trustTier value', () => {
    expect(
      FeedSourceSchema.safeParse({ ...validFeedSource, trustTier: 'unknown' })
        .success
    ).toBe(false);
  });

  it('rejects non-boolean enabled', () => {
    expect(
      FeedSourceSchema.safeParse({ ...validFeedSource, enabled: 'yes' })
        .success
    ).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(FeedSourceSchema.safeParse({}).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  RawFeedItemSchema                                                 */
/* ------------------------------------------------------------------ */

describe('RawFeedItemSchema', () => {
  it('accepts a valid raw feed item with all fields', () => {
    const result = RawFeedItemSchema.parse(validRawFeedItem);
    expect(result.sourceId).toBe('src-reuters');
    expect(result.author).toBe('Jane Doe');
  });

  it('accepts a raw feed item without optional fields', () => {
    const minimal = {
      sourceId: 'src-1',
      url: 'https://example.com/a',
      title: 'Test',
    };
    const result = RawFeedItemSchema.parse(minimal);
    expect(result.publishedAt).toBeUndefined();
    expect(result.summary).toBeUndefined();
    expect(result.author).toBeUndefined();
  });

  it('rejects empty sourceId', () => {
    expect(
      RawFeedItemSchema.safeParse({ ...validRawFeedItem, sourceId: '' })
        .success
    ).toBe(false);
  });

  it('rejects invalid url', () => {
    expect(
      RawFeedItemSchema.safeParse({ ...validRawFeedItem, url: 'bad' }).success
    ).toBe(false);
  });

  it('rejects empty title', () => {
    expect(
      RawFeedItemSchema.safeParse({ ...validRawFeedItem, title: '' }).success
    ).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(RawFeedItemSchema.safeParse({}).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  StoryBundleSourceSchema                                           */
/* ------------------------------------------------------------------ */

describe('StoryBundleSourceSchema', () => {
  it('accepts a valid bundle source', () => {
    const result = StoryBundleSourceSchema.parse(validBundleSource);
    expect(result.url_hash).toBe('abc123hash');
  });

  it('accepts without optional published_at', () => {
    const { published_at: _, ...noPub } = validBundleSource;
    const result = StoryBundleSourceSchema.parse(noPub);
    expect(result.published_at).toBeUndefined();
  });

  it('rejects empty source_id', () => {
    expect(
      StoryBundleSourceSchema.safeParse({
        ...validBundleSource,
        source_id: '',
      }).success
    ).toBe(false);
  });

  it('rejects empty publisher', () => {
    expect(
      StoryBundleSourceSchema.safeParse({
        ...validBundleSource,
        publisher: '',
      }).success
    ).toBe(false);
  });

  it('rejects invalid url', () => {
    expect(
      StoryBundleSourceSchema.safeParse({
        ...validBundleSource,
        url: 'nope',
      }).success
    ).toBe(false);
  });

  it('rejects empty url_hash', () => {
    expect(
      StoryBundleSourceSchema.safeParse({
        ...validBundleSource,
        url_hash: '',
      }).success
    ).toBe(false);
  });

  it('rejects empty title', () => {
    expect(
      StoryBundleSourceSchema.safeParse({
        ...validBundleSource,
        title: '',
      }).success
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  ClusterFeaturesSchema                                             */
/* ------------------------------------------------------------------ */

describe('ClusterFeaturesSchema', () => {
  it('accepts valid cluster features', () => {
    const result = ClusterFeaturesSchema.parse(validClusterFeatures);
    expect(result.entity_keys).toEqual(['markets', 'stocks']);
  });

  it('rejects empty entity_keys array', () => {
    expect(
      ClusterFeaturesSchema.safeParse({
        ...validClusterFeatures,
        entity_keys: [],
      }).success
    ).toBe(false);
  });

  it('rejects entity_keys with empty string', () => {
    expect(
      ClusterFeaturesSchema.safeParse({
        ...validClusterFeatures,
        entity_keys: [''],
      }).success
    ).toBe(false);
  });

  it('rejects empty time_bucket', () => {
    expect(
      ClusterFeaturesSchema.safeParse({
        ...validClusterFeatures,
        time_bucket: '',
      }).success
    ).toBe(false);
  });

  it('rejects empty semantic_signature', () => {
    expect(
      ClusterFeaturesSchema.safeParse({
        ...validClusterFeatures,
        semantic_signature: '',
      }).success
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  StoryBundleSchema                                                 */
/* ------------------------------------------------------------------ */

describe('StoryBundleSchema', () => {
  it('accepts a valid story bundle', () => {
    const result = StoryBundleSchema.parse(validStoryBundle);
    expect(result.schemaVersion).toBe('story-bundle-v0');
    expect(result.story_id).toBe('story-001');
    expect(result.sources).toHaveLength(1);
  });

  it('accepts without optional summary_hint', () => {
    const { summary_hint: _, ...noHint } = validStoryBundle;
    const result = StoryBundleSchema.parse(noHint);
    expect(result.summary_hint).toBeUndefined();
  });

  it('accepts multiple sources', () => {
    const multi = {
      ...validStoryBundle,
      sources: [
        validBundleSource,
        { ...validBundleSource, source_id: 'src-ap', publisher: 'AP' },
      ],
    };
    const result = StoryBundleSchema.parse(multi);
    expect(result.sources).toHaveLength(2);
  });

  it('rejects wrong schemaVersion', () => {
    expect(
      StoryBundleSchema.safeParse({
        ...validStoryBundle,
        schemaVersion: 'story-bundle-v1',
      }).success
    ).toBe(false);
  });

  it('rejects empty story_id', () => {
    expect(
      StoryBundleSchema.safeParse({ ...validStoryBundle, story_id: '' })
        .success
    ).toBe(false);
  });

  it('rejects empty topic_id', () => {
    expect(
      StoryBundleSchema.safeParse({ ...validStoryBundle, topic_id: '' })
        .success
    ).toBe(false);
  });

  it('rejects empty headline', () => {
    expect(
      StoryBundleSchema.safeParse({ ...validStoryBundle, headline: '' })
        .success
    ).toBe(false);
  });

  it('rejects empty sources array', () => {
    expect(
      StoryBundleSchema.safeParse({ ...validStoryBundle, sources: [] })
        .success
    ).toBe(false);
  });

  it('rejects empty provenance_hash', () => {
    expect(
      StoryBundleSchema.safeParse({
        ...validStoryBundle,
        provenance_hash: '',
      }).success
    ).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(StoryBundleSchema.safeParse({}).success).toBe(false);
  });

  it('validates nested source entries', () => {
    const badSource = {
      ...validStoryBundle,
      sources: [{ ...validBundleSource, url: 'not-a-url' }],
    };
    expect(StoryBundleSchema.safeParse(badSource).success).toBe(false);
  });

  it('validates nested cluster_features', () => {
    const badFeatures = {
      ...validStoryBundle,
      cluster_features: { ...validClusterFeatures, entity_keys: [] },
    };
    expect(StoryBundleSchema.safeParse(badFeatures).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  STORY_BUNDLE_VERSION constant                                     */
/* ------------------------------------------------------------------ */

describe('STORY_BUNDLE_VERSION', () => {
  it('equals story-bundle-v0', () => {
    expect(STORY_BUNDLE_VERSION).toBe('story-bundle-v0');
  });
});
