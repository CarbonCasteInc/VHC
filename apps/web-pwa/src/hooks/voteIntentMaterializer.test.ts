/* @vitest-environment jsdom */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PointAggregateSnapshotV1Schema, type VoteIntentRecord } from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';
import * as GunClient from '@vh/gun-client';
import * as ClientResolver from '../store/clientResolver';
import * as VoteIntentQueue from './voteIntentQueue';
import { enqueueIntent, getPendingIntents } from './voteIntentQueue';
import {
  materializePointSnapshot,
  replayVoteIntentQueue,
  scheduleVoteIntentReplay,
  voteIntentMaterializerInternal,
} from './voteIntentMaterializer';

function makeIntent(overrides: Partial<VoteIntentRecord> = {}): VoteIntentRecord {
  return {
    intent_id: `intent-${Math.random().toString(36).slice(2, 8)}`,
    voter_id: 'voter-1',
    topic_id: 'topic-1',
    synthesis_id: 'synth-1',
    epoch: 1,
    point_id: 'point-1',
    agreement: 1,
    weight: 1,
    proof_ref: 'pref-opaque',
    seq: 100,
    emitted_at: 100,
    ...overrides,
  };
}

describe('voteIntentMaterializer', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('materializePointSnapshot is deterministic for replay (order-independent)', () => {
    const tuple = {
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 1,
      point_id: 'point-1',
    };

    const intents = [
      makeIntent({ intent_id: 'v1-old', voter_id: 'voter-1', agreement: 1, weight: 0.7, seq: 10, emitted_at: 10 }),
      makeIntent({ intent_id: 'v2', voter_id: 'voter-2', agreement: 1, weight: 1.1, seq: 20, emitted_at: 20 }),
      makeIntent({ intent_id: 'v1-new', voter_id: 'voter-1', agreement: -1, weight: 1.3, seq: 30, emitted_at: 30 }),
    ];

    const forward = materializePointSnapshot({
      tuple,
      intents,
      computedAtMs: 999,
    });
    const reversed = materializePointSnapshot({
      tuple,
      intents: [...intents].reverse(),
      computedAtMs: 999,
    });

    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({
      agree: 1,
      disagree: 1,
      participants: 2,
      source_window: { from_seq: 20, to_seq: 30 },
      version: 30,
      computed_at: 999,
    });
    expect(forward.weight).toBeCloseTo(2.4, 6);
    expect(PointAggregateSnapshotV1Schema.safeParse(forward).success).toBe(true);
  });

  it('materializePointSnapshot normalizes invalid sequence/timestamp values to zero', () => {
    const tuple = {
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 1,
      point_id: 'point-1',
    };

    const snapshot = materializePointSnapshot({
      tuple,
      intents: [
        makeIntent({
          intent_id: 'invalid-normalization',
          voter_id: 'voter-x',
          seq: -10,
          emitted_at: -10,
        }),
      ],
      computedAtMs: Number.NaN,
    });

    expect(snapshot.source_window).toEqual({ from_seq: 0, to_seq: 0 });
    expect(snapshot.version).toBe(0);
    expect(snapshot.computed_at).toBe(0);
  });

  it('compareIntentLww tie-breaks by emitted_at and then intent_id', () => {
    const older = makeIntent({ intent_id: 'a', seq: 10, emitted_at: 10 });
    const newerByEmittedAt = makeIntent({ intent_id: 'b', seq: 10, emitted_at: 11 });
    const newerByIntentId = makeIntent({ intent_id: 'b', seq: 10, emitted_at: 10 });

    expect(voteIntentMaterializerInternal.compareIntentLww(older, newerByEmittedAt)).toBeLessThan(0);
    expect(voteIntentMaterializerInternal.compareIntentLww(newerByEmittedAt, older)).toBeGreaterThan(0);

    expect(voteIntentMaterializerInternal.compareIntentLww(older, newerByIntentId)).toBeLessThan(0);
    expect(voteIntentMaterializerInternal.compareIntentLww(newerByIntentId, older)).toBeGreaterThan(0);
  });

  it('materializePointSnapshot falls back to zero source_window and Date.now when no context is available', () => {
    const tuple = {
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 1,
      point_id: 'point-1',
    };

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(321);
    try {
      const snapshot = materializePointSnapshot({
        tuple,
        intents: [makeIntent({ point_id: 'other-point' })],
      });

      expect(snapshot.source_window).toEqual({ from_seq: 0, to_seq: 0 });
      expect(snapshot.version).toBe(0);
      expect(snapshot.computed_at).toBe(321);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('materializePointSnapshot carries forward previous source_window when no winners exist', () => {
    const tuple = {
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 1,
      point_id: 'point-1',
    };

    const snapshot = materializePointSnapshot({
      tuple,
      intents: [
        // Different point_id on purpose so tuple filter yields no winners.
        makeIntent({ point_id: 'other-point', seq: 999, emitted_at: 999 }),
      ],
      previousSnapshot: {
        schema_version: 'point-aggregate-snapshot-v1',
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 1,
        point_id: 'point-1',
        agree: 2,
        disagree: 1,
        weight: 3,
        participants: 3,
        version: 10,
        computed_at: 10,
        source_window: { from_seq: 4, to_seq: 10 },
      },
      computedAtMs: 500,
    });

    expect(snapshot.source_window).toEqual({ from_seq: 4, to_seq: 10 });
    expect(snapshot.version).toBe(10);
    expect(snapshot.agree).toBe(0);
    expect(snapshot.disagree).toBe(0);
    expect(snapshot.participants).toBe(0);
    expect(snapshot.weight).toBe(0);
  });

  it('materializePointSnapshot applies LWW semantics per voter_id', () => {
    const tuple = {
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 1,
      point_id: 'point-1',
    };

    const snapshot = materializePointSnapshot({
      tuple,
      intents: [
        makeIntent({ intent_id: 'a-old', voter_id: 'voter-a', agreement: 1, weight: 0.9, seq: 40, emitted_at: 40 }),
        makeIntent({ intent_id: 'a-new', voter_id: 'voter-a', agreement: -1, weight: 1.2, seq: 50, emitted_at: 50 }),
        makeIntent({ intent_id: 'b-only', voter_id: 'voter-b', agreement: 1, weight: 1.0, seq: 45, emitted_at: 45 }),
      ],
      computedAtMs: 123,
    });

    // voter-a latest vote is disagree, voter-b agree
    expect(snapshot.agree).toBe(1);
    expect(snapshot.disagree).toBe(1);
    expect(snapshot.participants).toBe(2);
    expect(snapshot.weight).toBeCloseTo(2.2, 6);
    expect(snapshot.source_window).toEqual({ from_seq: 45, to_seq: 50 });
  });

  it('replayVoteIntentQueue reports pending failures when client is unavailable', async () => {
    enqueueIntent(makeIntent({ intent_id: 'pending-when-offline' }));

    const result = await replayVoteIntentQueue({ client: null });
    expect(result).toEqual({ replayed: 0, failed: 1 });
  });

  it('replayVoteIntentQueue replaces existing voter row when incoming record wins LWW', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([
      {
        voter_id: 'voter-9',
        node: {
          point_id: 'point-1',
          agreement: 1,
          weight: 0.5,
          updated_at: new Date(50).toISOString(),
        },
        updated_at_ms: 50,
      },
    ]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    vi.spyOn(GunClient, 'writeVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: -1,
      weight: 1.4,
      updated_at: new Date(100).toISOString(),
    });
    const writeSnapshotSpy = vi
      .spyOn(GunClient, 'writePointAggregateSnapshot')
      .mockImplementation(async (_client, snapshot) => PointAggregateSnapshotV1Schema.parse(snapshot));

    enqueueIntent(
      makeIntent({
        intent_id: 'replace-existing',
        voter_id: 'voter-9',
        agreement: -1,
        weight: 1.4,
        seq: 100,
        emitted_at: 100,
      }),
    );

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 500 });

    expect(result).toEqual({ replayed: 1, failed: 0 });
    expect(writeSnapshotSpy).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        agree: 0,
        disagree: 1,
        participants: 1,
        weight: 1.4,
        source_window: { from_seq: 100, to_seq: 100 },
      }),
    );
  });

  it('replayVoteIntentQueue uses default replay limit when none is provided', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    const replaySpy = vi.spyOn(VoteIntentQueue, 'replayPendingIntents').mockResolvedValue({ replayed: 0, failed: 0 });

    await expect(replayVoteIntentQueue({ client, now: () => 1 })).resolves.toEqual({ replayed: 0, failed: 0 });
    expect(replaySpy).toHaveBeenCalledWith(expect.any(Function), { limit: 25 });
  });

  it('scheduleVoteIntentReplay coalesces while replay is already in flight', async () => {
    const replaySpy = vi.spyOn(VoteIntentQueue, 'replayPendingIntents');
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);

    let resolveReplay: ((value: { replayed: number; failed: number }) => void) | null = null;
    replaySpy.mockImplementation(
      () =>
        new Promise<{ replayed: number; failed: number }>((resolve) => {
          resolveReplay = resolve;
        }),
    );

    scheduleVoteIntentReplay(3);
    scheduleVoteIntentReplay(3);

    await Promise.resolve();
    expect(replaySpy).toHaveBeenCalledTimes(1);

    resolveReplay?.({ replayed: 0, failed: 0 });
    await Promise.resolve();
    await Promise.resolve();
  });

  it('replayVoteIntentQueue publishes schema-conformant snapshots without sensitive fields', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    const writeVoterSpy = vi.spyOn(GunClient, 'writeVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: new Date(100).toISOString(),
    });
    const writeSnapshotSpy = vi
      .spyOn(GunClient, 'writePointAggregateSnapshot')
      .mockImplementation(async (_client, snapshot) => PointAggregateSnapshotV1Schema.parse(snapshot));

    enqueueIntent(makeIntent({ intent_id: 'queue-1', voter_id: 'voter-9', seq: 100, emitted_at: 100 }));

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 777 });

    expect(result).toEqual({ replayed: 1, failed: 0 });
    expect(getPendingIntents()).toHaveLength(0);

    expect(writeVoterSpy).toHaveBeenCalledTimes(1);
    expect(writeVoterSpy.mock.calls[0][5]).toEqual({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: new Date(100).toISOString(),
    });

    expect(writeSnapshotSpy).toHaveBeenCalledTimes(1);
    const snapshotArg = writeSnapshotSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(PointAggregateSnapshotV1Schema.safeParse(snapshotArg).success).toBe(true);
    expect(snapshotArg).not.toHaveProperty('nullifier');
    expect(snapshotArg).not.toHaveProperty('constituency_proof');
    expect(snapshotArg).not.toHaveProperty('proof_ref');
  });

  it('failed projection remains retryable in queue', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    vi.spyOn(GunClient, 'writeVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: new Date(100).toISOString(),
    });

    const writeSnapshotSpy = vi.spyOn(GunClient, 'writePointAggregateSnapshot');
    writeSnapshotSpy.mockRejectedValueOnce(new Error('materialize-fail'));

    enqueueIntent(makeIntent({ intent_id: 'retry-1', seq: 100, emitted_at: 100 }));

    const first = await replayVoteIntentQueue({ limit: 10, now: () => 1000 });
    expect(first).toEqual({ replayed: 0, failed: 1 });
    expect(getPendingIntents().map((item) => item.intent_id)).toEqual(['retry-1']);

    writeSnapshotSpy.mockImplementation(async (_client, snapshot) => PointAggregateSnapshotV1Schema.parse(snapshot));
    const second = await replayVoteIntentQueue({ limit: 10, now: () => 1001 });
    expect(second).toEqual({ replayed: 1, failed: 0 });
    expect(getPendingIntents()).toHaveLength(0);
  });
});
