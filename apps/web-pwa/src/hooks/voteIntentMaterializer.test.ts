/* @vitest-environment jsdom */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PointAggregateSnapshotV1Schema, type VoteIntentRecord } from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';
import * as GunClient from '@vh/gun-client';
import * as ClientResolver from '../store/clientResolver';
import * as SentimentTelemetry from '../utils/sentimentTelemetry';
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
    voteIntentMaterializerInternal.clearReplayRetryTimer();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    voteIntentMaterializerInternal.clearReplayRetryTimer();
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
    const meshWriteSpy = vi.spyOn(SentimentTelemetry, 'logMeshWriteResult').mockImplementation(() => {});

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
    expect(meshWriteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        topic_id: 'topic-1',
        point_id: 'point-1',
        success: true,
        voter_node_ok: true,
        snapshot_ok: true,
      }),
    );
  });

  it('replayVoteIntentQueue normalizes negative emitted_at values during projection writes', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    const meshWriteSpy = vi.spyOn(SentimentTelemetry, 'logMeshWriteResult').mockImplementation(() => {});

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    const writeVoterNodeSpy = vi.spyOn(GunClient, 'writeVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: new Date(0).toISOString(),
    });
    vi.spyOn(GunClient, 'writePointAggregateSnapshot')
      .mockImplementation(async (_client, snapshot) => PointAggregateSnapshotV1Schema.parse(snapshot));

    enqueueIntent(makeIntent({
      intent_id: 'negative-emitted-at',
      seq: -10,
      emitted_at: -10,
    }));

    await expect(replayVoteIntentQueue({ limit: 10, now: () => 500 })).resolves.toEqual({ replayed: 1, failed: 0 });
    expect(writeVoterNodeSpy).toHaveBeenCalledWith(
      client,
      'topic-1',
      'synth-1',
      1,
      'voter-1',
      expect.objectContaining({ updated_at: new Date(0).toISOString() }),
    );
    expect(meshWriteSpy).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('replayVoteIntentQueue writes the voter node before full aggregate fan-in', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    vi.spyOn(SentimentTelemetry, 'logMeshWriteResult').mockImplementation(() => {});

    const readRowsSpy = vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    const writeVoterSpy = vi.spyOn(GunClient, 'writeVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: new Date(100).toISOString(),
    });
    vi.spyOn(GunClient, 'writePointAggregateSnapshot')
      .mockImplementation(async (_client, snapshot) => PointAggregateSnapshotV1Schema.parse(snapshot));

    enqueueIntent(makeIntent({ intent_id: 'write-before-fanin', seq: 100, emitted_at: 100 }));

    await expect(replayVoteIntentQueue({ limit: 10, now: () => 500 })).resolves.toEqual({ replayed: 1, failed: 0 });
    expect(writeVoterSpy.mock.invocationCallOrder[0]!).toBeLessThan(readRowsSpy.mock.invocationCallOrder[0]!);
  });

  it('replayVoteIntentQueue clears readback-confirmed timeout recovery after snapshot projection', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    const meshWriteSpy = vi.spyOn(SentimentTelemetry, 'logMeshWriteResult').mockImplementation(() => {});

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue(new Error('aggregate-put-ack-timeout'));
    vi.spyOn(GunClient, 'readAggregateVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: new Date(150).toISOString(),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const writeSnapshotSpy = vi
      .spyOn(GunClient, 'writePointAggregateSnapshot')
      .mockImplementation(async (_client, snapshot) => PointAggregateSnapshotV1Schema.parse(snapshot));

    enqueueIntent(makeIntent({
      intent_id: 'timeout-recovered',
      voter_id: 'voter-timeout',
      agreement: 1,
      weight: 1,
      seq: 120,
      emitted_at: 120,
    }));

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 500 });

    expect(result).toEqual({ replayed: 1, failed: 0 });
    expect(writeSnapshotSpy).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        agree: 1,
        disagree: 0,
        participants: 1,
      }),
    );
    expect(getPendingIntents()).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:vote:intent-replay:timeout-recovered]',
      expect.objectContaining({
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 1,
        point_id: 'point-1',
        voter_id: 'voter-timeout',
        intent_id: 'timeout-recovered',
      }),
    );
    expect(meshWriteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        topic_id: 'topic-1',
        point_id: 'point-1',
        success: true,
        timed_out: true,
        voter_node_ok: true,
        snapshot_ok: true,
        readback_recovered: true,
      }),
    );
  });

  it('replayVoteIntentQueue keeps intent pending when timeout readback is stale/mismatched', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue(new Error('aggregate-put-ack-timeout'));
    vi.spyOn(GunClient, 'readAggregateVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: new Date(10).toISOString(),
    });
    const writeSnapshotSpy = vi.spyOn(GunClient, 'writePointAggregateSnapshot');

    enqueueIntent(makeIntent({
      intent_id: 'timeout-stale',
      voter_id: 'voter-timeout-stale',
      agreement: 1,
      weight: 1,
      seq: 120,
      emitted_at: 120,
    }));

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 500 });

    expect(result).toEqual({ replayed: 0, failed: 1 });
    expect(writeSnapshotSpy).not.toHaveBeenCalled();
    expect(getPendingIntents().map((item) => item.intent_id)).toEqual(['timeout-stale']);
  });

  it('replayVoteIntentQueue clears string timeout recoveries after readback-confirmed snapshot projection', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue('aggregate-put-ack-timeout');
    vi.spyOn(GunClient, 'readAggregateVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: new Date(150).toISOString(),
    });
    const writeSnapshotSpy = vi
      .spyOn(GunClient, 'writePointAggregateSnapshot')
      .mockImplementation(async (_client, snapshot) => PointAggregateSnapshotV1Schema.parse(snapshot));

    enqueueIntent(makeIntent({
      intent_id: 'timeout-string-recovered',
      voter_id: 'voter-timeout-string',
      agreement: 1,
      weight: 1,
      seq: 120,
      emitted_at: 120,
    }));

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 501 });

    expect(result).toEqual({ replayed: 1, failed: 0 });
    expect(writeSnapshotSpy).toHaveBeenCalledTimes(1);
    expect(getPendingIntents()).toEqual([]);
  });

  it('replayVoteIntentQueue keeps intent pending when timeout readback point_id mismatches', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue(new Error('aggregate-put-ack-timeout'));
    vi.spyOn(GunClient, 'readAggregateVoterNode').mockResolvedValue({
      point_id: 'other-point',
      agreement: 1,
      weight: 1,
      updated_at: new Date(150).toISOString(),
    });
    const writeSnapshotSpy = vi.spyOn(GunClient, 'writePointAggregateSnapshot');

    enqueueIntent(makeIntent({
      intent_id: 'timeout-mismatch-point',
      voter_id: 'voter-timeout-point',
      agreement: 1,
      weight: 1,
      seq: 120,
      emitted_at: 120,
    }));

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 502 });

    expect(result).toEqual({ replayed: 0, failed: 1 });
    expect(writeSnapshotSpy).not.toHaveBeenCalled();
    expect(getPendingIntents().map((item) => item.intent_id)).toEqual(['timeout-mismatch-point']);
  });

  it('replayVoteIntentQueue keeps intent pending when timeout readback agreement mismatches', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue(new Error('aggregate-put-ack-timeout'));
    vi.spyOn(GunClient, 'readAggregateVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: -1,
      weight: 1,
      updated_at: new Date(150).toISOString(),
    });
    const writeSnapshotSpy = vi.spyOn(GunClient, 'writePointAggregateSnapshot');

    enqueueIntent(makeIntent({
      intent_id: 'timeout-mismatch-agreement',
      voter_id: 'voter-timeout-agreement',
      agreement: 1,
      weight: 1,
      seq: 120,
      emitted_at: 120,
    }));

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 503 });

    expect(result).toEqual({ replayed: 0, failed: 1 });
    expect(writeSnapshotSpy).not.toHaveBeenCalled();
    expect(getPendingIntents().map((item) => item.intent_id)).toEqual(['timeout-mismatch-agreement']);
  });

  it('replayVoteIntentQueue keeps intent pending when timeout readback timestamp is invalid', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue(new Error('aggregate-put-ack-timeout'));
    vi.spyOn(GunClient, 'readAggregateVoterNode').mockResolvedValue({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: 'not-a-date',
    });
    const writeSnapshotSpy = vi.spyOn(GunClient, 'writePointAggregateSnapshot');

    enqueueIntent(makeIntent({
      intent_id: 'timeout-invalid-timestamp',
      voter_id: 'voter-timeout-invalid-ts',
      agreement: 1,
      weight: 1,
      seq: 120,
      emitted_at: 120,
    }));

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 504 });

    expect(result).toEqual({ replayed: 0, failed: 1 });
    expect(writeSnapshotSpy).not.toHaveBeenCalled();
    expect(getPendingIntents().map((item) => item.intent_id)).toEqual(['timeout-invalid-timestamp']);
  });

  it('replayVoteIntentQueue keeps intent pending on non-timeout writeVoterNode errors', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'readPointAggregateSnapshot').mockResolvedValue(null);
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue(new Error('write-failed-hard'));
    const readBackSpy = vi.spyOn(GunClient, 'readAggregateVoterNode');
    const writeSnapshotSpy = vi.spyOn(GunClient, 'writePointAggregateSnapshot');

    enqueueIntent(makeIntent({
      intent_id: 'non-timeout-error',
      voter_id: 'voter-non-timeout',
      agreement: 1,
      weight: 1,
      seq: 120,
      emitted_at: 120,
    }));

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 505 });

    expect(result).toEqual({ replayed: 0, failed: 1 });
    expect(readBackSpy).not.toHaveBeenCalled();
    expect(writeSnapshotSpy).not.toHaveBeenCalled();
    expect(getPendingIntents().map((item) => item.intent_id)).toEqual(['non-timeout-error']);
  });

  it('replayVoteIntentQueue logs string failure payloads from projection errors', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    const meshWriteSpy = vi.spyOn(SentimentTelemetry, 'logMeshWriteResult').mockImplementation(() => {});

    vi.spyOn(GunClient, 'readAggregateVoterRows').mockResolvedValue([]);
    vi.spyOn(GunClient, 'writeVoterNode').mockRejectedValue('string-write-fail');

    enqueueIntent(makeIntent({
      intent_id: 'string-hard-fail',
      voter_id: 'voter-string-hard-fail',
    }));

    await expect(replayVoteIntentQueue({ limit: 10, now: () => 506 })).resolves.toEqual({ replayed: 0, failed: 1 });
    expect(meshWriteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        topic_id: 'topic-1',
        point_id: 'point-1',
        success: false,
        error: 'string-write-fail',
        timed_out: false,
      }),
    );
    expect(getPendingIntents().map((item) => item.intent_id)).toEqual(['string-hard-fail']);
  });

  it('replayVoteIntentQueue uses default replay limit when none is provided', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    const replaySpy = vi.spyOn(VoteIntentQueue, 'replayPendingIntents').mockResolvedValue({ replayed: 0, failed: 0 });

    await expect(replayVoteIntentQueue({ client, now: () => 1 })).resolves.toEqual({ replayed: 0, failed: 0 });
    expect(replaySpy).toHaveBeenCalledWith(expect.any(Function), { limit: 25 });
  });

  it('replayVoteIntentQueue falls back to Date.now when no now override is provided', async () => {
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
    const writeSnapshotSpy = vi
      .spyOn(GunClient, 'writePointAggregateSnapshot')
      .mockImplementation(async (_client, snapshot) => PointAggregateSnapshotV1Schema.parse(snapshot));
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(777);

    try {
      enqueueIntent(makeIntent({ intent_id: 'default-now', seq: 100, emitted_at: 100 }));
      await expect(replayVoteIntentQueue({ client, limit: 10 })).resolves.toEqual({ replayed: 1, failed: 0 });
      expect(writeSnapshotSpy).toHaveBeenCalledWith(
        client,
        expect.objectContaining({
          computed_at: 777,
        }),
      );
    } finally {
      nowSpy.mockRestore();
    }
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

    const resolve = resolveReplay as ((value: { replayed: number; failed: number }) => void) | null;
    resolve?.({ replayed: 0, failed: 0 });
    await Promise.resolve();
    await Promise.resolve();
  });

  it('scheduleVoteIntentReplay retries failed batches after delay', async () => {
    vi.useFakeTimers();
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    const replaySpy = vi
      .spyOn(VoteIntentQueue, 'replayPendingIntents')
      .mockResolvedValueOnce({ replayed: 0, failed: 1 })
      .mockResolvedValueOnce({ replayed: 1, failed: 0 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      scheduleVoteIntentReplay(7);

      await Promise.resolve();
      await Promise.resolve();
      expect(replaySpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
      await Promise.resolve();

      expect(replaySpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:vote:intent-replay]',
        expect.objectContaining({ failed: 1, retry_in_ms: 1000 }),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        '[vh:vote:intent-replay]',
        expect.objectContaining({ replayed: 1, failed: 0 }),
      );
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('clearReplayRetryTimer cancels a pending retry timer', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    try {
      voteIntentMaterializerInternal.armReplayRetryTimerForTest(callback, 1000);
      voteIntentMaterializerInternal.clearReplayRetryTimer();
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('armReplayRetryTimerForTest invokes the callback and clears its handle when allowed to fire', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    try {
      voteIntentMaterializerInternal.armReplayRetryTimerForTest(callback, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(1);
      voteIntentMaterializerInternal.clearReplayRetryTimer();
    } finally {
      vi.useRealTimers();
    }
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
    expect(writeVoterSpy.mock.calls[0]![5]).toEqual({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: new Date(100).toISOString(),
    });

    expect(writeSnapshotSpy).toHaveBeenCalledTimes(1);
    const snapshotArg = writeSnapshotSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(PointAggregateSnapshotV1Schema.safeParse(snapshotArg).success).toBe(true);
    expect(snapshotArg).not.toHaveProperty('nullifier');
    expect(snapshotArg).not.toHaveProperty('constituency_proof');
    expect(snapshotArg).not.toHaveProperty('proof_ref');
  });

  it('clears persisted voter-node intents even when snapshot materialization fails', async () => {
    const client = {} as VennClient;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(client);
    const meshWriteSpy = vi.spyOn(SentimentTelemetry, 'logMeshWriteResult').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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

    const result = await replayVoteIntentQueue({ limit: 10, now: () => 1000 });
    expect(result).toEqual({ replayed: 1, failed: 0 });
    expect(getPendingIntents()).toHaveLength(0);
    expect(meshWriteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        voter_node_ok: true,
        snapshot_ok: false,
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:vote:intent-replay:snapshot-materialization-failed]',
      expect.objectContaining({ error: 'materialize-fail' }),
    );
  });
});
