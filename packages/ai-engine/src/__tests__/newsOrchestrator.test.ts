import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  newsOrchestratorInternal,
  orchestrateNewsPipeline,
} from '../newsOrchestrator';
import type { NormalizedItem } from '../newsTypes';

const xmlForSourceA = `
  <rss>
    <channel>
      <item>
        <title>Markets rally after rate decision</title>
        <link>https://news.example.com/a?utm_source=rss</link>
        <description>Markets moved up.</description>
        <pubDate>Mon, 05 Feb 2024 12:10:00 GMT</pubDate>
      </item>
    </channel>
  </rss>
`;

const xmlForSourceB = `
  <rss>
    <channel>
      <item>
        <title>Team wins championship in overtime</title>
        <link>https://news.example.com/sports</link>
        <description>Championship recap.</description>
        <pubDate>Mon, 05 Feb 2024 12:20:00 GMT</pubDate>
      </item>
    </channel>
  </rss>
`;

const xmlForSourceC = `
  <rss>
    <channel>
      <item>
        <title>Weather alert issued for coastal region</title>
        <link>https://news.example.com/weather</link>
        <description>Storm warning.</description>
        <pubDate>Mon, 05 Feb 2024 12:25:00 GMT</pubDate>
      </item>
    </channel>
  </rss>
`;

describe('newsOrchestrator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-05T14:00:00.000Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs ingest -> normalize -> cluster and groups by configured topic mapping', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(xmlForSourceA),
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(xmlForSourceB),
    } as unknown as Response);

    const bundles = await orchestrateNewsPipeline({
      feedSources: [
        {
          id: 'source-a',
          name: 'Source A',
          rssUrl: 'https://feeds.example.com/a.xml',
          enabled: true,
        },
        {
          id: 'source-b',
          name: 'Source B',
          rssUrl: 'https://feeds.example.com/b.xml',
          enabled: true,
        },
      ],
      topicMapping: {
        defaultTopicId: 'topic-general',
        sourceTopics: {
          'source-a': 'topic-finance',
          'source-b': 'topic-sports',
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bundles).toHaveLength(2);
    expect(bundles.map((bundle) => bundle.topic_id)).toEqual([
      'topic-finance',
      'topic-sports',
    ]);
  });

  it('sorts bundles by story_id when multiple clusters map to same topic', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({ ok: true, text: vi.fn().mockResolvedValue(xmlForSourceA) } as unknown as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, text: vi.fn().mockResolvedValue(xmlForSourceB) } as unknown as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, text: vi.fn().mockResolvedValue(xmlForSourceC) } as unknown as Response);

    const bundles = await orchestrateNewsPipeline({
      feedSources: [
        {
          id: 'source-a',
          name: 'Source A',
          rssUrl: 'https://feeds.example.com/a.xml',
          enabled: true,
        },
        {
          id: 'source-b',
          name: 'Source B',
          rssUrl: 'https://feeds.example.com/b.xml',
          enabled: true,
        },
        {
          id: 'source-c',
          name: 'Source C',
          rssUrl: 'https://feeds.example.com/c.xml',
          enabled: true,
        },
      ],
      topicMapping: {
        defaultTopicId: 'topic-general',
      },
    });

    expect(bundles).toHaveLength(3);
    expect(bundles.every((bundle) => bundle.topic_id === 'topic-general')).toBe(true);

    const storyIds = bundles.map((bundle) => bundle.story_id);
    expect(storyIds).toEqual([...storyIds].sort());
  });

  it('returns empty array when no normalized items are produced', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('<rss><channel></channel></rss>'),
    } as unknown as Response);

    const bundles = await orchestrateNewsPipeline({
      feedSources: [
        {
          id: 'source-empty',
          name: 'Source Empty',
          rssUrl: 'https://feeds.example.com/empty.xml',
          enabled: true,
        },
      ],
      topicMapping: {
        defaultTopicId: 'topic-general',
      },
      normalize: {
        nearDuplicateWindowMs: 60_000,
      },
    });

    expect(bundles).toEqual([]);
  });

  it('validates config and exposes groupByTopic internal helper', async () => {
    await expect(
      orchestrateNewsPipeline({
        feedSources: [],
        topicMapping: {
          defaultTopicId: '',
        },
      }),
    ).rejects.toThrow();

    const grouped = newsOrchestratorInternal.groupByTopic(
      [
        {
          sourceId: 'src-a',
          publisher: 'src-a',
          url: 'https://example.com/a',
          canonicalUrl: 'https://example.com/a',
          title: 'Title A',
          publishedAt: 1,
          summary: 'A',
          author: 'Author',
          url_hash: 'hash-a',
          entity_keys: ['alpha'],
        },
        {
          sourceId: 'src-b',
          publisher: 'src-b',
          url: 'https://example.com/b',
          canonicalUrl: 'https://example.com/b',
          title: 'Title B',
          publishedAt: 2,
          summary: 'B',
          author: 'Author',
          url_hash: 'hash-b',
          entity_keys: ['beta'],
        },
      ] as NormalizedItem[],
      {
        feedSources: [],
        topicMapping: {
          defaultTopicId: 'topic-default',
          sourceTopics: {},
        },
      },
    );

    expect(grouped.get('topic-default')).toHaveLength(2);
  });
});
