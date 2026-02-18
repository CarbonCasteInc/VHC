import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArticleTextCache } from '../articleTextCache';
import {
  ArticleTextService,
  ArticleTextServiceError,
  BACKOFF_BASE_MS,
  FETCH_TIMEOUT_MS,
  MAX_ATTEMPTS,
  MIN_CHAR_COUNT,
  MIN_QUALITY_SCORE,
  MIN_SENTENCE_COUNT,
  MIN_WORD_COUNT,
  articleTextServiceInternal,
} from '../articleTextService';
import { urlHash } from '../normalize';
import { RemovalLedger } from '../removalLedger';
import { SourceLifecycleTracker } from '../sourceLifecycle';

const { extractMock } = vi.hoisted(() => ({
  extractMock: vi.fn(),
}));

vi.mock('@extractus/article-extractor', () => ({
  extract: extractMock,
}));

function makeWords(total: number): string {
  return Array.from({ length: total }, (_, index) => `word${index}`).join(' ');
}

function makeHtml(body: string, title = 'Example Title'): string {
  return `<html><head><title>${title}</title></head><body><article>${body}</article></body></html>`;
}

beforeEach(() => {
  extractMock.mockReset();
});

describe('ArticleTextService', () => {
  it('rejects invalid URLs and non-allowlisted domains', async () => {
    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
    });

    await expect(service.extract('not-a-url')).rejects.toMatchObject({
      code: 'invalid-url',
      statusCode: 400,
    });

    await expect(service.extract('https://blocked.com/story')).rejects.toMatchObject({
      code: 'domain-not-allowed',
      statusCode: 403,
    });
  });

  it('rejects extraction when URL exists in removal ledger', async () => {
    const ledger = new RemovalLedger();
    await ledger.write('https://allowed.com/removed-story', 'manual');

    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      removalLedger: ledger,
    });

    await expect(service.extract('https://allowed.com/removed-story')).rejects.toMatchObject({
      code: 'removed',
      statusCode: 410,
    });
  });

  it('serves url-hash cache hits without refetching', async () => {
    const cache = new ArticleTextCache();
    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      cache,
      fetchFn: vi.fn(),
    });

    const text = makeWords(220);
    const url = 'https://allowed.com/story';

    cache.rememberSuccess({
      url,
      urlHash: urlHash(url),
      contentHash: cache.hashContent(makeHtml(text)),
      title: 'Cached',
      text,
      extractionMethod: 'article-extractor',
      fetchedAt: 1,
      sourceDomain: 'allowed.com',
      quality: { charCount: text.length, wordCount: 220, sentenceCount: 8, score: 0.95 },
    });

    const result = await service.extract(url);
    expect(result.cacheHit).toBe('urlHash');
    expect(result.attempts).toBe(0);
  });

  it('returns cached failure responses from url-hash cache', async () => {
    const cache = new ArticleTextCache();
    const url = 'https://allowed.com/fail';

    cache.rememberFailure({
      url,
      urlHash: urlHash(url),
      code: 'quality-too-low',
      message: 'too short',
      statusCode: 422,
      retryable: false,
      failedAt: 1,
    });

    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      cache,
      fetchFn: vi.fn(),
    });

    await expect(service.extract(url)).rejects.toMatchObject({
      code: 'quality-too-low',
      statusCode: 422,
    });
  });

  it('retries retryable fetch failures, then succeeds and records lifecycle metadata', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(makeHtml(makeWords(220)), { status: 200 }));

    const sleep = vi.fn().mockResolvedValue(undefined);
    const lifecycle = new SourceLifecycleTracker({ now: () => 1_000 });

    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn,
      sleep,
      lifecycle,
    });

    const result = await service.extract('https://allowed.com/retry-story');

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(BACKOFF_BASE_MS);
    expect(result.cacheHit).toBe('none');
    expect(result.attempts).toBe(2);

    const state = lifecycle.getState('allowed.com');
    expect(state?.retryCount).toBe(1);
    expect(state?.status).toBe('healthy');
  });

  it('uses fallback extractor when primary output fails quality thresholds', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(makeHtml(makeWords(260), 'Fallback Title'), { status: 200 }),
    );

    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn,
      primaryExtractor: vi.fn().mockResolvedValue({
        title: 'Primary',
        text: 'tiny text',
      }),
      fallbackExtractor: vi.fn().mockReturnValue({
        title: 'Fallback',
        text: makeWords(260),
      }),
    });

    const result = await service.extract('https://allowed.com/fallback-story');

    expect(result.extractionMethod).toBe('html-fallback');
    expect(result.title).toBe('Fallback');
    expect(result.cacheHit).toBe('none');
  });

  it('raises quality-too-low when both extraction passes fail', async () => {
    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(makeHtml('short body'), { status: 200 }),
      ),
      primaryExtractor: vi.fn().mockResolvedValue(null),
      fallbackExtractor: vi.fn().mockReturnValue(null),
    });

    await expect(service.extract('https://allowed.com/no-content')).rejects.toMatchObject({
      code: 'quality-too-low',
      statusCode: 422,
    });
  });

  it('raises quality-too-low and caches terminal failures', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(makeHtml('too short'), { status: 200 }),
    );

    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn,
      primaryExtractor: vi.fn().mockResolvedValue({ title: 'P', text: 'tiny' }),
      fallbackExtractor: vi.fn().mockReturnValue({ title: 'F', text: 'tiny' }),
    });

    await expect(service.extract('https://allowed.com/quality')).rejects.toMatchObject({
      code: 'quality-too-low',
      statusCode: 422,
    });

    const firstCallCount = fetchFn.mock.calls.length;
    await expect(service.extract('https://allowed.com/quality')).rejects.toMatchObject({
      code: 'quality-too-low',
      statusCode: 422,
    });
    expect(fetchFn.mock.calls.length).toBe(firstCallCount);
  });

  it('reuses content-hash cache across different URLs', async () => {
    const html = makeHtml(makeWords(240), 'Shared Story');
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(html, { status: 200 }));

    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn,
      primaryExtractor: vi.fn().mockResolvedValue({ title: 'Shared Story', text: makeWords(240) }),
    });

    const first = await service.extract('https://allowed.com/story-a');
    const second = await service.extract('https://allowed.com/story-b');

    expect(first.cacheHit).toBe('none');
    expect(second.cacheHit).toBe('contentHash');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('maps non-service runtime exceptions in extract loop to fetch-failed', async () => {
    const baseOptions = {
      allowlist: new Set(['allowed.com']),
      fetchFn: vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response(makeHtml(makeWords(200)), { status: 200 })),
      maxAttempts: 1,
    };

    const errorService = new ArticleTextService({
      ...baseOptions,
      primaryExtractor: vi.fn().mockRejectedValue(new Error('extractor exploded')),
    });

    await expect(errorService.extract('https://allowed.com/loop-error')).rejects.toMatchObject({
      code: 'fetch-failed',
      retryable: true,
      message: 'extractor exploded',
    });

    const stringService = new ArticleTextService({
      ...baseOptions,
      primaryExtractor: vi.fn().mockRejectedValue('string failure'),
    });

    await expect(stringService.extract('https://allowed.com/loop-string')).rejects.toMatchObject({
      code: 'fetch-failed',
      retryable: true,
      message: 'Article fetch failed',
    });
  });

  it('throws non-retryable failures after max attempts and caches them', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('bad request', { status: 400 }));
    const lifecycle = new SourceLifecycleTracker();

    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn,
      lifecycle,
      maxAttempts: 2,
    });

    await expect(service.extract('https://allowed.com/non-retry')).rejects.toMatchObject({
      code: 'fetch-failed',
      retryable: false,
    });

    const state = lifecycle.getState('allowed.com');
    expect(state?.status).toBe('failing');
    expect(state?.totalFailures).toBe(1);
  });

  it('exports service constants and utility internals', async () => {
    expect(FETCH_TIMEOUT_MS).toBe(12_000);
    expect(MAX_ATTEMPTS).toBe(3);
    expect(MIN_CHAR_COUNT).toBe(800);
    expect(MIN_WORD_COUNT).toBe(160);
    expect(MIN_SENTENCE_COUNT).toBe(4);
    expect(MIN_QUALITY_SCORE).toBe(0.7);

    expect(articleTextServiceInternal.countWords('one two three')).toBe(3);
    expect(articleTextServiceInternal.countWords('   ')).toBe(0);
    expect(articleTextServiceInternal.countSentences('A. B? C!')).toBe(3);
    expect(articleTextServiceInternal.isRetryableStatus(503)).toBe(true);
    expect(articleTextServiceInternal.isRetryableStatus(404)).toBe(false);
    expect(articleTextServiceInternal.backoffForAttempt(2)).toBe(BACKOFF_BASE_MS * 2);

    const title = articleTextServiceInternal.extractTitle('<title> Hello </title>');
    expect(title).toBe('Hello');
    expect(articleTextServiceInternal.extractTitle('<div>No title</div>')).toBe('');

    const normalized = articleTextServiceInternal.normalizeWhitespace('A\n\tB&nbsp;&amp;C');
    expect(normalized).toBe('A B &C');

    const stripped = articleTextServiceInternal.stripNonContentTags(
      '<script>x</script><style>y</style><p>Body</p>',
    );
    expect(stripped).toContain('<p>Body</p>');

    const fallback = articleTextServiceInternal.defaultFallbackExtractor(
      'https://allowed.com',
      '<html><title>T</title><body><p>alpha beta gamma</p></body></html>',
    );
    expect(fallback).not.toBeNull();

    const fallbackWithoutSemanticBlocks = articleTextServiceInternal.defaultFallbackExtractor(
      'https://allowed.com',
      '<html><title>T</title><body><div>alpha beta gamma</div></body></html>',
    );
    expect(fallbackWithoutSemanticBlocks).not.toBeNull();

    const emptyFallback = articleTextServiceInternal.defaultFallbackExtractor(
      'https://allowed.com',
      '<html><body><script>x</script></body></html>',
    );
    expect(emptyFallback).toBeNull();

    const quality = articleTextServiceInternal.assessQuality(makeWords(200), 10, 10, 1);
    expect(quality.score).toBeGreaterThan(0);

    await articleTextServiceInternal.defaultSleep(0);

    extractMock.mockResolvedValueOnce({
      title: 'Primary Title',
      content: `<article>${makeWords(220)}</article>`,
    });

    const primary = await articleTextServiceInternal.defaultPrimaryExtractor(
      'https://allowed.com',
      makeHtml(makeWords(220), 'Primary Title'),
    );
    expect(primary?.title).toBe('Primary Title');

    extractMock.mockResolvedValueOnce({ content: `<article>${makeWords(220)}</article>` });
    const primaryWithFallbackTitle = await articleTextServiceInternal.defaultPrimaryExtractor(
      'https://allowed.com',
      makeHtml(makeWords(220), 'Fallback Document Title'),
    );
    expect(primaryWithFallbackTitle?.title).toBe('Fallback Document Title');

    extractMock.mockResolvedValueOnce({ title: '', content: '' });
    const emptyPrimary = await articleTextServiceInternal.defaultPrimaryExtractor(
      'https://allowed.com',
      makeHtml('short'),
    );
    expect(emptyPrimary).toBeNull();
  });

  it('maps unknown runtime errors to fetch-failed errors', async () => {
    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue('offline'),
      maxAttempts: 1,
    });

    await expect(service.extract('https://allowed.com/offline')).rejects.toBeInstanceOf(ArticleTextServiceError);
  });

  it('maps AbortError to fetch-timeout failure message', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(abortError),
      maxAttempts: 1,
    });

    await expect(service.extract('https://allowed.com/timeout')).rejects.toMatchObject({
      code: 'fetch-failed',
      message: 'Article fetch timed out',
    });
  });

  it('treats non-abort DOMException as normal fetch error', async () => {
    const domError = new DOMException('dom failure', 'NetworkError');
    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(domError),
      maxAttempts: 1,
    });

    await expect(service.extract('https://allowed.com/dom-error')).rejects.toMatchObject({
      code: 'fetch-failed',
      message: 'dom failure',
    });
  });

  it('uses Error.message when fetch rejects with non-abort Error', async () => {
    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(new Error('network down')),
      maxAttempts: 1,
    });

    await expect(service.extract('https://allowed.com/network-error')).rejects.toMatchObject({
      code: 'fetch-failed',
      message: 'network down',
    });
  });

  it('uses terminal fallback error path when maxAttempts is 0', async () => {
    const service = new ArticleTextService({
      allowlist: new Set(['allowed.com']),
      maxAttempts: 0,
    });

    await expect(service.extract('https://allowed.com/no-attempts')).rejects.toMatchObject({
      code: 'fetch-failed',
      message: 'Article extraction failed',
    });
  });
});
