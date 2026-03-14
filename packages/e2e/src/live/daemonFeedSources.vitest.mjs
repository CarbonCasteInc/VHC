import { afterEach, describe, expect, it } from 'vitest';
import { resolveDaemonFeedSourcesJson } from './daemonFeedSources.ts';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('resolveDaemonFeedSourcesJson', () => {
  it('resolves smoke-only sources that are not part of the starter default list', () => {
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'abc-politics,nbc-politics,pbs-politics';

    const sources = JSON.parse(resolveDaemonFeedSourcesJson());

    expect(sources.map((source) => source.id)).toEqual([
      'abc-politics',
      'nbc-politics',
      'pbs-politics',
    ]);
    expect(sources[0].rssUrl).toBe('https://abcnews.go.com/abcnews/politicsheadlines');
    expect(sources[1].rssUrl).toBe('https://feeds.nbcnews.com/feeds/nbcpolitics');
    expect(sources[2].rssUrl).toBe('https://www.pbs.org/newshour/feeds/rss/politics');
  });

  it('falls back to the full catalog when all requested ids are unknown in live mode', () => {
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'missing-one,missing-two';

    const sources = JSON.parse(resolveDaemonFeedSourcesJson());

    expect(sources.map((source) => source.id)).toEqual([
      'fox-latest',
      'nypost-politics',
      'federalist',
      'guardian-us',
      'huffpost-us',
      'cbs-politics',
      'bbc-general',
      'bbc-us-canada',
      'yahoo-world',
      'npr-news',
      'npr-politics',
      'abc-politics',
      'nbc-politics',
      'pbs-politics',
    ]);
  });

  it('rewrites fixture feeds to the local fixture server and keeps only known sources', () => {
    process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED = 'true';
    process.env.VH_DAEMON_FEED_FIXTURE_BASE_URL = 'http://127.0.0.1:9988';
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'guardian-us,pbs-politics,missing-one';

    const sources = JSON.parse(resolveDaemonFeedSourcesJson());

    expect(sources).toEqual([
      expect.objectContaining({
        id: 'guardian-us',
        rssUrl: 'http://127.0.0.1:9988/rss/guardian-us',
      }),
      expect.objectContaining({
        id: 'pbs-politics',
        rssUrl: 'http://127.0.0.1:9988/rss/pbs-politics',
      }),
    ]);
  });

  it('uses the default fixture port when fixture mode is enabled without an explicit base url', () => {
    process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED = 'true';
    delete process.env.VH_DAEMON_FEED_FIXTURE_BASE_URL;
    delete process.env.VH_DAEMON_FEED_FIXTURE_PORT;
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'npr-politics';

    const sources = JSON.parse(resolveDaemonFeedSourcesJson());

    expect(sources).toEqual([
      expect.objectContaining({
        id: 'npr-politics',
        rssUrl: 'http://127.0.0.1:8788/rss/npr-politics',
      }),
    ]);
  });
});
