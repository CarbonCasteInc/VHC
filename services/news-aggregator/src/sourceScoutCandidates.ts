import { FeedSourceSchema, type FeedSource } from '@vh/ai-engine';

/**
 * Checked-in backlog for evidence-driven source scouting.
 * These are evaluated in the background but never auto-promoted.
 */
export const SOURCE_SCOUT_CANDIDATE_FEED_SOURCES: readonly FeedSource[] = Object.freeze([
  FeedSourceSchema.parse({
    id: 'reuters-topnews',
    name: 'Reuters Top News',
    displayName: 'Reuters',
    rssUrl: 'https://feeds.reuters.com/reuters/topNews',
    perspectiveTag: 'international-wire',
    iconKey: 'reuters',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'ap-topnews',
    name: 'Associated Press Top News',
    displayName: 'AP',
    rssUrl: 'https://apnews.com/hub/ap-top-news?output=rss',
    perspectiveTag: 'wire-service',
    iconKey: 'ap',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'cnn-politics',
    name: 'CNN Politics',
    displayName: 'CNN',
    rssUrl: 'http://rss.cnn.com/rss/cnn_allpolitics.rss',
    perspectiveTag: 'broadcast-news',
    iconKey: 'cnn',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'nyt-us',
    name: 'New York Times US',
    displayName: 'New York Times',
    rssUrl: 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml',
    perspectiveTag: 'national-newspaper',
    iconKey: 'nyt',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'thehill-news',
    name: 'The Hill',
    displayName: 'The Hill',
    rssUrl: 'https://thehill.com/feed/',
    perspectiveTag: 'politics-trade',
    iconKey: 'thehill',
    enabled: true,
  }),
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
    id: 'washingtonexaminer-politics',
    name: 'Washington Examiner Politics',
    displayName: 'Washington Examiner',
    rssUrl: 'https://www.washingtonexaminer.com/tag/politics.rss',
    perspectiveTag: 'conservative',
    iconKey: 'washingtonexaminer',
    enabled: true,
  }),
  FeedSourceSchema.parse({
    id: 'sky-world',
    name: 'Sky News World',
    displayName: 'Sky News',
    rssUrl: 'https://feeds.skynews.com/feeds/rss/world.xml',
    perspectiveTag: 'international-wire',
    iconKey: 'sky',
    enabled: true,
  }),
]);
