import type {
  PointAggregateSnapshotV1,
  VoteIntentRecord,
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

export interface PointTuple {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  point_id: string;
}

export interface ReplayProjectionResult {
  topic_id: string;
  point_id: string;
  voter_node_ok: boolean;
  snapshot_ok: boolean;
  readback_recovered: boolean;
  timed_out: boolean;
}

const SNAPSHOT_MATERIALIZATION_CRITICAL_TIMEOUT_MS = 3_000;

export function toPointTuple(record: VoteIntentRecord): PointTuple {
  return {
    topic_id: record.topic_id,
    synthesis_id: record.synthesis_id,
    epoch: record.epoch,
    point_id: record.point_id,
  };
}

export function pointTupleMatches(tuple: PointTuple, record: VoteIntentRecord): boolean {
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

export function compareIntentLww(a: VoteIntentRecord, b: VoteIntentRecord): number {
  if (a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  if (a.emitted_at !== b.emitted_at) {
    return a.emitted_at - b.emitted_at;
  }
  return a.intent_id.localeCompare(b.intent_id);
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

async function awaitSnapshotMaterialization(params: {
  readonly tuple: PointTuple;
  readonly run: () => Promise<void>;
}): Promise<boolean> {
  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const materialization = params.run()
    .then(() => {
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      return true;
    })
    .catch((error) => {
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      console.warn('[vh:vote:intent-replay:snapshot-materialization-failed]', {
        topic_id: params.tuple.topic_id,
        synthesis_id: params.tuple.synthesis_id,
        epoch: params.tuple.epoch,
        point_id: params.tuple.point_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    });

  const deadline = new Promise<boolean>((resolve) => {
    timeoutId = setTimeout(() => {
      if (!settled) {
        console.warn('[vh:vote:intent-replay:snapshot-materialization-deferred]', {
          topic_id: params.tuple.topic_id,
          synthesis_id: params.tuple.synthesis_id,
          epoch: params.tuple.epoch,
          point_id: params.tuple.point_id,
          timeout_ms: SNAPSHOT_MATERIALIZATION_CRITICAL_TIMEOUT_MS,
        });
        resolve(false);
      }
    }, SNAPSHOT_MATERIALIZATION_CRITICAL_TIMEOUT_MS);
  });

  return Promise.race([materialization, deadline]);
}

export async function projectIntentRecord(params: {
  client: VennClient;
  record: VoteIntentRecord;
  now: () => number;
  materializePointSnapshot: (args: {
    tuple: PointTuple;
    intents: readonly VoteIntentRecord[];
    previousSnapshot?: PointAggregateSnapshotV1 | null;
    computedAtMs?: number;
  }) => PointAggregateSnapshotV1;
}): Promise<ReplayProjectionResult> {
  const tuple = toPointTuple(params.record);
  let voterNodeOk = false;
  let readbackRecovered = false;
  let timedOut = false;
  let nextRow: AggregateVoterPointRow | null = null;

  const updatedAtIso = new Date(normalizeNonNegativeInt(params.record.emitted_at)).toISOString();

  try {
    await writeVoterNode(
      params.client,
      tuple.topic_id,
      tuple.synthesis_id,
      tuple.epoch,
      params.record.voter_id,
      {
        point_id: tuple.point_id,
        agreement: params.record.agreement,
        weight: params.record.weight,
        updated_at: updatedAtIso,
      },
    );

    nextRow = {
      voter_id: params.record.voter_id,
      node: {
        point_id: tuple.point_id,
        agreement: params.record.agreement,
        weight: params.record.weight,
        updated_at: updatedAtIso,
      },
      updated_at_ms: normalizeNonNegativeInt(params.record.emitted_at),
    };
    voterNodeOk = true;
  } catch (error) {
    if (!isAckTimeoutError(error)) {
      throw error;
    }

    const recovered = await readAggregateVoterNode(
      params.client,
      tuple.topic_id,
      tuple.synthesis_id,
      tuple.epoch,
      params.record.voter_id,
      tuple.point_id,
    );

    if (!recovered || !matchesRecoveredIntentNode({
      record: params.record,
      tuple,
      recovered,
    })) {
      throw error;
    }

    nextRow = {
      voter_id: params.record.voter_id,
      node: recovered,
      updated_at_ms: normalizeMaybeTimestampMs(recovered.updated_at),
    };
    voterNodeOk = true;
    readbackRecovered = true;
    timedOut = true;
    console.warn('[vh:vote:intent-replay:timeout-recovered]', {
      topic_id: tuple.topic_id,
      synthesis_id: tuple.synthesis_id,
      epoch: tuple.epoch,
      point_id: tuple.point_id,
      voter_id: params.record.voter_id,
      intent_id: params.record.intent_id,
    });
  }

  /* c8 ignore next 3 */
  if (!nextRow) {
    throw new Error('intent-replay-next-row-missing');
  }

  const snapshotOk = await awaitSnapshotMaterialization({
    tuple,
    run: async () => {
      const currentRows = await readAggregateVoterRows(
        params.client,
        tuple.topic_id,
        tuple.synthesis_id,
        tuple.epoch,
        tuple.point_id,
      );
      const nextRows = [...currentRows];
      const replaceIndex = nextRows.findIndex((row) => row.voter_id === params.record.voter_id);
      if (replaceIndex >= 0) {
        nextRows[replaceIndex] = nextRow;
      } else {
        nextRows.push(nextRow);
      }
      const previousSnapshot = await readPointAggregateSnapshot(
        params.client,
        tuple.topic_id,
        tuple.synthesis_id,
        tuple.epoch,
        tuple.point_id,
      );

      const intentsForSnapshot = nextRows.map((row) => rowToIntent(row, tuple));
      const snapshot = params.materializePointSnapshot({
        tuple,
        intents: intentsForSnapshot,
        previousSnapshot,
        computedAtMs: params.now(),
      });

      await writePointAggregateSnapshot(params.client, snapshot);
    },
  });

  return {
    topic_id: tuple.topic_id,
    point_id: tuple.point_id,
    voter_node_ok: voterNodeOk,
    snapshot_ok: snapshotOk,
    readback_recovered: readbackRecovered,
    timed_out: timedOut,
  };
}
