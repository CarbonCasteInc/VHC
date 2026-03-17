import { describe, expect, it, vi } from 'vitest';
import type { FeedSource } from '@vh/data-model';
import { buildSourceFeedContributionReport } from './sourceContributionReport';

function makeSource(id: string, rssUrl: string): FeedSource {
  return {
    id,
    name: id,
    rssUrl,
    enabled: true,
  };
}

function makeResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe('sourceContributionReport', () => {
  it('builds per-source contribution metrics from a live feed snapshot', async () => {
    const sources = [
      makeSource('alpha', 'https://alpha.example/rss.xml'),
      makeSource('beta', 'https://beta.example/rss.xml'),
      makeSource('gamma', 'https://gamma.example/rss.xml'),
    ];

    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://alpha.example/rss.xml') {
        return makeResponse(
          200,
          `<rss><channel>
             <item><title>Storm hits city center</title><link>https://alpha.example/a</link><pubDate>Tue, 17 Mar 2026 10:00:00 GMT</pubDate></item>
             <item><title>Storm hits city center</title><link>https://alpha.example/a</link><pubDate>Tue, 17 Mar 2026 10:00:00 GMT</pubDate></item>
           </channel></rss>`,
        );
      }
      if (url === 'https://beta.example/rss.xml') {
        return makeResponse(
          200,
          `<rss><channel>
             <item><title>Storm hits city center as rain falls</title><link>https://beta.example/b</link><pubDate>Tue, 17 Mar 2026 10:05:00 GMT</pubDate></item>
           </channel></rss>`,
        );
      }
      if (url === 'https://gamma.example/rss.xml') {
        return makeResponse(
          200,
          `<rss><channel>
             <item><title>Election board certifies local recount</title><link>https://gamma.example/c</link><pubDate>Tue, 17 Mar 2026 11:00:00 GMT</pubDate></item>
           </channel></rss>`,
        );
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await buildSourceFeedContributionReport({
      feedSources: sources,
      fetchFn,
      now: () => 1_763_761_200_000,
    });

    expect(report.snapshotMode).toBe('heuristic_live_feed_snapshot');
    expect(report.totalIngestedItemCount).toBe(4);
    expect(report.totalNormalizedItemCount).toBe(3);
    expect(report.totalBundleCount).toBe(2);
    expect(report.totalSingletonBundleCount).toBe(1);
    expect(report.totalCorroboratedBundleCount).toBe(1);
    expect(report.contributingSourceIds).toEqual(['alpha', 'beta', 'gamma']);
    expect(report.corroboratingSourceIds).toEqual(['alpha', 'beta']);
    expect(report.zeroContributionSourceIds).toEqual([]);
    expect(report.sources).toEqual([
      {
        sourceId: 'alpha',
        sourceName: 'alpha',
        rssUrl: 'https://alpha.example/rss.xml',
        ingestErrorCount: 0,
        ingestErrors: [],
        ingestedItemCount: 2,
        normalizedItemCount: 1,
        dedupDroppedItemCount: 1,
        bundleAppearanceCount: 1,
        singletonBundleCount: 0,
        corroboratedBundleCount: 1,
        contributionStatus: 'corroborated',
      },
      {
        sourceId: 'beta',
        sourceName: 'beta',
        rssUrl: 'https://beta.example/rss.xml',
        ingestErrorCount: 0,
        ingestErrors: [],
        ingestedItemCount: 1,
        normalizedItemCount: 1,
        dedupDroppedItemCount: 0,
        bundleAppearanceCount: 1,
        singletonBundleCount: 0,
        corroboratedBundleCount: 1,
        contributionStatus: 'corroborated',
      },
      {
        sourceId: 'gamma',
        sourceName: 'gamma',
        rssUrl: 'https://gamma.example/rss.xml',
        ingestErrorCount: 0,
        ingestErrors: [],
        ingestedItemCount: 1,
        normalizedItemCount: 1,
        dedupDroppedItemCount: 0,
        bundleAppearanceCount: 1,
        singletonBundleCount: 1,
        corroboratedBundleCount: 0,
        contributionStatus: 'singleton_only',
      },
    ]);
  });

  it('records zero-contribution sources and ingest errors', async () => {
    const sources = [
      makeSource('alpha', 'https://alpha.example/rss.xml'),
      makeSource('beta', 'https://beta.example/rss.xml'),
    ];

    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://alpha.example/rss.xml') {
        return makeResponse(
          200,
          `<rss><channel>
             <item><title>Only alpha story</title><link>https://alpha.example/a</link></item>
           </channel></rss>`,
        );
      }
      throw new Error('feed unavailable');
    }) as typeof fetch;

    const report = await buildSourceFeedContributionReport({
      feedSources: sources,
      fetchFn,
      now: () => 1_763_761_200_000,
    });

    expect(report.totalBundleCount).toBe(1);
    expect(report.zeroContributionSourceIds).toEqual(['beta']);
    expect(report.sources[1]).toEqual({
      sourceId: 'beta',
      sourceName: 'beta',
      rssUrl: 'https://beta.example/rss.xml',
      ingestErrorCount: 1,
      ingestErrors: ['Fetch failed for https://beta.example/rss.xml: feed unavailable'],
      ingestedItemCount: 0,
      normalizedItemCount: 0,
      dedupDroppedItemCount: 0,
      bundleAppearanceCount: 0,
      singletonBundleCount: 0,
      corroboratedBundleCount: 0,
      contributionStatus: 'none',
    });
  });
});
