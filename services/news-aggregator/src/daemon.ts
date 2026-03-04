import os from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  FeedSourceSchema,
  STARTER_FEED_SOURCES,
  TopicMappingSchema,
  startNewsRuntime,
  type FeedSource,
  type NewsRuntimeConfig,
  type NewsRuntimeHandle,
  type NewsRuntimeSynthesisCandidate,
  type TopicMapping,
} from '@vh/ai-engine';
import {
  createClient,
  readNewsIngestionLease,
  writeNewsIngestionLease,
  writeStoryBundle,
  type NewsIngestionLease,
  type VennClient,
} from '@vh/gun-client';

const DEFAULT_TOPIC_MAPPING: TopicMapping = {
  defaultTopicId: 'topic-news',
  sourceTopics: {},
};

const DEFAULT_LEASE_TTL_MS = 2 * 60 * 1000;

type LoggerLike = Pick<Console, 'info' | 'warn' | 'error'>;

type EnrichmentWorker = (candidate: NewsRuntimeSynthesisCandidate) => Promise<void> | void;

type RuntimeStarter = (config: NewsRuntimeConfig) => NewsRuntimeHandle;

interface AsyncEnrichmentQueue {
  enqueue(candidate: NewsRuntimeSynthesisCandidate): void;
  size(): number;
  stop(): void;
}

function createAsyncEnrichmentQueue(worker: EnrichmentWorker, logger: LoggerLike): AsyncEnrichmentQueue {
  const pending: NewsRuntimeSynthesisCandidate[] = [];
  let draining = false;
  let stopped = false;
  let drainScheduled = false;

  const drain = async (): Promise<void> => {
    if (draining || stopped) {
      return;
    }

    draining = true;
    try {
      while (!stopped && pending.length > 0) {
        const next = pending.shift();
        if (!next) {
          continue;
        }

        try {
          await worker(next);
        } catch (error) {
          logger.warn('[vh:news-daemon] enrichment worker failed', error);
        }
      }
    } finally {
      draining = false;
      if (!stopped && pending.length > 0 && !drainScheduled) {
        drainScheduled = true;
        queueMicrotask(() => {
          drainScheduled = false;
          void drain();
        });
      }
    }
  };

  return {
    enqueue(candidate: NewsRuntimeSynthesisCandidate) {
      if (stopped) {
        return;
      }

      pending.push(candidate);
      if (drainScheduled || draining) {
        return;
      }

      drainScheduled = true;
      queueMicrotask(() => {
        drainScheduled = false;
        void drain();
      });
    },

    size() {
      return pending.length;
    },

    stop() {
      stopped = true;
      pending.length = 0;
    },
  };
}

function readEnvVar(name: string): string | undefined {
  const value = process.env?.[name];
  return typeof value === 'string' ? value : undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function parseFeedSources(raw: string | undefined): FeedSource[] {
  if (!raw) {
    return [...STARTER_FEED_SOURCES];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [...STARTER_FEED_SOURCES];
    }

    const valid: FeedSource[] = [];
    for (const source of parsed) {
      const result = FeedSourceSchema.safeParse(source);
      if (result.success) {
        valid.push(result.data);
      }
    }

    return valid;
  } catch {
    return [...STARTER_FEED_SOURCES];
  }
}

function parseTopicMapping(raw: string | undefined): TopicMapping {
  if (!raw) {
    return DEFAULT_TOPIC_MAPPING;
  }

  try {
    const parsed = TopicMappingSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : DEFAULT_TOPIC_MAPPING;
  } catch {
    return DEFAULT_TOPIC_MAPPING;
  }
}

function parseGunPeers(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    } catch {
      return [];
    }
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveLeaseHolderId(raw: string | undefined): string {
  if (raw && raw.trim().length > 0) {
    return raw.trim();
  }

  const sanitizedHost = os
    .hostname()
    .trim()
    .replace(/[^a-zA-Z0-9-_.]/g, '-')
    .slice(0, 64) || 'host';

  return `vh-news-daemon:${sanitizedHost}:${process.pid}`;
}

function buildLeaseToken(holderId: string, nowMs: number, randomFn: () => number): string {
  return `${holderId}:${nowMs}:${randomFn().toString(36).slice(2, 10)}`;
}

