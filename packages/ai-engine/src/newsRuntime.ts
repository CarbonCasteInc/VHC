import { buildRemoteRequest, type RemoteAnalysisRequest } from './modelConfig';
import {
  buildStoryAdvancedArtifact,
  type StoryAdvancedArtifact,
} from './newsAdvancedPipeline';
import { buildEnrichmentWorkItems } from './newsCluster';
import {
  orchestrateNewsPipeline,
  type NewsOrchestratorClusterArtifacts,
  type NewsOrchestratorOptions,
} from './newsOrchestrator';
import {
  detectActionCategory,
  extractKeywords,
  jaccardSimilarity,
} from './sameEventMerge';
import type { FeedSource, StoryBundle, StorylineGroup, TopicMapping } from './newsTypes';

const DEFAULT_POLL_INTERVAL_MS = 30 * 60 * 1000;
const REMOTE_PROVIDER_ID = 'remote-analysis';
const MIN_TWO_SOURCE_PUBLICATION_CONFIDENCE = 0.6;
const MIN_TITLE_SUPPORTED_TWO_SOURCE_PUBLICATION_CONFIDENCE = 0.45;
const STRONG_TWO_SOURCE_PUBLICATION_CONFIDENCE = 0.8;
const STRONG_TITLE_KEYWORD_OVERLAP = 0.35;
const ACTION_MATCH_TITLE_KEYWORD_OVERLAP = 0.1;
const SHARED_TITLE_ANCHOR_MIN_COUNT = 2;
const GENERIC_TITLE_ANCHORS = new Set([
  'congo',
  'court',
  'dr',
  'ebola',
  'ebola-related',
  'outbreak',
  'supreme',
  'uganda',
]);
const TITLE_KEYWORD_ALIASES: Readonly<Record<string, string>> = {
  chinese: 'china',
  kills: 'kill',
  killed: 'kill',
  leads: 'lead',
  meetings: 'meeting',
  negotiations: 'negotiation',
  talks: 'talk',
  turtles: 'turtle',
};

export interface NewsRuntimeEnrichmentWorkItem {
  story_id: string;
  topic_id: string;
  work_type: 'full-analysis' | 'bias-table';
  summary_hint: string;
  requested_at: number;
}

export interface NewsRuntimeSynthesisCandidate {
  story_id: string;
  provider: {
    provider_id: string;
    model_id: string;
    kind: 'remote';
  };
  request: RemoteAnalysisRequest;
  work_items: NewsRuntimeEnrichmentWorkItem[];
  advanced_artifact?: StoryAdvancedArtifact;
}

export interface NewsRuntimeConfig {
  feedSources: FeedSource[];
  topicMapping: TopicMapping;
  gunClient: unknown;
  pollIntervalMs?: number;
  maxPublishedBundles?: number;
  pruneStaleBundles?: boolean;
  runOnStart?: boolean;
  enabled?: boolean;
  writeStoryBundle?: (client: unknown, bundle: StoryBundle) => Promise<unknown>;
  removeStoryBundle?: (client: unknown, storyId: string) => Promise<unknown>;
  writeStorylineGroup?: (client: unknown, storyline: StorylineGroup) => Promise<unknown>;
  removeStorylineGroup?: (client: unknown, storylineId: string) => Promise<unknown>;
  createAnalysisPrompt?: (bundle: StoryBundle) => string;
  createAdvancedArtifact?: (bundle: StoryBundle) => StoryAdvancedArtifact;
  onSynthesisCandidate?: (candidate: NewsRuntimeSynthesisCandidate) => void | Promise<void>;
  onTickSummary?: (summary: NewsRuntimeTickSummary) => void | Promise<void>;
  onError?: (error: unknown) => void;
  orchestratorOptions?: NewsOrchestratorOptions;
  noWrite?: boolean;
  tickWatchdogMs?: number;
}

export interface NewsRuntimeHandle {
  stop(): void;
  isRunning(): boolean;
  lastRun(): Date | null;
}

