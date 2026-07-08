import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntentQueue } from './intentQueue';

const storage = new Map<string, string>();

vi.mock('../utils/safeStorage', () => ({
  safeGetItem: (key: string) => storage.get(key) ?? null,
  safeSetItem: (key: string, value: string) => {
    storage.set(key, value);
    return true;
  },
}));

interface TestIntent {
  readonly intent_id: string;
  readonly seq: number;
}

function createQueue(storageKey = 'vh_test_intent_queue_v1') {
  return createIntentQueue<TestIntent>({
    storageKey,
    maxQueueSize: 3,
    getId: (record) => record.intent_id,
    compareReplayOrder: (a, b) => a.seq - b.seq || a.intent_id.localeCompare(b.intent_id),
  });
}

function createLwwQueue(storageKey = 'vh_lww_intent_queue_v1') {
  return createIntentQueue<TestIntent>({
    storageKey,
    maxQueueSize: 3,
    getId: (record) => record.intent_id,
    compareReplayOrder: (a, b) => a.seq - b.seq || a.intent_id.localeCompare(b.intent_id),
    compareLww: (incoming, existing) => incoming.seq - existing.seq,
  });
}

describe('createIntentQueue', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('dedupes by deterministic id and evicts oldest records at the cap', () => {
    const queue = createQueue();
    queue.enqueue({ intent_id: 'a', seq: 1 });
    queue.enqueue({ intent_id: 'a', seq: 99 });
    queue.enqueue({ intent_id: 'b', seq: 2 });
    queue.enqueue({ intent_id: 'c', seq: 3 });
    queue.enqueue({ intent_id: 'd', seq: 4 });

    expect(queue.getPending()).toEqual([
      { intent_id: 'b', seq: 2 },
      { intent_id: 'c', seq: 3 },
      { intent_id: 'd', seq: 4 },
    ]);
  });

  it('replaces a same-id record in place when the incoming one wins the LWW comparator', () => {
    const queue = createLwwQueue();
    queue.enqueue({ intent_id: 'a', seq: 1 });
    queue.enqueue({ intent_id: 'b', seq: 5 });
    // Newer 'a' wins and replaces in place (keeps position, does not append).
    queue.enqueue({ intent_id: 'a', seq: 9 });
    // Older 'b' loses and is ignored.
    queue.enqueue({ intent_id: 'b', seq: 2 });

    expect(queue.getPending()).toEqual([
      { intent_id: 'a', seq: 9 },
      { intent_id: 'b', seq: 5 },
    ]);
  });

  it('replays in deterministic order, clears successes, and keeps failures pending', async () => {
    const queue = createQueue();
    queue.enqueue({ intent_id: 'c', seq: 30 });
    queue.enqueue({ intent_id: 'a', seq: 10 });
    queue.enqueue({ intent_id: 'b', seq: 20 });

    const projected: string[] = [];
    const result = await queue.replay(async (record) => {
      projected.push(record.intent_id);
      if (record.intent_id === 'b') {
        throw new Error('retry later');
      }
    });

    expect(result).toEqual({ replayed: 2, failed: 1 });
    expect(projected).toEqual(['a', 'b', 'c']);
    expect(queue.getPending()).toEqual([{ intent_id: 'b', seq: 20 }]);
  });

  it('survives malformed persisted data and reports storage write failures', () => {
    storage.set('vh_corrupt_intent_queue_v1', '{bad json');
    const corruptQueue = createQueue('vh_corrupt_intent_queue_v1');
    expect(corruptQueue.getPending()).toEqual([]);

    const setItemSpy = vi.spyOn(storage, 'set').mockImplementation(() => {
      throw new Error('quota');
    });
    const queue = createQueue('vh_storage_failure_intent_queue_v1');
    let persisted = true;
    // A failed durable write is reported (false), not swallowed as success,
    // and never throws.
    expect(() => {
      persisted = queue.enqueue({ intent_id: 'safe', seq: 1 });
    }).not.toThrow();
    expect(persisted).toBe(false);
    setItemSpy.mockRestore();
  });

  it('reports a persist failure (not a throw) when a record cannot be serialized', () => {
    const queue = createQueue('vh_unserializable_intent_queue_v1');
    let persisted = true;
    // A BigInt makes JSON.stringify throw inside persist; the failure must be
    // reported as a non-durable write rather than propagating.
    expect(() => {
      persisted = queue.enqueue({ intent_id: 'x', seq: 1, bad: 1n } as unknown as TestIntent);
    }).not.toThrow();
    expect(persisted).toBe(false);
  });

  it('returns true when a record is durably queued and for an idempotent no-op', () => {
    const queue = createLwwQueue();
    expect(queue.enqueue({ intent_id: 'a', seq: 1 })).toBe(true);
    // Same id, not newer: idempotent no-op still reports durable.
    expect(queue.enqueue({ intent_id: 'a', seq: 1 })).toBe(true);
    // Same id, newer: LWW replace persists.
    expect(queue.enqueue({ intent_id: 'a', seq: 5 })).toBe(true);
  });

  it('invokes onEvicted with the evicted records after a successful persist', () => {
    const evictedBatches: TestIntent[][] = [];
    const queue = createIntentQueue<TestIntent>({
      storageKey: 'vh_evicted_intent_queue_v1',
      maxQueueSize: 3,
      getId: (record) => record.intent_id,
      compareReplayOrder: (a, b) => a.seq - b.seq || a.intent_id.localeCompare(b.intent_id),
      onEvicted: (records) => evictedBatches.push([...records]),
    });

    queue.enqueue({ intent_id: 'a', seq: 1 });
    queue.enqueue({ intent_id: 'b', seq: 2 });
    queue.enqueue({ intent_id: 'c', seq: 3 });
    // Under the cap: no eviction reported.
    expect(evictedBatches).toEqual([]);

    expect(queue.enqueue({ intent_id: 'd', seq: 4 })).toBe(true);
    expect(evictedBatches).toEqual([[{ intent_id: 'a', seq: 1 }]]);
    expect(queue.getPending().map((record) => record.intent_id)).toEqual(['b', 'c', 'd']);
  });

  it('does not invoke onEvicted when the persist fails (nothing was durably evicted)', () => {
    const onEvicted = vi.fn();
    const queue = createIntentQueue<TestIntent>({
      storageKey: 'vh_evict_persist_failure_queue_v1',
      maxQueueSize: 1,
      getId: (record) => record.intent_id,
      compareReplayOrder: (a, b) => a.seq - b.seq || a.intent_id.localeCompare(b.intent_id),
      onEvicted,
    });
    expect(queue.enqueue({ intent_id: 'a', seq: 1 })).toBe(true);

    const setItemSpy = vi.spyOn(storage, 'set').mockImplementation(() => {
      throw new Error('quota');
    });
    // The overflowing enqueue evicts in memory but the durable write fails:
    // the caller gets `false` (existing failure path) and no eviction event.
    expect(queue.enqueue({ intent_id: 'b', seq: 2 })).toBe(false);
    setItemSpy.mockRestore();

    expect(onEvicted).not.toHaveBeenCalled();
    expect(queue.getPending().map((record) => record.intent_id)).toEqual(['a']);
  });

  it('keeps a newer same-id record enqueued mid-flight pending instead of deleting it un-projected', async () => {
    const queue = createLwwQueue('vh_replay_guard_queue_v1');
    queue.enqueue({ intent_id: 'a', seq: 1 });

    let resolveProjection!: () => void;
    const projectionGate = new Promise<void>((resolve) => {
      resolveProjection = resolve;
    });
    const replayPromise = queue.replay(async () => projectionGate);

    // Mutate while the replay is in flight: the newer same-id record wins the
    // LWW enqueue and replaces the stored record before the old projection
    // resolves. Completion must not delete it by id.
    queue.enqueue({ intent_id: 'a', seq: 9 });
    resolveProjection();
    const result = await replayPromise;

    expect(result).toEqual({ replayed: 1, failed: 0 });
    expect(queue.getPending()).toEqual([{ intent_id: 'a', seq: 9 }]);

    // The retained record projects (and is removed) on the next pass.
    const projected: TestIntent[] = [];
    await queue.replay(async (record) => {
      projected.push(record);
    });
    expect(projected).toEqual([{ intent_id: 'a', seq: 9 }]);
    expect(queue.getPending()).toEqual([]);
  });

  it('comparator-less replay keeps remove-by-id semantics for mid-flight same-id enqueues', async () => {
    const queue = createQueue('vh_replay_no_lww_queue_v1');
    queue.enqueue({ intent_id: 'a', seq: 1 });

    let resolveProjection!: () => void;
    const projectionGate = new Promise<void>((resolve) => {
      resolveProjection = resolve;
    });
    const replayPromise = queue.replay(async () => projectionGate);

    // Without an LWW comparator a same-id enqueue is deduped, so removal by
    // id after projection is correct and leaves nothing behind.
    queue.enqueue({ intent_id: 'a', seq: 9 });
    resolveProjection();
    await replayPromise;

    expect(queue.getPending()).toEqual([]);
  });

  it('replay removal is a no-op when the record was already removed mid-flight', async () => {
    const queue = createLwwQueue('vh_replay_removed_mid_flight_queue_v1');
    queue.enqueue({ intent_id: 'a', seq: 1 });

    let resolveProjection!: () => void;
    const projectionGate = new Promise<void>((resolve) => {
      resolveProjection = resolve;
    });
    const replayPromise = queue.replay(async () => projectionGate);

    // External removal (e.g. another tab draining the shared queue) while the
    // projection is in flight; completion must not throw or resurrect it. The
    // guarded removal then finds no matching id and no-ops.
    storage.set('vh_replay_removed_mid_flight_queue_v1', '[]');
    resolveProjection();

    await expect(replayPromise).resolves.toEqual({ replayed: 1, failed: 0 });
    expect(queue.getPending()).toEqual([]);
  });

  it('reports a corrupt persisted blob via onLoadError exactly once and recovers empty', () => {
    storage.set('vh_corrupt_reported_queue_v1', '{bad json');
    const onLoadError = vi.fn();
    const queue = createIntentQueue<TestIntent>({
      storageKey: 'vh_corrupt_reported_queue_v1',
      maxQueueSize: 3,
      getId: (record) => record.intent_id,
      compareReplayOrder: (a, b) => a.seq - b.seq || a.intent_id.localeCompare(b.intent_id),
      onLoadError,
    });

    expect(queue.getPending()).toEqual([]);
    // load() runs on every operation; the report is latched to fire once.
    expect(queue.getPending()).toEqual([]);
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(onLoadError).toHaveBeenCalledWith(expect.any(SyntaxError));
  });
});
