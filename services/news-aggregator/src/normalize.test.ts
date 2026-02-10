import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  urlHash,
  normalizeItem,
  dedup,
  normalizeAndDedup,
  type NormalizedFeedItem,
} from './normalize';
import type { RawFeedItem } from '@vh/data-model';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

function makeItem(overrides: Partial<RawFeedItem> = {}): RawFeedItem {
  return {
    sourceId: 'src-1',
    url: 'https://example.com/article',
    title: 'Test Article',
    publishedAt: 1700000000000,
    ...overrides,
  };
}

function makeNormalized(
  overrides: Partial<RawFeedItem> & Partial<Pick<NormalizedFeedItem, 'canonicalUrl' | 'urlHash'>> = {},
): NormalizedFeedItem {
  const item = makeItem(overrides);
  const canonical = overrides.canonicalUrl ?? canonicalizeUrl(item.url) ?? item.url;
  const hash = overrides.urlHash ?? urlHash(canonical);
  return {
    ...item,
    canonicalUrl: canonical,
    urlHash: hash,
  };
}

/* ------------------------------------------------------------------ */
/*  canonicalizeUrl                                                    */
/* ------------------------------------------------------------------ */

describe('canonicalizeUrl', () => {
  it('lowercases scheme and host', () => {
    expect(canonicalizeUrl('HTTPS://EXAMPLE.COM/Path')).toBe(
      'https://example.com/Path',
    );
  });

  it('strips UTM tracking params', () => {
    const url = 'https://example.com/a?utm_source=twitter&utm_medium=social&keep=1';
    const result = canonicalizeUrl(url);
    expect(result).toBe('https://example.com/a?keep=1');
  });

  it('strips fbclid', () => {
    const url = 'https://example.com/a?fbclid=abc123';
    expect(canonicalizeUrl(url)).toBe('https://example.com/a');
  });

  it('strips gclid and gclsrc', () => {
    const url = 'https://example.com/a?gclid=x&gclsrc=y';
    expect(canonicalizeUrl(url)).toBe('https://example.com/a');
  });

  it('strips msclkid', () => {
    expect(canonicalizeUrl('https://a.com?msclkid=z')).toBe('https://a.com/');
  });

  it('strips dclid', () => {
    expect(canonicalizeUrl('https://a.com/p?dclid=abc')).toBe('https://a.com/p');
  });

  it('strips mc_cid and mc_eid', () => {
    expect(canonicalizeUrl('https://a.com?mc_cid=1&mc_eid=2')).toBe('https://a.com/');
  });

  it('strips oly_anon_id and oly_enc_id', () => {
    expect(canonicalizeUrl('https://a.com?oly_anon_id=x&oly_enc_id=y')).toBe(
      'https://a.com/',
    );
  });

  it('strips _ga and _gl', () => {
    expect(canonicalizeUrl('https://a.com?_ga=1&_gl=2')).toBe('https://a.com/');
  });

  it('strips ref and source params', () => {
    expect(canonicalizeUrl('https://a.com/p?ref=twitter&source=share')).toBe(
      'https://a.com/p',
    );
  });

  it('strips utm_id, utm_term, utm_content', () => {
    const url = 'https://a.com?utm_id=1&utm_term=kw&utm_content=cta';
    expect(canonicalizeUrl(url)).toBe('https://a.com/');
  });

  it('is case-insensitive for tracking param names', () => {
    expect(canonicalizeUrl('https://a.com?UTM_SOURCE=x')).toBe('https://a.com/');
  });

  it('sorts remaining query params', () => {
    const url = 'https://example.com/a?z=1&a=2&m=3';
    expect(canonicalizeUrl(url)).toBe('https://example.com/a?a=2&m=3&z=1');
  });

  it('removes trailing slash from path (non-root)', () => {
    expect(canonicalizeUrl('https://example.com/path/')).toBe(
      'https://example.com/path',
    );
  });

  it('keeps root slash', () => {
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('removes default port 443 for https', () => {
    expect(canonicalizeUrl('https://example.com:443/p')).toBe(
      'https://example.com/p',
    );
  });

  it('removes default port 80 for http', () => {
    expect(canonicalizeUrl('http://example.com:80/p')).toBe(
      'http://example.com/p',
    );
  });

  it('keeps non-default port', () => {
    expect(canonicalizeUrl('https://example.com:8080/p')).toBe(
      'https://example.com:8080/p',
    );
  });

  it('strips fragment', () => {
    expect(canonicalizeUrl('https://example.com/a#section')).toBe(
      'https://example.com/a',
    );
  });

  it('returns null for invalid URL', () => {
    expect(canonicalizeUrl('not-a-url')).toBeNull();
  });

  it('returns null for non-http protocol', () => {
    expect(canonicalizeUrl('ftp://files.example.com/f')).toBeNull();
  });

  it('returns null for javascript: protocol', () => {
    // eslint-disable-next-line no-script-url
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('handles URL with no query or fragment', () => {
    expect(canonicalizeUrl('https://example.com/clean')).toBe(
      'https://example.com/clean',
    );
  });

  it('removes multiple trailing slashes', () => {
    expect(canonicalizeUrl('https://example.com/path///')).toBe(
      'https://example.com/path',
    );
  });
});

/* ------------------------------------------------------------------ */
/*  urlHash                                                           */
/* ------------------------------------------------------------------ */

describe('urlHash', () => {
  it('returns an 8-character hex string', () => {
    const hash = urlHash('https://example.com/article');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    const a = urlHash('https://example.com/a');
    const b = urlHash('https://example.com/a');
    expect(a).toBe(b);
  });

  it('produces different hashes for different URLs', () => {
    const a = urlHash('https://example.com/a');
    const b = urlHash('https://example.com/b');
    expect(a).not.toBe(b);
  });

  it('handles empty string', () => {
    const hash = urlHash('');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

/* ------------------------------------------------------------------ */
/*  normalizeItem                                                     */
/* ------------------------------------------------------------------ */

describe('normalizeItem', () => {
  it('adds canonicalUrl and urlHash', () => {
    const result = normalizeItem(makeItem());
    expect(result).not.toBeNull();
    expect(result!.canonicalUrl).toBe('https://example.com/article');
    expect(result!.urlHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('strips tracking params in canonical URL', () => {
    const item = makeItem({
      url: 'https://example.com/a?utm_source=twitter',
    });
    const result = normalizeItem(item);
    expect(result!.canonicalUrl).toBe('https://example.com/a');
  });

  it('preserves original item fields', () => {
    const item = makeItem({ summary: 'hello', author: 'Alice' });
    const result = normalizeItem(item);
    expect(result!.sourceId).toBe('src-1');
    expect(result!.title).toBe('Test Article');
    expect(result!.summary).toBe('hello');
    expect(result!.author).toBe('Alice');
  });

  it('returns null for un-parseable URL', () => {
    const item = makeItem({ url: 'not-valid' as unknown as string });
    // RawFeedItem's url field is validated by Zod, but normalizeItem
    // handles any string defensively
    expect(normalizeItem({ ...item, url: 'not-valid' } as RawFeedItem)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  dedup                                                             */
/* ------------------------------------------------------------------ */

describe('dedup', () => {
  it('removes exact URL duplicates (same urlHash)', () => {
    const a = makeNormalized({ sourceId: 'src-1' });
    const b = makeNormalized({ sourceId: 'src-2' });
    // Same URL → same urlHash
    const result = dedup([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].sourceId).toBe('src-1'); // first wins
  });

  it('keeps items with different URLs and different titles', () => {
    const a = makeNormalized({ url: 'https://a.com/1', title: 'Alpha Article' });
    const b = makeNormalized({ url: 'https://b.com/2', title: 'Beta Article' });
    const result = dedup([a, b]);
    expect(result).toHaveLength(2);
  });

  it('removes near-duplicate titles in same time window', () => {
    const t = 1700000000000;
    const a = makeNormalized({
      url: 'https://a.com/1',
      title: 'Breaking: Markets Rise!',
      publishedAt: t,
    });
    const b = makeNormalized({
      url: 'https://b.com/2',
      title: 'breaking markets rise',
      publishedAt: t + 1000, // same 1h bucket
    });
    const result = dedup([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].canonicalUrl).toContain('a.com');
  });

  it('keeps near-duplicate titles in different time windows', () => {
    const t = 1700000000000;
    const a = makeNormalized({
      url: 'https://a.com/1',
      title: 'Markets Rise',
      publishedAt: t,
    });
    const b = makeNormalized({
      url: 'https://b.com/2',
      title: 'Markets Rise',
      publishedAt: t + 2 * 60 * 60 * 1000, // 2h later → different bucket
    });
    const result = dedup([a, b]);
    expect(result).toHaveLength(2);
  });

  it('respects custom window size', () => {
    const t = 1700000000000;
    const a = makeNormalized({
      url: 'https://a.com/1',
      title: 'Same Title',
      publishedAt: t,
    });
    const b = makeNormalized({
      url: 'https://b.com/2',
      title: 'Same Title',
      publishedAt: t + 30 * 60 * 1000, // 30 min later
    });
    // Default 1h window → same bucket → deduped
    expect(dedup([a, b])).toHaveLength(1);
    // Tiny 10-min window → different bucket → kept
    expect(dedup([a, b], 10 * 60 * 1000)).toHaveLength(2);
  });

  it('handles items without publishedAt (time bucket = "unknown")', () => {
    const a = makeNormalized({
      url: 'https://a.com/1',
      title: 'No Time',
      publishedAt: undefined,
    });
    const b = makeNormalized({
      url: 'https://b.com/2',
      title: 'No Time',
      publishedAt: undefined,
    });
    // Same title, both "unknown" bucket → deduped
    const result = dedup([a, b]);
    expect(result).toHaveLength(1);
  });

  it('returns empty for empty input', () => {
    expect(dedup([])).toEqual([]);
  });

  it('handles single item', () => {
    const a = makeNormalized();
    expect(dedup([a])).toEqual([a]);
  });
});

/* ------------------------------------------------------------------ */
/*  normalizeAndDedup                                                 */
/* ------------------------------------------------------------------ */

describe('normalizeAndDedup', () => {
  it('normalizes and deduplicates in one pass', () => {
    const items: RawFeedItem[] = [
      makeItem({ url: 'https://example.com/a?utm_source=tw' }),
      makeItem({
        sourceId: 'src-2',
        url: 'https://example.com/a?utm_medium=social',
      }),
    ];
    const result = normalizeAndDedup(items);
    expect(result).toHaveLength(1);
    expect(result[0].canonicalUrl).toBe('https://example.com/a');
  });

  it('drops items with invalid URLs', () => {
    const items: RawFeedItem[] = [
      makeItem(),
      { ...makeItem(), url: 'ftp://bad.com/file' } as RawFeedItem,
    ];
    const result = normalizeAndDedup(items);
    expect(result).toHaveLength(1);
  });

  it('returns empty for empty input', () => {
    expect(normalizeAndDedup([])).toEqual([]);
  });

  it('applies near-dupe title dedup', () => {
    const t = 1700000000000;
    const items: RawFeedItem[] = [
      makeItem({ url: 'https://a.com/1', title: 'Big News!', publishedAt: t }),
      makeItem({
        url: 'https://b.com/2',
        title: 'big news',
        publishedAt: t + 1000,
      }),
    ];
    const result = normalizeAndDedup(items);
    expect(result).toHaveLength(1);
  });

  it('accepts custom windowMs', () => {
    const t = 1700000000000;
    const items: RawFeedItem[] = [
      makeItem({ url: 'https://a.com/1', title: 'Same', publishedAt: t }),
      makeItem({
        url: 'https://b.com/2',
        title: 'Same',
        publishedAt: t + 30 * 60 * 1000,
      }),
    ];
    // 10 min window → different bucket → both kept
    expect(normalizeAndDedup(items, 10 * 60 * 1000)).toHaveLength(2);
  });

  it('preserves order (first wins)', () => {
    const items: RawFeedItem[] = [
      makeItem({
        sourceId: 'first',
        url: 'https://example.com/a?ref=a',
      }),
      makeItem({
        sourceId: 'second',
        url: 'https://example.com/a?ref=b',
      }),
    ];
    const result = normalizeAndDedup(items);
    expect(result[0].sourceId).toBe('first');
  });
});
