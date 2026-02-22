/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VoteIntentRecord } from '@vh/data-model';
import {
  enqueueIntent,
  markIntentProjected,
  getPendingIntents,
  replayPendingIntents,
} from './voteIntentQueue';

const STORAGE_KEY = 'vh_vote_intent_queue_v1';

function makeIntent(overrides: Partial<VoteIntentRecord> = {}): VoteIntentRecord {
  return {
    intent_id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    voter_id: 'voter-1',
    topic_id: 'topic-1',
    synthesis_id: 'synth-1',
    epoch: 0,
    point_id: 'point-1',
    agreement: 1,
    weight: 1,
    proof_ref: 'pref-abc',
    seq: Date.now(),
    emitted_at: Date.now(),
    ...overrides,
  };
}

describe('voteIntentQueue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('enqueueIntent persists to safeStorage', () => {
    const record = makeIntent({ intent_id: 'persist-test' });
    enqueueIntent(record);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!) as VoteIntentRecord[];
    expect(stored).toHaveLength(1);
    expect(stored[0].intent_id).toBe('persist-test');
  });

  it('getPendingIntents returns all un-projected intents', () => {
    enqueueIntent(makeIntent({ intent_id: 'a' }));
    enqueueIntent(makeIntent({ intent_id: 'b' }));
    enqueueIntent(makeIntent({ intent_id: 'c' }));

    const pending = getPendingIntents();
    expect(pending).toHaveLength(3);
    expect(pending.map((r) => r.intent_id)).toEqual(['a', 'b', 'c']);
  });

  it('markIntentProjected removes from pending', () => {
    enqueueIntent(makeIntent({ intent_id: 'keep' }));
    enqueueIntent(makeIntent({ intent_id: 'remove' }));

    markIntentProjected('remove');

    const pending = getPendingIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0].intent_id).toBe('keep');
  });

  it('duplicate intent_id is silently deduped (idempotent)', () => {
    const record = makeIntent({ intent_id: 'dup-test' });
    enqueueIntent(record);
    enqueueIntent(record);
    enqueueIntent({ ...record, agreement: -1 }); // same intent_id, different data

    const pending = getPendingIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0].intent_id).toBe('dup-test');
    expect(pending[0].agreement).toBe(1); // original value preserved
  });

  it('queue survives simulated restart (reload from safeStorage)', () => {
    enqueueIntent(makeIntent({ intent_id: 'survive-restart' }));

    // Simulate restart: the module re-reads from safeStorage on each call
    // (no in-memory cache), so just verify storage is intact
    const beforeRestart = getPendingIntents();
    expect(beforeRestart).toHaveLength(1);

    // Verify the raw storage is intact
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();

    // Re-read — simulates fresh module load reading from storage
    const afterRestart = getPendingIntents();
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0].intent_id).toBe('survive-restart');
  });

  it('queue cap: 201st intent evicts oldest', () => {
    for (let i = 1; i <= 201; i++) {
      enqueueIntent(makeIntent({ intent_id: `cap-${i}`, seq: i, emitted_at: i }));
    }

    const pending = getPendingIntents();
    expect(pending).toHaveLength(200);
    // Oldest (cap-1) should be evicted
    expect(pending[0].intent_id).toBe('cap-2');
    expect(pending[pending.length - 1].intent_id).toBe('cap-201');
  });

  it('replayPendingIntents processes all pending, marks projected on success', async () => {
    enqueueIntent(makeIntent({ intent_id: 'replay-1' }));
    enqueueIntent(makeIntent({ intent_id: 'replay-2' }));
    enqueueIntent(makeIntent({ intent_id: 'replay-3' }));

    const projected: string[] = [];
    const result = await replayPendingIntents(async (record) => {
      projected.push(record.intent_id);
    });

    expect(result).toEqual({ replayed: 3, failed: 0 });
    expect(projected).toEqual(['replay-1', 'replay-2', 'replay-3']);
    expect(getPendingIntents()).toHaveLength(0);
  });

  it('replayPendingIntents counts failures separately (does not mark as projected)', async () => {
    enqueueIntent(makeIntent({ intent_id: 'ok-1' }));
    enqueueIntent(makeIntent({ intent_id: 'fail-1' }));
    enqueueIntent(makeIntent({ intent_id: 'ok-2' }));

    const result = await replayPendingIntents(async (record) => {
      if (record.intent_id === 'fail-1') {
        throw new Error('projection failed');
      }
    });

    expect(result).toEqual({ replayed: 2, failed: 1 });
    // Failed intent remains in queue
    const pending = getPendingIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0].intent_id).toBe('fail-1');
  });

  it('empty queue replay returns {replayed: 0, failed: 0}', async () => {
    const result = await replayPendingIntents(async () => {
      throw new Error('should not be called');
    });

    expect(result).toEqual({ replayed: 0, failed: 0 });
  });

  it('handles persist failure gracefully when JSON.stringify throws', () => {
    const original = JSON.stringify;
    let callCount = 0;
    JSON.stringify = (...args: Parameters<typeof original>) => {
      callCount++;
      // Allow loadQueue reads but fail on persistQueue writes
      if (callCount > 0) {
        // First call is from enqueueIntent -> loadQueue (but loadQueue uses JSON.parse, not stringify)
        // The stringify call is from persistQueue — make it throw
        throw new Error('simulated-stringify-failure');
      }
      return original(...args);
    };

    try {
      // Should not throw even when persist fails
      expect(() => enqueueIntent(makeIntent({ intent_id: 'stringify-fail' }))).not.toThrow();
    } finally {
      JSON.stringify = original;
    }
  });

  it('recovers gracefully from malformed storage JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{malformed-json');
    const pending = getPendingIntents();
    expect(pending).toEqual([]);

    // Can still enqueue after recovery
    enqueueIntent(makeIntent({ intent_id: 'after-corrupt' }));
    expect(getPendingIntents()).toHaveLength(1);
  });

  it('no silent drops: every enqueued intent has a terminal state after replay', async () => {
    const ids = ['terminal-1', 'terminal-2', 'terminal-3', 'terminal-4', 'terminal-5'];
    for (const id of ids) {
      enqueueIntent(makeIntent({ intent_id: id }));
    }

    // All succeed
    const result = await replayPendingIntents(async () => {
      // success
    });

    expect(result.replayed + result.failed).toBe(ids.length);
    expect(result.replayed).toBe(5);
    expect(result.failed).toBe(0);
    // Queue is empty — every intent reached terminal state (projected)
    expect(getPendingIntents()).toHaveLength(0);
  });
});