function buildLeasePayload(
  holderId: string,
  existing: NewsIngestionLease | null,
  nowMs: number,
  leaseTtlMs: number,
  randomFn: () => number,
): NewsIngestionLease {
  if (existing && existing.holder_id === holderId) {
    return {
      ...existing,
      heartbeat_at: nowMs,
      expires_at: nowMs + leaseTtlMs,
    };
  }

  return {
    holder_id: holderId,
    lease_token: buildLeaseToken(holderId, nowMs, randomFn),
    acquired_at: nowMs,
    heartbeat_at: nowMs,
    expires_at: nowMs + leaseTtlMs,
  };
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
  enrichmentWorker?: EnrichmentWorker;
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
  const nowFn = config.now ?? Date.now;
  const randomFn = config.random ?? Math.random;
  const setIntervalFn = config.setIntervalFn ?? setInterval;
  const clearIntervalFn = config.clearIntervalFn ?? clearInterval;

  const leaseTtlMs = config.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const leaseRenewIntervalMs = Math.max(5_000, Math.floor(leaseTtlMs / 2));
  const holderId = resolveLeaseHolderId(config.leaseHolderId);
  const queue = createAsyncEnrichmentQueue(
    config.enrichmentWorker ?? (() => undefined),
    logger,
  );

  let running = false;
  let runtimeHandle: NewsRuntimeHandle | null = null;
  let lease: NewsIngestionLease | null = null;
  let leaseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let leadershipTickPromise: Promise<void> | null = null;

  const stopRuntime = () => {
    if (!runtimeHandle) {
      return;
    }

    runtimeHandle.stop();
    runtimeHandle = null;
  };

  const assertLeaseHeld = async (): Promise<void> => {
    if (!lease) {
      throw new Error('news daemon lease not acquired');
    }

    const nowMs = nowFn();
    if (lease.expires_at <= nowMs) {
      throw new Error('news daemon lease expired');
    }

    const current = await readLease(config.client);
    if (
      !current ||
      current.holder_id !== lease.holder_id ||
      current.lease_token !== lease.lease_token ||
      current.expires_at <= nowMs
    ) {
      throw new Error('news daemon lease not held');
    }
  };

  const startRuntimeIfNeeded = () => {
    if (runtimeHandle?.isRunning()) {
      return;
    }

    runtimeHandle = startRuntime({
      enabled: true,
      feedSources: config.feedSources,
      topicMapping: config.topicMapping,
      gunClient: config.client,
      pollIntervalMs: config.pollIntervalMs,
      writeStoryBundle: async (runtimeClient: unknown, bundle: unknown) => {
        await assertLeaseHeld();
        return writeBundle(runtimeClient as VennClient, bundle);
      },
      onSynthesisCandidate(candidate) {
        queue.enqueue(candidate);
      },
      onError(error) {
        logger.warn('[vh:news-daemon] runtime tick failed', error);
      },
    });

    if (runtimeHandle.isRunning()) {
      logger.info('[vh:news-daemon] runtime started', {
        holder_id: holderId,
        poll_interval_ms: config.pollIntervalMs ?? null,
      });
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

    if (currentLease && currentLease.holder_id !== holderId && currentLease.expires_at > nowMs) {
      lease = null;
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

    lease = await writeLease(config.client, nextLease);
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
    if (!lease) {
      return;
    }

    const nowMs = nowFn();
    try {
      await writeLease(config.client, {
        ...lease,
        heartbeat_at: nowMs,
        expires_at: nowMs,
      });
    } catch (error) {
      logger.warn('[vh:news-daemon] failed to release lease', error);
    } finally {
      lease = null;
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

      logger.info('[vh:news-daemon] leadership loop started', {
        holder_id: holderId,
        lease_ttl_ms: leaseTtlMs,
        lease_renew_interval_ms: leaseRenewIntervalMs,
      });
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

      logger.info('[vh:news-daemon] stopped', {
        holder_id: holderId,
      });
    },

    isRunning() {
      return running;
    },

    currentLease() {
      return lease;
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
  const feedSources = parseFeedSources(readEnvVar('VITE_NEWS_FEED_SOURCES'));
  const topicMapping = parseTopicMapping(readEnvVar('VITE_NEWS_TOPIC_MAPPING'));
  const pollIntervalMs = parseOptionalPositiveInt(readEnvVar('VITE_NEWS_POLL_INTERVAL_MS'));
  const leaseTtlMs = parsePositiveInt(
    readEnvVar('VH_NEWS_RUNTIME_LEASE_TTL_MS') ?? readEnvVar('VITE_NEWS_RUNTIME_LEASE_TTL_MS'),
    DEFAULT_LEASE_TTL_MS,
  );

  const gunPeers = parseGunPeers(readEnvVar('VH_GUN_PEERS') ?? readEnvVar('VITE_GUN_PEERS'));
  const client = createClient({
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

async function runFromCli(): Promise<void> {
  const processHandle = await startNewsAggregatorDaemonFromEnv();

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[vh:news-daemon] received ${signal}; shutting down`);
    await processHandle.stop();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown(signal).finally(() => {
        process.exit(0);
      });
    });
  }
}

if (isDirectExecution(import.meta.url)) {
  void runFromCli().catch((error) => {
    console.error('[vh:news-daemon] failed to start', error);
    process.exit(1);
  });
}

export const __internal = {
  buildLeasePayload,
  parseFeedSources,
  parseGunPeers,
  parseTopicMapping,
  resolveLeaseHolderId,
};
