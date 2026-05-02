import type { NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';

export type LoggerLike = Pick<Console, 'info' | 'warn' | 'error'>;
export type EnrichmentWorker = (candidate: NewsRuntimeSynthesisCandidate) => Promise<void> | void;

export interface AsyncEnrichmentQueueOptions {
  maxDepth?: number;
  onDrop?: (
    candidate: NewsRuntimeSynthesisCandidate,
    detail: { reason: 'queue_full'; maxDepth: number },
  ) => void;
}

export interface AsyncEnrichmentQueue {
  enqueue(candidate: NewsRuntimeSynthesisCandidate): void;
  size(): number;
  stop(): void;
}

export function createAsyncEnrichmentQueue(
  worker: EnrichmentWorker,
  logger: LoggerLike,
  options: AsyncEnrichmentQueueOptions = {},
): AsyncEnrichmentQueue {
  const pending: NewsRuntimeSynthesisCandidate[] = [];
  const maxDepth =
    typeof options.maxDepth === 'number' && Number.isFinite(options.maxDepth) && options.maxDepth > 0
      ? Math.floor(options.maxDepth)
      : undefined;
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

      const candidateStoryId =
        typeof candidate === 'object' && candidate !== null
          ? (candidate as Partial<NewsRuntimeSynthesisCandidate>).story_id
          : undefined;
      const existingIndex = candidateStoryId
        ? pending.findIndex((queued) => queued?.story_id === candidateStoryId)
        : -1;
      if (existingIndex >= 0) {
        pending[existingIndex] = candidate;
        return;
      }

      if (maxDepth !== undefined && pending.length >= maxDepth) {
        const dropped = pending.shift();
        if (dropped) {
          options.onDrop?.(dropped, { reason: 'queue_full', maxDepth });
        }
        logger.warn('[vh:news-daemon] enrichment queue full; evicted oldest candidate', {
          story_id: dropped?.story_id ?? null,
          replacement_story_id: candidateStoryId ?? null,
          max_depth: maxDepth,
        });
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
