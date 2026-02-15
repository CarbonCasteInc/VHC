import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  extractEntityKeys,
  newsNormalizeInternal,
  normalizeAndDedup,
} from '../newsNormalize';
import type { RawFeedItem } from '../newsTypes';

describe('newsNormalize', () => {
  it('canonicalizes URLs by stripping tracking params and ordering query keys', () => {
    const canonical = canonicalizeUrl(
      'HTTPS://Example.com/story/?utm_source=x&z=2&fbclid=bad&a=1#fragment',
    );

    expect(canonical).toBe('https://example.com/story?a=1&z=2');
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(canonicalizeUrl('not-a-url')).toBe('not-a-url');

    expect(newsNormalizeInternal.isTrackingParam('utm_campaign')).toBe(true);
    expect(newsNormalizeInternal.isTrackingParam('fbclid')).toBe(true);
    expect(newsNormalizeInternal.isTrackingParam('non_tracking')).toBe(false);
  });

  it('normalizes and deduplicates exact canonical URL collisions', () => {
    const items: RawFeedItem[] = [
      {
        sourceId: 'src-a',
        url: 'https://example.com/story/?utm_source=abc&id=1',
        title: 'Headline one',
        publishedAt: 1707134400000,
      },
      {
        sourceId: 'src-a',
        url: 'https://example.com/story/?id=1',
        title: 'Headline one duplicate',
        publishedAt: 1707134405000,
      },
      {
        sourceId: 'src-a',
        url: 'https://example.com/story/2',
        title: 'Headline two',
        publishedAt: 1707138000000,
      },
    ];

    const normalized = normalizeAndDedup(items);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toMatchObject({
      sourceId: 'src-a',
      publisher: 'src-a',
      canonicalUrl: 'https://example.com/story?id=1',
    });
    expect(normalized[0]?.url_hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('deduplicates near-duplicate title/time in same source and honors configurable window', () => {
    const items: RawFeedItem[] = [
      {
        sourceId: 'src-a',
        url: 'https://example.com/a',
        title: 'Breaking Market Update',
        publishedAt: 1707134400000,
      },
      {
        sourceId: 'src-a',
        url: 'https://example.com/b',
        title: 'Breaking market update!!',
        publishedAt: 1707136200000,
      },
      {
        sourceId: 'src-b',
        url: 'https://example.com/c',
        title: 'Breaking market update',
        publishedAt: 1707136200000,
      },
      {
        sourceId: 'src-c',
        url: 'https://example.com/d',
        title: 'Untimed duplicate title',
      },
      {
        sourceId: 'src-c',
        url: 'https://example.com/e',
        title: 'Untimed duplicate title',
      },
    ];

    const defaultWindow = normalizeAndDedup(items);
    expect(defaultWindow).toHaveLength(3);
    expect(defaultWindow.map((item) => item.sourceId)).toEqual(['src-a', 'src-b', 'src-c']);

    const shortWindow = normalizeAndDedup(items, { nearDuplicateWindowMs: 1_000 });
    expect(shortWindow).toHaveLength(4);
  });

  it('extracts stable entity keys and covers internal title normalization', () => {
    expect(extractEntityKeys('Markets surge after central bank policy meeting')).toEqual([
      'bank',
      'central',
      'markets',
      'meeting',
      'policy',
      'surge',
    ]);

    expect(newsNormalizeInternal.normalizeTitle('  HELLO, World!!  ')).toBe('hello world');
  });
});
