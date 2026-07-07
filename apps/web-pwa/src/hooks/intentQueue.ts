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
   * duplicate ids keep the first-enqueued record (pure idempotency). Replay
   * also uses it to guard removal: a queued record that wins against the
   * just-projected one (a newer same-id enqueue raced the projection) stays
   * pending instead of being deleted un-projected.
   */
  readonly compareLww?: (incoming: T, existing: T) => number;
  /**
   * Optional observer for records evicted by the queue-size cap. Invoked only
   * after the shrunken queue was durably persisted — on a persist failure
   * nothing was durably evicted and `enqueue` already reports `false`.
   */
  readonly onEvicted?: (records: readonly T[]) => void;
  /**
   * Optional observer for a corrupt persisted blob (parse failure). The queue
   * recovers by starting empty; this makes the silent discard observable.
   * Fired at most once per queue instance (load runs on every operation).
   * Receives only the error — never the raw blob contents.
   */
  readonly onLoadError?: (error: unknown) => void;
}

export interface IntentQueue<T> {
  /**
   * Persist a record. Returns `true` when the record is durably queued
   * (written, or already present from a prior enqueue), `false` when the
   * durable write failed — so callers can surface a persistence failure rather
   * than assume success.
   */
  enqueue(record: T): boolean;
  markProjected(intentId: string): void;
  getPending(): T[];
  replay(
    project: (record: T) => Promise<void>,
    options?: { readonly limit?: number },
  ): Promise<{ replayed: number; failed: number }>;
}

function persistQueue<T>(storageKey: string, queue: readonly T[]): boolean {
  try {
    return safeSetItem(storageKey, JSON.stringify(queue));
  } catch {
    // Serialization failed (unexpected for plain intent records) — treat as a
    // non-durable write so the caller can surface it.
    return false;
  }
}

export function createIntentQueue<T>(options: IntentQueueOptions<T>): IntentQueue<T> {
  // Corrupt-blob observability is once-latched: load() runs on every queue
  // operation, so an unlatched callback would fire on each of them.
  let loadErrorReported = false;
  const load = (): T[] => {
    try {
      const raw = safeGetItem(options.storageKey);
      return raw ? (JSON.parse(raw) as T[]) : [];
    } catch (error) {
      if (!loadErrorReported) {
        loadErrorReported = true;
        options.onLoadError?.(error);
      }
      return [];
    }
  };
  const persist = (queue: readonly T[]) => persistQueue(options.storageKey, queue);

  // Guarded removal for replay: remove the projected record unless a newer
  // same-id record won an LWW enqueue while the projection was in flight —
  // deleting by id alone would destroy that newer record un-projected. The
  // retained record stays pending for the next replay pass.
  const removeProjected = (record: T): void => {
    const queue = load();
    const id = options.getId(record);
    const index = queue.findIndex((queued) => options.getId(queued) === id);
    if (index < 0) {
      return;
    }
    if (options.compareLww && options.compareLww(queue[index]!, record) > 0) {
      // The stored record strictly wins against the one just projected: it
      // was enqueued mid-flight and must survive until it projects itself.
      return;
    }
    queue.splice(index, 1);
    persist(queue);
  };

  return {
    enqueue(record: T): boolean {
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
          return persist(queue);
        }
        // Already durably queued; nothing new to write.
        return true;
      }

      queue.push(record);
      const evicted: T[] = [];
      while (queue.length > options.maxQueueSize) {
        evicted.push(queue.shift()!);
      }
      const persisted = persist(queue);
      // Report evictions only after a durable persist: evicted records are
      // admitted, receipted intents, so their discard must be observable.
      if (persisted && evicted.length > 0) {
        options.onEvicted?.(evicted);
      }
      return persisted;
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
          removeProjected(record);
          replayed += 1;
        } catch {
          failed += 1;
        }
      }

      return { replayed, failed };
    },
  };
}
