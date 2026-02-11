import { describe, expect, it } from 'vitest';
import {
  fnv1a32,
  computeDisagreementScore,
  computeSourceDispersion,
  computeProviderMix,
  selectCandidate,
  selectFromGatherer,
  SELECTION_ALGORITHM_VERSION,
  type SelectionResult,
} from './quorum';
import {
  createGathererState,
  addCandidate,
  type GatheredCandidate,
} from './candidateGatherer';

// ── Fixtures ───────────────────────────────────────────────────────

const now = 1_700_000_000_000;

function makeCandidate(overrides?: Partial<GatheredCandidate>): GatheredCandidate {
  return {
    candidate_id: 'cand-1',
    topic_id: 'topic-42',
    epoch: 0,
    critique_notes: [],
    facts_summary: 'Summary.',
    frames: [{ frame: 'F1', reframe: 'R1' }],
    warnings: [],
    divergence_hints: [],
    provider: { provider_id: 'prov-1', model_id: 'model-a', kind: 'local' },
    created_at: now,
    ...overrides,
  };
}

function makeCandidates(n: number): GatheredCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    makeCandidate({
      candidate_id: `cand-${i}`,
      provider: {
        provider_id: `prov-${i % 3}`,
        model_id: 'model-a',
        kind: i % 2 === 0 ? 'local' : 'remote',
      },
      divergence_hints: i % 2 === 0 ? ['hint-a'] : ['hint-b'],
    }),
  );
}

// ── SELECTION_ALGORITHM_VERSION ────────────────────────────────────

describe('SELECTION_ALGORITHM_VERSION', () => {
  it('is deterministic-v1', () => {
    expect(SELECTION_ALGORITHM_VERSION).toBe('deterministic-v1');
  });
});

// ── fnv1a32 ────────────────────────────────────────────────────────

