/**
 * @vh/news-aggregator — RSS ingest, normalization, clustering, and
 * StoryBundle publication service.
 *
 * This module re-exports the canonical StoryBundle schemas from
 * @vh/data-model for downstream convenience.
 *
 * Implementation will be filled in slices B-2 (ingest/normalize)
 * and B-3 (cluster/provenance).
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
