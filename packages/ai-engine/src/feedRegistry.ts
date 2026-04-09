import { FeedSourceSchema, type FeedSource } from './newsTypes';

/**
 * Source metadata for UI consumption (badges, icons, display names).
 * perspectiveTag uses governance-managed labels, not hard-coded political axes.
 */
export interface SourceMetadata {
  readonly displayName: string;
  readonly perspectiveTag: string | undefined;
  readonly iconKey: string | undefined;
}

/**
 * Starter feed slate is evidence-admitted and may grow as new sources clear
 * readability, health, and feed-contribution gates. perspectiveTag values are
 * governance-managed and auditable via code review.
 */
export const STARTER_FEED_SOURCES: readonly FeedSource[] = Object.freeze([
  // Conservative (2)
  FeedSourceSchema.parse({
    id: 'fox-latest',
    name: 'Fox News',
    displayName: 'Fox News',
    rssUrl: 'https://moxie.foxnews.com/google-publisher/latest.xml',
    perspectiveTag: 'conservative',
    iconKey: 'fox',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'nypost-politics',
    name: 'New York Post Politics',
    displayName: 'New York Post',
    rssUrl: 'https://nypost.com/politics/feed/',
    perspectiveTag: 'conservative',
    iconKey: 'nypost',
    enabled: true,
  }),
  // Progressive (3)
  FeedSourceSchema.parse({
    id: 'guardian-us',
    name: 'The Guardian US',
    displayName: 'The Guardian',
    rssUrl: 'https://www.theguardian.com/us-news/rss',
    perspectiveTag: 'progressive',
    iconKey: 'guardian',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'huffpost-us',
    name: 'HuffPost',
    displayName: 'HuffPost',
    rssUrl: 'https://www.huffpost.com/section/us-news/feed',
    perspectiveTag: 'progressive',
    iconKey: 'huffpost',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'cbs-politics',
    name: 'CBS News Politics',
    displayName: 'CBS News',
    rssUrl: 'https://www.cbsnews.com/latest/rss/politics',
    perspectiveTag: 'progressive',
    iconKey: 'cbs',
    enabled: true,
  }),
  // Broadcast news (2)
  FeedSourceSchema.parse({
    id: 'abc-politics',
    name: 'ABC News Politics',
    displayName: 'ABC News',
    rssUrl: 'https://abcnews.go.com/abcnews/politicsheadlines',
    perspectiveTag: 'broadcast-news',
    iconKey: 'abc',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'nbc-politics',
    name: 'NBC News Politics',
    displayName: 'NBC News',
    rssUrl: 'https://feeds.nbcnews.com/feeds/nbcpolitics',
    perspectiveTag: 'broadcast-news',
    iconKey: 'nbc',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'washingtonexaminer-politics',
    name: 'Washington Examiner Politics',
    displayName: 'Washington Examiner',
    rssUrl: 'https://www.washingtonexaminer.com/tag/politics.rss',
    perspectiveTag: 'conservative',
    iconKey: 'washingtonexaminer',
    enabled: true,
  }),
  // Public radio (2)
  FeedSourceSchema.parse({
    id: 'npr-news',
    name: 'NPR News',
    displayName: 'NPR',
    rssUrl: 'https://feeds.npr.org/1001/rss.xml',
    perspectiveTag: 'public-radio',
    iconKey: 'npr',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'npr-politics',
    name: 'NPR Politics',
    displayName: 'NPR',
    rssUrl: 'https://feeds.npr.org/1014/rss.xml',
    perspectiveTag: 'public-radio',
    iconKey: 'npr',
    enabled: true,
  }),
  // Public broadcast (1)
  FeedSourceSchema.parse({
    id: 'pbs-politics',
    name: 'PBS News Politics',
    displayName: 'PBS News',
    rssUrl: 'https://www.pbs.org/newshour/feeds/rss/politics',
    perspectiveTag: 'public-broadcast',
    iconKey: 'pbs',
    enabled: true,
  }),
  // International wire (3)
  FeedSourceSchema.parse({
    id: 'bbc-general',
    name: 'BBC News',
    displayName: 'BBC News',
    rssUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
    perspectiveTag: 'international-wire',
    iconKey: 'bbc',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'bbc-us-canada',
    name: 'BBC US & Canada',
    displayName: 'BBC',
    rssUrl: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml',
    perspectiveTag: 'international-wire',
    iconKey: 'bbc',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'ap-topnews',
    name: 'Associated Press Top News',
    displayName: 'AP',
    rssUrl: 'https://apnews.com/hub/apf-topnews',
    perspectiveTag: 'international-wire',
    iconKey: 'ap',
    enabled: true,
  }),
  // Statehouse / policy implementation (3)
  FeedSourceSchema.parse({
    id: 'texastribune-main',
    name: 'Texas Tribune',
    displayName: 'Texas Tribune',
    rssUrl: 'https://feeds.texastribune.org/feeds/main/',
    perspectiveTag: 'statehouse',
    iconKey: 'texastribune',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'nevadaindependent-main',
    name: 'Nevada Independent',
    displayName: 'Nevada Independent',
    rssUrl: 'https://thenevadaindependent.com/feed/',
    perspectiveTag: 'statehouse',
    iconKey: 'nevadaindependent',
    enabled: true,
  }),
  // Specialist policy / legal / climate (4)
  FeedSourceSchema.parse({
    id: 'kffhealthnews-original',
    name: 'KFF Health News',
    displayName: 'KFF Health News',
    rssUrl: 'https://kffhealthnews.org/topics/syndicate/feed/aprss',
    perspectiveTag: 'health-policy',
    iconKey: 'kff',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'scotusblog-main',
    name: 'SCOTUSblog',
    displayName: 'SCOTUSblog',
    rssUrl: 'https://feeds.feedburner.com/scotusblog/pFXs',
    perspectiveTag: 'courts-legal',
    iconKey: 'scotusblog',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'canarymedia-main',
    name: 'Canary Media',
    displayName: 'Canary Media',
    rssUrl: 'https://www.canarymedia.com/rss.rss',
    perspectiveTag: 'climate-policy',
    iconKey: 'canarymedia',
    enabled: true,
  }),
  // International breadth (4)
  FeedSourceSchema.parse({
    id: 'aljazeera-all',
    name: 'Al Jazeera',
    displayName: 'Al Jazeera',
    rssUrl: 'https://www.aljazeera.com/xml/rss/all.xml',
    perspectiveTag: 'international-wire',
    iconKey: 'aljazeera',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'globalnews-politics',
    name: 'Global News Politics',
    displayName: 'Global News',
    rssUrl: 'https://globalnews.ca/politics/feed/',
    perspectiveTag: 'broadcast-news',
    iconKey: 'globalnews',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'channelnewsasia-latest',
    name: 'Channel NewsAsia Latest',
    displayName: 'Channel NewsAsia',
    rssUrl: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml',
    perspectiveTag: 'international-wire',
    iconKey: 'cna',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'dw-top',
    name: 'Deutsche Welle Top Stories',
    displayName: 'DW',
    rssUrl: 'https://rss.dw.com/rdf/rss-en-top',
    perspectiveTag: 'international-wire',
    iconKey: 'dw',
    enabled: true,
  }),
]);

/**
 * Resolve display name: prefer displayName, fall back to name.
 * Exported for testing branch coverage.
 */
export function resolveDisplayName(source: FeedSource): string {
  return source.displayName ?? source.name;
}

const metadataMap = new Map<string, SourceMetadata>(
  STARTER_FEED_SOURCES.map((source) => [
    source.id,
    {
      displayName: resolveDisplayName(source),
      perspectiveTag: source.perspectiveTag,
      iconKey: source.iconKey,
    },
  ]),
);

/**
 * Look up source display metadata by sourceId.
 * Returns undefined for unknown sources (graceful degradation).
 */
export function getSourceMetadata(
  sourceId: string,
): SourceMetadata | undefined {
  return metadataMap.get(sourceId);
}
