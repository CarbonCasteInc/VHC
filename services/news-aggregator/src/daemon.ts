import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startNewsRuntime,
  type FeedSource,
  type NewsRuntimeConfig,
  type NewsRuntimeHandle,
  type NewsRuntimeNonFatalErrorContext,
  type NewsRuntimeTickSummary,
  type TopicMapping,
} from '@vh/ai-engine';
import {
  readNewsIngestionLease,
  readNewsSynthesisLifecycleStatus,
  removeNewsBundle,
  removeNewsStoryline,
  buildNewsSynthesisLifecycleRecord,
  writeNewsBundle,
  writeNewsIngestionLease,
  writeNewsSynthesisLifecycleStatus,
  writeNewsStoryline,
  type NewsIngestionLease,
  type VennClient,
} from '@vh/gun-client';
import { StoryBundleSchema } from '@vh/data-model';
import { createNodeMeshClient } from '@vh/gun-client/node';
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
  resolveSystemWriterClientConfigFromEnv,
  resolveLeaseHolderId,
  verifyStoryClusterHealth,
  type AsyncEnrichmentQueueOptions,
  type EnrichmentQueueSnapshot,
  type EnrichmentWorker,
  type LoggerLike,
} from './daemonUtils';
import { createLeaseGuard } from './leaseGuard';
import { createDaemonFeedClusterCaptureRecorder } from './clusterCapturePersistence';
import { createRuntimeDiagnosticRecorder } from './runtimeDiagnostics';
import {
  createBundleSynthesisEnrichmentFromEnv,
  isTruthyFlag,
} from './bundleSynthesisDaemonConfig';
import { NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE, isDirectExecution, runFromCli } from './daemonCli';
import {
  createDaemonWriteLaneRegistry,
  type DaemonWriteLaneRegistry,
  type DaemonWriteLaneSnapshot,
} from './daemonWriteLane';
import {
  replayAcceptedAnalysisEvalSyntheses,
  resolveAnalysisEvalReplayArtifactDirFromEnv,
} from './analysisEvalReplay';
import { reconcileProductFeedFromRawStories } from './productFeedReconciler';
import {
  DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS,
  collectPendingSynthesisCatchupCandidates,
  type PendingSynthesisCatchupResult,
} from './pendingSynthesisCatchup';
type RuntimeStarter = (config: NewsRuntimeConfig) => NewsRuntimeHandle;
type RuntimeOrchestratorOptions = NonNullable<NewsRuntimeConfig['orchestratorOptions']> & {
  remoteClusterMaxItemsPerRequest?: number;
};
type LeaseBackend = {
  readLease: (client: VennClient) => Promise<NewsIngestionLease | null>;
  writeLease: (client: VennClient, lease: unknown) => Promise<NewsIngestionLease>;
};
function hasReadableMesh(client: VennClient): boolean {
  return Boolean(client.mesh && typeof client.mesh.get === 'function');
}

const DEFAULT_PRODUCT_FEED_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_SYNTHESIS_CATCHUP_INTERVAL_MS = 5 * 60 * 1000;
const FAIL_CLOSED_RUNTIME_WRITE_CLASSES = new Set([
  'news_bundle',
  'news_synthesis_lifecycle',
]);

function shouldStopFailClosedRuntimeWriteClass(writeClass: string): boolean {
  return FAIL_CLOSED_RUNTIME_WRITE_CLASSES.has(writeClass);
}

function nonFatalRuntimeErrorFields(context: NewsRuntimeNonFatalErrorContext): Record<string, unknown> {
  return {
    kind: context.kind,
    reason: context.reason,
    story_id: context.story_id ?? null,
    storyline_id: context.storyline_id ?? null,
    story_count: context.story_count ?? null,
    work_item_count: context.work_item_count ?? null,
  };
}

function normalizePositiveIntervalMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}

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
  enrichmentQueueOptions?: AsyncEnrichmentQueueOptions;
  writeLanes?: DaemonWriteLaneRegistry;
  replayAcceptedSynthesis?: (client: VennClient) => Promise<unknown>;
  reconcileProductFeed?: (client: VennClient) => Promise<unknown>;
  productFeedReconcileIntervalMs?: number;
  collectPendingSynthesisCandidates?: (
    client: VennClient,
    options: { limit?: number; logger?: LoggerLike; now?: () => number; staleInProgressMs?: number },
  ) => Promise<PendingSynthesisCatchupResult>;
  synthesisCatchupIntervalMs?: number;
  synthesisCatchupSampleLimit?: number;
  synthesisInProgressStaleMs?: number;
  runtimeOrchestratorOptions?: NewsRuntimeConfig['orchestratorOptions'];
  noWrite?: boolean;
  runtimeMaxTicks?: number;
  onRuntimeTickLimitReached?: (summary: NewsRuntimeTickSummary) => void | Promise<void>;
  runtimeTickWatchdogMs?: number;
  deferEnrichmentUntilFirstTickComplete?: boolean;
  failClosedOnRuntimeError?: boolean;
  onFailClosedRuntimeError?: (error: unknown) => void | Promise<void>;
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
  enrichmentQueueDeadLetterCount(): number;
  enrichmentQueueStats(): EnrichmentQueueSnapshot;
  writeLaneStats(): DaemonWriteLaneSnapshot[];
}
export function createNewsAggregatorDaemon(config: NewsAggregatorDaemonConfig): NewsAggregatorDaemonHandle {
  const logger = config.logger ?? console;
  const startRuntime = config.startRuntime ?? startNewsRuntime;
  const readLease = config.readLease ?? readNewsIngestionLease;
  const writeLease = config.writeLease ?? writeNewsIngestionLease;
  const writeBundle = config.writeBundle ?? writeNewsBundle;
  const removeBundle = config.removeBundle ?? removeNewsBundle;
  const nowFn = config.now ?? Date.now;
  const randomFn = config.random ?? Math.random;
  const setIntervalFn = config.setIntervalFn ?? setInterval;
  const clearIntervalFn = config.clearIntervalFn ?? clearInterval;
  const leaseTtlMs = config.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const leaseRenewIntervalMs = Math.max(5_000, Math.floor(leaseTtlMs / 2));
  const leaseVerificationWindowMs = Math.max(500, Math.min(5_000, Math.floor(leaseTtlMs / 6)));
  const holderId = resolveLeaseHolderId(config.leaseHolderId);
  const noWrite = config.noWrite === true;
  const failClosedOnRuntimeError = config.failClosedOnRuntimeError ?? !noWrite;
  const writeLanes = config.writeLanes ?? createDaemonWriteLaneRegistry({
    logger,
    now: nowFn,
    stopClassOnFailure: failClosedOnRuntimeError && !noWrite
      ? shouldStopFailClosedRuntimeWriteClass
      : false,
  });
  const queue = createAsyncEnrichmentQueue(
    config.enrichmentWorker ?? (() => undefined),
    logger,
    {
      ...(config.enrichmentQueueOptions ?? {}),
      autoStart: false,
    },
  );
  const clusterCaptureRecorder = createDaemonFeedClusterCaptureRecorder(
    readEnvVar('VH_DAEMON_FEED_RUN_ID'),
  );
  const runtimeDiagnosticRecorder = createRuntimeDiagnosticRecorder({
    runId: readEnvVar('VH_DAEMON_FEED_RUN_ID'),
    noWrite,
  });
  const runtimeMaxTicks = config.runtimeMaxTicks;
  const deferEnrichmentUntilFirstTickComplete = config.deferEnrichmentUntilFirstTickComplete === true;
  let runtimeTickLimitReached = false;
  let firstRuntimeTickCompleted = false;
  let enrichmentQueueDeferredLogged = false;
  let running = false;
  let runtimeHandle: NewsRuntimeHandle | null = null;
  let leaseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let leadershipTickPromise: Promise<void> | null = null;
  let leadershipMaintenancePromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let runtimeWritesBlocked = false;
  let acceptedSynthesisReplayAttempted = false;
  const productFeedReconcileIntervalMs = normalizePositiveIntervalMs(
    config.productFeedReconcileIntervalMs
    ?? parseOptionalPositiveInt(readEnvVar('VH_NEWS_PRODUCT_FEED_REPAIR_INTERVAL_MS')),
    DEFAULT_PRODUCT_FEED_RECONCILE_INTERVAL_MS,
  );
  let nextProductFeedReconciliationAt = Number.NEGATIVE_INFINITY;
  const synthesisCatchupIntervalMs = normalizePositiveIntervalMs(
    config.synthesisCatchupIntervalMs
    ?? parseOptionalPositiveInt(readEnvVar('VH_BUNDLE_SYNTHESIS_CATCHUP_INTERVAL_MS'))
    ?? DEFAULT_SYNTHESIS_CATCHUP_INTERVAL_MS,
    DEFAULT_SYNTHESIS_CATCHUP_INTERVAL_MS,
  );
  const synthesisCatchupSampleLimit = config.synthesisCatchupSampleLimit
    ?? parseOptionalPositiveInt(readEnvVar('VH_BUNDLE_SYNTHESIS_CATCHUP_SAMPLE_LIMIT'))
    ?? 25;
  const synthesisInProgressStaleMs = normalizePositiveIntervalMs(
    config.synthesisInProgressStaleMs
    ?? parseOptionalPositiveInt(readEnvVar('VH_BUNDLE_SYNTHESIS_IN_PROGRESS_STALE_MS'))
    ?? DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS,
    DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS,
  );
  const collectPendingSynthesisCandidates =
    config.collectPendingSynthesisCandidates ?? collectPendingSynthesisCatchupCandidates;
  let nextSynthesisCatchupAt = Number.NEGATIVE_INFINITY;
  const reconcileProductFeed = config.reconcileProductFeed ?? ((client: VennClient) =>
    hasReadableMesh(client)
      ? reconcileProductFeedFromRawStories(client, {
          logger,
          now: nowFn,
          sampleLimit: parseOptionalPositiveInt(readEnvVar('VH_NEWS_PRODUCT_FEED_REPAIR_SAMPLE_LIMIT')),
        })
      : Promise.resolve({ skipped: 'mesh_unavailable' }));
  const leaseGuard = createLeaseGuard({ client: config.client, readLease, verificationWindowMs: leaseVerificationWindowMs });
  const stopRuntime = () => {
    if (!runtimeHandle) {
      return;
    }
    const handle = runtimeHandle;
    runtimeHandle = null;
    handle.stop();
  };
  const assertRuntimeWritesAllowed = () => {
    if (runtimeWritesBlocked) {
      throw new Error('news daemon runtime writes stopped after runtime error');
    }
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
      noWrite,
      tickWatchdogMs: config.runtimeTickWatchdogMs,
      async onTickSummary(summary: NewsRuntimeTickSummary) {
        const snapshot = await runtimeDiagnosticRecorder(summary);
        logger.info('[vh:news-daemon] runtime diagnostic artifact written', {
          holder_id: holderId,
          tick_sequence: summary.tick_sequence,
          status: summary.status,
          no_write: summary.no_write,
          raw_wrote_count: summary.raw_wrote_count,
          selected_bundle_count: summary.selected_bundle_count,
          diagnostic_summary_count: snapshot.summaries.length,
        });
        if (
          runtimeMaxTicks
          && summary.tick_sequence >= runtimeMaxTicks
          && !runtimeTickLimitReached
        ) {
          runtimeTickLimitReached = true;
          logger.info('[vh:news-daemon] runtime tick limit reached', {
            holder_id: holderId,
            tick_sequence: summary.tick_sequence,
            max_ticks: runtimeMaxTicks,
            status: summary.status,
            no_write: summary.no_write,
          });
          void Promise.resolve(config.onRuntimeTickLimitReached?.(summary)).catch((error) => {
            logger.warn('[vh:news-daemon] runtime tick limit stop callback failed', error);
          });
        }
        if (
          deferEnrichmentUntilFirstTickComplete
          && !firstRuntimeTickCompleted
          && summary.status === 'completed'
        ) {
          firstRuntimeTickCompleted = true;
          queue.start();
          logger.info('[vh:news-daemon] enrichment queue started after first runtime tick', {
            holder_id: holderId,
            tick_sequence: summary.tick_sequence,
            raw_wrote_count: summary.raw_wrote_count,
            selected_bundle_count: summary.selected_bundle_count,
            enrichment_queue: queue.snapshot(),
          });
        }
      },
      writeStoryBundle: async (runtimeClient: unknown, bundle: unknown) => {
        const storyId = typeof bundle === 'object' && bundle !== null ? (bundle as { story_id?: unknown }).story_id : null;
        if (noWrite) {
          logger.info('[vh:news-daemon] no-write raw bundle write suppressed', {
            story_id: storyId ?? null,
          });
          return bundle;
        }
        assertRuntimeWritesAllowed();
        await leaseGuard.assertHeld(nowFn());
        return writeLanes.run('news_bundle', { story_id: storyId ?? null }, async () => {
          const written = await writeBundle(runtimeClient as VennClient, bundle);
          const parsedWritten = StoryBundleSchema.safeParse(written).success
            ? StoryBundleSchema.parse(written)
            : StoryBundleSchema.safeParse(bundle).success
              ? StoryBundleSchema.parse(bundle)
              : null;
          if (parsedWritten) {
            const existingLifecycle = await readNewsSynthesisLifecycleStatus(
              runtimeClient as VennClient,
              parsedWritten.story_id,
            ).catch((error) => {
              logger.warn('[vh:news-daemon] synthesis lifecycle read failed before pending transition', {
                story_id: parsedWritten.story_id,
                error: error instanceof Error ? error.message : String(error),
              });
              return null;
            });
            if (existingLifecycle?.source_set_revision === parsedWritten.provenance_hash) {
              logger.info('[vh:news-daemon] preserving synthesis lifecycle for unchanged source set', {
                story_id: parsedWritten.story_id,
                source_set_revision: parsedWritten.provenance_hash,
                status: existingLifecycle.status,
              });
            } else {
              await writeLanes.run('news_synthesis_lifecycle', { story_id: parsedWritten.story_id, status: 'pending' }, async () =>
                writeNewsSynthesisLifecycleStatus(runtimeClient as VennClient, buildNewsSynthesisLifecycleRecord({
                  story: parsedWritten,
                  status: 'pending',
                  frameTableState: 'frame_table_pending',
                  updatedAt: nowFn(),
                })),
              );
            }
          }
          return written;
        });
      },
      removeStoryBundle: async (runtimeClient: unknown, storyId: string) => {
        if (noWrite) {
          logger.info('[vh:news-daemon] no-write raw bundle remove suppressed', { story_id: storyId });
          return undefined;
        }
        assertRuntimeWritesAllowed();
        await leaseGuard.assertHeld(nowFn());
        return writeLanes.run('news_bundle_remove', { story_id: storyId }, async () => {
          return removeBundle(runtimeClient as VennClient, storyId);
        });
      },
      writeStorylineGroup: async (runtimeClient: unknown, storyline: unknown) => {
        const storylineId =
          typeof storyline === 'object' && storyline !== null
            ? (storyline as { storyline_id?: unknown }).storyline_id
            : null;
        if (noWrite) {
          logger.info('[vh:news-daemon] no-write storyline write suppressed', {
            storyline_id: storylineId ?? null,
          });
          return storyline;
        }
        assertRuntimeWritesAllowed();
        await leaseGuard.assertHeld(nowFn());
        return writeLanes.run('storyline', { storyline_id: storylineId ?? null }, async () => {
          return writeNewsStoryline(runtimeClient as VennClient, storyline);
        });
      },
      removeStorylineGroup: async (runtimeClient: unknown, storylineId: string) => {
        if (noWrite) {
          logger.info('[vh:news-daemon] no-write storyline remove suppressed', {
            storyline_id: storylineId,
          });
          return undefined;
        }
        assertRuntimeWritesAllowed();
        await leaseGuard.assertHeld(nowFn());
        return writeLanes.run('storyline_remove', { storyline_id: storylineId }, async () => {
          return removeNewsStoryline(runtimeClient as VennClient, storylineId);
        });
      },
      onSynthesisCandidate(candidate) {
        if (noWrite) {
          logger.info('[vh:news-daemon] no-write synthesis candidate suppressed', {
            story_id: candidate.story_id,
            work_item_count: candidate.work_items.length,
          });
          return;
        }
        if (runtimeWritesBlocked) {
          logger.warn('[vh:news-daemon] synthesis candidate suppressed after runtime error', {
            story_id: candidate.story_id,
            work_item_count: candidate.work_items.length,
          });
          return;
        }
        queue.enqueue(candidate);
        logger.info('[vh:news-daemon] enrichment candidate enqueued', {
          story_id: candidate.story_id,
          ...queue.snapshot(),
        });
      },
      onNonFatalError(_error, context) {
        logger.warn('[vh:news-daemon] runtime non-fatal enrichment failure', {
          holder_id: holderId,
          ...nonFatalRuntimeErrorFields(context),
        });
      },
      onError(error) {
        logger.warn('[vh:news-daemon] runtime tick failed', error);
        if (failClosedOnRuntimeError && !noWrite) {
          const wasRuntimeWritesBlocked = runtimeWritesBlocked;
          runtimeWritesBlocked = true;
          logger.error('[vh:news-daemon] runtime error triggered fail-closed stop', {
            holder_id: holderId,
            error,
          });
          if (!wasRuntimeWritesBlocked) {
            void (async () => {
              await config.onFailClosedRuntimeError?.(error);
            })().catch((callbackError) => {
              logger.error('[vh:news-daemon] fail-closed process shutdown callback failed', callbackError);
            });
          }
          void stopInternal('runtime_error').catch((stopError) => {
            logger.error('[vh:news-daemon] fail-closed stop after runtime error failed', stopError);
          });
        }
      },
      orchestratorOptions,
    });
    if (runtimeHandle.isRunning()) {
      if (deferEnrichmentUntilFirstTickComplete && !firstRuntimeTickCompleted) {
        queue.pause();
        if (!enrichmentQueueDeferredLogged) {
          enrichmentQueueDeferredLogged = true;
          logger.info('[vh:news-daemon] enrichment queue deferred until first runtime tick completes', {
            holder_id: holderId,
            enrichment_queue: queue.snapshot(),
          });
        }
      } else {
        queue.start();
      }
      logger.info('[vh:news-daemon] runtime started', {
        holder_id: holderId,
        poll_interval_ms: config.pollIntervalMs ?? null,
        enrichment_queue: queue.snapshot(),
      });
      return;
    }
    runtimeHandle = null;
    logger.warn('[vh:news-daemon] runtime did not start (disabled or rejected)');
  };
  const runLeadershipMaintenance = async (nowMs: number): Promise<void> => {
    if (!running || noWrite) {
      return;
    }
    if (!acceptedSynthesisReplayAttempted && config.replayAcceptedSynthesis) {
      acceptedSynthesisReplayAttempted = true;
      try {
        await config.replayAcceptedSynthesis(config.client);
      } catch (error) {
        logger.warn('[vh:news-daemon] accepted synthesis replay failed', error);
      }
    }
    if (!running) {
      return;
    }
    if (nowMs >= nextProductFeedReconciliationAt) {
      nextProductFeedReconciliationAt = nowMs + productFeedReconcileIntervalMs;
      try {
        const result = await reconcileProductFeed(config.client);
        logger.info('[vh:news-daemon] product feed reconciliation attempted', {
          holder_id: holderId,
          next_reconcile_at: nextProductFeedReconciliationAt,
          interval_ms: productFeedReconcileIntervalMs,
          result,
        });
      } catch (error) {
        logger.warn('[vh:news-daemon] product feed reconciliation failed', error);
      }
    }
    if (!running) {
      return;
    }
    if (config.enrichmentWorker && nowMs >= nextSynthesisCatchupAt) {
      nextSynthesisCatchupAt = nowMs + synthesisCatchupIntervalMs;
      try {
        const result = await collectPendingSynthesisCandidates(config.client, {
          limit: synthesisCatchupSampleLimit,
          logger,
          now: nowFn,
          staleInProgressMs: synthesisInProgressStaleMs,
        });
        if (running) {
          for (const candidate of result.candidates) {
            queue.enqueue(candidate.candidate);
          }
        }
        logger.info('[vh:news-daemon] pending synthesis catch-up attempted', {
          holder_id: holderId,
          next_catchup_at: nextSynthesisCatchupAt,
          interval_ms: synthesisCatchupIntervalMs,
          sample_limit: synthesisCatchupSampleLimit,
          scanned: result.scanned,
          enqueued: result.enqueued,
          skipped: result.skipped,
          stale_in_progress: result.staleInProgress,
          in_progress_stale_ms: synthesisInProgressStaleMs,
          enrichment_queue: queue.snapshot(),
        });
      } catch (error) {
        logger.warn('[vh:news-daemon] pending synthesis catch-up failed', error);
      }
    }
  };
  const scheduleLeadershipMaintenance = (nowMs: number): void => {
    if (!running || noWrite) {
      return;
    }
    if (leadershipMaintenancePromise) {
      logger.info('[vh:news-daemon] leadership maintenance already running; skipping this heartbeat', {
        holder_id: holderId,
        now_ms: nowMs,
      });
      return;
    }
    const inFlight = runLeadershipMaintenance(nowMs)
      .catch((error) => {
        logger.warn('[vh:news-daemon] leadership maintenance failed', error);
      })
      .finally(() => {
        if (leadershipMaintenancePromise === inFlight) {
          leadershipMaintenancePromise = null;
        }
      });
    leadershipMaintenancePromise = inFlight;
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
      if (noWrite) {
        logger.warn('[vh:news-daemon] no-write diagnostic observed active writer lease; continuing without writes', {
          holder_id: holderId,
          observed_lease_holder_id: currentLease.holder_id,
          observed_lease_expires_at: currentLease.expires_at,
        });
        startRuntimeIfNeeded();
        return;
      }
      logger.warn('[vh:news-daemon] lease held by another writer; runtime stays stopped', { holder_id: holderId, observed_lease_holder_id: currentLease.holder_id, observed_lease_expires_at: currentLease.expires_at });
      leaseGuard.clear();
      queue.pause();
      stopRuntime();
      return;
    }
    if (noWrite) {
      logger.warn('[vh:news-daemon] no-write diagnostic mode active; skipping lease heartbeat and mutation workers', {
        holder_id: holderId,
        observed_lease_holder_id: currentLease?.holder_id ?? null,
        observed_lease_expires_at: currentLease?.expires_at ?? null,
      });
      startRuntimeIfNeeded();
      return;
    }
    const nextLease = buildLeasePayload(
      holderId,
      currentLease && currentLease.holder_id === holderId ? currentLease : null,
      nowMs,
      leaseTtlMs,
      randomFn,
    );
    const lease = await writeLanes.run('lease', { holder_id: holderId, operation: 'heartbeat' }, async () =>
      writeLease(config.client, nextLease),
    );
    leaseGuard.accept(lease, nowMs);
    logger.info('[vh:news-daemon] lease acquired', {
      holder_id: holderId,
      lease_holder_id: lease.holder_id,
      lease_token_present: Boolean(lease.lease_token),
      expires_at: lease.expires_at,
    });
    startRuntimeIfNeeded();
    scheduleLeadershipMaintenance(nowMs);
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
    if (noWrite) {
      leaseGuard.clear();
      return;
    }
    const nowMs = nowFn();
    const releaseLease = leaseGuard.releasePayload(nowMs);
    if (!releaseLease) {
      return;
    }
    try {
      await writeLanes.run('lease', { holder_id: holderId, operation: 'release' }, async () =>
        writeLease(config.client, releaseLease),
      );
    } catch (error) {
      logger.warn('[vh:news-daemon] failed to release lease', error);
    } finally {
      leaseGuard.clear();
    }
  };
  const stopInternal = async (reason: string): Promise<void> => {
    if (stopPromise) {
      await stopPromise;
      return;
    }
    if (!running && !runtimeHandle) {
      return;
    }
    stopPromise = (async () => {
      let stopError: unknown;
      const recordStopError = (stage: string, error: unknown) => {
        stopError ??= error;
        logger.warn(`[vh:news-daemon] ${stage} failed during stop`, {
          holder_id: holderId,
          reason,
          error,
        });
      };
      running = false;
      if (leaseHeartbeatTimer) {
        clearIntervalFn(leaseHeartbeatTimer);
        leaseHeartbeatTimer = null;
      }
      try {
        queue.stop();
      } catch (error) {
        recordStopError('enrichment queue stop', error);
      }
      try {
        stopRuntime();
      } catch (error) {
        recordStopError('runtime stop', error);
      }
      try {
        await releaseLease();
      } catch (error) {
        stopError = error;
        logger.warn('[vh:news-daemon] failed to release lease during stop', {
          holder_id: holderId,
          reason,
          error,
        });
      } finally {
        try {
          writeLanes.stop();
        } catch (error) {
          recordStopError('write lane stop', error);
        }
        logger.info('[vh:news-daemon] stopped', { holder_id: holderId, reason });
      }
      if (stopError && reason !== 'runtime_error') {
        throw stopError;
      }
    })();
    try {
      await stopPromise;
    } finally {
      stopPromise = null;
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
      await stopInternal('operator');
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
    enrichmentQueueDeadLetterCount() {
      return queue.deadLetterCount();
    },
    enrichmentQueueStats() {
      return queue.snapshot();
    },
    writeLaneStats() {
      return writeLanes.snapshot();
    },
  };
}
export interface NewsAggregatorDaemonProcessHandle {
  daemon: NewsAggregatorDaemonHandle;
  client: VennClient;
  readonly closed: Promise<void>;
  closeExitCode?(): number | undefined;
  stop(): Promise<void>;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function isDisabledFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no';
}

function isEnabledFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function safePathToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '_') || 'default';
}

interface DaemonProcessLock {
  readonly filePath: string;
  release(): void;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

function readLockPid(filePath: string): number | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function acquireDaemonProcessLock(filePath: string, logger: LoggerLike): DaemonProcessLock {
  mkdirSync(path.dirname(filePath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(filePath, 'wx', 0o600);
      try {
        writeFileSync(fd, `${process.pid}\n`, 'utf8');
      } finally {
        closeSync(fd);
      }
      return {
        filePath,
        release() {
          const lockPid = readLockPid(filePath);
          if (lockPid === process.pid) {
            rmSync(filePath, { force: true });
          }
        },
      };
    } catch (error) {
      if (
        !error
        || typeof error !== 'object'
        || !('code' in error)
        || error.code !== 'EEXIST'
      ) {
        throw error;
      }
      const existingPid = readLockPid(filePath);
      if (existingPid && isProcessAlive(existingPid)) {
        throw new Error(`news daemon process lock is held by pid ${existingPid}`);
      }
      logger.warn('[vh:news-daemon] removing stale process lock', {
        lock_file: filePath,
        existing_pid: existingPid,
      });
      rmSync(filePath, { force: true });
    }
  }

  throw new Error(`unable to acquire news daemon process lock: ${filePath}`);
}

function resolveNewsDaemonGunFile(holderId: string | undefined): string {
  const stateRoot =
    firstNonEmpty(
      readEnvVar('VH_NEWS_DAEMON_STATE_DIR'),
      readEnvVar('VH_DAEMON_FEED_ARTIFACT_ROOT'),
    ) ?? path.join(os.tmpdir(), 'vh-news-daemon');
  return path.join(stateRoot, 'node-mesh-radisk', safePathToken(holderId ?? 'default'));
}

function parseLocalLease(value: unknown): NewsIngestionLease | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Partial<NewsIngestionLease>;
  if (
    typeof record.holder_id !== 'string'
    || record.holder_id.trim().length === 0
    || typeof record.lease_token !== 'string'
    || record.lease_token.trim().length === 0
    || typeof record.acquired_at !== 'number'
    || !Number.isFinite(record.acquired_at)
    || typeof record.heartbeat_at !== 'number'
    || !Number.isFinite(record.heartbeat_at)
    || typeof record.expires_at !== 'number'
    || !Number.isFinite(record.expires_at)
  ) {
    return null;
  }
  return {
    holder_id: record.holder_id.trim(),
    lease_token: record.lease_token.trim(),
    acquired_at: record.acquired_at,
    heartbeat_at: record.heartbeat_at,
    expires_at: record.expires_at,
  };
}

