import { safeGetItem, safeSetItem } from '../utils/safeStorage';

export interface IntentQueueOptions<T> {
  readonly storageKey: string;
  readonly maxQueueSize: number;
  readonly getId: (record: T) => string;
  readonly compareReplayOrder: (a: T, b: T) => number;
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
      if (queue.some((queued) => options.getId(queued) === intentId)) {
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
