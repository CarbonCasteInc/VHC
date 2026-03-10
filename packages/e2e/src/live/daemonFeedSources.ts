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
  federalist: { id: 'federalist', name: 'The Federalist', displayName: 'The Federalist', rssUrl: 'https://thefederalist.com/feed/', perspectiveTag: 'conservative', iconKey: 'federalist', enabled: true },
  'guardian-us': { id: 'guardian-us', name: 'The Guardian US', displayName: 'The Guardian', rssUrl: 'https://www.theguardian.com/us-news/rss', perspectiveTag: 'progressive', iconKey: 'guardian', enabled: true },
  'huffpost-us': { id: 'huffpost-us', name: 'HuffPost', displayName: 'HuffPost', rssUrl: 'https://www.huffpost.com/section/us-news/feed', perspectiveTag: 'progressive', iconKey: 'huffpost', enabled: true },
  'cbs-politics': { id: 'cbs-politics', name: 'CBS News Politics', displayName: 'CBS News', rssUrl: 'https://www.cbsnews.com/latest/rss/politics', perspectiveTag: 'progressive', iconKey: 'cbs', enabled: true },
  'bbc-general': { id: 'bbc-general', name: 'BBC News', displayName: 'BBC News', rssUrl: 'https://feeds.bbci.co.uk/news/rss.xml', perspectiveTag: 'international-wire', iconKey: 'bbc', enabled: true },
  'bbc-us-canada': { id: 'bbc-us-canada', name: 'BBC US & Canada', displayName: 'BBC', rssUrl: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', perspectiveTag: 'international-wire', iconKey: 'bbc', enabled: true },
  'yahoo-world': { id: 'yahoo-world', name: 'Yahoo News World', displayName: 'Yahoo News', rssUrl: 'https://news.yahoo.com/rss/world', perspectiveTag: 'international-wire', iconKey: 'yahoo', enabled: true },
};

const DEFAULT_SOURCE_IDS = [
  'guardian-us',
  'cbs-politics',
  'bbc-us-canada',
  'nypost-politics',
  'fox-latest',
];

export function resolveDaemonFeedSourcesJson(): string {
  const sourceIds = (process.env.VH_LIVE_DEV_FEED_SOURCE_IDS ?? DEFAULT_SOURCE_IDS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const sources = sourceIds
    .map((sourceId) => STARTER_FEED_SOURCE_CATALOG[sourceId])
    .filter(Boolean);

  return JSON.stringify(sources.length > 0 ? sources : Object.values(STARTER_FEED_SOURCE_CATALOG));
}
