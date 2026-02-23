import {
  POINT_AGGREGATE_SNAPSHOT_VERSION,
  type PointAggregateSnapshotV1,
  type VoteIntentRecord,
} from '@vh/data-model';
import {
  readAggregateVoterNode,
  readAggregateVoterRows,
  readPointAggregateSnapshot,
  writePointAggregateSnapshot,
  writeVoterNode,
  type AggregateVoterPointRow,
  type VennClient,
} from '@vh/gun-client';
import { resolveClientFromAppStore } from '../store/clientResolver';
import { getPendingIntents, replayPendingIntents } from './voteIntentQueue';

interface PointTuple {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  point_id: string;
}

const DEFAULT_REPLAY_LIMIT = 25;

let replayInFlight = false;
let replayRetryTimer: ReturnType<typeof setTimeout> | null = null;

const REPLAY_RETRY_DELAY_MS = 1000;

function toPointTuple(record: VoteIntentRecord): PointTuple {
  return {
    topic_id: record.topic_id,
    synthesis_id: record.synthesis_id,
    epoch: record.epoch,
    point_id: record.point_id,
  };
}

function pointTupleMatches(tuple: PointTuple, record: VoteIntentRecord): boolean {
  return (
    record.topic_id === tuple.topic_id &&
    record.synthesis_id === tuple.synthesis_id &&
    record.epoch === tuple.epoch &&
    record.point_id === tuple.point_id
  );
}

function normalizeNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeMaybeTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function isAckTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('aggregate-put-ack-timeout');
}

function matchesRecoveredIntentNode(params: {
  readonly record: VoteIntentRecord;
  readonly tuple: PointTuple;
  readonly recovered: {
    readonly point_id: string;
    readonly agreement: number;
    readonly weight: number;
    readonly updated_at: string;
  };
}): boolean {
  if (params.recovered.point_id !== params.tuple.point_id) {
    return false;
  }

  if (params.recovered.agreement !== params.record.agreement) {
    return false;
  }

  const recoveredUpdatedAtMs = normalizeMaybeTimestampMs(params.recovered.updated_at);
  const incomingSeq = normalizeNonNegativeInt(params.record.seq);
  return recoveredUpdatedAtMs >= incomingSeq;
}

function compareIntentLww(a: VoteIntentRecord, b: VoteIntentRecord): number {
  if (a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  if (a.emitted_at !== b.emitted_at) {
    return a.emitted_at - b.emitted_at;
  }
  return a.intent_id.localeCompare(b.intent_id);
}

function rowToIntent(row: AggregateVoterPointRow, tuple: PointTuple): VoteIntentRecord {
  const normalizedSeq = normalizeNonNegativeInt(row.updated_at_ms);
  return {
    intent_id: `materialized:${tuple.topic_id}:${tuple.synthesis_id}:${tuple.epoch}:${tuple.point_id}:${row.voter_id}:${normalizedSeq}`,
    voter_id: row.voter_id,
    topic_id: tuple.topic_id,
    synthesis_id: tuple.synthesis_id,
    epoch: tuple.epoch,
    point_id: tuple.point_id,
    agreement: row.node.agreement,
    weight: row.node.weight,
    proof_ref: 'materialized',
    seq: normalizedSeq,
    emitted_at: normalizedSeq,
  };
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

async function projectIntentRecord(
  client: VennClient,
  record: VoteIntentRecord,
  now: () => number,
): Promise<void> {
  const tuple = toPointTuple(record);
  const currentRows = await readAggregateVoterRows(
    client,
    tuple.topic_id,
    tuple.synthesis_id,
    tuple.epoch,
    tuple.point_id,
  );

  const existingRow = currentRows.find((row) => row.voter_id === record.voter_id);
  const existingIntent = existingRow ? rowToIntent(existingRow, tuple) : null;

  const incomingWins = !existingIntent || compareIntentLww(record, existingIntent) >= 0;
  const nextRows = [...currentRows];

  if (incomingWins) {
    const updatedAtIso = new Date(normalizeNonNegativeInt(record.emitted_at)).toISOString();
    let nextRow: AggregateVoterPointRow | null = null;

    try {
      await writeVoterNode(client, tuple.topic_id, tuple.synthesis_id, tuple.epoch, record.voter_id, {
        point_id: tuple.point_id,
        agreement: record.agreement,
        weight: record.weight,
        updated_at: updatedAtIso,
      });

      nextRow = {
        voter_id: record.voter_id,
        node: {
          point_id: tuple.point_id,
          agreement: record.agreement,
          weight: record.weight,
          updated_at: updatedAtIso,
        },
        updated_at_ms: normalizeNonNegativeInt(record.emitted_at),
      };
    } catch (error) {
      if (!isAckTimeoutError(error)) {
        throw error;
      }

      const recovered = await readAggregateVoterNode(
        client,
        tuple.topic_id,
        tuple.synthesis_id,
        tuple.epoch,
        record.voter_id,
        tuple.point_id,
      );

      if (!recovered || !matchesRecoveredIntentNode({
        record,
        tuple,
        recovered,
      })) {
        throw error;
      }

      const recoveredUpdatedAtMs = normalizeMaybeTimestampMs(recovered.updated_at);
      nextRow = {
        voter_id: record.voter_id,
        node: recovered,
        updated_at_ms: recoveredUpdatedAtMs,
      };

      console.warn('[vh:vote:intent-replay:timeout-recovered]', {
        topic_id: tuple.topic_id,
        synthesis_id: tuple.synthesis_id,
        epoch: tuple.epoch,
        point_id: tuple.point_id,
        voter_id: record.voter_id,
        intent_id: record.intent_id,
      });
    }

    if (!nextRow) {
      throw new Error('intent-replay-next-row-missing');
    }

    const replaceIndex = nextRows.findIndex((row) => row.voter_id === record.voter_id);
    if (replaceIndex >= 0) {
      nextRows[replaceIndex] = nextRow;
    } else {
      nextRows.push(nextRow);
    }
  }

  const previousSnapshot = await readPointAggregateSnapshot(
    client,
    tuple.topic_id,
    tuple.synthesis_id,
    tuple.epoch,
    tuple.point_id,
  );

  const intentsForSnapshot = nextRows.map((row) => rowToIntent(row, tuple));
  const snapshot = materializePointSnapshot({
    tuple,
    intents: intentsForSnapshot,
    previousSnapshot,
    computedAtMs: now(),
  });

  await writePointAggregateSnapshot(client, snapshot);
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
  return replayPendingIntents(
    async (record) => {
      await projectIntentRecord(client, record, now);
    },
    { limit: options?.limit ?? DEFAULT_REPLAY_LIMIT },
  );
}

export function scheduleVoteIntentReplay(limit = DEFAULT_REPLAY_LIMIT): void {
  if (replayInFlight) {
    return;
  }

  if (replayRetryTimer) {
    clearTimeout(replayRetryTimer);
    replayRetryTimer = null;
  }

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
  compareIntentLww,
  toPointTuple,
};
