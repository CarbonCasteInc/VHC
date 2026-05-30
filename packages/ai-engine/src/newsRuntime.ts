import { buildRemoteRequest, type RemoteAnalysisRequest } from './modelConfig';
import {
  buildStoryAdvancedArtifact,
  type StoryAdvancedArtifact,
} from './newsAdvancedPipeline';
import { buildEnrichmentWorkItems } from './newsCluster';
import {
  orchestrateNewsPipeline,
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
  onError?: (error: unknown) => void;
  orchestratorOptions?: NewsOrchestratorOptions;
}

export interface NewsRuntimeHandle {
  stop(): void;
  isRunning(): boolean;
  lastRun(): Date | null;
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
  if (!maxPublishedBundles || eligibleBundles.length <= maxPublishedBundles) {
    return [...eligibleBundles];
  }

  return [...eligibleBundles]
    .sort((left, right) => (
      canonicalSourceCount(right) - canonicalSourceCount(left)
      || right.cluster_window_end - left.cluster_window_end
      || right.created_at - left.created_at
      || left.story_id.localeCompare(right.story_id)
    ))
    .slice(0, maxPublishedBundles);
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

function trustsClusterOutputForPublication(config: NewsRuntimeConfig): boolean {
  return config.orchestratorOptions?.productionMode === true
    && config.orchestratorOptions.allowHeuristicFallback === false;
}

export function startNewsRuntime(config: NewsRuntimeConfig): NewsRuntimeHandle {
  const pollIntervalMs = normalizePollInterval(config.pollIntervalMs);
  const maxPublishedBundles = resolveMaxPublishedBundles(config);
  const pruneStaleBundles = resolvePruneStaleBundles(config);
  const shouldRun = config.enabled ?? isNewsRuntimeEnabled();

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let inFlight = false;
  let lastRunAt: Date | null = null;
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
    const startedAt = Date.now();
    runtimeTrace('tick_started', {
      poll_interval_ms: pollIntervalMs,
      feed_source_count: config.feedSources.length,
    });

    try {
      const result = await orchestrateNewsPipeline(
        {
          feedSources: config.feedSources,
          topicMapping: config.topicMapping,
        },
        config.orchestratorOptions,
      );
      const { bundles, storylines } = result;
      const trustClusterOutput = trustsClusterOutputForPublication(config);
      const bundlesToPublish = selectBundlesForPublication(bundles, maxPublishedBundles, {
        trustClusterOutput,
      });
      const publicationEligibleBundleCount = trustClusterOutput
        ? bundles.length
        : bundles.filter(isPublicationEligibleBundle).length;
      runtimeTrace('tick_clustered', {
        bundle_count: bundles.length,
        storyline_count: storylines.length,
        published_bundle_limit: maxPublishedBundles,
        prune_stale_bundles: pruneStaleBundles,
        trusted_cluster_output_for_publication: trustClusterOutput,
        publication_ineligible_bundle_count: bundles.length - publicationEligibleBundleCount,
        selected_bundle_count: bundlesToPublish.length,
      });

      const writeStoryBundle = config.writeStoryBundle;
      if (!writeStoryBundle) {
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

      for (const bundle of bundlesToPublish) {
        const request = buildRemoteRequest(createPrompt(bundle));
        const workItems = buildEnrichmentWorkItems(bundle);

        await writeStoryBundle(config.gunClient, bundle);
        nextPublishedStoryIds.add(bundle.story_id);
        publishedStoryIds.add(bundle.story_id);

        let advancedArtifact: StoryAdvancedArtifact | undefined;
        try {
          advancedArtifact = createAdvancedArtifact(bundle);
        } catch (error) {
          config.onError?.(error);
        }

        if (config.onSynthesisCandidate && workItems.length > 0) {
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

          void Promise.resolve(config.onSynthesisCandidate(candidate)).catch((error) => {
            config.onError?.(error);
          });
        }
      }

      if (writeStorylineGroup) {
        for (const storyline of storylines) {
          try {
            await writeStorylineGroup(config.gunClient, storyline);
            nextPublishedStorylineIds.add(storyline.storyline_id);
            publishedStorylineIds.add(storyline.storyline_id);
          } catch (error) {
            runtimeTrace('storyline_write_failed', {
              storyline_id: storyline.storyline_id,
              error: error instanceof Error ? error.message : String(error),
            });
            config.onError?.(error);
          }
        }
      }

      if (pruneStaleBundles && removeStorylineGroup && bundlesToPublish.length > 0) {
        const staleStorylineIds = [...publishedStorylineIds]
          .filter((storylineId) => !nextPublishedStorylineIds.has(storylineId))
          .sort();

        for (const staleStorylineId of staleStorylineIds) {
          await removeStorylineGroup(config.gunClient, staleStorylineId);
          publishedStorylineIds.delete(staleStorylineId);
        }
      }

      if (pruneStaleBundles && removeStoryBundle && nextPublishedStoryIds.size > 0) {
        const staleStoryIds = [...publishedStoryIds]
          .filter((storyId) => !nextPublishedStoryIds.has(storyId))
          .sort();

        for (const staleStoryId of staleStoryIds) {
          await removeStoryBundle(config.gunClient, staleStoryId);
          publishedStoryIds.delete(staleStoryId);
        }
      }

      lastRunAt = new Date();
      runtimeTrace('tick_completed', {
        duration_ms: Math.max(0, Date.now() - startedAt),
        published_story_count: nextPublishedStoryIds.size,
        published_storyline_count: nextPublishedStorylineIds.size,
      });
    } catch (error) {
      runtimeTrace('tick_failed', {
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      config.onError?.(error);
    } finally {
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
    runtimeTrace('tick_queued_immediate', {
      poll_interval_ms: pollIntervalMs,
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
  selectBundlesForPublication,
  readEnvVar,
  readOptionalPositiveIntEnv,
  trustsClusterOutputForPublication,
  titlesHaveMatchingAction,
};
