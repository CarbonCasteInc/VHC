import { pathToFileURL } from 'node:url';
import {
  startNewsRuntime,
  type FeedSource,
  type NewsRuntimeConfig,
  type NewsRuntimeHandle,
  type TopicMapping,
} from '@vh/ai-engine';
import {
  createNodeMeshClient,
  readNewsIngestionLease,
  removeNewsBundle,
  removeNewsStoryline,
  writeNewsIngestionLease,
  writeNewsStoryline,
  writeStoryBundle,
  type NewsIngestionLease,
  type VennClient,
} from '@vh/gun-client';
import {
  buildLeasePayload,
  createAsyncEnrichmentQueue,
  DEFAULT_LEASE_TTL_MS,
  parseFeedSources,
  resolveFeedSourceConfig,
  parseGunPeers,
  parseOptionalPositiveInt,
  parsePositiveInt,
  parseStoryClusterRemoteConfig,
  parseTopicMapping,
  readEnvVar,
  resolveLeaseHolderId,
  verifyStoryClusterHealth,
  type EnrichmentWorker,
  type LoggerLike,
} from './daemonUtils';
import { createLeaseGuard } from './leaseGuard';
import { createDaemonFeedClusterCaptureRecorder } from './clusterCapturePersistence';
type RuntimeStarter = (config: NewsRuntimeConfig) => NewsRuntimeHandle;
type RuntimeOrchestratorOptions = NonNullable<NewsRuntimeConfig['orchestratorOptions']> & {
  remoteClusterMaxItemsPerRequest?: number;
};
export interface NewsAggregatorDaemonConfig {
  client: VennClient;
  feedSources: FeedSource[];
  topicMapping: TopicMapping;
  pollIntervalMs?: number;
  leaseTtlMs?: number;
  leaseHolderId?: string;
  logger?: LoggerLike;
  startRuntime?: RuntimeStarter;
  readLease?: (client: VennClient) => Promise<NewsIngestionLease | null>;
  writeLease?: (client: VennClient, lease: unknown) => Promise<NewsIngestionLease>;
  writeBundle?: (client: VennClient, bundle: unknown) => Promise<unknown>;
  removeBundle?: (client: VennClient, storyId: string) => Promise<unknown>;
  enrichmentWorker?: EnrichmentWorker;
  runtimeOrchestratorOptions?: NewsRuntimeConfig['orchestratorOptions'];
  now?: () => number;
  random?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface NewsAggregatorDaemonHandle {
  readonly leaseHolderId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  currentLease(): NewsIngestionLease | null;
  enrichmentQueueDepth(): number;
}
export function createNewsAggregatorDaemon(config: NewsAggregatorDaemonConfig): NewsAggregatorDaemonHandle {
  const logger = config.logger ?? console;
  const startRuntime = config.startRuntime ?? startNewsRuntime;
  const readLease = config.readLease ?? readNewsIngestionLease;
  const writeLease = config.writeLease ?? writeNewsIngestionLease;
  const writeBundle = config.writeBundle ?? writeStoryBundle;
  const removeBundle = config.removeBundle ?? removeNewsBundle;
  const nowFn = config.now ?? Date.now;
  const randomFn = config.random ?? Math.random;
  const setIntervalFn = config.setIntervalFn ?? setInterval;
  const clearIntervalFn = config.clearIntervalFn ?? clearInterval;
  const leaseTtlMs = config.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const leaseRenewIntervalMs = Math.max(5_000, Math.floor(leaseTtlMs / 2));
  const leaseVerificationWindowMs = Math.max(500, Math.min(5_000, Math.floor(leaseTtlMs / 6)));
  const holderId = resolveLeaseHolderId(config.leaseHolderId);
  const queue = createAsyncEnrichmentQueue(config.enrichmentWorker ?? (() => undefined), logger);
  const clusterCaptureRecorder = createDaemonFeedClusterCaptureRecorder(
    readEnvVar('VH_DAEMON_FEED_RUN_ID'),
  );
  let running = false;
  let runtimeHandle: NewsRuntimeHandle | null = null;
  let leaseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let leadershipTickPromise: Promise<void> | null = null;
  const leaseGuard = createLeaseGuard({ client: config.client, readLease, verificationWindowMs: leaseVerificationWindowMs });
  const stopRuntime = () => {
    if (!runtimeHandle) {
      return;
    }
    runtimeHandle.stop();
    runtimeHandle = null;
  };
  const startRuntimeIfNeeded = () => {
    if (runtimeHandle?.isRunning()) {
      logger.info('[vh:news-daemon] runtime already running', { holder_id: holderId });
      return;
    }
    logger.info('[vh:news-daemon] starting runtime', { holder_id: holderId });
    const orchestratorOptions: NewsRuntimeConfig['orchestratorOptions'] = {
      ...(config.runtimeOrchestratorOptions ?? {}),
    };
    if (clusterCaptureRecorder) {
      const existingCaptureHook = orchestratorOptions.onClusterArtifacts;
      orchestratorOptions.onClusterArtifacts = async (artifacts) => {
        await clusterCaptureRecorder(artifacts);
        await existingCaptureHook?.(artifacts);
      };
    }
    runtimeHandle = startRuntime({
      enabled: true,
      feedSources: config.feedSources,
      topicMapping: config.topicMapping,
      gunClient: config.client,
      pollIntervalMs: config.pollIntervalMs,
      writeStoryBundle: async (runtimeClient: unknown, bundle: unknown) => {
        await leaseGuard.assertHeld(nowFn());
        return writeBundle(runtimeClient as VennClient, bundle);
      },
      removeStoryBundle: async (runtimeClient: unknown, storyId: string) => {
        await leaseGuard.assertHeld(nowFn());
        return removeBundle(runtimeClient as VennClient, storyId);
      },
      writeStorylineGroup: async (runtimeClient: unknown, storyline: unknown) => {
        await leaseGuard.assertHeld(nowFn());
        return writeNewsStoryline(runtimeClient as VennClient, storyline);
      },
      removeStorylineGroup: async (runtimeClient: unknown, storylineId: string) => {
        await leaseGuard.assertHeld(nowFn());
        return removeNewsStoryline(runtimeClient as VennClient, storylineId);
      },
      onSynthesisCandidate(candidate) {
        queue.enqueue(candidate);
      },
      onError(error) {
        logger.warn('[vh:news-daemon] runtime tick failed', error);
      },
      orchestratorOptions,
    });
    if (runtimeHandle.isRunning()) {
      logger.info('[vh:news-daemon] runtime started', { holder_id: holderId, poll_interval_ms: config.pollIntervalMs ?? null });
      return;
    }
    runtimeHandle = null;
    logger.warn('[vh:news-daemon] runtime did not start (disabled or rejected)');
  };
  const leadershipTick = async (): Promise<void> => {
    if (!running) {
      return;
    }
    const nowMs = nowFn();
    const currentLease = await readLease(config.client);
    logger.info('[vh:news-daemon] leadership tick', {
      holder_id: holderId,
      observed_lease_holder_id: currentLease?.holder_id ?? null,
      observed_lease_expires_at: currentLease?.expires_at ?? null,
      now_ms: nowMs,
    });
    if (currentLease && currentLease.holder_id !== holderId && currentLease.expires_at > nowMs) {
      logger.warn('[vh:news-daemon] lease held by another writer; runtime stays stopped', { holder_id: holderId, observed_lease_holder_id: currentLease.holder_id, observed_lease_expires_at: currentLease.expires_at });
      leaseGuard.clear();
      stopRuntime();
      return;
    }
    const nextLease = buildLeasePayload(
      holderId,
      currentLease && currentLease.holder_id === holderId ? currentLease : null,
      nowMs,
      leaseTtlMs,
      randomFn,
    );
    const lease = await writeLease(config.client, nextLease);
    leaseGuard.accept(lease, nowMs);
    logger.info('[vh:news-daemon] lease acquired', { holder_id: holderId, lease_holder_id: lease.holder_id, lease_token: lease.lease_token, expires_at: lease.expires_at });
    startRuntimeIfNeeded();
  };
  const runLeadershipTick = async (): Promise<void> => {
    if (leadershipTickPromise) {
      await leadershipTickPromise;
      return;
    }
    const inFlight = leadershipTick().catch((error) => {
      logger.warn('[vh:news-daemon] lease heartbeat failed', error);
      stopRuntime();
    });
    leadershipTickPromise = inFlight;
    await inFlight.finally(() => {
      if (leadershipTickPromise === inFlight) {
        leadershipTickPromise = null;
      }
    });
  };
  const releaseLease = async (): Promise<void> => {
    const nowMs = nowFn();
    const releaseLease = leaseGuard.releasePayload(nowMs);
    if (!releaseLease) {
      return;
    }
    try {
      await writeLease(config.client, releaseLease);
    } catch (error) {
      logger.warn('[vh:news-daemon] failed to release lease', error);
    } finally {
      leaseGuard.clear();
    }
  };
  return {
    leaseHolderId: holderId,
    async start() {
      if (running) {
        return;
      }
      running = true;
      await runLeadershipTick();
      leaseHeartbeatTimer = setIntervalFn(() => {
        void runLeadershipTick();
      }, leaseRenewIntervalMs);
      logger.info('[vh:news-daemon] leadership loop started', { holder_id: holderId, lease_ttl_ms: leaseTtlMs, lease_renew_interval_ms: leaseRenewIntervalMs });
    },
    async stop() {
      if (!running) {
        return;
      }
      running = false;
      if (leaseHeartbeatTimer) {
        clearIntervalFn(leaseHeartbeatTimer);
        leaseHeartbeatTimer = null;
      }
      queue.stop();
      stopRuntime();
      await releaseLease();
      logger.info('[vh:news-daemon] stopped', { holder_id: holderId });
    },
    isRunning() {
      return running;
    },
    currentLease() {
      return leaseGuard.current();
    },
    enrichmentQueueDepth() {
      return queue.size();
    },
  };
}
export interface NewsAggregatorDaemonProcessHandle {
  daemon: NewsAggregatorDaemonHandle;
  client: VennClient;
  stop(): Promise<void>;
}

export async function startNewsAggregatorDaemonFromEnv(): Promise<NewsAggregatorDaemonProcessHandle> {
  const feedSourceResolution = resolveFeedSourceConfig(readEnvVar('VITE_NEWS_FEED_SOURCES'));
  const feedSources = [...feedSourceResolution.feedSources];
  const topicMapping = parseTopicMapping(readEnvVar('VITE_NEWS_TOPIC_MAPPING'));
  const pollIntervalMs = parseOptionalPositiveInt(readEnvVar('VITE_NEWS_POLL_INTERVAL_MS'));
  const leaseTtlMs = parsePositiveInt(
    readEnvVar('VH_NEWS_RUNTIME_LEASE_TTL_MS') ?? readEnvVar('VITE_NEWS_RUNTIME_LEASE_TTL_MS'),
    DEFAULT_LEASE_TTL_MS,
  );

  const storyCluster = parseStoryClusterRemoteConfig();
  await verifyStoryClusterHealth({
    healthUrl: storyCluster.healthUrl,
    headers: storyCluster.headers,
    timeoutMs: storyCluster.timeoutMs,
  });

  const gunPeers = parseGunPeers(readEnvVar('VH_GUN_PEERS') ?? readEnvVar('VITE_GUN_PEERS'));
  if (feedSourceResolution.sourceHealth.summary) {
    console.info('[vh:news-daemon] source health starter surface', {
      ...feedSourceResolution.sourceHealth.summary,
      reportPath: feedSourceResolution.sourceHealth.reportPath,
    });
  }
  const client = createNodeMeshClient({
    peers: gunPeers.length > 0 ? gunPeers : undefined,
    requireSession: false,
  });
  const daemon = createNewsAggregatorDaemon({
    client,
    feedSources,
    topicMapping,
    pollIntervalMs,
    leaseTtlMs,
    leaseHolderId: readEnvVar('VH_NEWS_DAEMON_HOLDER_ID'),
    runtimeOrchestratorOptions: {
      productionMode: true,
      allowHeuristicFallback: false,
      remoteClusterEndpoint: storyCluster.endpointUrl,
      remoteClusterTimeoutMs: storyCluster.timeoutMs,
      remoteClusterMaxItemsPerRequest: storyCluster.maxItemsPerRequest,
      remoteClusterHeaders: storyCluster.headers,
    } as RuntimeOrchestratorOptions,
  });
  await daemon.start();
  return {
    daemon,
    client,
    async stop() {
      await daemon.stop();
      await client.shutdown();
    },
  };
}

function isDirectExecution(metaUrl: string): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }
  try {
    return pathToFileURL(argvPath).href === metaUrl;
  } catch {
    return false;
  }
}
type ProcessLifecycle = Pick<typeof process, 'once' | 'exit'>;
type CliLogger = Pick<Console, 'info' | 'error'>;

async function runFromCli(
  startFromEnv: () => Promise<NewsAggregatorDaemonProcessHandle> = startNewsAggregatorDaemonFromEnv,
  lifecycle: ProcessLifecycle = process,
  logger: CliLogger = console,
): Promise<void> {
  const processHandle = await startFromEnv();
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`[vh:news-daemon] received ${signal}; shutting down`);
    await processHandle.stop();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    lifecycle.once(signal, () => {
      void shutdown(signal).finally(() => {
        lifecycle.exit(0);
      });
    });
  }
}
/* c8 ignore start */
if (isDirectExecution(import.meta.url)) {
  void runFromCli().catch((error) => {
    console.error('[vh:news-daemon] failed to start', error);
    process.exit(1);
  });
}
/* c8 ignore stop */
export const __internal = {
  buildLeasePayload,
  isDirectExecution,
  parseFeedSources,
  parseGunPeers,
  parseStoryClusterRemoteConfig,
  parseTopicMapping,
  resolveLeaseHolderId,
  runFromCli,
  startNewsAggregatorDaemonFromEnv,
  verifyStoryClusterHealth,
};
