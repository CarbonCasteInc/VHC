import { describe, expect, it } from 'vitest';
import {
  createGathererState,
  addCandidate,
  checkGatherStatus,
  toQuorumStatus,
  GatheredCandidateSchema,
  type GatheredCandidate,
  type GathererState,
} from './candidateGatherer';

// ── Fixtures ───────────────────────────────────────────────────────

const now = 1_700_000_000_000;

function makeCandidate(overrides?: Partial<GatheredCandidate>): GatheredCandidate {
  return {
    candidate_id: 'cand-1',
    topic_id: 'topic-42',
    epoch: 0,
    critique_notes: ['note-1'],
    facts_summary: 'Summary text.',
    frames: [{ frame: 'Frame A', reframe: 'Reframe A' }],
    warnings: [],
    divergence_hints: [],
    provider: { provider_id: 'prov-1', model_id: 'model-a', kind: 'local' },
    created_at: now,
    ...overrides,
  };
}

function fillToQuorum(
  state: GathererState,
  count: number,
): GathererState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const result = addCandidate(
      s,
      makeCandidate({ candidate_id: `fill-${i}`, provider: { provider_id: `prov-${i}`, model_id: 'model-a', kind: 'local' } }),
    );
    if (!result.ok) throw new Error(result.reason);
    s = result.result.state;
  }
  return s;
}

// ── GatheredCandidateSchema ────────────────────────────────────────

describe('GatheredCandidateSchema', () => {
  it('accepts a valid candidate', () => {
    expect(GatheredCandidateSchema.safeParse(makeCandidate()).success).toBe(true);
  });

  it('rejects empty candidate_id', () => {
    expect(
      GatheredCandidateSchema.safeParse(makeCandidate({ candidate_id: '' })).success,
    ).toBe(false);
  });

  it('rejects negative epoch', () => {
    expect(
      GatheredCandidateSchema.safeParse(makeCandidate({ epoch: -1 })).success,
    ).toBe(false);
  });

  it('accepts optional based_on_prior_epoch', () => {
    const c = makeCandidate({ based_on_prior_epoch: 0 });
    expect(GatheredCandidateSchema.safeParse(c).success).toBe(true);
  });

  it('rejects invalid provider kind', () => {
    const c = makeCandidate();
    (c as any).provider.kind = 'cloud';
    expect(GatheredCandidateSchema.safeParse(c).success).toBe(false);
  });

  it('rejects empty facts_summary', () => {
    expect(
      GatheredCandidateSchema.safeParse(makeCandidate({ facts_summary: '' })).success,
    ).toBe(false);
  });
});

// ── createGathererState ────────────────────────────────────────────

describe('createGathererState', () => {
  it('creates state with default config', () => {
    const s = createGathererState('topic-42', 0, now);
    expect(s.topic_id).toBe('topic-42');
    expect(s.epoch).toBe(0);
    expect(s.config.quorum_size).toBe(5);
    expect(s.config.candidate_timeout_ms).toBe(86_400_000);
    expect(s.candidates).toEqual([]);
    expect(s.started_at).toBe(now);
  });

  it('applies config overrides', () => {
    const s = createGathererState('topic-42', 1, now, { quorum_size: 3 });
    expect(s.config.quorum_size).toBe(3);
  });

  it('uses spec defaults for omitted config fields', () => {
    const s = createGathererState('topic-42', 0, now, { quorum_size: 7 });
    expect(s.config.candidate_timeout_ms).toBe(86_400_000);
    expect(s.config.selection_rule).toBe('deterministic');
  });
});

// ── addCandidate ───────────────────────────────────────────────────

