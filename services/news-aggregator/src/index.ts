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

export { clusterItems, extractWords, getDefaultClusterEngine } from './cluster';
export type {
  ClusterOptions,
  AggregatorClusterBatchInput,
  AggregatorClusterEngine,
} from './cluster';

export { orchestrateNewsPipeline } from './orchestrator';
export type { PipelineConfig, PipelineResult } from './orchestrator';

export {
  MAX_TOKENS,
  TEMPERATURE,
  RATE_LIMIT_PER_MIN,
  RATE_WINDOW_MS,
  getRelayModel,
  resolveTokenParam,
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
  InMemoryItemEligibilityLedgerStore,
  ItemEligibilityLedger,
  itemEligibilityLedgerPath,
} from './itemEligibilityLedger';
export type {
  ItemEligibilityLedgerEntry,
  ItemEligibilityLedgerOptions,
  ItemEligibilityLedgerStore,
} from './itemEligibilityLedger';

export {
  assessItemEligibilityFromError,
  assessItemEligibilityFromResult,
} from './itemEligibilityPolicy';
export type {
  ItemEligibilityAssessment,
  ItemEligibilityReason,
  ItemEligibilityState,
} from './itemEligibilityPolicy';

export {
  STARTER_FEED_URLS,
  STARTER_SOURCE_DOMAINS,
  buildSourceDomainAllowlist,
  findLatestSourceHealthReportPath,
  getStarterSourceDomainAllowlist,
  isSourceDomainAllowed,
  resolveSourceHealthReport,
  resolveStarterFeedSources,
} from './sourceRegistry';
export type { ResolvedStarterFeedSources } from './sourceRegistry';

export {
  SOURCE_ADMISSION_REPORT_SCHEMA_VERSION,
  auditFeedSourceAdmission,
  buildSourceAdmissionReport,
  writeSourceAdmissionArtifact,
} from './sourceAdmissionReport';
export type {
  SourceAdmissionArtifactOptions,
  SourceAdmissionAuditOptions,
  SourceAdmissionCriteria,
  SourceAdmissionEvaluationMode,
  SourceAdmissionReport,
  SourceAdmissionSampleResult,
  SourceAdmissionSourceReport,
  SourceAdmissionStatus,
} from './sourceAdmissionReport';

export {
  SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
  SOURCE_HEALTH_TREND_INDEX_SCHEMA_VERSION,
  buildSourceHealthReport,
  buildSourceHealthTrendIndex,
  buildSourceHealthThresholds,
  buildSourceHealthRuntimePolicy,
  writeSourceHealthArtifact,
} from './sourceHealthReport';
export type {
  SourceHealthArtifactOptions,
  SourceHealthDecision,
  SourceHealthHistorySummary,
  SourceHealthObservability,
  SourceHealthReleaseEvidence,
  SourceHealthReleaseEvidenceStatus,
  SourceHealthReadinessStatus,
  SourceHealthReport,
  SourceHealthRuntimePolicy,
  SourceHealthSourceHistory,
  SourceHealthSourceReport,
  SourceHealthTrendIndex,
  SourceHealthTrendRunSummary,
  SourceHealthThresholds,
} from './sourceHealthReport';

export {
  SOURCE_FEED_CONTRIBUTION_REPORT_SCHEMA_VERSION,
  buildSourceFeedContributionReport,
} from './sourceContributionReport';
export type {
  SourceFeedContributionOptions,
  SourceFeedContributionReport,
  SourceFeedContributionSourceReport,
} from './sourceContributionReport';

export {
  SOURCE_CANDIDATE_SCOUT_REPORT_SCHEMA_VERSION,
  buildSourceCandidateScoutReport,
  writeSourceCandidateScoutReport,
} from './sourceCandidateScout';
export type {
  SourceCandidateScoutCandidateResult,
  SourceCandidateScoutOptions,
  SourceCandidateScoutReport,
} from './sourceCandidateScout';

export { SOURCE_SCOUT_CANDIDATE_FEED_SOURCES } from './sourceScoutCandidates';

export {
  createArticleTextServer,
  startArticleTextServer,
} from './server';

export {
  createNewsAggregatorDaemon,
  startNewsAggregatorDaemonFromEnv,
} from './daemon';
export type {
  NewsAggregatorDaemonConfig,
  NewsAggregatorDaemonHandle,
  NewsAggregatorDaemonProcessHandle,
} from './daemon';
