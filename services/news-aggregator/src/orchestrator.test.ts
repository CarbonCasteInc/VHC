import { describe, expect, it, vi } from 'vitest';
import { StoryBundleSchema, type FeedSource } from '@vh/data-model';
import { orchestrateNewsPipeline } from './orchestrator';
import type { FetchFn } from './ingest';

const FIXED_NOW = 1700000000000;

const MOCK_RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Test Article One</title>
    <link>https://example.com/article-1</link>
    <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    <description>First article summary</description>
  </item>
  <item>
    <title>Test Article Two</title>
    <link>https://example.com/article-2</link>
    <pubDate>Mon, 01 Jan 2024 13:00:00 GMT</pubDate>
    <description>Second article summary</description>
  </item>
</channel></rss>`;

const MOCK_RSS_ALT = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Market Pulse Morning</title>
    <link>https://example.com/article-3</link>
    <pubDate>Mon, 01 Jan 2024 14:00:00 GMT</pubDate>
    <description>Third article summary</description>
  </item>
  <item>
    <title>Space Mission Update</title>
    <link>https://example.com/article-4</link>
    <pubDate>Mon, 01 Jan 2024 15:00:00 GMT</pubDate>
    <description>Fourth article summary</description>
  </item>
</channel></rss>`;

const MOCK_RSS_OVERLAP = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Test Article One</title>
    <link>https://example.com/article-1</link>
    <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    <description>Duplicate article summary</description>
  </item>
  <item>
    <title>Unique Source B Story</title>
    <link>https://example.com/article-5</link>
    <pubDate>Mon, 01 Jan 2024 16:00:00 GMT</pubDate>
    <description>Unique article summary</description>
  </item>
</channel></rss>`;

const MOCK_RSS_COUNTS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Counted Story One</title>
    <link>https://example.com/counted-1?utm_source=newsletter</link>
    <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    <description>Count test one</description>
  </item>
  <item>
    <title>Counted Story One</title>
    <link>https://example.com/counted-1</link>
    <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    <description>Count test duplicate</description>
  </item>
  <item>
    <title>Counted Story Two</title>
    <link>https://example.com/counted-2</link>
    <pubDate>Mon, 01 Jan 2024 11:00:00 GMT</pubDate>
    <description>Count test two</description>
  </item>
</channel></rss>`;

function source(id: string, url: string, enabled = true): FeedSource {
  return {
    id,
    name: `Source ${id}`,
    rssUrl: url,
    enabled,
  };
}

function createFetchMock(
  table: Record<string, { body: string; status?: number }>,
) {
  return vi.fn<FetchFn>(async (url: string) => {
    const hit = table[url];
    if (!hit) {
      return new Response('', { status: 404 });
    }
    return new Response(hit.body, { status: hit.status ?? 200 });
  });
}

