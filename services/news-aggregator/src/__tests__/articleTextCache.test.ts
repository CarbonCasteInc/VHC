import { describe, expect, it } from 'vitest';
import {
  ArticleTextCache,
  FAILURE_TTL_MS,
  SUCCESS_TTL_MS,
  articleTextCacheInternal,
  type CachedArticleText,
  type CachedExtractionFailure,
} from '../articleTextCache';

function makeSuccess(overrides: Partial<CachedArticleText> = {}): CachedArticleText {
  return {
    url: 'https://example.com/a',
    urlHash: 'url-hash',
    contentHash: 'content-hash',
    title: 'Example title',
    text: 'full article text for extraction cache testing',
    extractionMethod: 'article-extractor',
    fetchedAt: 10,
    sourceDomain: 'example.com',
    quality: {
      charCount: 200,
      wordCount: 35,
      sentenceCount: 5,
      score: 0.9,
    },
    ...overrides,
  };
}

function makeFailure(overrides: Partial<CachedExtractionFailure> = {}): CachedExtractionFailure {
  return {
    url: 'https://example.com/a',
    urlHash: 'url-hash',
    code: 'fetch-failed',
    message: 'upstream unavailable',
    statusCode: 502,
    retryable: true,
    failedAt: 10,
    ...overrides,
  };
}

describe('ArticleTextCache', () => {
  it('stores and retrieves successes by urlHash and contentHash', () => {
    const cache = new ArticleTextCache();
    const success = makeSuccess();

    cache.rememberSuccess(success);

    expect(cache.get('url-hash')).toEqual({
      keyType: 'urlHash',
      entry: { kind: 'success', value: success },
    });

    expect(cache.get('other-hash', 'content-hash')).toEqual({
      keyType: 'contentHash',
      entry: { kind: 'success', value: success },
    });
  });

  it('stores failures only under urlHash', () => {
    const cache = new ArticleTextCache();
    const failure = makeFailure();

    cache.rememberFailure(failure);

    expect(cache.get('url-hash')).toEqual({
      keyType: 'urlHash',
      entry: { kind: 'failure', value: failure },
    });
    expect(cache.get('missing', 'content-hash')).toBeNull();
  });

  it('links urlHash to contentHash for cached content reuse', () => {
    const cache = new ArticleTextCache();
    cache.rememberSuccess(makeSuccess());

    expect(cache.linkUrlToContent('new-url', 'content-hash')).toBe(true);
    expect(cache.get('new-url')?.entry.kind).toBe('success');
  });

  it('returns false when content-hash link target does not exist', () => {
    const cache = new ArticleTextCache();
    expect(cache.linkUrlToContent('new-url', 'missing')).toBe(false);
  });

  it('expires entries based on success/failure TTL values', () => {
    let now = 100;
    const cache = new ArticleTextCache({
      now: () => now,
      successTtlMs: 20,
      failureTtlMs: 10,
    });

    cache.rememberSuccess(makeSuccess());
    cache.rememberFailure(makeFailure({ urlHash: 'failed-url' }));

    now += 9;
    expect(cache.get('url-hash')).not.toBeNull();
    expect(cache.get('failed-url')).not.toBeNull();

    now += 2;
    expect(cache.get('failed-url')).toBeNull();
    expect(cache.get('url-hash')).not.toBeNull();

    now += 10;
    expect(cache.get('url-hash')).toBeNull();
  });

  it('reports snapshot sizes after clearing expired values', () => {
    let now = 100;
    const cache = new ArticleTextCache({
      now: () => now,
      successTtlMs: 5,
      failureTtlMs: 5,
    });

    cache.rememberSuccess(makeSuccess());
    cache.rememberFailure(makeFailure({ urlHash: 'failed-url' }));

    expect(cache.snapshotSizes()).toEqual({ urlEntries: 2, contentEntries: 1 });

    now += 6;
    expect(cache.snapshotSizes()).toEqual({ urlEntries: 0, contentEntries: 0 });
  });

  it('hashes content deterministically and exports documented TTL constants', () => {
    const cache = new ArticleTextCache();

    expect(cache.hashContent('abc')).toBe(cache.hashContent('abc'));
    expect(articleTextCacheInternal.sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );

    expect(SUCCESS_TTL_MS).toBe(10 * 60 * 1000);
    expect(FAILURE_TTL_MS).toBe(90 * 1000);
  });
});
