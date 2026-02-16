import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FETCH_TIMEOUT_MS,
  MIN_WORD_COUNT,
  countWords,
  fetchFullText,
  stripHtml,
} from './fullTextFetcher';

function makeWords(total: number): string {
  return Array.from({ length: total }, (_, index) => `word${index}`).join(' ');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fetchFullText', () => {
  it('returns eligible=true when fetch succeeds with enough text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`<html><body><article>${makeWords(MIN_WORD_COUNT)}</article></body></html>`, {
          status: 200,
        }),
      ),
    );

    const result = await fetchFullText('https://example.com/success');

    expect(result.eligible).toBe(true);
    expect(result.exclusionReason).toBeUndefined();
    expect(result.extractionMethod).toBe('raw-html');
    expect(result.wordCount).toBe(MIN_WORD_COUNT);
    expect(result.fullText.startsWith('word0 word1')).toBe(true);
    expect(result.fetchedAt).toBeTypeOf('number');
  });

  it('returns paywall for HTTP 402', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('payment required', { status: 402 })));

    const result = await fetchFullText('https://example.com/402');

    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe('paywall');
  });

  it('returns paywall for HTTP 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })));

    const result = await fetchFullText('https://example.com/403');

    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe('paywall');
  });

  it('returns fetch-error for HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('server error', { status: 500 })));

    const result = await fetchFullText('https://example.com/500');

    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe('fetch-error');
  });

  it('returns fetch-error for AbortError (timeout simulation)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        });
      }),
    );

    const pending = fetchFullText('https://example.com/timeout');
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe('fetch-error');
  });

  it('returns fetch-error for network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await fetchFullText('https://example.com/network');

    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe('fetch-error');
  });

  it('returns fetch-error when response text reading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        text: () => Promise.reject(new Error('read failed')),
      } satisfies Pick<Response, 'status' | 'ok' | 'text'>),
    );

    const result = await fetchFullText('https://example.com/read-fail');

    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe('fetch-error');
  });

  it('returns empty for body under 100 chars after strip', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<div>tiny body</div>', { status: 200 })));

    const result = await fetchFullText('https://example.com/empty');

    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe('empty');
  });

  it('returns truncated for body under 200 words but at least 100 chars', async () => {
    const shortButLongEnough = makeWords(MIN_WORD_COUNT - 1);
    expect(shortButLongEnough.length).toBeGreaterThanOrEqual(100);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(`<html><body><p>${shortButLongEnough}</p></body></html>`, { status: 200 })),
    );

    const result = await fetchFullText('https://example.com/truncated');

    expect(result.eligible).toBe(false);
    expect(result.exclusionReason).toBe('truncated');
  });
});

describe('stripHtml', () => {
  it('removes script/style/tags and decodes basic entities', () => {
    const html = [
      '<style>.hide{display:none}</style>',
      '<script>window.x = 1;</script>',
      '<div>Hello <b>world</b>&nbsp;&amp;&lt;ok&gt;&quot;yes&#39;</div>',
    ].join('');

    expect(stripHtml(html)).toBe(`Hello world &<ok>"yes'`);
  });
});

describe('countWords', () => {
  it('counts words correctly and handles empty string', () => {
    expect(countWords('one two   three')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});
