import { describe, it, expect } from 'vitest';
import { StoryBundleSchema } from '@vh/data-model';
import type { FeedSource } from '@vh/data-model';
import { clusterItems, extractWords } from './cluster';
import type { NormalizedFeedItem } from './normalize';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const FIXED_NOW = 1700000000000;
const SIX_HOURS = 6 * 60 * 60 * 1000;

function makeItem(overrides: Partial<NormalizedFeedItem> = {}): NormalizedFeedItem {
  return {
    sourceId: 'src-1',
    url: 'https://example.com/article',
    title: 'Climate Change Summit Results',
    publishedAt: FIXED_NOW,
    summary: 'Summary of the article',
    canonicalUrl: 'https://example.com/article',
    urlHash: 'aabb1122',
    ...overrides,
  };
}

function makeFeedSources(
  ...entries: [string, string][]
): Map<string, FeedSource> {
  const map = new Map<string, FeedSource>();
  for (const [id, name] of entries) {
    map.set(id, {
      id,
      name,
      rssUrl: `https://${id}.example.com/rss`,
      enabled: true,
    });
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  extractWords                                                      */
/* ------------------------------------------------------------------ */

describe('extractWords', () => {
  it('extracts significant words, removing stop words and short words', () => {
    const words = extractWords('The Climate Change Summit in Paris');
    expect(words).toEqual(['climate', 'change', 'summit', 'paris']);
  });

  it('lowercases all words', () => {
    const words = extractWords('BREAKING NEWS Technology');
    expect(words).toEqual(['breaking', 'news', 'technology']);
  });

  it('strips non-alphanumeric characters', () => {
    const words = extractWords("Biden's $100M Climate-Plan!");
    expect(words).toEqual(['bidens', '100m', 'climateplan']);
  });

  it('returns empty for all-stop-word titles', () => {
    const words = extractWords('the is a an');
    expect(words).toEqual([]);
  });

  it('filters words with 2 or fewer chars', () => {
    const words = extractWords('AI UK EU trade deal');
    // 'ai' and 'uk' and 'eu' are 2 chars → filtered out
    expect(words).toEqual(['trade', 'deal']);
  });
});

/* ------------------------------------------------------------------ */
/*  clusterItems — empty input                                        */
/* ------------------------------------------------------------------ */

describe('clusterItems', () => {
  const sources = makeFeedSources(
    ['src-1', 'News Daily'],
    ['src-2', 'World Report'],
    ['src-3', 'Tech Journal'],
  );
  const nowFn = () => FIXED_NOW;

  it('returns empty array for empty input', () => {
    const result = clusterItems([], sources, { nowFn });
    expect(result).toEqual([]);
  });

  /* ---------------------------------------------------------------- */
  /*  Single item cluster                                             */
  /* ---------------------------------------------------------------- */

  it('creates a valid StoryBundle from a single item', () => {
    const item = makeItem();
    const bundles = clusterItems([item], sources, { nowFn });

    expect(bundles).toHaveLength(1);
    const bundle = bundles[0]!;

    // Validate against schema
    expect(() => StoryBundleSchema.parse(bundle)).not.toThrow();

    expect(bundle.schemaVersion).toBe('story-bundle-v0');
    expect(bundle.headline).toBe('Climate Change Summit Results');
    expect(bundle.summary_hint).toBe('Summary of the article');
    expect(bundle.sources).toHaveLength(1);
    expect(bundle.sources[0]!.publisher).toBe('News Daily');
    expect(bundle.sources[0]!.url).toBe('https://example.com/article');
    expect(bundle.cluster_window_start).toBe(FIXED_NOW);
    expect(bundle.cluster_window_end).toBe(FIXED_NOW);
    expect(bundle.created_at).toBe(FIXED_NOW);
  });

  /* ---------------------------------------------------------------- */
  /*  Stable IDs                                                      */
  /* ---------------------------------------------------------------- */

  it('generates stable story_id and topic_id for same input', () => {
    const items = [makeItem()];

    const bundles1 = clusterItems(items, sources, { nowFn });
    const bundles2 = clusterItems(items, sources, { nowFn });

    expect(bundles1[0]!.story_id).toBe(bundles2[0]!.story_id);
    expect(bundles1[0]!.topic_id).toBe(bundles2[0]!.topic_id);
    expect(bundles1[0]!.story_id).toMatch(/^story-[0-9a-f]{8}$/);
    expect(bundles1[0]!.topic_id).toMatch(/^topic-[0-9a-f]{8}$/);
  });

  /* ---------------------------------------------------------------- */
  /*  Multi-source clustering                                         */
  /* ---------------------------------------------------------------- */

  it('clusters items with shared entity keys in the same time bucket', () => {
    const item1 = makeItem({
      sourceId: 'src-1',
      title: 'Climate Summit Begins',
      url: 'https://a.com/1',
      canonicalUrl: 'https://a.com/1',
      urlHash: 'hash_a1',
      publishedAt: FIXED_NOW,
    });
    const item2 = makeItem({
      sourceId: 'src-2',
      title: 'Climate Summit Day One',
      url: 'https://b.com/1',
      canonicalUrl: 'https://b.com/1',
      urlHash: 'hash_b1',
      publishedAt: FIXED_NOW + 1000,
    });

    const bundles = clusterItems([item1, item2], sources, { nowFn });

    // Should be in same cluster (shared "climate", "summit")
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.sources).toHaveLength(2);

    // Validate schema
    expect(() => StoryBundleSchema.parse(bundles[0]!)).not.toThrow();
  });

  it('separates items in different time buckets', () => {
    const item1 = makeItem({
      sourceId: 'src-1',
      title: 'Climate Summit Begins',
      url: 'https://a.com/1',
      canonicalUrl: 'https://a.com/1',
      urlHash: 'hash_a1',
      publishedAt: FIXED_NOW,
    });
    const item2 = makeItem({
      sourceId: 'src-2',
      title: 'Climate Summit Day Two',
      url: 'https://b.com/2',
      canonicalUrl: 'https://b.com/2',
      urlHash: 'hash_b2',
      publishedAt: FIXED_NOW + SIX_HOURS + 1, // next bucket
    });

    const bundles = clusterItems([item1, item2], sources, { nowFn });
    expect(bundles).toHaveLength(2);
  });

  it('separates items with no shared entity keys in same bucket', () => {
    const item1 = makeItem({
      sourceId: 'src-1',
      title: 'Climate Summit Begins',
      url: 'https://a.com/1',
      canonicalUrl: 'https://a.com/1',
      urlHash: 'hash_a1',
      publishedAt: FIXED_NOW,
    });
    const item2 = makeItem({
      sourceId: 'src-2',
      title: 'Technology Stocks Rally',
      url: 'https://b.com/1',
      canonicalUrl: 'https://b.com/1',
      urlHash: 'hash_b1',
      publishedAt: FIXED_NOW + 1000,
    });

    const bundles = clusterItems([item1, item2], sources, { nowFn });
    expect(bundles).toHaveLength(2);
  });

  /* ---------------------------------------------------------------- */
  /*  Provenance                                                      */
  /* ---------------------------------------------------------------- */

  it('preserves all sources in provenance (no dropped URLs)', () => {
    const items = [
      makeItem({
        sourceId: 'src-1',
        title: 'Climate Change News',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
        publishedAt: FIXED_NOW,
      }),
      makeItem({
        sourceId: 'src-2',
        title: 'Climate Change Update',
        url: 'https://b.com/1',
        canonicalUrl: 'https://b.com/1',
        urlHash: 'hb',
        publishedAt: FIXED_NOW + 100,
      }),
      makeItem({
        sourceId: 'src-3',
        title: 'Climate Change Report',
        url: 'https://c.com/1',
        canonicalUrl: 'https://c.com/1',
        urlHash: 'hc',
        publishedAt: FIXED_NOW + 200,
      }),
    ];

    const bundles = clusterItems(items, sources, { nowFn });
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.sources).toHaveLength(3);

    const urls = bundles[0]!.sources.map((s) => s.url).sort();
    expect(urls).toEqual([
      'https://a.com/1',
      'https://b.com/1',
      'https://c.com/1',
    ]);
  });

  it('provenance_hash is deterministic', () => {
    const items = [
      makeItem({
        sourceId: 'src-1',
        title: 'Climate Summit',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
      }),
      makeItem({
        sourceId: 'src-2',
        title: 'Climate Summit Update',
        url: 'https://b.com/1',
        canonicalUrl: 'https://b.com/1',
        urlHash: 'hb',
      }),
    ];

    const b1 = clusterItems(items, sources, { nowFn });
    const b2 = clusterItems(items, sources, { nowFn });
    expect(b1[0]!.provenance_hash).toBe(b2[0]!.provenance_hash);
    expect(b1[0]!.provenance_hash).toMatch(/^[0-9a-f]{8}$/);
  });

  /* ---------------------------------------------------------------- */
  /*  Headline & summary selection                                    */
  /* ---------------------------------------------------------------- */

  it('selects headline from earliest item by publishedAt', () => {
    const items = [
      makeItem({
        sourceId: 'src-2',
        title: 'Climate Later',
        url: 'https://b.com/1',
        canonicalUrl: 'https://b.com/1',
        urlHash: 'hb',
        publishedAt: FIXED_NOW + 5000,
        summary: 'Later summary',
      }),
      makeItem({
        sourceId: 'src-1',
        title: 'Climate Earlier',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
        publishedAt: FIXED_NOW,
        summary: 'Earlier summary',
      }),
    ];

    const bundles = clusterItems(items, sources, { nowFn });
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.headline).toBe('Climate Earlier');
    expect(bundles[0]!.summary_hint).toBe('Earlier summary');
  });

  it('uses undefined summary_hint when first item has no summary', () => {
    const item = makeItem({ summary: undefined });
    const bundles = clusterItems([item], sources, { nowFn });
    expect(bundles[0]!.summary_hint).toBeUndefined();
  });

  /* ---------------------------------------------------------------- */
  /*  Cluster window                                                  */
  /* ---------------------------------------------------------------- */

  it('sets cluster_window from min/max publishedAt', () => {
    const items = [
      makeItem({
        sourceId: 'src-1',
        title: 'Climate Change Alpha',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
        publishedAt: FIXED_NOW,
      }),
      makeItem({
        sourceId: 'src-2',
        title: 'Climate Change Beta',
        url: 'https://b.com/1',
        canonicalUrl: 'https://b.com/1',
        urlHash: 'hb',
        publishedAt: FIXED_NOW + 3000,
      }),
    ];

    const bundles = clusterItems(items, sources, { nowFn });
    expect(bundles[0]!.cluster_window_start).toBe(FIXED_NOW);
    expect(bundles[0]!.cluster_window_end).toBe(FIXED_NOW + 3000);
  });

  it('uses nowFn for cluster window when no publishedAt', () => {
    const items = [
      makeItem({
        title: 'Climate Mystery',
        publishedAt: undefined,
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
      }),
    ];

    const bundles = clusterItems(items, sources, { nowFn });
    expect(bundles[0]!.cluster_window_start).toBe(FIXED_NOW);
    expect(bundles[0]!.cluster_window_end).toBe(FIXED_NOW);
  });

  /* ---------------------------------------------------------------- */
  /*  Time bucket features                                            */
  /* ---------------------------------------------------------------- */

  it('sets time_bucket to tb-unknown when no timestamps', () => {
    const items = [
      makeItem({
        title: 'Climate Mystery',
        publishedAt: undefined,
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
      }),
    ];

    const bundles = clusterItems(items, sources, { nowFn });
    expect(bundles[0]!.cluster_features.time_bucket).toBe('tb-unknown');
  });

  it('computes time_bucket from earliest timestamp', () => {
    const items = [makeItem({ publishedAt: FIXED_NOW })];
    const bundles = clusterItems(items, sources, { nowFn });
    const expected = `tb-${Math.floor(FIXED_NOW / SIX_HOURS)}`;
    expect(bundles[0]!.cluster_features.time_bucket).toBe(expected);
  });

  /* ---------------------------------------------------------------- */
  /*  Entity keys                                                     */
  /* ---------------------------------------------------------------- */

  it('limits entity keys to maxEntityKeys', () => {
    const items = [
      makeItem({
        title: 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
      }),
    ];

    const bundles = clusterItems(items, sources, {
      nowFn,
      maxEntityKeys: 3,
    });
    expect(bundles[0]!.cluster_features.entity_keys).toHaveLength(3);
  });

  it('entity_keys are sorted alphabetically', () => {
    const items = [
      makeItem({
        title: 'Zebra Apple Mango',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
      }),
    ];

    const bundles = clusterItems(items, sources, { nowFn });
    const keys = bundles[0]!.cluster_features.entity_keys;
    expect(keys).toEqual([...keys].sort());
  });

  /* ---------------------------------------------------------------- */
  /*  Custom options                                                  */
  /* ---------------------------------------------------------------- */

  it('respects custom timeBucketMs', () => {
    const ONE_HOUR = 60 * 60 * 1000;
    const item1 = makeItem({
      title: 'Climate Update Alpha',
      url: 'https://a.com/1',
      canonicalUrl: 'https://a.com/1',
      urlHash: 'ha',
      publishedAt: FIXED_NOW,
    });
    const item2 = makeItem({
      title: 'Climate Update Beta',
      url: 'https://b.com/1',
      canonicalUrl: 'https://b.com/1',
      urlHash: 'hb',
      publishedAt: FIXED_NOW + ONE_HOUR + 1,
    });

    // With 1-hour buckets, these should be in different buckets
    const bundles = clusterItems([item1, item2], sources, {
      nowFn,
      timeBucketMs: ONE_HOUR,
    });
    expect(bundles).toHaveLength(2);
  });

  it('defaults nowFn to Date.now when not provided', () => {
    const item = makeItem({ publishedAt: undefined });
    const before = Date.now();
    const bundles = clusterItems([item], sources);
    const after = Date.now();

    expect(bundles[0]!.created_at).toBeGreaterThanOrEqual(before);
    expect(bundles[0]!.created_at).toBeLessThanOrEqual(after);
  });

  /* ---------------------------------------------------------------- */
  /*  Schema compliance                                               */
  /* ---------------------------------------------------------------- */

  it('all output bundles pass StoryBundleSchema validation', () => {
    const items = [
      makeItem({
        sourceId: 'src-1',
        title: 'Economy Growth Report',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'h1',
        publishedAt: FIXED_NOW,
      }),
      makeItem({
        sourceId: 'src-2',
        title: 'Economy Growth Forecast',
        url: 'https://b.com/1',
        canonicalUrl: 'https://b.com/1',
        urlHash: 'h2',
        publishedAt: FIXED_NOW + 1000,
      }),
      makeItem({
        sourceId: 'src-3',
        title: 'Technology Innovation Summit',
        url: 'https://c.com/1',
        canonicalUrl: 'https://c.com/1',
        urlHash: 'h3',
        publishedAt: FIXED_NOW + 2000,
      }),
    ];

    const bundles = clusterItems(items, sources, { nowFn });
    for (const bundle of bundles) {
      expect(() => StoryBundleSchema.parse(bundle)).not.toThrow();
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Semantic signature stability                                    */
  /* ---------------------------------------------------------------- */

  it('semantic_signature is stable for same URLs', () => {
    const items = [
      makeItem({
        title: 'Climate Report',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
      }),
    ];

    const b1 = clusterItems(items, sources, { nowFn });
    const b2 = clusterItems(items, sources, { nowFn });
    expect(b1[0]!.cluster_features.semantic_signature).toBe(
      b2[0]!.cluster_features.semantic_signature,
    );
  });

  /* ---------------------------------------------------------------- */
  /*  Items with undefined publishedAt sorting                        */
  /* ---------------------------------------------------------------- */

  it('items without publishedAt sort after items with publishedAt', () => {
    const item1 = makeItem({
      sourceId: 'src-1',
      title: 'Climate Story Timed',
      url: 'https://a.com/1',
      canonicalUrl: 'https://a.com/1',
      urlHash: 'ha',
      publishedAt: FIXED_NOW + 5000,
      summary: 'Timed summary',
    });
    const item2 = makeItem({
      sourceId: 'src-2',
      title: 'Climate Story Untimed',
      url: 'https://b.com/1',
      canonicalUrl: 'https://b.com/1',
      urlHash: 'hb',
      publishedAt: undefined,
      summary: 'Untimed summary',
    });

    // Both in tb-unknown bucket? No — item1 has publishedAt, item2 does not.
    // They'll be in different buckets.
    const bundles = clusterItems([item2, item1], sources, { nowFn });
    // item1 → specific bucket, item2 → tb-unknown bucket
    expect(bundles.length).toBeGreaterThanOrEqual(2);

    // Verify the timed one has proper headline
    const timedBundle = bundles.find((b) =>
      b.cluster_features.time_bucket !== 'tb-unknown',
    );
    expect(timedBundle?.headline).toBe('Climate Story Timed');
  });

  /* ---------------------------------------------------------------- */
  /*  Both items without publishedAt in same cluster                  */
  /* ---------------------------------------------------------------- */

  it('handles multiple items without publishedAt in same cluster', () => {
    const items = [
      makeItem({
        sourceId: 'src-1',
        title: 'Climate Story Alpha',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
        publishedAt: undefined,
        summary: 'Alpha summary',
      }),
      makeItem({
        sourceId: 'src-2',
        title: 'Climate Story Beta',
        url: 'https://b.com/1',
        canonicalUrl: 'https://b.com/1',
        urlHash: 'hb',
        publishedAt: undefined,
        summary: 'Beta summary',
      }),
    ];

    const bundles = clusterItems(items, sources, { nowFn });
    expect(bundles).toHaveLength(1);
    // Both undefined → array order preserved; first item becomes headline
    expect(bundles[0]!.headline).toBe('Climate Story Alpha');
    expect(bundles[0]!.sources).toHaveLength(2);
    expect(bundles[0]!.cluster_features.time_bucket).toBe('tb-unknown');
    expect(() => StoryBundleSchema.parse(bundles[0]!)).not.toThrow();
  });

  /* ---------------------------------------------------------------- */
  /*  Union-find merging: transitive entity key sharing               */
  /* ---------------------------------------------------------------- */

  it('merges items transitively through shared entity keys', () => {
    // A shares "climate" with B, B shares "summit" with C
    // So A, B, C should all be in one cluster
    const items = [
      makeItem({
        sourceId: 'src-1',
        title: 'Climate Policy Debate',
        url: 'https://a.com/1',
        canonicalUrl: 'https://a.com/1',
        urlHash: 'ha',
        publishedAt: FIXED_NOW,
      }),
      makeItem({
        sourceId: 'src-2',
        title: 'Climate Summit Opening',
        url: 'https://b.com/1',
        canonicalUrl: 'https://b.com/1',
        urlHash: 'hb',
        publishedAt: FIXED_NOW + 100,
      }),
      makeItem({
        sourceId: 'src-3',
        title: 'Summit Closing Remarks',
        url: 'https://c.com/1',
        canonicalUrl: 'https://c.com/1',
        urlHash: 'hc',
        publishedAt: FIXED_NOW + 200,
      }),
    ];

    const bundles = clusterItems(items, sources, { nowFn });
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.sources).toHaveLength(3);
  });
});
