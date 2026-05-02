import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntentQueue } from './intentQueue';

const storage = new Map<string, string>();

vi.mock('../utils/safeStorage', () => ({
  safeGetItem: (key: string) => storage.get(key) ?? null,
  safeSetItem: (key: string, value: string) => storage.set(key, value),
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

  it('survives malformed persisted data and storage write failures', () => {
    storage.set('vh_corrupt_intent_queue_v1', '{bad json');
    const corruptQueue = createQueue('vh_corrupt_intent_queue_v1');
    expect(corruptQueue.getPending()).toEqual([]);

    const setItemSpy = vi.spyOn(storage, 'set').mockImplementation(() => {
      throw new Error('quota');
    });
    const queue = createQueue('vh_storage_failure_intent_queue_v1');
    expect(() => queue.enqueue({ intent_id: 'safe', seq: 1 })).not.toThrow();
    setItemSpy.mockRestore();
  });
});
