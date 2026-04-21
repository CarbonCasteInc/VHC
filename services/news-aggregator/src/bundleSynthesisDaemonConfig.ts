import type { VennClient } from '@vh/gun-client';
import {
  parsePositiveInt,
  readEnvVar,
  type AsyncEnrichmentQueueOptions,
  type EnrichmentWorker,
  type LoggerLike,
} from './daemonUtils';
import {
  DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS,
  DEFAULT_BUNDLE_SYNTHESIS_PIPELINE_VERSION,
  DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN,
  DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS,
  getBundleSynthesisModel,
} from './bundleSynthesisRelay';
import { createBundleSynthesisWorker } from './bundleSynthesisWorker';

export interface BundleSynthesisDaemonEnrichment {
  enrichmentWorker?: EnrichmentWorker;
  enrichmentQueueOptions?: AsyncEnrichmentQueueOptions;
}

export function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !['0', 'false', 'off', 'no'].includes(normalized);
}

export function createBundleSynthesisEnrichmentFromEnv(
  client: VennClient,
  logger: LoggerLike = console,
): BundleSynthesisDaemonEnrichment {
  const enabled = isTruthyFlag(readEnvVar('VH_BUNDLE_SYNTHESIS_ENABLED'));
  if (!enabled) {
    return {};
  }

  const queueDepth = parsePositiveInt(readEnvVar('VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH'), 32);
  const worker = createBundleSynthesisWorker({
    client,
    model: readEnvVar('VH_BUNDLE_SYNTHESIS_MODEL') ?? getBundleSynthesisModel(),
    maxTokens: parsePositiveInt(readEnvVar('VH_BUNDLE_SYNTHESIS_MAX_TOKENS'), DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS),
    timeoutMs: parsePositiveInt(readEnvVar('VH_BUNDLE_SYNTHESIS_TIMEOUT_MS'), DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS),
    ratePerMinute: parsePositiveInt(
      readEnvVar('VH_BUNDLE_SYNTHESIS_RATE_PER_MIN'),
      DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN,
    ),
    pipelineVersion: readEnvVar('VH_BUNDLE_SYNTHESIS_PIPELINE_VERSION') ?? DEFAULT_BUNDLE_SYNTHESIS_PIPELINE_VERSION,
    logger,
  });

  return {
    enrichmentWorker: async (candidate) => {
      await worker(candidate);
    },
    enrichmentQueueOptions: {
      maxDepth: queueDepth,
      onDrop(candidate) {
        logger.warn('[vh:bundle-synthesis] queue full; candidate dropped', {
          story_id: candidate.story_id,
          max_depth: queueDepth,
        });
      },
    },
  };
}
