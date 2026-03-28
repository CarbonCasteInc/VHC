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
  'nypost-politics': { id: 'nypost-politics', name: 'New York Post Politics', displayName: 'New York Post', rssUrl: 'https://nypost.com/politics/feed/', perspectiveTag: 'conservative', iconKey: 'nypost', enabled: true },
  'guardian-us': { id: 'guardian-us', name: 'The Guardian US', displayName: 'The Guardian', rssUrl: 'https://www.theguardian.com/us-news/rss', perspectiveTag: 'progressive', iconKey: 'guardian', enabled: true },
  'huffpost-us': { id: 'huffpost-us', name: 'HuffPost', displayName: 'HuffPost', rssUrl: 'https://www.huffpost.com/section/us-news/feed', perspectiveTag: 'progressive', iconKey: 'huffpost', enabled: true },
  'cbs-politics': { id: 'cbs-politics', name: 'CBS News Politics', displayName: 'CBS News', rssUrl: 'https://www.cbsnews.com/latest/rss/politics', perspectiveTag: 'progressive', iconKey: 'cbs', enabled: true },
  'bbc-general': { id: 'bbc-general', name: 'BBC News', displayName: 'BBC News', rssUrl: 'https://feeds.bbci.co.uk/news/rss.xml', perspectiveTag: 'international-wire', iconKey: 'bbc', enabled: true },
  'bbc-us-canada': { id: 'bbc-us-canada', name: 'BBC US & Canada', displayName: 'BBC', rssUrl: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', perspectiveTag: 'international-wire', iconKey: 'bbc', enabled: true },
  'ap-topnews': { id: 'ap-topnews', name: 'Associated Press Top News', displayName: 'AP', rssUrl: 'https://apnews.com/hub/apf-topnews', perspectiveTag: 'international-wire', iconKey: 'ap', enabled: true },
  'yahoo-world': { id: 'yahoo-world', name: 'Yahoo News World', displayName: 'Yahoo News', rssUrl: 'https://news.yahoo.com/rss/world', perspectiveTag: 'international-wire', iconKey: 'yahoo', enabled: true },
  'npr-news': { id: 'npr-news', name: 'NPR News', displayName: 'NPR', rssUrl: 'https://feeds.npr.org/1001/rss.xml', perspectiveTag: 'public-radio', iconKey: 'npr', enabled: true },
  'npr-politics': { id: 'npr-politics', name: 'NPR Politics', displayName: 'NPR', rssUrl: 'https://feeds.npr.org/1014/rss.xml', perspectiveTag: 'public-radio', iconKey: 'npr', enabled: true },
  'abc-politics': { id: 'abc-politics', name: 'ABC News Politics', displayName: 'ABC News', rssUrl: 'https://abcnews.go.com/abcnews/politicsheadlines', perspectiveTag: 'broadcast-news', iconKey: 'abc', enabled: true },
  'nbc-politics': { id: 'nbc-politics', name: 'NBC News Politics', displayName: 'NBC News', rssUrl: 'https://feeds.nbcnews.com/feeds/nbcpolitics', perspectiveTag: 'broadcast-news', iconKey: 'nbc', enabled: true },
  'pbs-politics': { id: 'pbs-politics', name: 'PBS News Politics', displayName: 'PBS News', rssUrl: 'https://www.pbs.org/newshour/feeds/rss/politics', perspectiveTag: 'public-broadcast', iconKey: 'pbs', enabled: true },
  'texastribune-main': { id: 'texastribune-main', name: 'Texas Tribune', displayName: 'Texas Tribune', rssUrl: 'https://feeds.texastribune.org/feeds/main/', perspectiveTag: 'statehouse', iconKey: 'texastribune', enabled: true },
  'nevadaindependent-main': { id: 'nevadaindependent-main', name: 'Nevada Independent', displayName: 'Nevada Independent', rssUrl: 'https://thenevadaindependent.com/feed/', perspectiveTag: 'statehouse', iconKey: 'nevadaindependent', enabled: true },
  'kffhealthnews-original': { id: 'kffhealthnews-original', name: 'KFF Health News', displayName: 'KFF Health News', rssUrl: 'https://kffhealthnews.org/topics/syndicate/feed/aprss', perspectiveTag: 'health-policy', iconKey: 'kff', enabled: true },
  'scotusblog-main': { id: 'scotusblog-main', name: 'SCOTUSblog', displayName: 'SCOTUSblog', rssUrl: 'https://feeds.feedburner.com/scotusblog/pFXs', perspectiveTag: 'courts-legal', iconKey: 'scotusblog', enabled: true },
  'canarymedia-main': { id: 'canarymedia-main', name: 'Canary Media', displayName: 'Canary Media', rssUrl: 'https://www.canarymedia.com/rss.rss', perspectiveTag: 'climate-policy', iconKey: 'canarymedia', enabled: true },
  'sky-world': { id: 'sky-world', name: 'Sky News World', displayName: 'Sky News', rssUrl: 'https://feeds.skynews.com/feeds/rss/world.xml', perspectiveTag: 'international-wire', iconKey: 'sky', enabled: true },
  'aljazeera-all': { id: 'aljazeera-all', name: 'Al Jazeera', displayName: 'Al Jazeera', rssUrl: 'https://www.aljazeera.com/xml/rss/all.xml', perspectiveTag: 'international-wire', iconKey: 'aljazeera', enabled: true },
  'globalnews-politics': { id: 'globalnews-politics', name: 'Global News Politics', displayName: 'Global News', rssUrl: 'https://globalnews.ca/politics/feed/', perspectiveTag: 'broadcast-news', iconKey: 'globalnews', enabled: true },
  'channelnewsasia-latest': { id: 'channelnewsasia-latest', name: 'Channel NewsAsia Latest', displayName: 'Channel NewsAsia', rssUrl: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', perspectiveTag: 'international-wire', iconKey: 'cna', enabled: true },
  'dw-top': { id: 'dw-top', name: 'Deutsche Welle Top Stories', displayName: 'DW', rssUrl: 'https://rss.dw.com/rdf/rss-en-top', perspectiveTag: 'international-wire', iconKey: 'dw', enabled: true },
};

const DEFAULT_SOURCE_IDS = [
  'guardian-us',
  'cbs-politics',
  'bbc-us-canada',
  'nypost-politics',
  'fox-latest',
];

function fixtureFeedBaseUrl(): string {
  return process.env.VH_DAEMON_FEED_FIXTURE_BASE_URL?.trim()
    || `http://127.0.0.1:${process.env.VH_DAEMON_FEED_FIXTURE_PORT?.trim() || '8788'}`;
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

  return JSON.stringify(sources.length > 0 ? sources : Object.values(STARTER_FEED_SOURCE_CATALOG));
}