export type NewsRuntimeTickStage =
  | 'queued'
  | 'started'
  | 'orchestrating'
  | 'clustered'
  | 'writing_raw_bundles'
  | 'writing_storylines'
  | 'pruning_stale'
  | 'completed'
  | 'failed';

export interface NewsRuntimeTickSummary {
  readonly schemaVersion: 'vh-news-runtime-tick-summary-v1';
  readonly tick_sequence: number;
  readonly first_tick: boolean;
  readonly status: 'completed' | 'failed';
  readonly no_write: boolean;
  readonly started_at: string;
  readonly completed_at: string;
  readonly duration_ms: number;
  readonly poll_interval_ms: number;
  readonly feed_source_count: number;
  readonly ingested_item_count: number | null;
  readonly normalized_item_count: number | null;
  readonly clustered_bundle_count: number;
  readonly clustered_storyline_count: number;
  readonly selected_bundle_count: number;
  readonly selected_singleton_bundle_count: number;
  readonly selected_multi_source_bundle_count: number;
  readonly publication_ineligible_bundle_count: number;
  readonly raw_write_attempted_count: number;
  readonly raw_write_suppressed_count: number;
  readonly raw_wrote_count: number;
  readonly raw_write_failed_count: number;
  readonly storyline_write_attempted_count: number;
  readonly storyline_write_suppressed_count: number;
  readonly storyline_wrote_count: number;
  readonly storyline_write_failed_count: number;
  readonly stale_story_remove_attempted_count: number;
  readonly stale_story_remove_suppressed_count: number;
  readonly stale_story_removed_count: number;
  readonly stale_story_remove_failed_count: number;
  readonly stale_storyline_remove_attempted_count: number;
  readonly stale_storyline_remove_suppressed_count: number;
  readonly stale_storyline_removed_count: number;
  readonly stale_storyline_remove_failed_count: number;
  readonly synthesis_candidate_enqueued_count: number;
  readonly synthesis_candidate_suppressed_count: number;
  readonly last_stage: NewsRuntimeTickStage;
  readonly first_selected_story_ids: readonly string[];
  readonly error?: string;
}

function readEnvVar(name: string): string | undefined {
  const viteValue = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[name];
  const processValue =
    typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)[name] : undefined;
  const value = viteValue ?? processValue;
  return typeof value === 'string' ? value : undefined;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return !['0', 'false', 'off', 'no'].includes(normalized);
}

export function isNewsRuntimeEnabled(): boolean {
  return isTruthyFlag(readEnvVar('VITE_NEWS_RUNTIME_ENABLED'));
}

function normalizePollInterval(intervalMs: number | undefined): number {
  if (intervalMs === undefined) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('pollIntervalMs must be a positive finite number');
  }
  return Math.floor(intervalMs);
}

function normalizeOptionalPositiveInt(
  value: number | undefined,
  label: string,
): number | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
  return Math.floor(value);
}

