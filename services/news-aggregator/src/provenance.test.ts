import { describe, it, expect } from 'vitest';
import type { FeedSource, StoryBundleSource } from '@vh/data-model';
import { toStoryBundleSource, computeProvenanceHash } from './provenance';
import type { NormalizedFeedItem } from './normalize';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function makeItem(overrides: Partial<NormalizedFeedItem> = {}): NormalizedFeedItem {
  return {
    sourceId: 'src-1',
    url: 'https://example.com/article',
    title: 'Test Article',
    publishedAt: 1700000000000,
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
/*  toStoryBundleSource                                               */
/* ------------------------------------------------------------------ */

describe('toStoryBundleSource', () => {
  it('maps NormalizedFeedItem to StoryBundleSource with publisher name', () => {
    const sources = makeFeedSources(['src-1', 'Example News']);
    const item = makeItem();
    const result = toStoryBundleSource(item, sources);

    expect(result).toEqual({
      source_id: 'src-1',
      publisher: 'Example News',
      url: 'https://example.com/article',
      url_hash: 'aabb1122',
      published_at: 1700000000000,
      title: 'Test Article',
    });
  });

  it('falls back to sourceId when feed source not found', () => {
    const sources = new Map<string, FeedSource>();
    const item = makeItem({ sourceId: 'unknown-src' });
    const result = toStoryBundleSource(item, sources);

    expect(result.publisher).toBe('unknown-src');
    expect(result.source_id).toBe('unknown-src');
  });

  it('preserves undefined published_at', () => {
    const sources = makeFeedSources(['src-1', 'News']);
    const item = makeItem({ publishedAt: undefined });
    const result = toStoryBundleSource(item, sources);

    expect(result.published_at).toBeUndefined();
  });

  it('uses canonicalUrl not original url', () => {
    const sources = makeFeedSources(['src-1', 'News']);
    const item = makeItem({
      url: 'https://example.com/article?utm_source=foo',
      canonicalUrl: 'https://example.com/article',
    });
    const result = toStoryBundleSource(item, sources);

    expect(result.url).toBe('https://example.com/article');
  });
});

/* ------------------------------------------------------------------ */
/*  computeProvenanceHash                                             */
/* ------------------------------------------------------------------ */

describe('computeProvenanceHash', () => {
  it('returns deterministic hash for same sources', () => {
    const sources: StoryBundleSource[] = [
      {
        source_id: 's1',
        publisher: 'Pub A',
        url: 'https://a.com/1',
        url_hash: 'hash_a',
        title: 'Title A',
      },
      {
        source_id: 's2',
        publisher: 'Pub B',
        url: 'https://b.com/1',
        url_hash: 'hash_b',
        title: 'Title B',
      },
    ];

    const hash1 = computeProvenanceHash(sources);
    const hash2 = computeProvenanceHash(sources);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is order-independent (sorts by url_hash)', () => {
    const s1: StoryBundleSource = {
      source_id: 's1',
      publisher: 'A',
      url: 'https://a.com',
      url_hash: 'bbb',
      title: 'A',
    };
    const s2: StoryBundleSource = {
      source_id: 's2',
      publisher: 'B',
      url: 'https://b.com',
      url_hash: 'aaa',
      title: 'B',
    };

    expect(computeProvenanceHash([s1, s2])).toBe(
      computeProvenanceHash([s2, s1]),
    );
  });

  it('produces different hashes for different source sets', () => {
    const s1: StoryBundleSource = {
      source_id: 's1',
      publisher: 'A',
      url: 'https://a.com',
      url_hash: 'hash1',
      title: 'A',
    };
    const s2: StoryBundleSource = {
      source_id: 's2',
      publisher: 'B',
      url: 'https://b.com',
      url_hash: 'hash2',
      title: 'B',
    };
    const s3: StoryBundleSource = {
      source_id: 's3',
      publisher: 'C',
      url: 'https://c.com',
      url_hash: 'hash3',
      title: 'C',
    };

    expect(computeProvenanceHash([s1, s2])).not.toBe(
      computeProvenanceHash([s1, s3]),
    );
  });

  it('handles single source', () => {
    const s: StoryBundleSource = {
      source_id: 's1',
      publisher: 'A',
      url: 'https://a.com',
      url_hash: 'onlyhash',
      title: 'A',
    };

    const hash = computeProvenanceHash([s]);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('does not mutate input array', () => {
    const sources: StoryBundleSource[] = [
      {
        source_id: 's2',
        publisher: 'B',
        url: 'https://b.com',
        url_hash: 'zzz',
        title: 'B',
      },
      {
        source_id: 's1',
        publisher: 'A',
        url: 'https://a.com',
        url_hash: 'aaa',
        title: 'A',
      },
    ];
    const original = [...sources];
    computeProvenanceHash(sources);
    expect(sources).toEqual(original);
  });
});
