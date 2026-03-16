import { afterEach, describe, expect, it } from 'vitest';
import {
  readExplicitLiveDevFeedSourcesJson,
  resolveDaemonFeedSourcesJson,
} from './daemonFeedSources.ts';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('resolveDaemonFeedSourcesJson', () => {
  it('resolves smoke-only sources that are not part of the starter default list', () => {
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'abc-politics,huffpost-us,independent-us-politics,cnn-politics,pbs-politics';
    process.env.VH_LIVE_BASE_URL = 'http://127.0.0.1:2148/';

    const sources = JSON.parse(resolveDaemonFeedSourcesJson());

    expect(sources.map((source) => source.id)).toEqual([
      'abc-politics',
      'huffpost-us',
      'independent-us-politics',
      'cnn-politics',
      'pbs-politics',
    ]);
    expect(sources[0].rssUrl).toBe('https://abcnews.go.com/abcnews/politicsheadlines');
    expect(sources[1].rssUrl).toBe('http://127.0.0.1:2148/rss/huffpost-us');
    expect(sources[2].rssUrl).toBe('http://127.0.0.1:2148/rss/independent-us-politics');
    expect(sources[3].rssUrl).toBe('http://127.0.0.1:2148/rss/cnn-politics');
    expect(sources[4].rssUrl).toBe('https://www.pbs.org/newshour/feeds/rss/politics');
  });

  it('keeps live-mode urls unchanged when no local base url is available', () => {
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'ap-politics,cnn-politics';
    delete process.env.VH_LIVE_BASE_URL;

    const sources = JSON.parse(resolveDaemonFeedSourcesJson());

    expect(sources).toEqual([
      expect.objectContaining({
        id: 'ap-politics',
        rssUrl: 'https://apnews.com/politics',
      }),
      expect.objectContaining({
        id: 'cnn-politics',
        rssUrl: 'https://www.cnn.com/politics',
      }),
    ]);
  });

  it('honors an explicit survey-only source override in live mode', () => {
    process.env.VH_LIVE_DEV_FEED_SOURCES_JSON = JSON.stringify([
      {
        id: 'washington-examiner-politics',
        name: 'Washington Examiner Politics',
        displayName: 'Washington Examiner',
        rssUrl: 'https://www.washingtonexaminer.com/tag/politics/feed',
        perspectiveTag: 'conservative',
        iconKey: 'washington-examiner',
        enabled: true,
      },
    ]);

    expect(JSON.parse(resolveDaemonFeedSourcesJson())).toEqual([
      expect.objectContaining({
        id: 'washington-examiner-politics',
        rssUrl: 'https://www.washingtonexaminer.com/tag/politics/feed',
      }),
    ]);
    expect(readExplicitLiveDevFeedSourcesJson()).toBe(
      JSON.stringify([
        {
          id: 'washington-examiner-politics',
          name: 'Washington Examiner Politics',
          displayName: 'Washington Examiner',
          rssUrl: 'https://www.washingtonexaminer.com/tag/politics/feed',
          perspectiveTag: 'conservative',
          iconKey: 'washington-examiner',
          enabled: true,
        },
      ]),
    );
  });

  it('ignores an explicit live override while fixture mode is active', () => {
    process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED = 'true';
    process.env.VH_DAEMON_FEED_FIXTURE_BASE_URL = 'http://127.0.0.1:9988';
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'guardian-us';
    process.env.VH_LIVE_DEV_FEED_SOURCES_JSON = JSON.stringify([
      {
        id: 'washington-examiner-politics',
        name: 'Washington Examiner Politics',
        displayName: 'Washington Examiner',
        rssUrl: 'https://www.washingtonexaminer.com/tag/politics/feed',
        perspectiveTag: 'conservative',
        iconKey: 'washington-examiner',
        enabled: true,
      },
    ]);

    expect(readExplicitLiveDevFeedSourcesJson()).toBeNull();
    expect(JSON.parse(resolveDaemonFeedSourcesJson())).toEqual([
      expect.objectContaining({
        id: 'guardian-us',
        rssUrl: 'http://127.0.0.1:9988/rss/guardian-us',
      }),
    ]);
  });

  it('rejects invalid explicit live overrides and falls back to catalog ids', () => {
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'guardian-us';
    process.env.VH_LIVE_DEV_FEED_SOURCES_JSON = 'not-json';

    expect(readExplicitLiveDevFeedSourcesJson()).toBeNull();
    expect(JSON.parse(resolveDaemonFeedSourcesJson())).toEqual([
      expect.objectContaining({
        id: 'guardian-us',
      }),
    ]);

    process.env.VH_LIVE_DEV_FEED_SOURCES_JSON = JSON.stringify({ id: 'guardian-us' });
    expect(readExplicitLiveDevFeedSourcesJson()).toBeNull();

    process.env.VH_LIVE_DEV_FEED_SOURCES_JSON = JSON.stringify([null, { id: 'bad' }]);
    expect(readExplicitLiveDevFeedSourcesJson()).toBeNull();
  });

  it('falls back to the full catalog when all requested ids are unknown in live mode', () => {
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'missing-one,missing-two';

    const sources = JSON.parse(resolveDaemonFeedSourcesJson());

    expect(sources.map((source) => source.id)).toEqual([
      'fox-latest',
      'fox-politics',
      'nypost-politics',
      'federalist',
      'guardian-us',
      'huffpost-us',
      'cbs-politics',
      'ap-politics',
      'usatoday-politics',
      'bbc-general',
      'bbc-us-canada',
      'yahoo-world',
      'npr-news',
      'npr-politics',
      'abc-politics',
      'cnn-politics',
      'independent-us-politics',
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

  it('uses the configured fixture port when fixture mode omits a base url', () => {
    process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED = 'true';
    delete process.env.VH_DAEMON_FEED_FIXTURE_BASE_URL;
    process.env.VH_DAEMON_FEED_FIXTURE_PORT = '9911';
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = 'cnn-politics';

    const sources = JSON.parse(resolveDaemonFeedSourcesJson());

    expect(sources).toEqual([
      expect.objectContaining({
        id: 'cnn-politics',
        rssUrl: 'http://127.0.0.1:9911/rss/cnn-politics',
      }),
    ]);
  });

  it('falls back to the default source ids when the source env is unset or blank', () => {
    delete process.env.VH_LIVE_DEV_FEED_SOURCE_IDS;

    expect(JSON.parse(resolveDaemonFeedSourcesJson()).map((source) => source.id)).toEqual([
      'guardian-us',
      'cbs-politics',
      'bbc-us-canada',
      'nypost-politics',
      'fox-latest',
    ]);
  });

  it('falls back to the default live source ids when the source env is blank', () => {
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = '   ';
    delete process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED;

    expect(JSON.parse(resolveDaemonFeedSourcesJson()).map((source) => source.id)).toEqual([
      'guardian-us',
      'cbs-politics',
      'bbc-us-canada',
      'nypost-politics',
      'fox-latest',
    ]);
  });

  it('falls back to the default source ids when fixture mode receives a blank source env', () => {
    process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED = 'true';
    process.env.VH_LIVE_DEV_FEED_SOURCE_IDS = '   ';
    delete process.env.VH_DAEMON_FEED_FIXTURE_BASE_URL;
    delete process.env.VH_DAEMON_FEED_FIXTURE_PORT;

    expect(JSON.parse(resolveDaemonFeedSourcesJson()).map((source) => source.id)).toEqual([
      'guardian-us',
      'cbs-politics',
      'bbc-us-canada',
      'nypost-politics',
      'fox-latest',
    ]);
  });
});
