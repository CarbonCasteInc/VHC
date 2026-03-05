import os from 'node:os';
import {
  FeedSourceSchema,
  STARTER_FEED_SOURCES,
  TopicMappingSchema,
  type FeedSource,
  type NewsRuntimeSynthesisCandidate,
  type TopicMapping,
} from '@vh/ai-engine';
import type { NewsIngestionLease } from '@vh/gun-client';

export const DEFAULT_TOPIC_MAPPING: TopicMapping = {
  defaultTopicId: 'topic-news',
  sourceTopics: {},
};

export const DEFAULT_LEASE_TTL_MS = 2 * 60 * 1000;
export const DEFAULT_STORYCLUSTER_REMOTE_TIMEOUT_MS = 8_000;

export type LoggerLike = Pick<Console, 'info' | 'warn' | 'error'>;

export interface StoryClusterRemoteConfig {
  endpointUrl: string;
  healthUrl: string;
  timeoutMs: number;
  headers: Record<string, string>;
}
export type EnrichmentWorker = (candidate: NewsRuntimeSynthesisCandidate) => Promise<void> | void;

export interface AsyncEnrichmentQueue {
  enqueue(candidate: NewsRuntimeSynthesisCandidate): void;
  size(): number;
  stop(): void;
}
export function createAsyncEnrichmentQueue(worker: EnrichmentWorker, logger: LoggerLike): AsyncEnrichmentQueue {
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

export function readEnvVar(name: string): string | undefined {
  const value = process.env?.[name];
  return typeof value === 'string' ? value : undefined;
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

export function deriveStoryClusterHealthUrl(endpointUrl: string): string {
  const parsed = new URL(endpointUrl);
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    parsed.pathname = '/health';
  } else if (segments[segments.length - 1] === 'cluster') {
    segments[segments.length - 1] = 'health';
    parsed.pathname = `/${segments.join('/')}`;
  } else {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/health`;
  }

  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}
export function parseStoryClusterRemoteConfig(): StoryClusterRemoteConfig {
  const endpointUrl = firstNonEmpty(
    readEnvVar('VH_STORYCLUSTER_REMOTE_URL'),
    readEnvVar('STORYCLUSTER_REMOTE_URL'),
    readEnvVar('VITE_STORYCLUSTER_REMOTE_URL'),
  );

  if (!endpointUrl) {
    throw new Error('storycluster remote endpoint is required (VH_STORYCLUSTER_REMOTE_URL)');
  }

  const authToken = firstNonEmpty(
    readEnvVar('VH_STORYCLUSTER_REMOTE_AUTH_TOKEN'),
    readEnvVar('STORYCLUSTER_REMOTE_AUTH_TOKEN'),
  );

  if (!authToken) {
    throw new Error('storycluster auth token is required (VH_STORYCLUSTER_REMOTE_AUTH_TOKEN)');
  }

  const authHeader = firstNonEmpty(readEnvVar('VH_STORYCLUSTER_REMOTE_AUTH_HEADER')) ?? 'authorization';
  const authScheme = firstNonEmpty(readEnvVar('VH_STORYCLUSTER_REMOTE_AUTH_SCHEME')) ?? 'Bearer';
  const timeoutMs = parsePositiveInt(
    readEnvVar('VH_STORYCLUSTER_REMOTE_TIMEOUT_MS'),
    DEFAULT_STORYCLUSTER_REMOTE_TIMEOUT_MS,
  );

  const healthUrl =
    firstNonEmpty(readEnvVar('VH_STORYCLUSTER_REMOTE_HEALTH_URL')) ??
    deriveStoryClusterHealthUrl(endpointUrl);

  return {
    endpointUrl,
    healthUrl,
    timeoutMs,
    headers: {
      [authHeader]: `${authScheme} ${authToken}`,
    },
  };
}

export async function verifyStoryClusterHealth(
  config: Pick<StoryClusterRemoteConfig, 'healthUrl' | 'headers' | 'timeoutMs'> & {
    fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  },
): Promise<void> {
  const fetchFn =
    config.fetchFn ??
    (typeof fetch === 'function'
      ? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
      : undefined);

  if (!fetchFn) {
    throw new Error('fetch API is unavailable for storycluster health check');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, config.timeoutMs);

  try {
    const response = await fetchFn(config.healthUrl, {
      method: 'GET',
      headers: config.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`storycluster health check failed: HTTP ${response.status}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`storycluster health check timed out after ${config.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

export function parseFeedSources(raw: string | undefined): FeedSource[] {
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

export function parseTopicMapping(raw: string | undefined): TopicMapping {
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

export function parseGunPeers(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown[];
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

export function resolveLeaseHolderId(raw: string | undefined): string {
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

export function buildLeasePayload(
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
