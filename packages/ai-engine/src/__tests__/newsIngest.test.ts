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

describe('newsIngest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
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
      sourceId: 'src-rss',
      title: 'Markets rally & recover',
      url: 'https://example.com/news?id=1',
      summary: 'Detailed summary',
      author: 'Reporter One',
    });
    expect(items[1]).toMatchObject({
      sourceId: 'src-atom',
      title: 'Policy update released',
      url: 'https://atom.example.com/story/42',
      summary: 'Atom summary',
    });
    expect(items[1]?.publishedAt).toBeTypeOf('number');
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
});
