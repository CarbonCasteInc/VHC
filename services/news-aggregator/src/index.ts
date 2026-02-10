/**
 * @vh/news-aggregator — RSS ingest, normalization, clustering, and
 * StoryBundle publication service.
 *
 * This module re-exports the canonical StoryBundle schemas from
 * @vh/data-model for downstream convenience, plus ingest and
 * normalization modules (B-2).
 */
export {
  FeedSourceSchema,
  RawFeedItemSchema,
  StoryBundleSchema,
  StoryBundleSourceSchema,
  ClusterFeaturesSchema,
  STORY_BUNDLE_VERSION,
} from '@vh/data-model';

export type {
  FeedSource,
  RawFeedItem,
  StoryBundle,
  StoryBundleSource,
  ClusterFeatures,
} from '@vh/data-model';

export {
  ingestFeed,
  ingestFeeds,
  parseFeedXml,
  extractTags,
  stripTags,
  parseDate,
} from './ingest';
export type { FetchFn, IngestResult } from './ingest';

export {
  canonicalizeUrl,
  urlHash,
  normalizeItem,
  dedup,
  normalizeAndDedup,
} from './normalize';
export type { NormalizedFeedItem } from './normalize';

export { toStoryBundleSource, computeProvenanceHash } from './provenance';

export { clusterItems, extractWords } from './cluster';
export type { ClusterOptions } from './cluster';
