/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoteIntentRecord } from '@vh/data-model';
import * as SentimentTelemetry from '../utils/sentimentTelemetry';
import {
  enqueueIntent,
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
    vi.restoreAllMocks();
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

  it('duplicate intent_id with equal seq/emitted_at is deduped (idempotent)', () => {
    const record = makeIntent({ intent_id: 'dup-test', seq: 100, emitted_at: 100 });
    enqueueIntent(record);
    enqueueIntent(record);
    // Same intent_id and same seq/emitted_at → LWW comparator returns 0 → deduped.
    enqueueIntent({ ...record, agreement: -1 });

    const pending = getPendingIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0].intent_id).toBe('dup-test');
    expect(pending[0].agreement).toBe(1); // original value preserved
  });

  it('LWW on enqueue: a newer same-intent_id record replaces the stale queued one', () => {
    const original = makeIntent({
      intent_id: 'mutate-while-pending',
      agreement: 1,
      weight: 1,
      seq: 100,
      emitted_at: 100,
    });
    enqueueIntent(original);

    // Mutate-while-pending: same intent_id, newer seq/emitted_at wins LWW.
    const mutated = makeIntent({
      intent_id: 'mutate-while-pending',
      agreement: -1,
      weight: 1.3,
      seq: 200,
      emitted_at: 200,
    });
    enqueueIntent(mutated);

    const pending = getPendingIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      intent_id: 'mutate-while-pending',
      agreement: -1,
      weight: 1.3,
      seq: 200,
      emitted_at: 200,
    });
  });

  it('LWW on enqueue: an older same-intent_id record does not overwrite a newer queued one', () => {
    enqueueIntent(makeIntent({ intent_id: 'lww-order', agreement: -1, seq: 200, emitted_at: 200 }));
    // Late-arriving older record must not clobber the newer pending state.
    enqueueIntent(makeIntent({ intent_id: 'lww-order', agreement: 1, seq: 100, emitted_at: 100 }));

    const pending = getPendingIntents();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ agreement: -1, seq: 200 });
  });

  it('mutate-while-pending replays the newer agreement after LWW replace', async () => {
    enqueueIntent(makeIntent({ intent_id: 'replay-mutate', agreement: 1, seq: 100, emitted_at: 100 }));
    enqueueIntent(makeIntent({ intent_id: 'replay-mutate', agreement: -1, seq: 200, emitted_at: 200 }));

    const projected: Array<{ agreement: number; seq: number }> = [];
    const result = await replayPendingIntents(async (record) => {
      projected.push({ agreement: record.agreement, seq: record.seq });
    });

    expect(result).toEqual({ replayed: 1, failed: 0 });
    // Replay projects the newer (mutated) agreement, not the stale one.
    expect(projected).toEqual([{ agreement: -1, seq: 200 }]);
    expect(getPendingIntents()).toHaveLength(0);
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

  it('queue cap eviction emits a reason-only Write queue failure admission event', () => {
    const admissionSpy = vi
      .spyOn(SentimentTelemetry, 'logVoteAdmission')
      .mockImplementation(() => {});

    for (let i = 1; i <= 200; i++) {
      enqueueIntent(makeIntent({
        intent_id: `evict-${i}`,
        topic_id: `topic-${i}`,
        point_id: `point-${i}`,
        seq: i,
        emitted_at: i,
      }));
    }
    // Under the cap: enqueues emit no admission events from the queue.
    expect(admissionSpy).not.toHaveBeenCalled();

    enqueueIntent(makeIntent({
      intent_id: 'evict-201',
      topic_id: 'topic-201',
      point_id: 'point-201',
      seq: 201,
      emitted_at: 201,
    }));

    // The evicted intent (evict-1) was an admitted, receipted vote — its
    // discard surfaces as a Write queue failure denial event. Exact-equality
    // asserts the payload carries ONLY these four keys: never voter_id,
    // proof_ref, or intent_id.
    expect(admissionSpy).toHaveBeenCalledTimes(1);
    expect(admissionSpy).toHaveBeenCalledWith({
      topic_id: 'topic-1',
      point_id: 'point-1',
      admitted: false,
      reason: 'Write queue failure',
    });
    const payload = admissionSpy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    for (const key of Object.keys(payload)) {
      expect(['topic_id', 'point_id', 'admitted', 'reason']).toContain(key);
    }
  });

  it('mutate-while-replay-in-flight: the newer stance survives the first replay and projects on the second', async () => {
    enqueueIntent(makeIntent({ intent_id: 'race', agreement: 1, seq: 100, emitted_at: 100 }));

    let resolveProjection!: () => void;
    const projectionGate = new Promise<void>((resolve) => {
      resolveProjection = resolve;
    });
    const firstReplay = replayPendingIntents(async () => projectionGate);

    // The user toggles their stance while the first projection is in flight:
    // same deterministic intent_id, newer seq/emitted_at wins the LWW enqueue.
    enqueueIntent(makeIntent({ intent_id: 'race', agreement: -1, seq: 200, emitted_at: 200 }));
    resolveProjection();
    await expect(firstReplay).resolves.toEqual({ replayed: 1, failed: 0 });

    // The newer stance must still be pending — completion of the stale
    // record's projection must not delete it un-projected.
    expect(getPendingIntents()).toMatchObject([
      { intent_id: 'race', agreement: -1, seq: 200, emitted_at: 200 },
    ]);

    const projected: Array<{ agreement: number; seq: number }> = [];
    await replayPendingIntents(async (record) => {
      projected.push({ agreement: record.agreement, seq: record.seq });
    });
    expect(projected).toEqual([{ agreement: -1, seq: 200 }]);
    expect(getPendingIntents()).toHaveLength(0);
  });

  it('warns once, reason-only, when the persisted queue blob is corrupt', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '{corrupt-blob voter_id proof_ref');

    // Fresh module instance: the corrupt-discard latch is per queue instance,
    // and earlier tests in this file may already have consumed the shared one.
    vi.resetModules();
    const freshModule = await import('./voteIntentQueue');

    expect(freshModule.getPendingIntents()).toEqual([]);
    // Latched: repeat operations must not re-report.
    expect(freshModule.getPendingIntents()).toEqual([]);

    const corruptCalls = warnSpy.mock.calls.filter(
      (call) => call[0] === '[vh:vote:intent-queue:corrupt-discarded]',
    );
    expect(corruptCalls).toHaveLength(1);
    expect(corruptCalls[0]![1]).toEqual({
      storage_key: STORAGE_KEY,
      error: 'SyntaxError',
    });
    // Never the raw blob contents (they carry voter_id/proof_ref material).
    expect(JSON.stringify(corruptCalls)).not.toContain('corrupt-blob');
  });

  it('stringifies a non-Error load failure into the corrupt-discard warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '[]');

    vi.resetModules();
    const freshModule = await import('./voteIntentQueue');

    const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw 'string-load-failure';
    });
    expect(freshModule.getPendingIntents()).toEqual([]);
    parseSpy.mockRestore();

    const corruptCalls = warnSpy.mock.calls.filter(
      (call) => call[0] === '[vh:vote:intent-queue:corrupt-discarded]',
    );
    expect(corruptCalls).toHaveLength(1);
    expect(corruptCalls[0]![1]).toEqual({
      storage_key: STORAGE_KEY,
      error: 'string-load-failure',
    });
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

  it('replayPendingIntents uses deterministic replay order', async () => {
    enqueueIntent(makeIntent({ intent_id: 'c', seq: 30, emitted_at: 30 }));
    enqueueIntent(makeIntent({ intent_id: 'a', seq: 10, emitted_at: 10 }));
    enqueueIntent(makeIntent({ intent_id: 'b', seq: 20, emitted_at: 20 }));

    const replayed: string[] = [];
    await replayPendingIntents(async (record) => {
      replayed.push(record.intent_id);
    });

    expect(replayed).toEqual(['a', 'b', 'c']);
  });

  it('replayPendingIntents tie-breaks by emitted_at, topic_id, and synthesis_id', async () => {
    enqueueIntent(
      makeIntent({
        intent_id: 'topic-a-synth-a-early',
        seq: 10,
        emitted_at: 1,
        topic_id: 'topic-a',
        synthesis_id: 'synth-a',
      }),
    );
    enqueueIntent(
      makeIntent({
        intent_id: 'topic-a-synth-a-late',
        seq: 10,
        emitted_at: 2,
        topic_id: 'topic-a',
        synthesis_id: 'synth-a',
      }),
    );
    enqueueIntent(
      makeIntent({
        intent_id: 'topic-a-synth-b-early',
        seq: 10,
        emitted_at: 1,
        topic_id: 'topic-a',
        synthesis_id: 'synth-b',
      }),
    );
    enqueueIntent(
      makeIntent({
        intent_id: 'topic-b-synth-a-early',
        seq: 10,
        emitted_at: 1,
        topic_id: 'topic-b',
        synthesis_id: 'synth-a',
      }),
    );

    const replayed: string[] = [];
    await replayPendingIntents(async (record) => {
      replayed.push(record.intent_id);
    });

    expect(replayed).toEqual([
      'topic-a-synth-a-early',
      'topic-a-synth-b-early',
      'topic-b-synth-a-early',
      'topic-a-synth-a-late',
    ]);
  });

  it('replayPendingIntents tie-breaks by epoch, point_id, voter_id, and intent_id', async () => {
    const shared = { seq: 10, emitted_at: 10, topic_id: 'topic-x', synthesis_id: 'synth-x' };

    enqueueIntent(makeIntent({ ...shared, intent_id: 'epoch-2', epoch: 2, point_id: 'point-a', voter_id: 'voter-a' }));
    enqueueIntent(makeIntent({ ...shared, intent_id: 'point-b-voter-b', epoch: 1, point_id: 'point-b', voter_id: 'voter-b' }));
    enqueueIntent(makeIntent({ ...shared, intent_id: 'point-b-voter-a-z', epoch: 1, point_id: 'point-b', voter_id: 'voter-a' }));
    enqueueIntent(makeIntent({ ...shared, intent_id: 'point-b-voter-a-a', epoch: 1, point_id: 'point-b', voter_id: 'voter-a' }));
    enqueueIntent(makeIntent({ ...shared, intent_id: 'point-a-voter-a', epoch: 1, point_id: 'point-a', voter_id: 'voter-a' }));

    const replayed: string[] = [];
    await replayPendingIntents(async (record) => {
      replayed.push(record.intent_id);
    });

    expect(replayed).toEqual([
      'point-a-voter-a',
      'point-b-voter-a-a',
      'point-b-voter-a-z',
      'point-b-voter-b',
      'epoch-2',
    ]);
  });

  it('replayPendingIntents respects replay limit and leaves tail pending', async () => {
    enqueueIntent(makeIntent({ intent_id: 'l1', seq: 1, emitted_at: 1 }));
    enqueueIntent(makeIntent({ intent_id: 'l2', seq: 2, emitted_at: 2 }));
    enqueueIntent(makeIntent({ intent_id: 'l3', seq: 3, emitted_at: 3 }));

    const replayed: string[] = [];
    const result = await replayPendingIntents(async (record) => {
      replayed.push(record.intent_id);
    }, { limit: 2 });

    expect(result).toEqual({ replayed: 2, failed: 0 });
    expect(replayed).toEqual(['l1', 'l2']);
    expect(getPendingIntents().map((record) => record.intent_id)).toEqual(['l3']);
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
