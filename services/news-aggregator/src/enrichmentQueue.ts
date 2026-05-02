import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';

export type LoggerLike = Pick<Console, 'info' | 'warn' | 'error'>;
export type EnrichmentWorker = (candidate: NewsRuntimeSynthesisCandidate) => Promise<void> | void;
export type EnrichmentDeadLetterReason = 'queue_full' | 'worker_failed';

export interface EnrichmentQueueDeadLetterRecord {
  schemaVersion: 'vh-news-enrichment-dlq-v1';
  recorded_at: number;
  reason: EnrichmentDeadLetterReason;
  max_depth?: number;
  error?: string;
  candidate: NewsRuntimeSynthesisCandidate;
}

export interface EnrichmentQueueSnapshot {
  pending_depth: number;
  in_flight: number;
  dead_letter_count: number;
  active: boolean;
  draining: boolean;
}

export interface AsyncEnrichmentQueueOptions {
  maxDepth?: number;
  autoStart?: boolean;
  persistenceDir?: string;
  now?: () => number;
  replayDeadLettersOnStart?: boolean;
  onDrop?: (
    candidate: NewsRuntimeSynthesisCandidate,
    detail: { reason: 'queue_full'; maxDepth: number },
  ) => void;
}

export interface AsyncEnrichmentQueue {
  start(): void;
  pause(): void;
  enqueue(candidate: NewsRuntimeSynthesisCandidate): void;
  size(): number;
  deadLetterCount(): number;
  snapshot(): EnrichmentQueueSnapshot;
  stop(): void;
}

interface PersistenceState {
  pendingFile: string;
  deadLetterFile: string;
}

function isCandidateLike(value: unknown): value is NewsRuntimeSynthesisCandidate {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<NewsRuntimeSynthesisCandidate>).story_id === 'string'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolvePersistence(options: AsyncEnrichmentQueueOptions): PersistenceState | null {
  const persistenceDir = options.persistenceDir?.trim();
  if (!persistenceDir) {
    return null;
  }
  return {
    pendingFile: path.join(persistenceDir, 'pending.json'),
    deadLetterFile: path.join(persistenceDir, 'dead-letter.jsonl'),
  };
}

function ensureParent(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureParent(filePath);
  const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmpFile, filePath);
}

function readPendingFile(filePath: string, logger: LoggerLike): NewsRuntimeSynthesisCandidate[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { pending?: unknown }).pending)
        ? (parsed as { pending: unknown[] }).pending
        : [];
    return candidates.filter(isCandidateLike);
  } catch (error) {
    logger.warn('[vh:news-daemon] enrichment queue pending replay failed', {
      file: filePath,
      error,
    });
    return [];
  }
}

function readDeadLetterFile(filePath: string, logger: LoggerLike): EnrichmentQueueDeadLetterRecord[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) {
    return [];
  }
  const records: EnrichmentQueueDeadLetterRecord[] = [];
  for (const line of content.split('\n')) {
    try {
      const parsed = JSON.parse(line) as Partial<EnrichmentQueueDeadLetterRecord>;
      if (
        parsed?.schemaVersion === 'vh-news-enrichment-dlq-v1' &&
        (parsed.reason === 'queue_full' || parsed.reason === 'worker_failed') &&
        isCandidateLike(parsed.candidate)
      ) {
        records.push(parsed as EnrichmentQueueDeadLetterRecord);
      }
    } catch (error) {
      logger.warn('[vh:news-daemon] enrichment queue dead-letter replay parse failed', {
        file: filePath,
        error,
      });
    }
  }
  return records;
}

function persistPending(
  persistence: PersistenceState | null,
  pending: NewsRuntimeSynthesisCandidate[],
  logger: LoggerLike,
  now: () => number,
): void {
  if (!persistence) {
    return;
  }
  try {
    writeJsonAtomic(persistence.pendingFile, {
      schemaVersion: 'vh-news-enrichment-pending-v1',
      updated_at: now(),
      pending,
    });
  } catch (error) {
    logger.warn('[vh:news-daemon] enrichment queue pending persist failed', {
      file: persistence.pendingFile,
      error,
    });
  }
}

function rewriteDeadLetters(
  persistence: PersistenceState,
  records: EnrichmentQueueDeadLetterRecord[],
  logger: LoggerLike,
): void {
  try {
    ensureParent(persistence.deadLetterFile);
    writeFileSync(
      persistence.deadLetterFile,
      records.map((record) => JSON.stringify(record)).join(records.length > 0 ? '\n' : '') +
        (records.length > 0 ? '\n' : ''),
      'utf8',
    );
  } catch (error) {
    logger.warn('[vh:news-daemon] enrichment queue dead-letter rewrite failed', {
      file: persistence.deadLetterFile,
      error,
    });
  }
}

