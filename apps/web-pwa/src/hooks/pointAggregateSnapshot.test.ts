/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import type { AggregateVoterPointRow } from '@vh/gun-client';
import {
  materializePointSnapshotFromRows,
  normalizeAggregateNumber,
  normalizeAggregateTimestampMs,
  upsertAggregateRow,
} from './pointAggregateSnapshot';

function row(
  voterId: string,
  pointId: string,
  agreement: -1 | 1,
  weight: number,
  updatedAtMs: number,
): AggregateVoterPointRow {
  return {
    voter_id: voterId,
    node: {
      point_id: pointId,
      agreement,
      weight,
      updated_at: new Date(updatedAtMs).toISOString(),
    },
    updated_at_ms: updatedAtMs,
  };
}

describe('pointAggregateSnapshot', () => {
  it('normalizes invalid numeric and timestamp inputs to zero', () => {
    expect(normalizeAggregateNumber(Number.NaN)).toBe(0);
    expect(normalizeAggregateNumber(-5)).toBe(0);
    expect(normalizeAggregateNumber(8.9)).toBe(8);
    expect(normalizeAggregateTimestampMs('not-a-date')).toBe(0);
    expect(normalizeAggregateTimestampMs('1970-01-01T00:00:01.234Z')).toBe(1234);
  });

  it('upserts rows by voter id', () => {
    const existing = row('voter-a', 'point-1', 1, 1, 100);
    const replacement = row('voter-a', 'point-1', -1, 2, 200);
    const appended = row('voter-b', 'point-1', 1, 1, 300);

    expect(upsertAggregateRow([existing], replacement)).toEqual([replacement]);
    expect(upsertAggregateRow([existing], appended)).toEqual([existing, appended]);
  });

  it('materializes a deterministic snapshot from latest rows per voter', () => {
    const snapshot = materializePointSnapshotFromRows({
      tuple: {
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 1,
        point_id: 'point-1',
      },
      rows: [
        row('voter-a', 'point-1', 1, 1.2, 100),
        row('voter-a', 'point-1', -1, 1.5, 200),
        row('voter-b', 'point-1', 1, 1.1, 150),
        row('voter-c', 'point-other', 1, 4, 500),
      ],
      computedAtMs: 999,
    });

    expect(snapshot).toMatchObject({
      agree: 1,
      disagree: 1,
      participants: 2,
      version: 200,
      computed_at: 999,
      source_window: { from_seq: 150, to_seq: 200 },
    });
    expect(snapshot.weight).toBeCloseTo(2.6, 6);
  });

  it('carries previous window forward when no matching rows remain', () => {
    const snapshot = materializePointSnapshotFromRows({
      tuple: {
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 1,
        point_id: 'point-1',
      },
      rows: [row('voter-a', 'point-other', 1, 1, 999)],
      previousSnapshot: {
        schema_version: 'point-aggregate-snapshot-v1',
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 1,
        point_id: 'point-1',
        agree: 2,
        disagree: 0,
        weight: 2,
        participants: 2,
        version: 10,
        computed_at: 10,
        source_window: { from_seq: 4, to_seq: 10 },
      },
      computedAtMs: Number.NaN,
    });

    expect(snapshot).toMatchObject({
      agree: 0,
      disagree: 0,
      participants: 0,
      weight: 0,
      version: 10,
      computed_at: 0,
      source_window: { from_seq: 4, to_seq: 10 },
    });
  });
});
