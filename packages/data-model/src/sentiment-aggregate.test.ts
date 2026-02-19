import { describe, expect, it } from 'vitest';
import type { SentimentSignal } from '@vh/types';

// Simple in-test aggregator that mirrors the spec expectations:
// - per-user (nullifier) per-point last stance wins
// - neutral (0) does not count
// - agree/disagree counts per point_id
// - weight sums per topic, each event weight is bounded [0,2]
function aggregateSignals(signals: SentimentSignal[]) {
  const perUserPoint = new Map<string, SentimentSignal>();
  signals.forEach((s) => {
    // enforce weight bounds per event
    expect(s.weight).toBeGreaterThanOrEqual(0);
    expect(s.weight).toBeLessThanOrEqual(2);
    const key = `${s.constituency_proof.nullifier}:${s.point_id}`;
    perUserPoint.set(key, s); // last-write wins per user+cell
  });

  const point_stats: Record<string, { agree: number; disagree: number }> = {};
  let weightSum = 0;

  perUserPoint.forEach((s) => {
    if (!point_stats[s.point_id]) {
      point_stats[s.point_id] = { agree: 0, disagree: 0 };
    }
    if (s.agreement === 1) point_stats[s.point_id].agree += 1;
    if (s.agreement === -1) point_stats[s.point_id].disagree += 1;
    weightSum += s.weight;
  });

  return { point_stats, weight: weightSum };
}

describe('Sentiment aggregation', () => {
  it('aggregates per-cell votes and engagement across users', () => {
    const signals: SentimentSignal[] = [
      {
        topic_id: 't1',
        synthesis_id: 's1',
        epoch: 1,
        analysis_id: 'a1',
        point_id: 'pA',
        agreement: 1,
        weight: 1.0,
        constituency_proof: { district_hash: 'd1', nullifier: 'u1', merkle_root: 'm' },
        emitted_at: Date.now()
      },
      {
        topic_id: 't1',
        synthesis_id: 's1',
        epoch: 1,
        analysis_id: 'a1',
        point_id: 'pA',
        agreement: -1,
        weight: 1.3,
        constituency_proof: { district_hash: 'd1', nullifier: 'u2', merkle_root: 'm' },
        emitted_at: Date.now()
      },
      {
        topic_id: 't1',
        synthesis_id: 's1',
        epoch: 1,
        analysis_id: 'a1',
        point_id: 'pB',
        agreement: 1,
        weight: 0.7,
        constituency_proof: { district_hash: 'd1', nullifier: 'u1', merkle_root: 'm' },
        emitted_at: Date.now()
      },
      // Same user toggles to neutral on pB; should remove their vote for that cell but keep prior pA vote
      {
        topic_id: 't1',
        synthesis_id: 's1',
        epoch: 1,
        analysis_id: 'a1',
        point_id: 'pB',
        agreement: 0,
        weight: 1.5,
        constituency_proof: { district_hash: 'd1', nullifier: 'u1', merkle_root: 'm' },
        emitted_at: Date.now()
      }
    ];

    const aggregate = aggregateSignals(signals);
    expect(aggregate.point_stats['pA']).toEqual({ agree: 1, disagree: 1 });
    expect(aggregate.point_stats['pB']).toEqual({ agree: 0, disagree: 0 }); // neutral dropped out
    // Weight accumulates per user across their last stances per cell
    expect(aggregate.weight).toBeCloseTo(1.0 + 1.3 + 1.5, 5);
  });

  it('sums large engagement across many users while keeping per-user ≤2', () => {
    const signals: SentimentSignal[] = Array.from({ length: 50 }).map((_, i) => ({
      topic_id: 't2',
      synthesis_id: 's2',
      epoch: 2,
      analysis_id: 'a2',
      point_id: 'p-main',
      agreement: i % 2 === 0 ? 1 : -1,
      weight: 2, // each user at or below the cap
      constituency_proof: { district_hash: 'd2', nullifier: `u${i}`, merkle_root: 'm' },
      emitted_at: Date.now()
    }));

    const aggregate = aggregateSignals(signals);
    expect(Math.max(...signals.map((s) => s.weight))).toBeLessThanOrEqual(2);
    expect(aggregate.point_stats['p-main'].agree + aggregate.point_stats['p-main'].disagree).toBe(50);
    expect(aggregate.weight).toBe(100); // 50 users * weight 2 each
  });
});
