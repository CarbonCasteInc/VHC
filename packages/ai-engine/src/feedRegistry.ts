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
 * 9-source starter feed slate: 3 conservative, 3 progressive, 3 international-wire.
 * perspectiveTag values are governance-managed and auditable via code review.
 */
export const STARTER_FEED_SOURCES: readonly FeedSource[] = Object.freeze([
  // Conservative (3)
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
  FeedSourceSchema.parse({
    id: 'federalist',
    name: 'The Federalist',
    displayName: 'The Federalist',
    rssUrl: 'https://thefederalist.com/feed/',
    perspectiveTag: 'conservative',
    iconKey: 'federalist',
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
    id: 'yahoo-world',
    name: 'Yahoo News World',
    displayName: 'Yahoo News',
    rssUrl: 'https://news.yahoo.com/rss/world',
    perspectiveTag: 'international-wire',
    iconKey: 'yahoo',
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
