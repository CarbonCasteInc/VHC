import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createNodeMeshClient } from '@vh/gun-client/node';
import {
  createBundleSynthesisEnrichmentFromEnv,
  resolveBundleSynthesisLifecycleLedgerPathFromEnv,
  resolveBundleSynthesisQueueDirFromEnv,
} from './bundleSynthesisDaemonConfig';
import { isDirectExecution } from './daemonCli';
import {
  parseGunPeers,
  readEnvVar,
  resolveSystemWriterClientConfigFromEnv,
  type EnrichmentWorker,
  type LoggerLike,
} from './daemonUtils';
import { createDaemonWriteLaneRegistry } from './daemonWriteLane';
import {
  readSynthesisLifecycleRecords,
  replayableSynthesisLifecycleCandidates,
} from './synthesisLifecycleLedger';

export interface SynthesisLifecycleReplayResult {
  ledger_path: string;
  candidates: number;
  replayed: number;
  failed: number;
  story_ids: readonly string[];
}

export interface SynthesisLifecycleReplayOptions {
  readonly ledgerPath: string;
  readonly storyIds?: readonly string[];
  readonly worker: EnrichmentWorker;
  readonly onWorkerResult?: (candidate: Parameters<EnrichmentWorker>[0], result: unknown) => void;
  readonly logger?: LoggerLike;
}

function parseStoryIdArgs(argv: readonly string[]): string[] {
  const storyIds: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--story-id' || arg === '--story_id') {
      const next = argv[index + 1]?.trim();
      if (next) {
        storyIds.push(next);
        index += 1;
      }
      continue;
    }
    if (arg?.startsWith('--story-id=')) {
      const value = arg.slice('--story-id='.length).trim();
      if (value) {
        storyIds.push(value);
      }
      continue;
    }
    if (arg && !arg.startsWith('-')) {
      storyIds.push(arg);
    }
  }
  return [...new Set(storyIds)];
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function safePathToken(value: string | undefined): string {
  return (value ?? 'default').trim().replace(/[^a-zA-Z0-9._:-]+/g, '_') || 'default';
}

function isDisabledFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
}

function resolveReplayGunFile(holderId: string | undefined): string {
  const stateRoot =
    firstNonEmpty(
      readEnvVar('VH_NEWS_DAEMON_STATE_DIR'),
      readEnvVar('VH_DAEMON_FEED_ARTIFACT_ROOT'),
    ) ?? path.join(process.cwd(), '.tmp', 'vh-news-daemon');
  return path.join(stateRoot, 'node-mesh-radisk', safePathToken(holderId ?? 'bundle-synthesis-replay'));
}

export async function replaySynthesisLifecycleFromLedger(
  options: SynthesisLifecycleReplayOptions,
): Promise<SynthesisLifecycleReplayResult> {
  const logger = options.logger ?? console;
  const records = readSynthesisLifecycleRecords(options.ledgerPath, logger);
  const candidates = replayableSynthesisLifecycleCandidates(records, options.storyIds);
  const result: SynthesisLifecycleReplayResult = {
    ledger_path: options.ledgerPath,
    candidates: candidates.length,
    replayed: 0,
    failed: 0,
    story_ids: candidates.map((candidate) => candidate.story_id),
  };

  for (const candidate of candidates) {
    try {
      const workerResult = await options.worker(candidate);
      options.onWorkerResult?.(candidate, workerResult);
      result.replayed += 1;
      logger.info('[vh:bundle-synthesis-replay] candidate replayed', {
        story_id: candidate.story_id,
      });
    } catch (error) {
      result.failed += 1;
      logger.warn('[vh:bundle-synthesis-replay] candidate replay failed', {
        story_id: candidate.story_id,
        error,
      });
    }
  }

  logger.info('[vh:bundle-synthesis-replay] complete', result);
  return result;
}

export async function runSynthesisLifecycleReplayFromEnv(argv = process.argv.slice(2)): Promise<SynthesisLifecycleReplayResult> {
  const storyIds = parseStoryIdArgs(argv);
  const queueDir = resolveBundleSynthesisQueueDirFromEnv();
  const ledgerPath = resolveBundleSynthesisLifecycleLedgerPathFromEnv(queueDir);
  const gunPeers = parseGunPeers(readEnvVar('VH_GUN_PEERS') ?? readEnvVar('VITE_GUN_PEERS'));
  const holderId = readEnvVar('VH_NEWS_DAEMON_HOLDER_ID');
  const gunRadisk = !isDisabledFlag(readEnvVar('VH_NEWS_DAEMON_GUN_RADISK'));
  const gunFile = gunRadisk
    ? firstNonEmpty(readEnvVar('VH_NEWS_DAEMON_GUN_FILE')) ?? resolveReplayGunFile(holderId)
    : false;
  if (typeof gunFile === 'string') {
    mkdirSync(path.dirname(gunFile), { recursive: true });
  }
  const writeLanes = createDaemonWriteLaneRegistry({ logger: console });
  const systemWriterConfig = await resolveSystemWriterClientConfigFromEnv();
  const client = createNodeMeshClient({
    peers: gunPeers.length > 0 ? gunPeers : undefined,
    requireSession: false,
    gunRadisk,
    gunFile,
    ...systemWriterConfig,
  });
  try {
    const enrichment = createBundleSynthesisEnrichmentFromEnv(client, console, {
      runWrite: writeLanes.run,
    });
    if (!enrichment.enrichmentWorker) {
      throw new Error('VH_BUNDLE_SYNTHESIS_ENABLED must be enabled for lifecycle replay');
    }
    return await replaySynthesisLifecycleFromLedger({
      ledgerPath,
      storyIds,
      worker: enrichment.enrichmentWorker,
      onWorkerResult: enrichment.enrichmentQueueOptions?.onWorkerResult,
      logger: console,
    });
  } finally {
    await client.shutdown();
  }
}

/* c8 ignore start */
if (isDirectExecution(import.meta.url)) {
  void runSynthesisLifecycleReplayFromEnv().catch((error) => {
    console.error('[vh:bundle-synthesis-replay] failed', error);
    process.exit(1);
  });
}
/* c8 ignore stop */
