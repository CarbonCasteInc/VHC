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
import type { FeedSource, StoryBundle, StorylineGroup, TopicMapping } from './newsTypes';

const DEFAULT_POLL_INTERVAL_MS = 30 * 60 * 1000;
const REMOTE_PROVIDER_ID = 'remote-analysis';

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
  runOnStart?: boolean;
  enabled?: boolean;
  prepareStoryBundle?: (bundle: StoryBundle) => Promise<StoryBundle | null> | StoryBundle | null;
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

export function startNewsRuntime(config: NewsRuntimeConfig): NewsRuntimeHandle {
  const pollIntervalMs = normalizePollInterval(config.pollIntervalMs);
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
      runtimeTrace('tick_clustered', {
        bundle_count: bundles.length,
        storyline_count: storylines.length,
      });

      const prepareStoryBundle = config.prepareStoryBundle;
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
      const preparedBundles: StoryBundle[] = [];
      const preparedStoryIds = new Set<string>();

      for (const bundle of bundles) {
        const preparedBundle = prepareStoryBundle
          ? await prepareStoryBundle(bundle)
          : bundle;
        if (!preparedBundle) {
          runtimeTrace('bundle_skipped', {
            story_id: bundle.story_id,
            reason: 'prepareStoryBundle',
          });
          continue;
        }
        preparedBundles.push(preparedBundle);
        preparedStoryIds.add(preparedBundle.story_id);
      }

      const preparedStorylines = storylines
        .map((storyline) => {
          const nextStoryIds = storyline.story_ids.filter((storyId) => preparedStoryIds.has(storyId));
          if (nextStoryIds.length === 0) {
            return null;
          }

          return {
            ...storyline,
            story_ids: nextStoryIds,
            canonical_story_id: nextStoryIds.includes(storyline.canonical_story_id)
              ? storyline.canonical_story_id
              : nextStoryIds[0]!,
          };
        })
        .filter((storyline): storyline is StorylineGroup => storyline !== null);

      if (writeStorylineGroup) {
        for (const storyline of preparedStorylines) {
          await writeStorylineGroup(config.gunClient, storyline);
          nextPublishedStorylineIds.add(storyline.storyline_id);
          publishedStorylineIds.add(storyline.storyline_id);
        }
      }

      for (const bundle of preparedBundles) {
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

      if (removeStorylineGroup && bundles.length > 0) {
        const staleStorylineIds = [...publishedStorylineIds]
          .filter((storylineId) => !nextPublishedStorylineIds.has(storylineId))
          .sort();

        for (const staleStorylineId of staleStorylineIds) {
          await removeStorylineGroup(config.gunClient, staleStorylineId);
          publishedStorylineIds.delete(staleStorylineId);
        }
      }

      if (removeStoryBundle && bundles.length > 0) {
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
  defaultPrompt,
  isTruthyFlag,
  normalizePollInterval,
  readEnvVar,
};
