import os from 'node:os';
import path from 'node:path';
import {
  computeStoryHotness,
  writeNewsHotIndexEntry,
  writeNewsLatestIndexEntry,
  type VennClient,
} from '@vh/gun-client';
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
  DEFAULT_BUNDLE_SYNTHESIS_TEMPERATURE,
  DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS,
  getBundleSynthesisModel,
} from './bundleSynthesisRelay';
import { createBundleSynthesisWorker, type BundleSynthesisWorkerResult } from './bundleSynthesisWorker';
import {
  appendSynthesisLifecycleRecord,
  synthesisLifecycleRecordFromWorkerResult,
} from './synthesisLifecycleLedger';

export interface BundleSynthesisDaemonEnrichment {
  enrichmentWorker?: EnrichmentWorker;
  enrichmentQueueOptions?: AsyncEnrichmentQueueOptions;
}

export interface BundleSynthesisDaemonOptions {
  runWrite?: <T>(
    writeClass: string,
    attributes: Record<string, unknown>,
    task: () => Promise<T>,
  ) => Promise<T>;
}

export function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !['0', 'false', 'off', 'no'].includes(normalized);
}

function isExplicitDisabledFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
}

function hasBundleSynthesisCredential(): boolean {
  return Boolean(
    readEnvVar('VH_BUNDLE_SYNTHESIS_API_KEY')
      || readEnvVar('ANALYSIS_RELAY_API_KEY')
      || readEnvVar('OPENAI_API_KEY'),
  );
}

export function shouldEnableBundleSynthesisFromEnv(): boolean {
  const explicit = readEnvVar('VH_BUNDLE_SYNTHESIS_ENABLED');
  if (isExplicitDisabledFlag(explicit)) {
    return false;
  }
  if (isTruthyFlag(explicit)) {
    return true;
  }
  return hasBundleSynthesisCredential();
}

function parseFiniteNumber(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isBundleSynthesisWorkerResult(value: unknown): value is BundleSynthesisWorkerResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  if (status === 'written') {
    return typeof (value as { storyId?: unknown }).storyId === 'string'
      && typeof (value as { synthesisId?: unknown }).synthesisId === 'string'
      && ((value as { latestStatus?: unknown }).latestStatus === 'written'
        || (value as { latestStatus?: unknown }).latestStatus === 'skipped');
  }
  return (status === 'skipped' || status === 'rejected')
    && typeof (value as { storyId?: unknown }).storyId === 'string'
    && typeof (value as { reason?: unknown }).reason === 'string';
}

export function createBundleSynthesisEnrichmentFromEnv(
  client: VennClient,
  logger: LoggerLike = console,
  options: BundleSynthesisDaemonOptions = {},
): BundleSynthesisDaemonEnrichment {
  const enabled = shouldEnableBundleSynthesisFromEnv();
  if (!enabled) {
    return {};
  }

  const runWrite = options.runWrite ?? (<T>(_: string, __: Record<string, unknown>, task: () => Promise<T>) => task());
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
    temperature: parseFiniteNumber(
      readEnvVar('VH_BUNDLE_SYNTHESIS_TEMPERATURE'),
      DEFAULT_BUNDLE_SYNTHESIS_TEMPERATURE,
    ),
    pipelineVersion: readEnvVar('VH_BUNDLE_SYNTHESIS_PIPELINE_VERSION') ?? DEFAULT_BUNDLE_SYNTHESIS_PIPELINE_VERSION,
    logger,
    runWrite: options.runWrite,
    publishReadyStory: async (publishClient, bundle) => {
      await runWrite(
        'news_latest_index',
        { story_id: bundle.story_id, topic_id: bundle.topic_id },
        () => writeNewsLatestIndexEntry(publishClient, bundle.story_id, bundle.cluster_window_end, bundle),
      );
      await runWrite(
        'news_hot_index',
        { story_id: bundle.story_id, topic_id: bundle.topic_id },
        () => writeNewsHotIndexEntry(publishClient, bundle.story_id, computeStoryHotness(bundle), bundle),
      );
    },
  });
  const queuePersistenceDir = resolveBundleSynthesisQueueDirFromEnv();
  const lifecycleLedgerPath = resolveBundleSynthesisLifecycleLedgerPathFromEnv(queuePersistenceDir);

  return {
    enrichmentWorker: (candidate) => worker(candidate),
    enrichmentQueueOptions: {
      maxDepth: queueDepth,
      persistenceDir: queuePersistenceDir,
      onWorkerResult(candidate, result) {
        if (!isBundleSynthesisWorkerResult(result)) {
          return;
        }
        appendSynthesisLifecycleRecord({
          filePath: lifecycleLedgerPath,
          record: synthesisLifecycleRecordFromWorkerResult({
            candidate,
            result,
            now: Date.now(),
          }),
          logger,
        });
      },
      onDrop(candidate) {
        logger.warn('[vh:bundle-synthesis] queue full; candidate dead-lettered for replay', {
          story_id: candidate.story_id,
          max_depth: queueDepth,
        });
      },
    },
  };
}

export function resolveBundleSynthesisQueueDirFromEnv(): string {
  const artifactRoot = readEnvVar('VH_DAEMON_FEED_ARTIFACT_ROOT');
  const stateRoot = readEnvVar('VH_NEWS_DAEMON_STATE_DIR');
  return (
    readEnvVar('VH_BUNDLE_SYNTHESIS_QUEUE_DIR') ??
    path.join(
      (stateRoot?.trim() || artifactRoot?.trim() || path.join(os.tmpdir(), 'vh-news-daemon')),
      'bundle-synthesis-queue',
    )
  );
}

export function resolveBundleSynthesisLifecycleLedgerPathFromEnv(queuePersistenceDir = resolveBundleSynthesisQueueDirFromEnv()): string {
  return readEnvVar('VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER') ??
    path.join(queuePersistenceDir, 'synthesis-lifecycle.jsonl');
}
