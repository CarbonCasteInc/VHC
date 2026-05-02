import {
  POINT_AGGREGATE_SNAPSHOT_VERSION,
  type PointAggregateSnapshotV1,
  type VoteIntentRecord,
} from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';
import { resolveClientFromAppStore } from '../store/clientResolver';
import { logMeshWriteResult } from '../utils/sentimentTelemetry';
import {
  compareIntentLww,
  pointTupleMatches,
  projectIntentRecord,
  toPointTuple,
  type PointTuple,
} from './voteIntentProjection';
import { getPendingIntents, replayPendingIntents } from './voteIntentQueue';

const DEFAULT_REPLAY_LIMIT = 25;
const REPLAY_RETRY_DELAY_MS = 1000;

let replayInFlight = false;
let replayRetryTimer: ReturnType<typeof setTimeout> | null = null;

function clearReplayRetryTimer(): void {
  if (!replayRetryTimer) {
    return;
  }
  clearTimeout(replayRetryTimer);
  replayRetryTimer = null;
}

function armReplayRetryTimerForTest(callback: () => void, delayMs: number): void {
  clearReplayRetryTimer();
  replayRetryTimer = setTimeout(() => {
    replayRetryTimer = null;
    callback();
  }, delayMs);
}

function normalizeNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function computeAggregateFromWinners(records: readonly VoteIntentRecord[]): {
  agree: number;
  disagree: number;
  participants: number;
  weight: number;
} {
  let agree = 0;
  let disagree = 0;
  let participants = 0;
  let weight = 0;

  for (const record of records) {
    if (record.agreement === 1) {
      agree += 1;
      participants += 1;
      weight += record.weight;
      continue;
    }

    if (record.agreement === -1) {
      disagree += 1;
      participants += 1;
      weight += record.weight;
    }
  }

  return { agree, disagree, participants, weight };
}

export function materializePointSnapshot(params: {
  tuple: PointTuple;
  intents: readonly VoteIntentRecord[];
  previousSnapshot?: PointAggregateSnapshotV1 | null;
  computedAtMs?: number;
}): PointAggregateSnapshotV1 {
  const tupleIntents = params.intents.filter((record) => pointTupleMatches(params.tuple, record));
  const lwwByVoter = new Map<string, VoteIntentRecord>();

  for (const record of tupleIntents) {
    const existing = lwwByVoter.get(record.voter_id);
    if (!existing || compareIntentLww(record, existing) >= 0) {
      lwwByVoter.set(record.voter_id, record);
    }
  }

  const winners = [...lwwByVoter.values()].sort((a, b) => a.voter_id.localeCompare(b.voter_id));
  const aggregate = computeAggregateFromWinners(winners);
  const localFromSeq = winners.length > 0
    ? Math.min(...winners.map((record) => normalizeNonNegativeInt(record.seq)))
    : normalizeNonNegativeInt(params.previousSnapshot?.source_window.from_seq ?? 0);
  const localToSeq = winners.length > 0
    ? Math.max(...winners.map((record) => normalizeNonNegativeInt(record.seq)))
    : normalizeNonNegativeInt(params.previousSnapshot?.source_window.to_seq ?? 0);
  const sourceWindow = {
    from_seq: params.previousSnapshot
      ? Math.min(normalizeNonNegativeInt(params.previousSnapshot.source_window.from_seq), localFromSeq)
      : localFromSeq,
    to_seq: params.previousSnapshot
      ? Math.max(normalizeNonNegativeInt(params.previousSnapshot.source_window.to_seq), localToSeq)
      : localToSeq,
  };
  const version = Math.max(
    normalizeNonNegativeInt(params.previousSnapshot?.version ?? 0),
    sourceWindow.to_seq,
  );

  return {
    schema_version: POINT_AGGREGATE_SNAPSHOT_VERSION,
    topic_id: params.tuple.topic_id,
    synthesis_id: params.tuple.synthesis_id,
    epoch: params.tuple.epoch,
    point_id: params.tuple.point_id,
    agree: aggregate.agree,
    disagree: aggregate.disagree,
    weight: aggregate.weight,
    participants: aggregate.participants,
    version,
    computed_at: normalizeNonNegativeInt(params.computedAtMs ?? Date.now()),
    source_window: sourceWindow,
  };
}

export async function replayVoteIntentQueue(options?: {
  limit?: number;
  client?: VennClient | null;
  now?: () => number;
}): Promise<{ replayed: number; failed: number }> {
  const client = options?.client ?? resolveClientFromAppStore();
  if (!client) {
    return { replayed: 0, failed: getPendingIntents().length };
  }

  const now = options?.now ?? (() => Date.now());
  return replayPendingIntents(async (record) => {
    const startedAt = now();
    try {
      const projection = await projectIntentRecord({
        client,
        record,
        now,
        materializePointSnapshot,
      });
      logMeshWriteResult({
        topic_id: projection.topic_id,
        point_id: projection.point_id,
        success: true,
        latency_ms: Math.max(0, now() - startedAt),
        voter_node_ok: projection.voter_node_ok,
        snapshot_ok: projection.snapshot_ok,
        readback_recovered: projection.readback_recovered,
        timed_out: projection.timed_out,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logMeshWriteResult({
        topic_id: record.topic_id,
        point_id: record.point_id,
        success: false,
        latency_ms: Math.max(0, now() - startedAt),
        error: message,
        timed_out: message.includes('aggregate-put-ack-timeout'),
      });
      throw error;
    }
  }, { limit: options?.limit ?? DEFAULT_REPLAY_LIMIT });
}

export function scheduleVoteIntentReplay(limit = DEFAULT_REPLAY_LIMIT): void {
  if (replayInFlight) {
    return;
  }

  clearReplayRetryTimer();
  replayInFlight = true;
  queueMicrotask(async () => {
    let replaySummary: { replayed: number; failed: number } | null = null;

    try {
      replaySummary = await replayVoteIntentQueue({ limit });
    } finally {
      replayInFlight = false;
    }

    if (replaySummary && replaySummary.failed > 0) {
      console.warn('[vh:vote:intent-replay]', {
        replayed: replaySummary.replayed,
        failed: replaySummary.failed,
        retry_in_ms: REPLAY_RETRY_DELAY_MS,
      });
      replayRetryTimer = setTimeout(() => {
        replayRetryTimer = null;
        scheduleVoteIntentReplay(limit);
      }, REPLAY_RETRY_DELAY_MS);
      return;
    }

    if (replaySummary) {
      console.info('[vh:vote:intent-replay]', {
        replayed: replaySummary.replayed,
        failed: replaySummary.failed,
      });
    }
  });
}

export const voteIntentMaterializerInternal = {
  armReplayRetryTimerForTest,
  compareIntentLww,
  clearReplayRetryTimer,
  toPointTuple,
};