export function createAsyncEnrichmentQueue(
  worker: EnrichmentWorker,
  logger: LoggerLike,
  options: AsyncEnrichmentQueueOptions = {},
): AsyncEnrichmentQueue {
  const now = options.now ?? Date.now;
  const persistence = resolvePersistence(options);
  const initialPending = persistence ? readPendingFile(persistence.pendingFile, logger) : [];
  const initialDeadLetters = persistence ? readDeadLetterFile(persistence.deadLetterFile, logger) : [];
  const replayDeadLettersOnStart = options.replayDeadLettersOnStart !== false;
  const replayableDeadLetters = replayDeadLettersOnStart
    ? initialDeadLetters.filter((record) => record.reason === 'queue_full')
    : [];
  const retainedDeadLetters = replayDeadLettersOnStart
    ? initialDeadLetters.filter((record) => record.reason !== 'queue_full')
    : initialDeadLetters;
  const pending: NewsRuntimeSynthesisCandidate[] = [...initialPending];
  const inFlight: NewsRuntimeSynthesisCandidate[] = [];
  for (const record of replayableDeadLetters) {
    const existingIndex = pending.findIndex((candidate) => candidate.story_id === record.candidate.story_id);
    if (existingIndex >= 0) {
      pending[existingIndex] = record.candidate;
    } else {
      pending.push(record.candidate);
    }
  }
  if (persistence && replayableDeadLetters.length > 0) {
    rewriteDeadLetters(persistence, retainedDeadLetters, logger);
  }
  if (persistence && (initialPending.length > 0 || replayableDeadLetters.length > 0)) {
    logger.info('[vh:news-daemon] enrichment queue replay loaded', {
      pending_count: initialPending.length,
      replayed_dead_letter_count: replayableDeadLetters.length,
      file: persistence.pendingFile,
    });
  }
  const maxDepth =
    typeof options.maxDepth === 'number' && Number.isFinite(options.maxDepth) && options.maxDepth > 0
      ? Math.floor(options.maxDepth)
      : undefined;
  let draining = false;
  let stopped = false;
  let active = options.autoStart !== false;
  let drainScheduled = false;
  let deadLetterCount = retainedDeadLetters.length;

  const persistDurableState = () => {
    persistPending(persistence, [...inFlight, ...pending], logger, now);
  };

  const appendDeadLetter = (
    candidate: NewsRuntimeSynthesisCandidate,
    reason: EnrichmentDeadLetterReason,
    detail: { maxDepth?: number; error?: unknown } = {},
  ) => {
    const record: EnrichmentQueueDeadLetterRecord = {
      schemaVersion: 'vh-news-enrichment-dlq-v1',
      recorded_at: now(),
      reason,
      candidate,
      ...(detail.maxDepth !== undefined ? { max_depth: detail.maxDepth } : {}),
      ...(detail.error !== undefined ? { error: errorMessage(detail.error) } : {}),
    };
    deadLetterCount += 1;
    if (!persistence) {
      return;
    }
    try {
      ensureParent(persistence.deadLetterFile);
      appendFileSync(persistence.deadLetterFile, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
      logger.warn('[vh:news-daemon] enrichment queue dead-letter persist failed', {
        file: persistence.deadLetterFile,
        reason,
        story_id: candidate.story_id,
        error,
      });
    }
  };

  const drain = async (): Promise<void> => {
    if (draining || stopped || !active) {
      return;
    }

    draining = true;
    try {
      while (!stopped && active && pending.length > 0) {
        const next = pending.shift();
        if (!next) {
          continue;
        }
        inFlight.push(next);
        persistDurableState();

        try {
          await worker(next);
        } catch (error) {
          logger.warn('[vh:news-daemon] enrichment worker failed', error);
          appendDeadLetter(next, 'worker_failed', { error });
        } finally {
          const inFlightIndex = inFlight.indexOf(next);
          if (inFlightIndex >= 0) {
            inFlight.splice(inFlightIndex, 1);
          }
          if (!stopped) {
            persistDurableState();
          }
        }
      }
    } finally {
      draining = false;
    }
  };

  const scheduleDrain = () => {
    if (drainScheduled || draining || stopped || !active) {
      return;
    }

    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      void drain();
    });
  };

  if (pending.length > 0) {
    persistDurableState();
    scheduleDrain();
  }

  return {
    start() {
      if (stopped) {
        return;
      }
      active = true;
      scheduleDrain();
    },

    pause() {
      active = false;
      persistDurableState();
    },

    enqueue(candidate: NewsRuntimeSynthesisCandidate) {
      if (stopped) {
        return;
      }

      const candidateStoryId =
        typeof candidate === 'object' && candidate !== null
          ? (candidate as Partial<NewsRuntimeSynthesisCandidate>).story_id
          : undefined;
      const existingIndex = candidateStoryId
        ? pending.findIndex((queued) => queued?.story_id === candidateStoryId)
        : -1;
      if (existingIndex >= 0) {
        pending[existingIndex] = candidate;
        persistDurableState();
        return;
      }

      if (maxDepth !== undefined && pending.length >= maxDepth) {
        const dropped = pending.shift();
        if (dropped) {
          appendDeadLetter(dropped, 'queue_full', { maxDepth });
          options.onDrop?.(dropped, { reason: 'queue_full', maxDepth });
        }
        logger.warn('[vh:news-daemon] enrichment queue full; evicted oldest candidate', {
          story_id: dropped?.story_id ?? null,
          replacement_story_id: candidateStoryId ?? null,
          max_depth: maxDepth,
        });
      }

      pending.push(candidate);
      persistDurableState();
      scheduleDrain();
    },

    size() {
      return pending.length;
    },

    deadLetterCount() {
      return deadLetterCount;
    },

    snapshot() {
      return {
        pending_depth: pending.length,
        in_flight: inFlight.length,
        dead_letter_count: deadLetterCount,
        active,
        draining,
      };
    },

    stop() {
      stopped = true;
      active = false;
      persistDurableState();
      pending.length = 0;
      inFlight.length = 0;
    },
  };
}