describe('orchestrateNewsPipeline', () => {
  it('runs ingest → normalize → cluster for two sources and emits schema-valid bundles', async () => {
    const srcA = source('a', 'https://feeds.example.com/a.xml');
    const srcB = source('b', 'https://feeds.example.com/b.xml');
    const fetchFn = createFetchMock({
      [srcA.rssUrl]: { body: MOCK_RSS },
      [srcB.rssUrl]: { body: MOCK_RSS_ALT },
    });

    const result = await orchestrateNewsPipeline({
      sources: [srcA, srcB],
      fetchFn,
      clusterOptions: { nowFn: () => FIXED_NOW },
    });

    expect(result.bundles.length).toBeGreaterThan(0);
    for (const bundle of result.bundles) {
      expect(() => StoryBundleSchema.parse(bundle)).not.toThrow();
    }

    const publishers = new Set(
      result.bundles.flatMap((bundle) => bundle.sources.map((src) => src.publisher)),
    );
    expect(publishers.has(srcA.name)).toBe(true);
    expect(publishers.has(srcB.name)).toBe(true);
  });

  it('deduplicates overlapping articles across sources', async () => {
    const srcA = source('a', 'https://feeds.example.com/a.xml');
    const srcB = source('b', 'https://feeds.example.com/b.xml');
    const fetchFn = createFetchMock({
      [srcA.rssUrl]: { body: MOCK_RSS },
      [srcB.rssUrl]: { body: MOCK_RSS_OVERLAP },
    });

    const result = await orchestrateNewsPipeline({
      sources: [srcA, srcB],
      fetchFn,
      clusterOptions: { nowFn: () => FIXED_NOW },
    });

    expect(result.totalIngested).toBe(4);
    expect(result.totalNormalized).toBe(3);

    const allUrls = result.bundles.flatMap((bundle) => bundle.sources.map((src) => src.url));
    expect(allUrls.filter((url) => url === 'https://example.com/article-1')).toHaveLength(1);
  });

  it('continues when one source fails and captures the error', async () => {
    const goodSource = source('good', 'https://feeds.example.com/good.xml');
    const badSource = source('bad', 'https://feeds.example.com/bad.xml');
    const fetchFn = createFetchMock({
      [goodSource.rssUrl]: { body: MOCK_RSS },
      [badSource.rssUrl]: { body: '', status: 500 },
    });

    const result = await orchestrateNewsPipeline({
      sources: [goodSource, badSource],
      fetchFn,
      clusterOptions: { nowFn: () => FIXED_NOW },
    });

    expect(result.bundles.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('HTTP 500');
  });

  it('returns an empty result for empty source lists', async () => {
    const fetchFn = createFetchMock({});

    const result = await orchestrateNewsPipeline({
      sources: [],
      fetchFn,
    });

    expect(result).toEqual({
      bundles: [],
      totalIngested: 0,
      totalNormalized: 0,
      errors: [],
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('skips disabled sources', async () => {
    const enabledSource = source('enabled', 'https://feeds.example.com/enabled.xml', true);
    const disabledSource = source('disabled', 'https://feeds.example.com/disabled.xml', false);
    const fetchFn = createFetchMock({
      [enabledSource.rssUrl]: { body: MOCK_RSS },
      [disabledSource.rssUrl]: { body: MOCK_RSS_ALT },
    });

    const result = await orchestrateNewsPipeline({
      sources: [enabledSource, disabledSource],
      fetchFn,
      clusterOptions: { nowFn: () => FIXED_NOW },
    });

    expect(result.totalIngested).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(enabledSource.rssUrl);
  });

  it('is deterministic for story_id and provenance_hash', async () => {
    const src = source('stable', 'https://feeds.example.com/stable.xml');

    const first = await orchestrateNewsPipeline({
      sources: [src],
      fetchFn: createFetchMock({ [src.rssUrl]: { body: MOCK_RSS } }),
      clusterOptions: { nowFn: () => FIXED_NOW },
    });

    const second = await orchestrateNewsPipeline({
      sources: [src],
      fetchFn: createFetchMock({ [src.rssUrl]: { body: MOCK_RSS } }),
      clusterOptions: { nowFn: () => FIXED_NOW },
    });

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(first.bundles[0]?.story_id).toBe(second.bundles[0]?.story_id);
    expect(first.bundles[0]?.provenance_hash).toBe(second.bundles[0]?.provenance_hash);
  });

  it('returns accurate totalIngested and totalNormalized counts', async () => {
    const src = source('counts', 'https://feeds.example.com/counts.xml');
    const fetchFn = createFetchMock({ [src.rssUrl]: { body: MOCK_RSS_COUNTS } });

    const result = await orchestrateNewsPipeline({
      sources: [src],
      fetchFn,
      clusterOptions: { nowFn: () => FIXED_NOW },
    });

    expect(result.totalIngested).toBe(3);
    expect(result.totalNormalized).toBe(2);
  });

  it('returns an explicit error for invalid sources config', async () => {
    const fetchFn = createFetchMock({});

    const result = await orchestrateNewsPipeline({
      sources: null as unknown as FeedSource[],
      fetchFn,
    });

    expect(result).toEqual({
      bundles: [],
      totalIngested: 0,
      totalNormalized: 0,
      errors: ['Invalid pipeline config: sources must be an array'],
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