describe('fnv1a32', () => {
  it('returns a positive unsigned 32-bit integer', () => {
    const h = fnv1a32('hello');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('is deterministic — same input always same output', () => {
    expect(fnv1a32('test-input')).toBe(fnv1a32('test-input'));
  });

  it('produces different hashes for different inputs', () => {
    expect(fnv1a32('alpha')).not.toBe(fnv1a32('beta'));
  });

  it('handles empty string', () => {
    const h = fnv1a32('');
    expect(h).toBe(0x811c9dc5); // offset basis unchanged
  });

  it('handles long strings', () => {
    const long = 'a'.repeat(10_000);
    const h = fnv1a32(long);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('matches known FNV-1a value for "foobar"', () => {
    // Verified against reference FNV-1a implementation
    const h = fnv1a32('foobar');
    expect(h).toBe(0xbf9cf968);
  });
});

// ── computeDisagreementScore ───────────────────────────────────────

describe('computeDisagreementScore', () => {
  it('returns 0 for single candidate', () => {
    expect(computeDisagreementScore([makeCandidate()])).toBe(0);
  });

  it('returns 0 for empty candidates', () => {
    expect(computeDisagreementScore([])).toBe(0);
  });

  it('returns 0 when all candidates have identical hints', () => {
    const cs = [
      makeCandidate({ candidate_id: 'a', divergence_hints: ['h1'] }),
      makeCandidate({ candidate_id: 'b', divergence_hints: ['h1'] }),
    ];
    expect(computeDisagreementScore(cs)).toBe(0);
  });

  it('returns 1 when all pairs disagree', () => {
    const cs = [
      makeCandidate({ candidate_id: 'a', divergence_hints: ['h1'] }),
      makeCandidate({ candidate_id: 'b', divergence_hints: ['h2'] }),
    ];
    expect(computeDisagreementScore(cs)).toBe(1);
  });

  it('returns fractional score for mixed agreement', () => {
    const cs = [
      makeCandidate({ candidate_id: 'a', divergence_hints: ['h1'] }),
      makeCandidate({ candidate_id: 'b', divergence_hints: ['h1'] }),
      makeCandidate({ candidate_id: 'c', divergence_hints: ['h2'] }),
    ];
    // Pairs: (a,b)=agree, (a,c)=disagree, (b,c)=disagree => 2/3
    const score = computeDisagreementScore(cs);
    expect(score).toBeCloseTo(2 / 3, 10);
  });

  it('returns 0 when all hints are empty', () => {
    const cs = [
      makeCandidate({ candidate_id: 'a', divergence_hints: [] }),
      makeCandidate({ candidate_id: 'b', divergence_hints: [] }),
    ];
    expect(computeDisagreementScore(cs)).toBe(0);
  });
});

// ── computeSourceDispersion ────────────────────────────────────────

describe('computeSourceDispersion', () => {
  it('returns 0 for single candidate', () => {
    expect(computeSourceDispersion([makeCandidate()])).toBe(0);
  });

  it('returns 0 for empty candidates', () => {
    expect(computeSourceDispersion([])).toBe(0);
  });

  it('returns 0 when all from same provider', () => {
    const cs = [
      makeCandidate({ candidate_id: 'a' }),
      makeCandidate({ candidate_id: 'b' }),
    ];
    expect(computeSourceDispersion(cs)).toBe(0);
  });

  it('returns 1 when all from different providers', () => {
    const cs = [
      makeCandidate({ candidate_id: 'a', provider: { provider_id: 'p1', model_id: 'm', kind: 'local' } }),
      makeCandidate({ candidate_id: 'b', provider: { provider_id: 'p2', model_id: 'm', kind: 'local' } }),
    ];
    expect(computeSourceDispersion(cs)).toBe(1);
  });

  it('returns value between 0 and 1 for mixed providers', () => {
    const cs = [
      makeCandidate({ candidate_id: 'a', provider: { provider_id: 'p1', model_id: 'm', kind: 'local' } }),
      makeCandidate({ candidate_id: 'b', provider: { provider_id: 'p1', model_id: 'm', kind: 'local' } }),
      makeCandidate({ candidate_id: 'c', provider: { provider_id: 'p2', model_id: 'm', kind: 'local' } }),
    ];
    const d = computeSourceDispersion(cs);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });
});

// ── computeProviderMix ─────────────────────────────────────────────

describe('computeProviderMix', () => {
  it('returns empty for no candidates', () => {
    expect(computeProviderMix([])).toEqual([]);
  });

  it('counts providers correctly', () => {
    const cs = [
      makeCandidate({ candidate_id: 'a', provider: { provider_id: 'p1', model_id: 'm', kind: 'local' } }),
      makeCandidate({ candidate_id: 'b', provider: { provider_id: 'p2', model_id: 'm', kind: 'local' } }),
      makeCandidate({ candidate_id: 'c', provider: { provider_id: 'p1', model_id: 'm', kind: 'local' } }),
    ];
    const mix = computeProviderMix(cs);
    expect(mix).toEqual([
      { provider_id: 'p1', count: 2 },
      { provider_id: 'p2', count: 1 },
    ]);
  });

  it('sorts by provider_id', () => {
    const cs = [
      makeCandidate({ candidate_id: 'a', provider: { provider_id: 'z-prov', model_id: 'm', kind: 'local' } }),
      makeCandidate({ candidate_id: 'b', provider: { provider_id: 'a-prov', model_id: 'm', kind: 'local' } }),
    ];
    const mix = computeProviderMix(cs);
    expect(mix[0].provider_id).toBe('a-prov');
    expect(mix[1].provider_id).toBe('z-prov');
  });
});

// ── selectCandidate ────────────────────────────────────────────────

describe('selectCandidate', () => {
  it('throws for empty candidate set', () => {
    expect(() => selectCandidate([])).toThrow('Cannot select from empty');
  });

  it('selects the only candidate when set has one', () => {
    const c = makeCandidate();
    const result = selectCandidate([c]);
    expect(result.selected.candidate_id).toBe('cand-1');
    expect(result.selection_index).toBe(0);
    expect(result.sorted_candidate_ids).toEqual(['cand-1']);
    expect(result.divergence.candidate_count).toBe(1);
  });

  it('is deterministic — same set always yields same selection', () => {
    const cs = makeCandidates(5);
    const r1 = selectCandidate(cs);
    const r2 = selectCandidate(cs);
    expect(r1.selected.candidate_id).toBe(r2.selected.candidate_id);
    expect(r1.selection_index).toBe(r2.selection_index);
  });

  it('is order-independent — shuffled input yields same selection', () => {
    const cs = makeCandidates(5);
    const reversed = [...cs].reverse();
    const r1 = selectCandidate(cs);
    const r2 = selectCandidate(reversed);
    expect(r1.selected.candidate_id).toBe(r2.selected.candidate_id);
    expect(r1.sorted_candidate_ids).toEqual(r2.sorted_candidate_ids);
  });

  it('sorted_candidate_ids is in lexicographic order', () => {
    const cs = makeCandidates(5);
    const result = selectCandidate(cs);
    const sorted = [...result.sorted_candidate_ids].sort();
    expect(result.sorted_candidate_ids).toEqual(sorted);
  });

  it('computes divergence metrics', () => {
    const cs = makeCandidates(4);
    const result = selectCandidate(cs);
    expect(result.divergence.disagreement_score).toBeGreaterThanOrEqual(0);
    expect(result.divergence.disagreement_score).toBeLessThanOrEqual(1);
    expect(result.divergence.source_dispersion).toBeGreaterThanOrEqual(0);
    expect(result.divergence.source_dispersion).toBeLessThanOrEqual(1);
    expect(result.divergence.candidate_count).toBe(4);
  });

  it('computes provider mix', () => {
    const cs = makeCandidates(3); // prov-0, prov-1, prov-2
    const result = selectCandidate(cs);
    expect(result.provider_mix.length).toBeGreaterThan(0);
    const total = result.provider_mix.reduce((s, p) => s + p.count, 0);
    expect(total).toBe(3);
  });

  it('selection_index is within bounds', () => {
    for (let n = 1; n <= 10; n++) {
      const cs = makeCandidates(n);
      const result = selectCandidate(cs);
      expect(result.selection_index).toBeGreaterThanOrEqual(0);
      expect(result.selection_index).toBeLessThan(n);
    }
  });

  it('different candidate sets may yield different selections', () => {
    // Not guaranteed but extremely likely with distinct IDs
    const setA = makeCandidates(5);
    const setB = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ candidate_id: `other-${i}` }),
    );
    const rA = selectCandidate(setA);
    const rB = selectCandidate(setB);
    // At minimum the IDs should differ
    expect(rA.sorted_candidate_ids).not.toEqual(rB.sorted_candidate_ids);
  });
});

// ── selectFromGatherer ─────────────────────────────────────────────

describe('selectFromGatherer', () => {
  it('throws for empty gatherer', () => {
    const s = createGathererState('topic-42', 0, now);
    expect(() => selectFromGatherer(s)).toThrow('Cannot select from empty');
  });

  it('selects from gatherer state', () => {
    const s = createGathererState('topic-42', 0, now, { quorum_size: 3 });
    let state = s;
    for (let i = 0; i < 3; i++) {
      const r = addCandidate(state, makeCandidate({ candidate_id: `c-${i}` }));
      if (!r.ok) throw new Error(r.reason);
      state = r.result.state;
    }
    const result = selectFromGatherer(state);
    expect(result.sorted_candidate_ids).toEqual(['c-0', 'c-1', 'c-2']);
    expect(result.divergence.candidate_count).toBe(3);
  });

  it('yields same result as selectCandidate with same data', () => {
    const s = createGathererState('topic-42', 0, now, { quorum_size: 3 });
    let state = s;
    const candidates: GatheredCandidate[] = [];
    for (let i = 0; i < 3; i++) {
      const c = makeCandidate({ candidate_id: `c-${i}` });
      candidates.push(c);
      const r = addCandidate(state, c);
      if (!r.ok) throw new Error(r.reason);
      state = r.result.state;
    }
    const fromGatherer = selectFromGatherer(state);
    const fromDirect = selectCandidate(candidates);
    expect(fromGatherer.selected.candidate_id).toBe(
      fromDirect.selected.candidate_id,
    );
  });
});

// ── Reproducibility stress test (spec §5.3) ───────────────────────

describe('deterministic selection reproducibility', () => {
  it('100 iterations with same set yield same result', () => {
    const cs = makeCandidates(7);
    const baseline = selectCandidate(cs);
    for (let i = 0; i < 100; i++) {
      // Shuffle order each time
      const shuffled = [...cs].sort(() => Math.random() - 0.5);
      const result = selectCandidate(shuffled);
      expect(result.selected.candidate_id).toBe(
        baseline.selected.candidate_id,
      );
      expect(result.selection_index).toBe(baseline.selection_index);
    }
  });
});
