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

export type LoggerLike = Pick<Console, 'info' | 'warn' | 'error'>;

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

export function readEnvVar(name: string): string | undefined {
  const value = process.env?.[name];
  return typeof value === 'string' ? value : undefined;
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
