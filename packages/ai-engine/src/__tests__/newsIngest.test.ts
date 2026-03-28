import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestFeeds, newsIngestInternal } from '../newsIngest';
import type { FeedSource } from '../newsTypes';

const rssXml = `
  <rss>
    <channel>
      <item>
        <title><![CDATA[Markets rally &amp; recover]]></title>
        <link>https://example.com/news?id=1</link>
        <description><![CDATA[Detailed <b>summary</b>]]></description>
        <pubDate>Mon, 05 Feb 2024 12:00:00 GMT</pubDate>
        <author>Reporter One</author>
      </item>
    </channel>
  </rss>
`;

const atomXml = `
  <feed>
    <entry>
      <title>Policy update released</title>
      <link href="https://atom.example.com/story/42" />
      <summary>Atom summary</summary>
      <updated>2024-02-05T13:00:00Z</updated>
      <author><name>Editor Two</name></author>
    </entry>
  </feed>
`;

const rssXmlWithBlankOptionalFields = `
  <rss>
    <channel>
      <item>
        <title>Policy desk update</title>
        <link>https://example.com/news?id=blank-fields</link>
        <description>   </description>
        <author></author>
      </item>
    </channel>
  </rss>
`;

const multiItemRssXml = `
  <rss>
    <channel>
      <item>
        <title>Newest headline</title>
        <link>https://example.com/news/newest</link>
        <pubDate>Mon, 05 Feb 2024 14:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Middle headline</title>
        <link>https://example.com/news/middle</link>
        <pubDate>Mon, 05 Feb 2024 13:00:00 GMT</pubDate>
      </item>
      <item>
        <title>Oldest headline</title>
        <link>https://example.com/news/oldest</link>
        <pubDate>Mon, 05 Feb 2024 12:00:00 GMT</pubDate>
      </item>
    </channel>
  </rss>
`;

const apHubHtml = `
  <!DOCTYPE html>
  <html class="TagPage" data-named-page-type="Hub">
    <body>
      <a href="https://apnews.com/article/policy-shift-111">AP policy shift headline</a>
      <a href="https://apnews.com/article/policy-shift-111">AP policy shift headline</a>
      <a href="https://apnews.com/article/budget-vote-222">Budget vote clears committee</a>
    </body>
  </html>
`;

