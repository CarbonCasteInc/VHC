import {
  POINT_AGGREGATE_SNAPSHOT_VERSION,
  type PointAggregateSnapshotV1,
} from '@vh/data-model';
import type { AggregateVoterPointRow } from '@vh/gun-client';

export interface AggregatePointTuple {
  readonly topic_id: string;
  readonly synthesis_id: string;
  readonly epoch: number;
  readonly point_id: string;
}

export function normalizeAggregateNumber(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

export function normalizeAggregateTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

export function upsertAggregateRow(
  rows: readonly AggregateVoterPointRow[],
  nextRow: AggregateVoterPointRow,
): AggregateVoterPointRow[] {
  const replaceIndex = rows.findIndex((row) => row.voter_id === nextRow.voter_id);
  if (replaceIndex < 0) {
    return [...rows, nextRow];
  }

  const nextRows = [...rows];
  nextRows[replaceIndex] = nextRow;
  return nextRows;
}

export function materializePointSnapshotFromRows(params: {
  tuple: AggregatePointTuple;
  rows: readonly AggregateVoterPointRow[];
  previousSnapshot?: PointAggregateSnapshotV1 | null;
  computedAtMs?: number;
}): PointAggregateSnapshotV1 {
  const winners = new Map<string, AggregateVoterPointRow>();

  for (const row of params.rows) {
    if (row.node.point_id !== params.tuple.point_id) {
      continue;
    }
    const existing = winners.get(row.voter_id);
    if (!existing || row.updated_at_ms >= existing.updated_at_ms) {
      winners.set(row.voter_id, row);
    }
  }

  const winnerRows = [...winners.values()].sort((left, right) => left.voter_id.localeCompare(right.voter_id));

  let agree = 0;
  let disagree = 0;
  let participants = 0;
  let weight = 0;

  for (const row of winnerRows) {
    if (row.node.agreement === 1) {
      agree += 1;
      participants += 1;
      weight += row.node.weight;
      continue;
    }
    if (row.node.agreement === -1) {
      disagree += 1;
      participants += 1;
      weight += row.node.weight;
    }
  }

  const localFromSeq = winnerRows.length > 0
    ? Math.min(...winnerRows.map((row) => normalizeAggregateNumber(row.updated_at_ms)))
    : normalizeAggregateNumber(params.previousSnapshot?.source_window.from_seq ?? 0);
  const localToSeq = winnerRows.length > 0
    ? Math.max(...winnerRows.map((row) => normalizeAggregateNumber(row.updated_at_ms)))
    : normalizeAggregateNumber(params.previousSnapshot?.source_window.to_seq ?? 0);

  const sourceWindow = {
    from_seq: params.previousSnapshot
      ? Math.min(normalizeAggregateNumber(params.previousSnapshot.source_window.from_seq), localFromSeq)
      : localFromSeq,
    to_seq: params.previousSnapshot
      ? Math.max(normalizeAggregateNumber(params.previousSnapshot.source_window.to_seq), localToSeq)
      : localToSeq,
  };

  const version = Math.max(
    normalizeAggregateNumber(params.previousSnapshot?.version ?? 0),
    sourceWindow.to_seq,
  );

  return {
    schema_version: POINT_AGGREGATE_SNAPSHOT_VERSION,
    topic_id: params.tuple.topic_id,
    synthesis_id: params.tuple.synthesis_id,
    epoch: params.tuple.epoch,
    point_id: params.tuple.point_id,
    agree,
    disagree,
    weight,
    participants,
    version,
    computed_at: normalizeAggregateNumber(params.computedAtMs ?? Date.now()),
    source_window: sourceWindow,
  };
}
