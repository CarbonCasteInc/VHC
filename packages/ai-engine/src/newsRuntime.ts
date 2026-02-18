import { buildRemoteRequest, type RemoteAnalysisRequest } from './modelConfig';
import { orchestrateNewsPipeline } from './newsOrchestrator';
import type { FeedSource, StoryBundle, TopicMapping } from './newsTypes';

const DEFAULT_POLL_INTERVAL_MS = 30 * 60 * 1000;
const REMOTE_PROVIDER_ID = 'remote-analysis';

export interface NewsRuntimeSynthesisCandidate {
  story_id: string;
  provider: {
    provider_id: string;
    model_id: string;
    kind: 'remote';
  };
  request: RemoteAnalysisRequest;
}

export interface NewsRuntimeConfig {
  feedSources: FeedSource[];
  topicMapping: TopicMapping;
  gunClient: unknown;
  pollIntervalMs?: number;
  runOnStart?: boolean;
  writeStoryBundle?: (client: unknown, bundle: StoryBundle) => Promise<unknown>;
  createAnalysisPrompt?: (bundle: StoryBundle) => string;
  onSynthesisCandidate?: (candidate: NewsRuntimeSynthesisCandidate) => void;
  onError?: (error: unknown) => void;
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

export function startNewsRuntime(config: NewsRuntimeConfig): NewsRuntimeHandle {
  const pollIntervalMs = normalizePollInterval(config.pollIntervalMs);
  const shouldRun = isNewsRuntimeEnabled();

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let inFlight = false;
  let lastRunAt: Date | null = null;

  const runTick = async (): Promise<void> => {
    if (!running || inFlight) {
      return;
    }

    inFlight = true;

    try {
      const bundles = await orchestrateNewsPipeline({
        feedSources: config.feedSources,
        topicMapping: config.topicMapping,
      });

      const writeStoryBundle = config.writeStoryBundle;
      if (!writeStoryBundle) {
        throw new Error('writeStoryBundle adapter is required');
      }

      const createPrompt = config.createAnalysisPrompt ?? defaultPrompt;

      for (const bundle of bundles) {
        const request = buildRemoteRequest(createPrompt(bundle));
        config.onSynthesisCandidate?.({
          story_id: bundle.story_id,
          provider: {
            provider_id: REMOTE_PROVIDER_ID,
            model_id: request.model,
            kind: 'remote',
          },
          request,
        });

        await writeStoryBundle(config.gunClient, bundle);
      }

      lastRunAt = new Date();
    } catch (error) {
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