describe('newsIngest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('ingests RSS and Atom items from enabled feeds', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, text: vi.fn().mockResolvedValue(rssXml) } as unknown as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, text: vi.fn().mockResolvedValue(atomXml) } as unknown as Response);

    const sources: FeedSource[] = [
      {
        id: 'src-rss',
        name: 'RSS Publisher',
        rssUrl: 'https://rss.example.com/feed.xml',
        enabled: true,
      },
      {
        id: 'src-atom',
        name: 'Atom Publisher',
        rssUrl: 'https://atom.example.com/feed.xml',
        enabled: true,
      },
      {
        id: 'src-disabled',
        name: 'Disabled Publisher',
        rssUrl: 'https://disabled.example.com/feed.xml',
        enabled: false,
      },
    ];

    const items = await ingestFeeds(sources);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceId: 'src-atom',
      title: 'Policy update released',
      url: 'https://atom.example.com/story/42',
      summary: 'Atom summary',
    });
    expect(items[1]).toMatchObject({
      sourceId: 'src-rss',
      title: 'Markets rally & recover',
      url: 'https://example.com/news?id=1',
      summary: 'Detailed summary',
      author: 'Reporter One',
    });
    expect(items[0]?.publishedAt).toBeTypeOf('number');
  });

  it('skips invalid feed sources and handles fetch failures with warnings', async () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response);
    fetchMock.mockRejectedValueOnce('network down');
    fetchMock.mockRejectedValueOnce(new Error('network error object'));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: vi
        .fn()
        .mockResolvedValue(
          '<rss><channel><item><title>Bad URL</title><link>not-a-url</link></item></channel></rss>',
        ),
    } as unknown as Response);

    const items = await ingestFeeds([
      {
        id: 'src-http-error',
        name: 'HTTP Error Feed',
        rssUrl: 'https://http-error.example.com/feed.xml',
        enabled: true,
      },
      {
        id: 'src-network-error',
        name: 'Network Error Feed',
        rssUrl: 'https://network-error.example.com/feed.xml',
        enabled: true,
      },
      {
        id: 'src-network-error-object',
        name: 'Network Error Object Feed',
        rssUrl: 'https://network-error-object.example.com/feed.xml',
        enabled: true,
      },
      {
        id: 'src-invalid-item',
        name: 'Invalid Item Feed',
        rssUrl: 'https://invalid-item.example.com/feed.xml',
        enabled: true,
      },
      {
        id: '',
        name: 'Broken Source',
        rssUrl: 'https://broken.example.com/feed.xml',
        enabled: true,
      } as unknown as FeedSource,
    ]);

    expect(items).toEqual([]);
    expect(warningSpy).toHaveBeenCalled();
  });

  it('covers ingest parser internals for edge-case branches', () => {
    expect(newsIngestInternal.extractTagText('<x><title>Hello</title></x>', 'title')).toBe('Hello');
    expect(newsIngestInternal.extractTagText('<x></x>', 'title')).toBeUndefined();

    expect(newsIngestInternal.extractLink('<entry><link href="https://example.com/a" /></entry>')).toBe(
      'https://example.com/a',
    );
    expect(newsIngestInternal.extractLink('<item><link>https://example.com/b</link></item>')).toBe(
      'https://example.com/b',
    );
    expect(newsIngestInternal.extractLink('<item></item>')).toBeUndefined();

    expect(newsIngestInternal.parsePublishedAt('<item><pubDate>Mon, 05 Feb 2024 12:00:00 GMT</pubDate></item>')).toBe(
      1707134400000,
    );
    expect(newsIngestInternal.parsePublishedAt('<item><updated>not-a-date</updated></item>')).toBeUndefined();

    const parsed = newsIngestInternal.parseFeedXml(
      '<rss><channel><item><title>A</title><link>https://example.com/a</link></item></channel></rss>',
      {
        id: 'src',
        name: 'Source',
        rssUrl: 'https://example.com/feed.xml',
        enabled: true,
      },
    );
    expect(parsed).toHaveLength(1);

    const skipped = newsIngestInternal.parseFeedXml(
      '<rss><channel><item><title>No link</title></item></channel></rss>',
      {
        id: 'src',
        name: 'Source',
        rssUrl: 'https://example.com/feed.xml',
        enabled: true,
      },
    );
    expect(skipped).toHaveLength(0);
  });

  it('keeps items when optional summary or author fields are blank', () => {
    const parsed = newsIngestInternal.parseFeedXml(
      rssXmlWithBlankOptionalFields,
      {
        id: 'src',
        name: 'Source',
        rssUrl: 'https://example.com/feed.xml',
        enabled: true,
      },
    );

    expect(parsed).toEqual([
      expect.objectContaining({
        sourceId: 'src',
        title: 'Policy desk update',
        url: 'https://example.com/news?id=blank-fields',
        summary: undefined,
        author: undefined,
      }),
    ]);
  });

  it('falls back to AP html hub parsing when no rss or atom entries exist', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      url: 'https://apnews.com/hub/apf-topnews',
      text: vi.fn().mockResolvedValue(apHubHtml),
    } as unknown as Response);

    const items = await ingestFeeds([
      {
        id: 'ap-topnews',
        name: 'Associated Press Top News',
        rssUrl: 'https://apnews.com/hub/apf-topnews',
        enabled: true,
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.url)).toEqual([
      'https://apnews.com/article/policy-shift-111',
      'https://apnews.com/article/budget-vote-222',
    ]);
    expect(items[0]?.publishedAt).toBeGreaterThan(items[1]?.publishedAt ?? Number.NEGATIVE_INFINITY);
  });

  it('applies per-source and total item budgets using recency ordering', async () => {
    vi.stubEnv('VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE', '2');
    vi.stubEnv('VH_NEWS_FEED_MAX_ITEMS_TOTAL', '3');

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(multiItemRssXml),
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(multiItemRssXml.replaceAll('example.com/news', 'example.com/second')),
    } as unknown as Response);

    const items = await ingestFeeds([
      {
        id: 'source-a',
        name: 'Source A',
        rssUrl: 'https://example.com/a.xml',
        enabled: true,
      },
      {
        id: 'source-b',
        name: 'Source B',
        rssUrl: 'https://example.com/b.xml',
        enabled: true,
      },
    ]);

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.url)).toEqual([
      'https://example.com/news/newest',
      'https://example.com/second/newest',
      'https://example.com/news/middle',
    ]);
  });

  it('retries transient feed fetch failures before succeeding', async () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VH_NEWS_FEED_FETCH_ATTEMPTS', '3');
    vi.stubEnv('VH_NEWS_FEED_FETCH_RETRY_BACKOFF_MS', '1');

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockRejectedValueOnce(new Error('transient network'))
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(rssXml),
      } as unknown as Response);

    const items = await ingestFeeds([
      {
        id: 'source-a',
        name: 'Source A',
        rssUrl: 'https://example.com/a.xml',
        enabled: true,
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(1);
    expect(warningSpy).toHaveBeenCalledWith(
      "[newsIngest] Fetch attempt 1/3 failed for 'source-a'; retrying",
      'transient network',
    );
  });

  it('surfaces the final fetch failure after retries are exhausted', async () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VH_NEWS_FEED_FETCH_ATTEMPTS', '2');
    vi.stubEnv('VH_NEWS_FEED_FETCH_RETRY_BACKOFF_MS', '1');

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockRejectedValue(new Error('still broken'));

    const items = await ingestFeeds([
      {
        id: 'source-a',
        name: 'Source A',
        rssUrl: 'https://example.com/a.xml',
        enabled: true,
      },
    ]);

    expect(items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warningSpy).toHaveBeenCalledWith(
      "[newsIngest] Fetch attempt 1/2 failed for 'source-a'; retrying",
      'still broken',
    );
    expect(warningSpy).toHaveBeenCalledWith(
      "[newsIngest] Failed to fetch feed 'source-a': still broken",
    );
  });

  it('normalizes non-Error final fetch failures into warning text', async () => {
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VH_NEWS_FEED_FETCH_ATTEMPTS', '1');
    vi.stubEnv('VH_NEWS_FEED_FETCH_RETRY_BACKOFF_MS', '1');

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockRejectedValue('plain-string-failure');

    const items = await ingestFeeds([
      {
        id: 'source-a',
        name: 'Source A',
        rssUrl: 'https://example.com/a.xml',
        enabled: true,
      },
    ]);

    expect(items).toEqual([]);
    expect(warningSpy).toHaveBeenCalledWith(
      "[newsIngest] Failed to fetch feed 'source-a': plain-string-failure",
    );
  });

  it('parses ingest env helpers and stable recency sort tie-breakers', () => {
    expect(newsIngestInternal.readPositiveIntEnv('VH_NEWS_FEED_MAX_ITEMS_TOTAL')).toBeUndefined();

    vi.stubEnv('VH_NEWS_FEED_MAX_ITEMS_TOTAL', '12');
    expect(newsIngestInternal.readEnvVar('VH_NEWS_FEED_MAX_ITEMS_TOTAL')).toBe('12');
    expect(newsIngestInternal.readPositiveIntEnv('VH_NEWS_FEED_MAX_ITEMS_TOTAL')).toBe(12);

    vi.stubEnv('VH_NEWS_FEED_MAX_ITEMS_TOTAL', '0');
    expect(newsIngestInternal.readPositiveIntEnv('VH_NEWS_FEED_MAX_ITEMS_TOTAL')).toBeUndefined();
    vi.stubEnv('VH_NEWS_FEED_FETCH_ATTEMPTS', '5');
    vi.stubEnv('VH_NEWS_FEED_FETCH_RETRY_BACKOFF_MS', '7');
    expect(newsIngestInternal.readFeedFetchAttempts()).toBe(5);
    expect(newsIngestInternal.readFeedFetchRetryBackoffMs()).toBe(7);
    const originalProcess = globalThis.process;
    vi.stubGlobal('process', undefined);
    expect(newsIngestInternal.readEnvVar('VH_NEWS_FEED_MAX_ITEMS_TOTAL')).toBeUndefined();
    vi.stubGlobal('process', originalProcess);

    expect(newsIngestInternal.sortByPublishedDesc(
      {
        sourceId: 'b',
        url: 'https://example.com/b',
        title: 'B',
      } as RawFeedItem,
      {
        sourceId: 'a',
        url: 'https://example.com/a',
        title: 'A',
      } as RawFeedItem,
    )).toBeGreaterThan(0);

    expect(newsIngestInternal.sortByPublishedDesc(
      {
        publishedAt: 100,
        sourceId: 'a',
        url: 'https://example.com/z',
        title: 'Z',
      } as RawFeedItem,
      {
        publishedAt: 100,
        sourceId: 'a',
        url: 'https://example.com/a',
        title: 'A',
      } as RawFeedItem,
    )).toBeGreaterThan(0);
  });
});