function readOptionalPositiveIntEnv(name: string): number | null {
  const raw = readEnvVar(name)?.trim();
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function resolveMaxPublishedBundles(config: NewsRuntimeConfig): number | null {
  return normalizeOptionalPositiveInt(config.maxPublishedBundles, 'maxPublishedBundles')
    ?? readOptionalPositiveIntEnv('VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES')
    ?? readOptionalPositiveIntEnv('VITE_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES');
}

function resolvePruneStaleBundles(config: NewsRuntimeConfig): boolean {
  if (config.pruneStaleBundles !== undefined) {
    return config.pruneStaleBundles;
  }
  return isTruthyFlag(readEnvVar('VH_NEWS_RUNTIME_PRUNE_STALE_BUNDLES'))
    || isTruthyFlag(readEnvVar('VITE_NEWS_RUNTIME_PRUNE_STALE_BUNDLES'));
}

function canonicalSourceCount(bundle: StoryBundle): number {
  return (bundle.primary_sources ?? bundle.sources).length;
}

function canonicalSources(bundle: StoryBundle): StoryBundle['sources'] {
  return bundle.primary_sources ?? bundle.sources;
}

function bundleConfidenceScore(bundle: StoryBundle): number {
  const confidence = bundle.cluster_features.confidence_score;
  return typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0.5;
}

function titleKeywordOverlap(leftTitle: string, rightTitle: string): number {
  return jaccardSimilarity(extractKeywords(leftTitle), extractKeywords(rightTitle));
}

function normalizeTitleKeyword(keyword: string): string | null {
  const normalized = keyword
    .trim()
    .toLowerCase()
    .replace(/^0+/, '')
    .replace(/'s$/, '')
    .replace(/&#0*39;s?$/, '');
  if (!normalized || /^\d+$/.test(normalized)) {
    return null;
  }
  const aliased = TITLE_KEYWORD_ALIASES[normalized] ?? normalized;
  return GENERIC_TITLE_ANCHORS.has(aliased) ? null : aliased;
}

function normalizedTitleKeywords(title: string): Set<string> {
  return new Set(
    extractKeywords(title)
      .map(normalizeTitleKeyword)
      .filter((keyword): keyword is string => Boolean(keyword)),
  );
}

function sharedTitleAnchorCount(leftTitle: string, rightTitle: string): number {
  const leftKeywords = normalizedTitleKeywords(leftTitle);
  const rightKeywords = normalizedTitleKeywords(rightTitle);
  let sharedCount = 0;
  for (const keyword of leftKeywords) {
    if (rightKeywords.has(keyword)) {
      sharedCount += 1;
    }
  }
  return sharedCount;
}

function titlesHaveMatchingAction(leftTitle: string, rightTitle: string): boolean {
  const leftAction = detectActionCategory(leftTitle);
  const rightAction = detectActionCategory(rightTitle);
  return leftAction !== null && leftAction === rightAction;
}

function hasTitlePairCanonicalSupport(leftTitle: string, rightTitle: string): boolean {
  const keywordOverlap = titleKeywordOverlap(leftTitle, rightTitle);
  return keywordOverlap >= STRONG_TITLE_KEYWORD_OVERLAP
    || sharedTitleAnchorCount(leftTitle, rightTitle) >= SHARED_TITLE_ANCHOR_MIN_COUNT
    || (
      titlesHaveMatchingAction(leftTitle, rightTitle)
      && keywordOverlap >= ACTION_MATCH_TITLE_KEYWORD_OVERLAP
    );
}

function hasTwoSourcePublicationSupport(bundle: StoryBundle): boolean {
  const sources = canonicalSources(bundle);
  if (sources.length !== 2) {
    return true;
  }

  const confidence = bundleConfidenceScore(bundle);
  if (confidence < MIN_TITLE_SUPPORTED_TWO_SOURCE_PUBLICATION_CONFIDENCE) {
    return false;
  }

  const left = sources[0]!;
  const right = sources[1]!;
  const titleSupport = hasTitlePairCanonicalSupport(left.title, right.title);
  if (confidence >= STRONG_TWO_SOURCE_PUBLICATION_CONFIDENCE) {
    return true;
  }
  if (!titleSupport) {
    return false;
  }
  return confidence >= MIN_TWO_SOURCE_PUBLICATION_CONFIDENCE
    || confidence >= MIN_TITLE_SUPPORTED_TWO_SOURCE_PUBLICATION_CONFIDENCE;
}

function isPublicationEligibleBundle(bundle: StoryBundle): boolean {
  const sourceCount = canonicalSourceCount(bundle);
  if (sourceCount < 2) {
    return true;
  }
  return hasTwoSourcePublicationSupport(bundle);
}

function refineBundleForPublication(bundle: StoryBundle): StoryBundle {
  const sources = canonicalSources(bundle);
  if (sources.length < 3) {
    return bundle;
  }

  const primarySources = sources.filter((source, index) =>
    sources.some((candidate, candidateIndex) =>
      candidateIndex !== index && hasTitlePairCanonicalSupport(source.title, candidate.title),
    ),
  );
  if (primarySources.length === sources.length || primarySources.length < 2) {
    return bundle;
  }

  const primaryKeys = new Set(primarySources.map((source) => `${source.source_id}:${source.url_hash}`));
  const demotedSources = sources.filter((source) => !primaryKeys.has(`${source.source_id}:${source.url_hash}`));
  return {
    ...bundle,
    primary_sources: primarySources,
    related_links: [
      ...(bundle.related_links ?? []),
      ...demotedSources,
    ],
  };
}

function selectBundlesForPublication(
  bundles: readonly StoryBundle[],
  maxPublishedBundles: number | null,
  options: { readonly trustClusterOutput?: boolean } = {},
): StoryBundle[] {
  const eligibleBundles = options.trustClusterOutput
    ? [...bundles]
    : bundles
        .map(refineBundleForPublication)
        .filter(isPublicationEligibleBundle);
  const orderedBundles = [...eligibleBundles].sort(compareBundlesForPublication);

  if (!maxPublishedBundles || orderedBundles.length <= maxPublishedBundles) {
    return orderedBundles;
  }

  return orderedBundles.slice(0, maxPublishedBundles);
}

function compareBundlesForPublication(left: StoryBundle, right: StoryBundle): number {
  return canonicalSourceCount(right) - canonicalSourceCount(left)
    || right.cluster_window_end - left.cluster_window_end
    || right.created_at - left.created_at
    || left.story_id.localeCompare(right.story_id);
}

function defaultPrompt(bundle: StoryBundle): string {
  return bundle.summary_hint ?? bundle.headline;
}

function runtimeTraceEnabled(): boolean {
  const raw = readEnvVar('VH_NEWS_RUNTIME_TRACE')?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function runtimeTrace(event: string, detail: Record<string, unknown>): void {
  if (!runtimeTraceEnabled()) {
    return;
  }
  console.info(`[vh:news-runtime] ${event}`, detail);
}

function normalizeRuntimeWatchdogMs(config: NewsRuntimeConfig): number | null {
  const configured = config.tickWatchdogMs ?? readOptionalPositiveIntEnv('VH_NEWS_RUNTIME_TICK_WATCHDOG_MS');
  if (configured === null || configured === undefined) {
    return null;
  }
  if (!Number.isFinite(configured) || configured <= 0) {
    throw new Error('tickWatchdogMs must be a positive finite number');
  }
  return Math.floor(configured);
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logTickSummary(summary: NewsRuntimeTickSummary): void {
  const logger = summary.status === 'failed' ? console.warn : console.info;
  logger('[vh:news-runtime] tick summary', summary);

  if (!summary.first_tick) {
    return;
  }

  const firstTickLogger =
    summary.status === 'failed'
    || summary.selected_bundle_count === 0
    || (!summary.no_write && summary.raw_wrote_count === 0)
      ? console.warn
      : console.info;
  firstTickLogger('[vh:news-runtime] first tick outcome', summary);
}

async function emitTickSummary(
  summary: NewsRuntimeTickSummary,
  onTickSummary: NewsRuntimeConfig['onTickSummary'],
): Promise<void> {
  logTickSummary(summary);
  if (!onTickSummary) {
    return;
  }
  try {
    await Promise.resolve(onTickSummary(summary));
  } catch (error) {
    console.warn('[vh:news-runtime] tick summary artifact callback failed', {
      tick_sequence: summary.tick_sequence,
      error: summarizeError(error),
    });
  }
}

function trustsClusterOutputForPublication(config: NewsRuntimeConfig): boolean {
  return config.orchestratorOptions?.productionMode === true
    && config.orchestratorOptions.allowHeuristicFallback === false;
}

export function startNewsRuntime(config: NewsRuntimeConfig): NewsRuntimeHandle {
  const pollIntervalMs = normalizePollInterval(config.pollIntervalMs);
  const maxPublishedBundles = resolveMaxPublishedBundles(config);
  const pruneStaleBundles = resolvePruneStaleBundles(config);
  const shouldRun = config.enabled ?? isNewsRuntimeEnabled();
  const noWrite = config.noWrite === true;
  const tickWatchdogMs = normalizeRuntimeWatchdogMs(config);

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let inFlight = false;
  let lastRunAt: Date | null = null;
  let tickSequence = 0;
  let publishedStoryIds = new Set<string>();
  let publishedStorylineIds = new Set<string>();

  const runTick = async (): Promise<void> => {
    if (!running || inFlight) {
      runtimeTrace('tick_skipped', {
        running,
        in_flight: inFlight,
      });
      return;
    }

    inFlight = true;
    tickSequence += 1;
    const currentTickSequence = tickSequence;
    const firstTick = currentTickSequence === 1;
    const startedAt = Date.now();
    let lastStage: NewsRuntimeTickStage = 'started';
    let latestClusterArtifacts: NewsOrchestratorClusterArtifacts | null = null;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    if (tickWatchdogMs !== null) {
      watchdogTimer = setTimeout(() => {
        /* c8 ignore next 3 -- defensive guard for a timer callback already queued as the tick completes. */
        if (!inFlight) {
          return;
        }
        console.warn('[vh:news-runtime] tick watchdog warning', {
          tick_sequence: currentTickSequence,
          first_tick: firstTick,
          elapsed_ms: Math.max(0, Date.now() - startedAt),
          threshold_ms: tickWatchdogMs,
          last_stage: lastStage,
          poll_interval_ms: pollIntervalMs,
        });
      }, tickWatchdogMs);
    }
    runtimeTrace('tick_started', {
      poll_interval_ms: pollIntervalMs,
      feed_source_count: config.feedSources.length,
    });

    const baseSummary = (): Omit<NewsRuntimeTickSummary, 'status' | 'completed_at' | 'duration_ms' | 'last_stage'> => ({
      schemaVersion: 'vh-news-runtime-tick-summary-v1',
      tick_sequence: currentTickSequence,
      first_tick: firstTick,
      no_write: noWrite,
      started_at: new Date(startedAt).toISOString(),
      poll_interval_ms: pollIntervalMs,
      feed_source_count: config.feedSources.length,
      ingested_item_count: latestClusterArtifacts?.rawItemCount ?? null,
      normalized_item_count: latestClusterArtifacts?.normalizedItems.length ?? null,
      clustered_bundle_count: 0,
      clustered_storyline_count: 0,
      selected_bundle_count: 0,
      selected_singleton_bundle_count: 0,
      selected_multi_source_bundle_count: 0,
      publication_ineligible_bundle_count: 0,
      raw_write_attempted_count: 0,
      raw_write_suppressed_count: 0,
      raw_wrote_count: 0,
      raw_write_failed_count: 0,
      storyline_write_attempted_count: 0,
      storyline_write_suppressed_count: 0,
      storyline_wrote_count: 0,
      storyline_write_failed_count: 0,
      stale_story_remove_attempted_count: 0,
      stale_story_remove_suppressed_count: 0,
      stale_story_removed_count: 0,
      stale_story_remove_failed_count: 0,
      stale_storyline_remove_attempted_count: 0,
      stale_storyline_remove_suppressed_count: 0,
      stale_storyline_removed_count: 0,
      stale_storyline_remove_failed_count: 0,
      synthesis_candidate_enqueued_count: 0,
      synthesis_candidate_suppressed_count: 0,
      first_selected_story_ids: [],
    });

    try {
      const orchestratorOptions: NewsOrchestratorOptions = {
        ...(config.orchestratorOptions ?? {}),
      };
      const existingClusterArtifactsHook = orchestratorOptions.onClusterArtifacts;
      orchestratorOptions.onClusterArtifacts = async (artifacts) => {
        latestClusterArtifacts = artifacts;
        await existingClusterArtifactsHook?.(artifacts);
      };
      lastStage = 'orchestrating';
      const result = await orchestrateNewsPipeline(
        {
          feedSources: config.feedSources,
          topicMapping: config.topicMapping,
        },
        orchestratorOptions,
      );
      const { bundles, storylines } = result;
      const trustClusterOutput = trustsClusterOutputForPublication(config);
      const bundlesToPublish = selectBundlesForPublication(bundles, maxPublishedBundles, {
        trustClusterOutput,
      });
      const publicationEligibleBundleCount = trustClusterOutput
        ? bundles.length
        : bundles.filter(isPublicationEligibleBundle).length;
      lastStage = 'clustered';
      runtimeTrace('tick_clustered', {
        bundle_count: bundles.length,
        storyline_count: storylines.length,
        published_bundle_limit: maxPublishedBundles,
        prune_stale_bundles: pruneStaleBundles,
        trusted_cluster_output_for_publication: trustClusterOutput,
        publication_ineligible_bundle_count: bundles.length - publicationEligibleBundleCount,
        selected_bundle_count: bundlesToPublish.length,
        selected_singleton_bundle_count: bundlesToPublish
          .filter((bundle) => canonicalSourceCount(bundle) === 1).length,
        selected_multi_source_bundle_count: bundlesToPublish
          .filter((bundle) => canonicalSourceCount(bundle) > 1).length,
        first_selected_story_ids: bundlesToPublish.slice(0, 10).map((bundle) => bundle.story_id),
      });

      const writeStoryBundle = config.writeStoryBundle;
      if (!writeStoryBundle && !noWrite) {
        throw new Error('writeStoryBundle adapter is required');
      }
      const removeStoryBundle = config.removeStoryBundle;
      const writeStorylineGroup = config.writeStorylineGroup;
      const removeStorylineGroup = config.removeStorylineGroup;

      const createPrompt = config.createAnalysisPrompt ?? defaultPrompt;
      const createAdvancedArtifact =
        config.createAdvancedArtifact ?? ((bundle: StoryBundle) => buildStoryAdvancedArtifact(bundle));

      const nextPublishedStoryIds = new Set<string>();
      const nextPublishedStorylineIds = new Set<string>();
      let rawWriteAttemptedCount = 0;
      let rawWriteSuppressedCount = 0;
      let rawWroteCount = 0;
      let failedStoryPublishCount = 0;
      let synthesisCandidateEnqueuedCount = 0;
      let synthesisCandidateSuppressedCount = 0;

      lastStage = 'writing_raw_bundles';
      for (const bundle of bundlesToPublish) {
        const request = buildRemoteRequest(createPrompt(bundle));
        const workItems = buildEnrichmentWorkItems(bundle);

        if (noWrite) {
          rawWriteSuppressedCount += 1;
          nextPublishedStoryIds.add(bundle.story_id);
          publishedStoryIds.add(bundle.story_id);
        } else {
          rawWriteAttemptedCount += 1;
          try {
            await writeStoryBundle!(config.gunClient, bundle);
            rawWroteCount += 1;
          } catch (error) {
            failedStoryPublishCount += 1;
            runtimeTrace('bundle_write_failed', {
              story_id: bundle.story_id,
              source_count: canonicalSourceCount(bundle),
              error: summarizeError(error),
            });
            config.onError?.(error);
            continue;
          }
          nextPublishedStoryIds.add(bundle.story_id);
          publishedStoryIds.add(bundle.story_id);
        }

        let advancedArtifact: StoryAdvancedArtifact | undefined;
        try {
          advancedArtifact = createAdvancedArtifact(bundle);
        } catch (error) {
          config.onError?.(error);
        }

        if (workItems.length > 0) {
          const candidate: NewsRuntimeSynthesisCandidate = {
            story_id: bundle.story_id,
            provider: {
              provider_id: REMOTE_PROVIDER_ID,
              model_id: request.model,
              kind: 'remote',
            },
            request,
            work_items: workItems,
            advanced_artifact: advancedArtifact,
          };

          if (noWrite || !config.onSynthesisCandidate) {
            synthesisCandidateSuppressedCount += 1;
          } else {
            synthesisCandidateEnqueuedCount += 1;
            void Promise.resolve(config.onSynthesisCandidate(candidate)).catch((error) => {
              config.onError?.(error);
            });
          }
        }
      }

      if (!noWrite && bundlesToPublish.length > 0 && nextPublishedStoryIds.size === 0 && failedStoryPublishCount > 0) {
        throw new Error(
          `news runtime failed to publish any selected bundles (${failedStoryPublishCount}/${bundlesToPublish.length} failed)`,
        );
      }

      let storylineWriteAttemptedCount = 0;
      let storylineWriteSuppressedCount = 0;
      let storylineWroteCount = 0;
      let storylineWriteFailedCount = 0;
      if (writeStorylineGroup) {
        lastStage = 'writing_storylines';
        for (const storyline of storylines) {
          if (noWrite) {
            storylineWriteSuppressedCount += 1;
            nextPublishedStorylineIds.add(storyline.storyline_id);
            publishedStorylineIds.add(storyline.storyline_id);
          } else {
            storylineWriteAttemptedCount += 1;
            try {
              await writeStorylineGroup(config.gunClient, storyline);
              storylineWroteCount += 1;
              nextPublishedStorylineIds.add(storyline.storyline_id);
              publishedStorylineIds.add(storyline.storyline_id);
            } catch (error) {
              storylineWriteFailedCount += 1;
              runtimeTrace('storyline_write_failed', {
                storyline_id: storyline.storyline_id,
                error: summarizeError(error),
              });
              config.onError?.(error);
            }
          }
        }
      } else if (noWrite) {
        storylineWriteSuppressedCount = storylines.length;
        for (const storyline of storylines) {
          nextPublishedStorylineIds.add(storyline.storyline_id);
          publishedStorylineIds.add(storyline.storyline_id);
        }
      }

      let staleStorylineRemoveAttemptedCount = 0;
      let staleStorylineRemoveSuppressedCount = 0;
      let staleStorylineRemovedCount = 0;
      let staleStorylineRemoveFailedCount = 0;
      if (pruneStaleBundles && (removeStorylineGroup || noWrite) && bundlesToPublish.length > 0) {
        lastStage = 'pruning_stale';
        const staleStorylineIds = [...publishedStorylineIds]
          .filter((storylineId) => !nextPublishedStorylineIds.has(storylineId))
          .sort();

        for (const staleStorylineId of staleStorylineIds) {
          if (noWrite) {
            staleStorylineRemoveSuppressedCount += 1;
          } else {
            staleStorylineRemoveAttemptedCount += 1;
            try {
              await removeStorylineGroup!(config.gunClient, staleStorylineId);
              staleStorylineRemovedCount += 1;
              publishedStorylineIds.delete(staleStorylineId);
            } catch (error) {
              staleStorylineRemoveFailedCount += 1;
              config.onError?.(error);
            }
          }
        }
      }

      let staleStoryRemoveAttemptedCount = 0;
      let staleStoryRemoveSuppressedCount = 0;
      let staleStoryRemovedCount = 0;
      let staleStoryRemoveFailedCount = 0;
      if (pruneStaleBundles && (removeStoryBundle || noWrite) && (nextPublishedStoryIds.size > 0 || noWrite)) {
        lastStage = 'pruning_stale';
        const staleStoryIds = [...publishedStoryIds]
          .filter((storyId) => !nextPublishedStoryIds.has(storyId))
          .sort();

        for (const staleStoryId of staleStoryIds) {
          if (noWrite) {
            staleStoryRemoveSuppressedCount += 1;
          } else {
            staleStoryRemoveAttemptedCount += 1;
            try {
              await removeStoryBundle!(config.gunClient, staleStoryId);
              staleStoryRemovedCount += 1;
              publishedStoryIds.delete(staleStoryId);
            } catch (error) {
              staleStoryRemoveFailedCount += 1;
              config.onError?.(error);
            }
          }
        }
      }

      lastRunAt = new Date();
      lastStage = 'completed';
      runtimeTrace('tick_completed', {
        duration_ms: Math.max(0, Date.now() - startedAt),
        selected_story_count: bundlesToPublish.length,
        published_story_count: nextPublishedStoryIds.size,
        failed_story_count: failedStoryPublishCount,
        published_storyline_count: nextPublishedStorylineIds.size,
      });
      const clusterArtifactsSnapshot = latestClusterArtifacts as NewsOrchestratorClusterArtifacts | null;
      await emitTickSummary({
        ...baseSummary(),
        status: 'completed',
        completed_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        ingested_item_count: clusterArtifactsSnapshot?.rawItemCount ?? null,
        normalized_item_count: clusterArtifactsSnapshot?.normalizedItems.length ?? null,
        clustered_bundle_count: bundles.length,
        clustered_storyline_count: storylines.length,
        selected_bundle_count: bundlesToPublish.length,
        selected_singleton_bundle_count: bundlesToPublish
          .filter((bundle) => canonicalSourceCount(bundle) === 1).length,
        selected_multi_source_bundle_count: bundlesToPublish
          .filter((bundle) => canonicalSourceCount(bundle) > 1).length,
        publication_ineligible_bundle_count: bundles.length - publicationEligibleBundleCount,
        raw_write_attempted_count: rawWriteAttemptedCount,
        raw_write_suppressed_count: rawWriteSuppressedCount,
        raw_wrote_count: rawWroteCount,
        raw_write_failed_count: failedStoryPublishCount,
        storyline_write_attempted_count: storylineWriteAttemptedCount,
        storyline_write_suppressed_count: storylineWriteSuppressedCount,
        storyline_wrote_count: storylineWroteCount,
        storyline_write_failed_count: storylineWriteFailedCount,
        stale_story_remove_attempted_count: staleStoryRemoveAttemptedCount,
        stale_story_remove_suppressed_count: staleStoryRemoveSuppressedCount,
        stale_story_removed_count: staleStoryRemovedCount,
        stale_story_remove_failed_count: staleStoryRemoveFailedCount,
        stale_storyline_remove_attempted_count: staleStorylineRemoveAttemptedCount,
        stale_storyline_remove_suppressed_count: staleStorylineRemoveSuppressedCount,
        stale_storyline_removed_count: staleStorylineRemovedCount,
        stale_storyline_remove_failed_count: staleStorylineRemoveFailedCount,
        synthesis_candidate_enqueued_count: synthesisCandidateEnqueuedCount,
        synthesis_candidate_suppressed_count: synthesisCandidateSuppressedCount,
        first_selected_story_ids: bundlesToPublish.slice(0, 10).map((bundle) => bundle.story_id),
        last_stage: lastStage,
      }, config.onTickSummary);
    } catch (error) {
      lastStage = 'failed';
      runtimeTrace('tick_failed', {
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: summarizeError(error),
      });
      await emitTickSummary({
        ...baseSummary(),
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - startedAt),
        last_stage: lastStage,
        error: summarizeError(error),
      }, config.onTickSummary);
      config.onError?.(error);
    } finally {
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer);
      }
      inFlight = false;
    }
  };

  if (!shouldRun) {
    return {
      stop() {
        running = false;
      },
      isRunning() {
        return false;
      },
      lastRun() {
        return lastRunAt;
      },
    };
  }

  running = true;
  timer = setInterval(() => {
    void runTick();
  }, pollIntervalMs);

  if (config.runOnStart !== false) {
    const queuedStage: NewsRuntimeTickStage = 'queued';
    runtimeTrace('tick_queued_immediate', {
      poll_interval_ms: pollIntervalMs,
      last_stage: queuedStage,
    });
    void runTick();
  }

  return {
    stop() {
      if (!running) {
        return;
      }
      running = false;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    isRunning() {
      return running;
    },
    lastRun() {
      return lastRunAt ? new Date(lastRunAt) : null;
    },
  };
}

export const __internal = {
  bundleConfidenceScore,
  defaultPrompt,
  hasTitlePairCanonicalSupport,
  isTruthyFlag,
  normalizeOptionalPositiveInt,
  normalizePollInterval,
  normalizeTitleKeyword,
  isPublicationEligibleBundle,
  refineBundleForPublication,
  resolvePruneStaleBundles,
  compareBundlesForPublication,
  selectBundlesForPublication,
  readEnvVar,
  readOptionalPositiveIntEnv,
  trustsClusterOutputForPublication,
  titlesHaveMatchingAction,
};