describe('addCandidate', () => {
  it('adds a valid candidate', () => {
    const s = createGathererState('topic-42', 0, now);
    const result = addCandidate(s, makeCandidate());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.state.candidates).toHaveLength(1);
    expect(result.result.status).toBe('collecting');
  });

  it('rejects candidate with wrong topic_id', () => {
    const s = createGathererState('topic-42', 0, now);
    const result = addCandidate(s, makeCandidate({ topic_id: 'wrong' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Topic mismatch');
  });

  it('rejects candidate with wrong epoch', () => {
    const s = createGathererState('topic-42', 0, now);
    const result = addCandidate(s, makeCandidate({ epoch: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Epoch mismatch');
  });

  it('rejects duplicate candidate_id', () => {
    const s = createGathererState('topic-42', 0, now);
    const r1 = addCandidate(s, makeCandidate());
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = addCandidate(r1.result.state, makeCandidate());
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.reason).toContain('Duplicate');
  });

  it('rejects invalid candidate schema', () => {
    const s = createGathererState('topic-42', 0, now);
    const bad = { ...makeCandidate(), candidate_id: '' };
    const result = addCandidate(s, bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Invalid candidate');
  });

  it('reaches quorum at exact quorum_size', () => {
    const s = createGathererState('topic-42', 0, now, { quorum_size: 3 });
    let state = s;
    for (let i = 0; i < 3; i++) {
      const r = addCandidate(state, makeCandidate({ candidate_id: `c-${i}` }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      state = r.result.state;
      if (i < 2) {
        expect(r.result.status).toBe('collecting');
      } else {
        expect(r.result.status).toBe('quorum_reached');
      }
    }
    expect(state.candidates).toHaveLength(3);
  });

  it('rejects candidate after quorum reached', () => {
    const s = createGathererState('topic-42', 0, now, { quorum_size: 2 });
    const filled = fillToQuorum(s, 2);
    const result = addCandidate(filled, makeCandidate({ candidate_id: 'extra' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('Quorum already reached');
  });

  it('preserves immutability of previous state', () => {
    const s = createGathererState('topic-42', 0, now);
    const result = addCandidate(s, makeCandidate());
    expect(result.ok).toBe(true);
    expect(s.candidates).toHaveLength(0); // original unchanged
  });
});

// ── checkGatherStatus ──────────────────────────────────────────────

describe('checkGatherStatus', () => {
  it('returns collecting when under quorum and not timed out', () => {
    const s = createGathererState('topic-42', 0, now);
    const result = checkGatherStatus(s, now + 1000);
    expect(result.status).toBe('collecting');
  });

  it('returns quorum_reached when enough candidates', () => {
    const s = createGathererState('topic-42', 0, now, { quorum_size: 2 });
    const filled = fillToQuorum(s, 2);
    const result = checkGatherStatus(filled, now + 1000);
    expect(result.status).toBe('quorum_reached');
  });

  it('returns timed_out after candidate_timeout_ms', () => {
    const s = createGathererState('topic-42', 0, now, {
      candidate_timeout_ms: 10_000,
    });
    const result = checkGatherStatus(s, now + 10_000);
    expect(result.status).toBe('timed_out');
  });

  it('returns timed_out just at boundary', () => {
    const s = createGathererState('topic-42', 0, now, {
      candidate_timeout_ms: 5000,
    });
    const result = checkGatherStatus(s, now + 5000);
    expect(result.status).toBe('timed_out');
  });

  it('returns collecting just before timeout', () => {
    const s = createGathererState('topic-42', 0, now, {
      candidate_timeout_ms: 5000,
    });
    const result = checkGatherStatus(s, now + 4999);
    expect(result.status).toBe('collecting');
  });

  it('prefers quorum_reached over timed_out', () => {
    const s = createGathererState('topic-42', 0, now, {
      quorum_size: 1,
      candidate_timeout_ms: 100,
    });
    const filled = fillToQuorum(s, 1);
    const result = checkGatherStatus(filled, now + 200);
    expect(result.status).toBe('quorum_reached');
  });
});

// ── toQuorumStatus ─────────────────────────────────────────────────

describe('toQuorumStatus', () => {
  it('builds correct quorum status during collection', () => {
    const s = createGathererState('topic-42', 1, now);
    const r = addCandidate(s, makeCandidate({ epoch: 1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const qs = toQuorumStatus(r.result.state, now + 1000);
    expect(qs.topic_id).toBe('topic-42');
    expect(qs.epoch).toBe(1);
    expect(qs.required).toBe(5);
    expect(qs.received).toBe(1);
    expect(qs.candidate_ids).toEqual(['cand-1']);
    expect(qs.timed_out).toBe(false);
    expect(qs.started_at).toBe(now);
  });

  it('marks timed_out when past deadline with insufficient candidates', () => {
    const s = createGathererState('topic-42', 0, now, {
      candidate_timeout_ms: 1000,
    });
    const qs = toQuorumStatus(s, now + 2000);
    expect(qs.timed_out).toBe(true);
    expect(qs.received).toBe(0);
  });

  it('does not mark timed_out when quorum reached even past deadline', () => {
    const s = createGathererState('topic-42', 0, now, {
      quorum_size: 2,
      candidate_timeout_ms: 1000,
    });
    const filled = fillToQuorum(s, 2);
    const qs = toQuorumStatus(filled, now + 5000);
    expect(qs.timed_out).toBe(false);
    expect(qs.received).toBe(2);
  });

  it('returns all candidate_ids', () => {
    const s = createGathererState('topic-42', 0, now, { quorum_size: 3 });
    const filled = fillToQuorum(s, 3);
    const qs = toQuorumStatus(filled, now);
    expect(qs.candidate_ids).toEqual(['fill-0', 'fill-1', 'fill-2']);
  });
});