function createLocalFileLeaseBackend(filePath: string): LeaseBackend {
  return {
    async readLease(): Promise<NewsIngestionLease | null> {
      try {
        return parseLocalLease(JSON.parse(readFileSync(filePath, 'utf8')));
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async writeLease(_client: VennClient, lease: unknown): Promise<NewsIngestionLease> {
      const normalized = parseLocalLease(lease);
      if (!normalized) {
        throw new Error('invalid local news ingestion lease payload');
      }
      mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(tempPath, filePath);
      return normalized;
    },
  };
}

function resolveLeaseBackend(daemonStateDir: string): LeaseBackend | undefined {
  const backend = firstNonEmpty(readEnvVar('VH_NEWS_DAEMON_LEASE_BACKEND'))?.toLowerCase();
  if (!backend || backend === 'gun') {
    return undefined;
  }
  if (backend !== 'local-file') {
    throw new Error(`unsupported VH_NEWS_DAEMON_LEASE_BACKEND: ${backend}`);
  }
  const leaseFile = firstNonEmpty(readEnvVar('VH_NEWS_DAEMON_LOCAL_LEASE_FILE'))
    ?? path.join(daemonStateDir, 'news-ingestion-lease.json');
  console.warn('[vh:news-daemon] local-file lease backend enabled', { lease_file: leaseFile });
  return createLocalFileLeaseBackend(leaseFile);
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
  const holderId = readEnvVar('VH_NEWS_DAEMON_HOLDER_ID');
  const noWrite = isEnabledFlag(readEnvVar('VH_NEWS_DAEMON_DIAGNOSTIC_NO_WRITE'))
    || isEnabledFlag(readEnvVar('VH_NEWS_DAEMON_NO_WRITE'));
  const diagnosticMaxTicks = noWrite
    ? parseOptionalPositiveInt(readEnvVar('VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS')) ?? 1
    : undefined;
  const runtimeTickWatchdogMs = parseOptionalPositiveInt(readEnvVar('VH_NEWS_RUNTIME_TICK_WATCHDOG_MS'));
  const deferEnrichmentUntilFirstTickComplete = !isDisabledFlag(
    readEnvVar('VH_NEWS_DAEMON_DEFER_SYNTHESIS_UNTIL_FIRST_TICK_COMPLETE'),
  );
  const failClosedOnRuntimeError = noWrite
    ? false
    : !isDisabledFlag(readEnvVar('VH_NEWS_DAEMON_FAIL_CLOSED_ON_RUNTIME_ERROR'));
  const leaseScope = firstNonEmpty(readEnvVar('VH_NEWS_INGESTION_LEASE_SCOPE'));
  const gunRadisk = !isDisabledFlag(readEnvVar('VH_NEWS_DAEMON_GUN_RADISK'));
  const daemonStateDir =
    firstNonEmpty(
      readEnvVar('VH_NEWS_DAEMON_STATE_DIR'),
      readEnvVar('VH_DAEMON_FEED_ARTIFACT_ROOT'),
    ) ?? path.join(os.tmpdir(), 'vh-news-daemon');
  const leaseBackend = resolveLeaseBackend(daemonStateDir);
  const processLock = acquireDaemonProcessLock(
    firstNonEmpty(readEnvVar('VH_NEWS_DAEMON_PID_FILE')) ?? path.join(daemonStateDir, 'news-daemon.pid'),
    console,
  );
  const gunFile = gunRadisk
    ? firstNonEmpty(readEnvVar('VH_NEWS_DAEMON_GUN_FILE')) ?? resolveNewsDaemonGunFile(holderId)
    : false;
  if (typeof gunFile === 'string') {
    mkdirSync(path.dirname(gunFile), { recursive: true });
  }
  const writeLanes = createDaemonWriteLaneRegistry({
    logger: console,
    stopClassOnFailure: failClosedOnRuntimeError && !noWrite
      ? shouldStopFailClosedRuntimeWriteClass
      : false,
  });
  let client: VennClient | null = null;
  let processHandle: NewsAggregatorDaemonProcessHandle | null = null;
  let diagnosticStopRequested = false;
  let closeExitCode: number | undefined;
  let resolveClosed: (() => void) | null = null;
  let rejectClosed: ((error: unknown) => void) | null = null;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  const settleClosed = (error?: unknown) => {
    if (error === undefined) {
      resolveClosed?.();
    } else {
      rejectClosed?.(error);
    }
    resolveClosed = null;
    rejectClosed = null;
  };
  try {
    const systemWriterConfig = await resolveSystemWriterClientConfigFromEnv();
    client = createNodeMeshClient({
      peers: gunPeers.length > 0 ? gunPeers : undefined,
      requireSession: false,
      gunRadisk,
      gunFile,
      ...(leaseScope ? { newsIngestionLeaseScope: leaseScope } : {}),
      ...systemWriterConfig,
    });
    const bundleSynthesisEnrichment = noWrite
      ? {}
      : createBundleSynthesisEnrichmentFromEnv(client, console, {
          runWrite: writeLanes.run,
        });
    if (noWrite) {
      console.warn('[vh:news-daemon] no-write diagnostic mode enabled; all mesh mutations are suppressed', {
        diagnostic_max_ticks: diagnosticMaxTicks ?? null,
      });
    }
    const replayArtifactDir = resolveAnalysisEvalReplayArtifactDirFromEnv();
    const requestDiagnosticStop = (summary: NewsRuntimeTickSummary) => {
      if (!noWrite || !diagnosticMaxTicks || diagnosticStopRequested) {
        return;
      }
      diagnosticStopRequested = true;
      setTimeout(() => {
        void processHandle?.stop()
          .then(() => {
            console.info('[vh:news-daemon] bounded no-write diagnostic stopped after tick limit', {
              tick_sequence: summary.tick_sequence,
              max_ticks: diagnosticMaxTicks,
              status: summary.status,
            });
          })
          .catch((error) => {
            console.warn('[vh:news-daemon] bounded no-write diagnostic stop failed', error);
          });
      }, 0);
    };
    const daemon = createNewsAggregatorDaemon({
      client,
      feedSources,
      topicMapping,
      pollIntervalMs,
      leaseTtlMs,
      leaseHolderId: holderId,
      writeLanes,
      noWrite,
      ...(leaseBackend ?? {}),
      runtimeMaxTicks: diagnosticMaxTicks,
      onRuntimeTickLimitReached: diagnosticMaxTicks ? requestDiagnosticStop : undefined,
      runtimeTickWatchdogMs,
      deferEnrichmentUntilFirstTickComplete: !noWrite && deferEnrichmentUntilFirstTickComplete,
      failClosedOnRuntimeError,
      onFailClosedRuntimeError: (error) => {
        console.error('[vh:news-daemon] fail-closed runtime error shutting down process', error);
        closeExitCode = NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE;
        setTimeout(() => {
          void processHandle?.stop().catch((stopError) => {
            console.error('[vh:news-daemon] fail-closed process shutdown failed', stopError);
          });
        }, 0);
      },
      replayAcceptedSynthesis: !noWrite && replayArtifactDir
        ? (runtimeClient) =>
            replayAcceptedAnalysisEvalSyntheses({
              client: runtimeClient,
              artifactDir: replayArtifactDir,
              logger: console,
              runWrite: writeLanes.run,
            })
        : undefined,
      ...bundleSynthesisEnrichment,
      runtimeOrchestratorOptions: {
        productionMode: true,
        allowHeuristicFallback: false,
        remoteClusterEndpoint: storyCluster.endpointUrl,
        remoteClusterTimeoutMs: storyCluster.timeoutMs,
        remoteClusterMaxItemsPerRequest: storyCluster.maxItemsPerRequest,
        remoteClusterHeaders: storyCluster.headers,
      } as RuntimeOrchestratorOptions,
    });
    let stopped = false;
    processHandle = {
      daemon,
      client,
      closed,
      closeExitCode: () => closeExitCode,
      async stop() {
        if (stopped) {
          return;
        }
        stopped = true;
        let stopError: unknown;
        try {
          await daemon.stop();
          await client?.shutdown();
        } catch (error) {
          stopError = error;
          throw error;
        } finally {
          try {
            processLock.release();
          } catch (error) {
            stopError ??= error;
            throw error;
          } finally {
            settleClosed(stopError);
          }
        }
      },
    };
    await daemon.start();
    return processHandle;
  } catch (error) {
    if (processHandle) {
      await processHandle?.stop();
    } else {
      try {
        await client?.shutdown();
      } finally {
        processLock.release();
      }
    }
    throw error;
  }
}

/* c8 ignore start */
if (isDirectExecution(import.meta.url)) {
  void runFromCli(startNewsAggregatorDaemonFromEnv).catch((error) => {
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
  NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE,
  startNewsAggregatorDaemonFromEnv,
  verifyStoryClusterHealth,
  isTruthyFlag,
  isEnabledFlag,
};
