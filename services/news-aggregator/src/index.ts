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

export { orchestrateNewsPipeline } from './orchestrator';
export type { PipelineConfig, PipelineResult } from './orchestrator';

export {
  DEFAULT_MODEL,
  MAX_TOKENS,
  TEMPERATURE,
  RATE_LIMIT_PER_MIN,
  RATE_WINDOW_MS,
  checkRateLimit,
  resetRateLimits,
  buildOpenAIChatRequest,
  handleAnalyze,
} from './analysisRelay';
export type { AnalyzeRequest, AnalyzeResponse } from './analysisRelay';

export {
  ArticleTextService,
  ArticleTextServiceError,
  FETCH_TIMEOUT_MS,
  MAX_ATTEMPTS,
  MIN_CHAR_COUNT,
  MIN_WORD_COUNT,
  MIN_SENTENCE_COUNT,
  MIN_QUALITY_SCORE,
} from './articleTextService';
export type {
  ArticleTextResult,
  ArticleTextQuality,
  ArticleTextServiceErrorCode,
  ArticleTextServiceOptions,
} from './articleTextService';

export {
  ArticleTextCache,
  FAILURE_TTL_MS,
  SUCCESS_TTL_MS,
} from './articleTextCache';
export type {
  ArticleTextCacheEntry,
  ArticleTextCacheHit,
  CachedArticleText,
  CachedExtractionFailure,
} from './articleTextCache';

export {
  SourceLifecycleTracker,
  RETRY_BASE_BACKOFF_MS,
  RETRY_MAX_BACKOFF_MS,
} from './sourceLifecycle';
export type { SourceLifecycleState, SourceStatus } from './sourceLifecycle';

export {
  InMemoryRemovalLedgerStore,
  RemovalLedger,
  removalLedgerPath,
} from './removalLedger';
export type {
  RemovalLedgerEntry,
  RemovalLedgerOptions,
  RemovalLedgerStore,
} from './removalLedger';

export {
  STARTER_FEED_URLS,
  STARTER_SOURCE_DOMAINS,
  getStarterSourceDomainAllowlist,
  isSourceDomainAllowed,
} from './sourceRegistry';

export {
  createArticleTextServer,
  startArticleTextServer,
} from './server';
