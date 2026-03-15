type FeedSource = {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly rssUrl: string;
  readonly perspectiveTag: string;
  readonly iconKey: string;
  readonly enabled: boolean;
};

const STARTER_FEED_SOURCE_CATALOG: Record<string, FeedSource> = {
  'fox-latest': { id: 'fox-latest', name: 'Fox News', displayName: 'Fox News', rssUrl: 'https://moxie.foxnews.com/google-publisher/latest.xml', perspectiveTag: 'conservative', iconKey: 'fox', enabled: true },
  'fox-politics': { id: 'fox-politics', name: 'Fox News Politics', displayName: 'Fox News', rssUrl: 'https://moxie.foxnews.com/google-publisher/politics.xml', perspectiveTag: 'conservative', iconKey: 'fox', enabled: true },
  'nypost-politics': { id: 'nypost-politics', name: 'New York Post Politics', displayName: 'New York Post', rssUrl: 'https://nypost.com/politics/feed/', perspectiveTag: 'conservative', iconKey: 'nypost', enabled: true },
  federalist: { id: 'federalist', name: 'The Federalist', displayName: 'The Federalist', rssUrl: 'https://thefederalist.com/feed/', perspectiveTag: 'conservative', iconKey: 'federalist', enabled: true },
  'guardian-us': { id: 'guardian-us', name: 'The Guardian US', displayName: 'The Guardian', rssUrl: 'https://www.theguardian.com/us-news/rss', perspectiveTag: 'progressive', iconKey: 'guardian', enabled: true },
  'huffpost-us': { id: 'huffpost-us', name: 'HuffPost', displayName: 'HuffPost', rssUrl: 'https://www.huffpost.com/section/us-news/feed', perspectiveTag: 'progressive', iconKey: 'huffpost', enabled: true },
  'cbs-politics': { id: 'cbs-politics', name: 'CBS News Politics', displayName: 'CBS News', rssUrl: 'https://www.cbsnews.com/latest/rss/politics', perspectiveTag: 'progressive', iconKey: 'cbs', enabled: true },
  'ap-politics': { id: 'ap-politics', name: 'AP Politics', displayName: 'AP News', rssUrl: 'https://apnews.com/politics', perspectiveTag: 'wire', iconKey: 'ap', enabled: true },
  'usatoday-politics': { id: 'usatoday-politics', name: 'USA TODAY Politics', displayName: 'USA TODAY', rssUrl: 'https://www.usatoday.com/news/politics/', perspectiveTag: 'national-news', iconKey: 'usatoday', enabled: true },
  'bbc-general': { id: 'bbc-general', name: 'BBC News', displayName: 'BBC News', rssUrl: 'https://feeds.bbci.co.uk/news/rss.xml', perspectiveTag: 'international-wire', iconKey: 'bbc', enabled: true },
  'bbc-us-canada': { id: 'bbc-us-canada', name: 'BBC US & Canada', displayName: 'BBC', rssUrl: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', perspectiveTag: 'international-wire', iconKey: 'bbc', enabled: true },
  'yahoo-world': { id: 'yahoo-world', name: 'Yahoo News World', displayName: 'Yahoo News', rssUrl: 'https://news.yahoo.com/rss/world', perspectiveTag: 'international-wire', iconKey: 'yahoo', enabled: true },
  'npr-news': { id: 'npr-news', name: 'NPR News', displayName: 'NPR', rssUrl: 'https://feeds.npr.org/1001/rss.xml', perspectiveTag: 'public-radio', iconKey: 'npr', enabled: true },
  'npr-politics': { id: 'npr-politics', name: 'NPR Politics', displayName: 'NPR', rssUrl: 'https://feeds.npr.org/1014/rss.xml', perspectiveTag: 'public-radio', iconKey: 'npr', enabled: true },
  'abc-politics': { id: 'abc-politics', name: 'ABC News Politics', displayName: 'ABC News', rssUrl: 'https://abcnews.go.com/abcnews/politicsheadlines', perspectiveTag: 'broadcast-news', iconKey: 'abc', enabled: true },
  'cnn-politics': { id: 'cnn-politics', name: 'CNN Politics', displayName: 'CNN Politics', rssUrl: 'https://www.cnn.com/politics', perspectiveTag: 'broadcast-news', iconKey: 'cnn', enabled: true },
  'nbc-politics': { id: 'nbc-politics', name: 'NBC News Politics', displayName: 'NBC News', rssUrl: 'https://feeds.nbcnews.com/feeds/nbcpolitics', perspectiveTag: 'broadcast-news', iconKey: 'nbc', enabled: true },
  'pbs-politics': { id: 'pbs-politics', name: 'PBS News Politics', displayName: 'PBS News', rssUrl: 'https://www.pbs.org/newshour/feeds/rss/politics', perspectiveTag: 'public-broadcast', iconKey: 'pbs', enabled: true },
};

const DEFAULT_SOURCE_IDS = [
  'guardian-us',
  'cbs-politics',
  'bbc-us-canada',
  'nypost-politics',
  'fox-latest',
];
const LIVE_PROXY_SOURCE_IDS = new Set([
  'ap-politics',
  'cnn-politics',
  'fox-politics',
  'usatoday-politics',
  'huffpost-us',
]);

function fixtureFeedBaseUrl(): string {
  return process.env.VH_DAEMON_FEED_FIXTURE_BASE_URL?.trim()
    || `http://127.0.0.1:${process.env.VH_DAEMON_FEED_FIXTURE_PORT?.trim() || '8788'}`;
}

function liveFeedBaseUrl(): string | null {
  const raw = process.env.VH_LIVE_BASE_URL?.trim();
  if (!raw) {
    return null;
  }
  return raw;
}

function buildLocalFeedUrl(baseUrl: string, sourceId: string): string {
  return new URL(`/rss/${sourceId}`, baseUrl).toString();
}

function resolveFixtureFeedSourcesJson(sourceIds: readonly string[]): string {
  const baseUrl = fixtureFeedBaseUrl();
  const sources = sourceIds.map((sourceId) => {
    const source = STARTER_FEED_SOURCE_CATALOG[sourceId];
    if (!source) {
      return null;
    }
    return {
      ...source,
      rssUrl: `${baseUrl}/rss/${sourceId}`,
    };
  }).filter(Boolean);

  return JSON.stringify(sources);
}

function resolveLiveFeedSourcesJson(sourceIds: readonly string[]): string {
  const baseUrl = liveFeedBaseUrl();
  const sources = sourceIds.map((sourceId) => {
    const source = STARTER_FEED_SOURCE_CATALOG[sourceId];
    if (!source) {
      return null;
    }
    if (baseUrl && LIVE_PROXY_SOURCE_IDS.has(sourceId)) {
      return {
        ...source,
        rssUrl: buildLocalFeedUrl(baseUrl, sourceId),
      };
    }
    return source;
  }).filter(Boolean);

  return JSON.stringify(sources.length > 0 ? sources : Object.values(STARTER_FEED_SOURCE_CATALOG));
}

export function resolveDaemonFeedSourcesJson(): string {
  const sourceIds = (process.env.VH_LIVE_DEV_FEED_SOURCE_IDS ?? DEFAULT_SOURCE_IDS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const sources = sourceIds
    .map((sourceId) => STARTER_FEED_SOURCE_CATALOG[sourceId])
    .filter(Boolean);

  if (process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true') {
    return resolveFixtureFeedSourcesJson(
      sourceIds.length > 0 ? sourceIds : DEFAULT_SOURCE_IDS,
    );
  }

  return resolveLiveFeedSourcesJson(
    sourceIds.length > 0
      ? sourceIds
      : DEFAULT_SOURCE_IDS,
  );
}
