import { safeGetItem, safeSetItem } from '../utils/safeStorage';

export interface IntentQueueOptions<T> {
  readonly storageKey: string;
  readonly maxQueueSize: number;
  readonly getId: (record: T) => string;
  readonly compareReplayOrder: (a: T, b: T) => number;
  /**
   * Optional last-write-wins comparator. When provided, enqueuing a record
   * whose id already exists REPLACES the queued record if the incoming one
   * wins (comparator > 0) instead of being silently deduped. Without it,
   * duplicate ids keep the first-enqueued record (pure idempotency).
   */
  readonly compareLww?: (incoming: T, existing: T) => number;
}

export interface IntentQueue<T> {
  enqueue(record: T): void;
  markProjected(intentId: string): void;
  getPending(): T[];
  replay(
    project: (record: T) => Promise<void>,
    options?: { readonly limit?: number },
  ): Promise<{ replayed: number; failed: number }>;
}

function loadQueue<T>(storageKey: string): T[] {
  try {
    const raw = safeGetItem(storageKey);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function persistQueue<T>(storageKey: string, queue: readonly T[]): void {
  try {
    safeSetItem(storageKey, JSON.stringify(queue));
  } catch {
    /* ignore — quota exceeded, disabled storage, etc. */
  }
}

export function createIntentQueue<T>(options: IntentQueueOptions<T>): IntentQueue<T> {
  const load = () => loadQueue<T>(options.storageKey);
  const persist = (queue: readonly T[]) => persistQueue(options.storageKey, queue);

  return {
    enqueue(record: T): void {
      const queue = load();
      const intentId = options.getId(record);
      const existingIndex = queue.findIndex((queued) => options.getId(queued) === intentId);
      if (existingIndex >= 0) {
        // Same id already pending. With an LWW comparator, replace the queued
        // record in place when the incoming one wins so a mutate-while-pending
        // vote does not lose its newer agreement. Without a comparator, keep the
        // first-enqueued record (pure idempotency).
        if (options.compareLww && options.compareLww(record, queue[existingIndex]!) > 0) {
          queue[existingIndex] = record;
          persist(queue);
        }
        return;
      }

      queue.push(record);
      while (queue.length > options.maxQueueSize) {
        queue.shift();
      }
      persist(queue);
    },

    markProjected(intentId: string): void {
      const queue = load();
      const filtered = queue.filter((record) => options.getId(record) !== intentId);
      if (filtered.length !== queue.length) {
        persist(filtered);
      }
    },

    getPending(): T[] {
      return load();
    },

    async replay(
      project: (record: T) => Promise<void>,
      replayOptions?: { readonly limit?: number },
    ): Promise<{ replayed: number; failed: number }> {
      const pending = load().sort(options.compareReplayOrder);
      const normalizedLimit = replayOptions?.limit && replayOptions.limit > 0
        ? Math.floor(replayOptions.limit)
        : pending.length;
      const replayBatch = pending.slice(0, normalizedLimit);

      let replayed = 0;
      let failed = 0;
      for (const record of replayBatch) {
        try {
          await project(record);
          this.markProjected(options.getId(record));
          replayed += 1;
        } catch {
          failed += 1;
        }
      }

      return { replayed, failed };
    },
  };
}
