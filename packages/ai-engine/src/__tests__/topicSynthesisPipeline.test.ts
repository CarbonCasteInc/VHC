import { describe, expect, it, vi } from 'vitest';
import type { CommentEvent } from '../commentTracker';
import type { GatheredCandidate } from '../candidateGatherer';
import type { TopicEpochMeta } from '../resynthesisWiring';
import type { VerifiedComment } from '../digestBuilder';
import {
  TopicSynthesisPipeline,
  runEpoch,
  selectCandidate,
  deriveSynthesisId,
  computeDivergenceMetrics,
  computeProviderMix,
  PipelineOutputSchema,
  type PipelineDeps,
  type PipelineOutput,
  type RunEpochInput,
} from '../topicSynthesisPipeline';

// ── Fixtures ───────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeCandidate(
  overrides?: Partial<GatheredCandidate>,
): GatheredCandidate {
  return {
    candidate_id: 'cand-1',
    topic_id: 'topic-A',
    epoch: 1,
    critique_notes: ['note'],
    facts_summary: 'Facts here',
    frames: [{ frame: 'F1', reframe: 'R1' }],
    warnings: [],
    divergence_hints: [],
    provider: { provider_id: 'prov-1', model_id: 'model-1', kind: 'local' },
    created_at: NOW,
    ...overrides,
  };
}

function makeCommentEvent(
  overrides?: Partial<CommentEvent>,
): CommentEvent {
  return {
    comment_id: 'c-1',
    topic_id: 'topic-A',
    principal_hash: 'hash-user-0',
    verified: true,
    kind: 'add',
    timestamp: NOW - 500,
    ...overrides,
  };
}

function makeVerifiedComment(
  overrides?: Partial<VerifiedComment>,
): VerifiedComment {
  return {
    comment_id: 'vc-1',
    content: 'Claim A',
    stance: 'concur',
    principal_hash: 'hash-alice',
    timestamp: NOW - 1000,
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<PipelineDeps>): PipelineDeps {
  return {
    enabled: true,
    now: () => NOW,
    resolveTopicEpochMeta: () => ({
      current_epoch: 0,
      last_epoch_timestamp: NOW - 2_000_000,
      epochs_today: 0,
    }),
    resolveVerifiedComments: () => [
      makeVerifiedComment({ comment_id: 'vc-1', stance: 'concur' }),
      makeVerifiedComment({
        comment_id: 'vc-2',
        stance: 'counter',
        content: 'Counter',
      }),
    ],
    ...overrides,
  };
}

function feedComments(
  pipeline: TopicSynthesisPipeline,
  topicId: string,
  count: number,
  principalPrefix = 'hash-user',
): void {
  for (let i = 0; i < count; i++) {
    pipeline.onCommentEvent(
      makeCommentEvent({
        comment_id: `c-${i}`,
        topic_id: topicId,
        principal_hash: `${principalPrefix}-${i}`,
        timestamp: NOW - count + i,
      }),
    );
  }
}

// ── Pure function tests ────────────────────────────────────────────

describe('selectCandidate', () => {
  it('returns null for empty array', () => {
    expect(selectCandidate([])).toBeNull();
  });

  it('selects lexicographically first candidate_id', () => {
    const a = makeCandidate({ candidate_id: 'cand-B' });
    const b = makeCandidate({ candidate_id: 'cand-A' });
    expect(selectCandidate([a, b])?.candidate_id).toBe('cand-A');
  });

  it('is deterministic regardless of input order', () => {
    const a = makeCandidate({ candidate_id: 'cand-C' });
    const b = makeCandidate({ candidate_id: 'cand-A' });
    const c = makeCandidate({ candidate_id: 'cand-B' });
    expect(selectCandidate([a, b, c])?.candidate_id).toBe('cand-A');
    expect(selectCandidate([c, a, b])?.candidate_id).toBe('cand-A');
    expect(selectCandidate([b, c, a])?.candidate_id).toBe('cand-A');
  });
});

describe('deriveSynthesisId', () => {
  it('produces deterministic id', () => {
    const id1 = deriveSynthesisId('topic-A', 1, 'cand-1');
    const id2 = deriveSynthesisId('topic-A', 1, 'cand-1');
    expect(id1).toBe(id2);
    expect(id1).toBe('synth-topic-A-1-cand-1');
  });

  it('varies by inputs', () => {
    const a = deriveSynthesisId('topic-A', 1, 'cand-1');
    const b = deriveSynthesisId('topic-B', 1, 'cand-1');
    const c = deriveSynthesisId('topic-A', 2, 'cand-1');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('computeDivergenceMetrics', () => {
  it('returns zeros for empty candidates', () => {
    const m = computeDivergenceMetrics([]);
    expect(m).toEqual({
      disagreement_score: 0,
      source_dispersion: 0,
      candidate_count: 0,
    });
  });

  it('computes source_dispersion from unique providers', () => {
    const candidates = [
      makeCandidate({
        candidate_id: 'c1',
        provider: { provider_id: 'p1', model_id: 'm1', kind: 'local' },
      }),
      makeCandidate({
        candidate_id: 'c2',
        provider: { provider_id: 'p2', model_id: 'm2', kind: 'remote' },
      }),
    ];
    const m = computeDivergenceMetrics(candidates);
    expect(m.source_dispersion).toBe(1);
    expect(m.candidate_count).toBe(2);
  });

  it('computes disagreement from divergence_hints', () => {
    const candidates = [
      makeCandidate({
        candidate_id: 'c1',
        divergence_hints: ['hint1'],
      }),
      makeCandidate({
        candidate_id: 'c2',
        divergence_hints: [],
      }),
    ];
    const m = computeDivergenceMetrics(candidates);
    expect(m.disagreement_score).toBe(0.5);
  });

  it('returns zeros for single candidate', () => {
    const m = computeDivergenceMetrics([makeCandidate()]);
    expect(m.source_dispersion).toBe(0);
    expect(m.disagreement_score).toBe(0);
    expect(m.candidate_count).toBe(1);
  });
});

describe('computeProviderMix', () => {
  it('returns empty for no candidates', () => {
    expect(computeProviderMix([])).toEqual([]);
  });

  it('aggregates providers and sorts by id', () => {
    const candidates = [
      makeCandidate({
        candidate_id: 'c1',
        provider: { provider_id: 'beta', model_id: 'm', kind: 'local' },
      }),
      makeCandidate({
        candidate_id: 'c2',
        provider: { provider_id: 'alpha', model_id: 'm', kind: 'local' },
      }),
      makeCandidate({
        candidate_id: 'c3',
        provider: { provider_id: 'beta', model_id: 'm', kind: 'local' },
      }),
    ];
    expect(computeProviderMix(candidates)).toEqual([
      { provider_id: 'alpha', count: 1 },
      { provider_id: 'beta', count: 2 },
    ]);
  });
});

// ── runEpoch tests ─────────────────────────────────────────────────

describe('runEpoch', () => {
  it('returns null for empty candidates', () => {
    const result = runEpoch({
      topicId: 'topic-A',
      epoch: 1,
      candidates: [],
      now: NOW,
      quorumRequired: 5,
      timedOut: false,
    });
    expect(result).toBeNull();
  });

  it('builds valid TopicSynthesisV2 output', () => {
    const candidates = [
      makeCandidate({ candidate_id: 'cand-B' }),
      makeCandidate({ candidate_id: 'cand-A', facts_summary: 'Selected facts' }),
    ];
    const result = runEpoch({
      topicId: 'topic-A',
      epoch: 1,
      candidates,
      now: NOW,
      quorumRequired: 5,
      timedOut: false,
    });

    expect(result).not.toBeNull();
    expect(result!.synthesis_id).toContain('cand-A');
    expect(result!.facts_summary).toBe('Selected facts');
    expect(result!.quorum.received).toBe(2);
    expect(result!.quorum.selection_rule).toBe('deterministic');
    expect(result!.provenance.candidate_ids).toHaveLength(2);
  });

  it('output passes schema validation', () => {
    const candidates = [makeCandidate()];
    const result = runEpoch({
      topicId: 'topic-A',
      epoch: 1,
      candidates,
      now: NOW,
      quorumRequired: 5,
      timedOut: false,
    });

    const parsed = PipelineOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('includes digest_id in inputs when digest provided', () => {
    const result = runEpoch({
      topicId: 'topic-A',
      epoch: 1,
      candidates: [makeCandidate()],
      digest: {
        digest_id: 'dg-abc',
        topic_id: 'topic-A',
        window_start: 0,
        window_end: NOW,
        verified_comment_count: 10,
        unique_verified_principals: 3,
        key_claims: [],
        salient_counterclaims: [],
        representative_quotes: [],
      },
      now: NOW,
      quorumRequired: 5,
      timedOut: false,
    });

    expect(result!.inputs.topic_digest_ids).toEqual(['dg-abc']);
  });

  it('marks timed_out correctly', () => {
    const result = runEpoch({
      topicId: 'topic-A',
      epoch: 1,
      candidates: [makeCandidate()],
      now: NOW,
      quorumRequired: 5,
      timedOut: true,
    });

    expect(result!.quorum.timed_out).toBe(true);
  });
});

// ── Pipeline orchestrator tests ────────────────────────────────────

describe('TopicSynthesisPipeline', () => {
  it('is no-op when disabled', () => {
    const onSynthesisProduced = vi.fn();
    const pipeline = new TopicSynthesisPipeline(
      makeDeps({ enabled: false, onSynthesisProduced }),
    );

    pipeline.onCommentEvent(makeCommentEvent());
    expect(onSynthesisProduced).not.toHaveBeenCalled();
    expect(pipeline.getCommentCount('topic-A')).toBe(0);
  });

  it('tracks comments via orchestrator', () => {
    const pipeline = new TopicSynthesisPipeline(makeDeps());

    pipeline.onCommentEvent(
      makeCommentEvent({ principal_hash: 'hash-user-1' }),
    );
    expect(pipeline.getCommentCount('topic-A')).toBe(1);
    expect(pipeline.getUniquePrincipalCount('topic-A')).toBe(1);
  });

  it('triggers epoch when thresholds met (initial epoch)', () => {
    const onSynthesisProduced = vi.fn();
    const deps = makeDeps({
      onSynthesisProduced,
      pipelineConfig: {
        resynthesis_comment_threshold: 3,
        resynthesis_unique_principal_min: 3,
        quorum_size: 1,
      },
      resolveTopicEpochMeta: () => ({
        current_epoch: 0,
        last_epoch_timestamp: NOW - 2_000_000,
        epochs_today: 0,
      }),
    });

    const pipeline = new TopicSynthesisPipeline(deps);
    feedComments(pipeline, 'topic-A', 3);

    // After threshold met, a gatherer should be active
    expect(pipeline.hasActiveGatherer('topic-A')).toBe(true);
  });

  it('completes gathering when quorum reached', () => {
    const onSynthesisProduced = vi.fn();
    const deps = makeDeps({
      onSynthesisProduced,
      pipelineConfig: {
        resynthesis_comment_threshold: 3,
        resynthesis_unique_principal_min: 3,
        quorum_size: 2,
      },
      resolveTopicEpochMeta: () => ({
        current_epoch: 0,
        last_epoch_timestamp: NOW - 2_000_000,
        epochs_today: 0,
      }),
    });

    const pipeline = new TopicSynthesisPipeline(deps);
    feedComments(pipeline, 'topic-A', 3);

    // Add candidates to reach quorum
    pipeline.addCandidate('topic-A', makeCandidate({ candidate_id: 'c1', epoch: 1 }));
    pipeline.addCandidate('topic-A', makeCandidate({ candidate_id: 'c2', epoch: 1 }));

    expect(onSynthesisProduced).toHaveBeenCalledTimes(1);
    const output: PipelineOutput = onSynthesisProduced.mock.calls[0][0];
    expect(output.schemaVersion).toBe('topic-synthesis-v2');
    expect(output.topic_id).toBe('topic-A');
    expect(output.epoch).toBe(1);
    expect(output.quorum.received).toBe(2);
    expect(output.quorum.selection_rule).toBe('deterministic');
    expect(pipeline.hasActiveGatherer('topic-A')).toBe(false);
  });

  it('rejects candidate when no active gatherer', () => {
    const pipeline = new TopicSynthesisPipeline(makeDeps());
    const result = pipeline.addCandidate('topic-A', makeCandidate());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('No active gatherer for topic');
  });

  it('rejects invalid candidate (addCandidate validation error)', () => {
    const onSynthesisProduced = vi.fn();
    const deps = makeDeps({
      onSynthesisProduced,
      pipelineConfig: {
        resynthesis_comment_threshold: 3,
        resynthesis_unique_principal_min: 3,
        quorum_size: 5,
      },
      resolveTopicEpochMeta: () => ({
        current_epoch: 0,
        last_epoch_timestamp: NOW - 2_000_000,
        epochs_today: 0,
      }),
    });

    const pipeline = new TopicSynthesisPipeline(deps);
    feedComments(pipeline, 'topic-A', 3);

    // Add candidate with wrong topic_id to trigger validation error
    const result = pipeline.addCandidate(
      'topic-A',
      makeCandidate({ topic_id: 'wrong-topic', epoch: 1 }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Topic mismatch');
  });

  it('rejects candidate when disabled', () => {
    const pipeline = new TopicSynthesisPipeline(
      makeDeps({ enabled: false }),
    );
    const result = pipeline.addCandidate('topic-A', makeCandidate());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Pipeline disabled');
  });

  it('completes gathering on timeout', () => {
    let clock = NOW;
    const onSynthesisProduced = vi.fn();
    const deps = makeDeps({
      onSynthesisProduced,
      now: () => clock,
      pipelineConfig: {
        resynthesis_comment_threshold: 3,
        resynthesis_unique_principal_min: 3,
        quorum_size: 5,
        candidate_timeout_ms: 1000,
      },
      resolveTopicEpochMeta: () => ({
        current_epoch: 0,
        last_epoch_timestamp: clock - 2_000_000,
        epochs_today: 0,
      }),
    });

    const pipeline = new TopicSynthesisPipeline(deps);
    feedComments(pipeline, 'topic-A', 3);

    // Add one candidate but not enough for quorum
    pipeline.addCandidate('topic-A', makeCandidate({ epoch: 1 }));

    // Advance time past timeout
    clock = NOW + 2000;
    pipeline.checkTimeouts();

    expect(onSynthesisProduced).toHaveBeenCalledTimes(1);
    const output: PipelineOutput = onSynthesisProduced.mock.calls[0][0];
    expect(output.quorum.timed_out).toBe(true);
    expect(output.quorum.received).toBe(1);
  });

  it('checkTimeouts is no-op when disabled', () => {
    const pipeline = new TopicSynthesisPipeline(
      makeDeps({ enabled: false }),
    );
    // Should not throw
    pipeline.checkTimeouts();
  });

  it('does not produce output when gatherer has no candidates and times out', () => {
    let clock = NOW;
    const onSynthesisProduced = vi.fn();
    const deps = makeDeps({
      onSynthesisProduced,
      now: () => clock,
      pipelineConfig: {
        resynthesis_comment_threshold: 3,
        resynthesis_unique_principal_min: 3,
        quorum_size: 5,
        candidate_timeout_ms: 1000,
      },
      resolveTopicEpochMeta: () => ({
        current_epoch: 0,
        last_epoch_timestamp: clock - 2_000_000,
        epochs_today: 0,
      }),
    });

    const pipeline = new TopicSynthesisPipeline(deps);
    feedComments(pipeline, 'topic-A', 3);

    // Don't add any candidates
    clock = NOW + 2000;
    pipeline.checkTimeouts();

    expect(onSynthesisProduced).not.toHaveBeenCalled();
    expect(pipeline.hasActiveGatherer('topic-A')).toBe(false);
  });

  it('does not trigger epoch when resolveTopicEpochMeta returns null', () => {
    const onSynthesisProduced = vi.fn();
    const deps = makeDeps({
      onSynthesisProduced,
      resolveTopicEpochMeta: () => null,
      pipelineConfig: {
        resynthesis_comment_threshold: 3,
        resynthesis_unique_principal_min: 3,
      },
    });

    const pipeline = new TopicSynthesisPipeline(deps);
    feedComments(pipeline, 'topic-A', 3);

    expect(pipeline.hasActiveGatherer('topic-A')).toBe(false);
    expect(onSynthesisProduced).not.toHaveBeenCalled();
  });

  it('handles meta returning null during epoch trigger callback', () => {
    const metaSpy = vi.fn<() => TopicEpochMeta | null>();
    const validMeta: TopicEpochMeta = {
      current_epoch: 0,
      last_epoch_timestamp: NOW - 2_000_000,
      epochs_today: 0,
    };
    // evaluate() calls resolveTopicEpochMeta once per call that passes threshold.
    // On the 3rd comment, threshold is met → orchestrator calls meta.
    // Then handleEpochTriggered calls meta again. We want that second call to return null.
    // The orchestrator.evaluate only calls meta when tracker threshold is met (3rd comment).
    // So: call 1 = from orchestrator.evaluate (3rd comment), call 2 = from handleEpochTriggered.
    metaSpy.mockReturnValueOnce(validMeta); // orchestrator.evaluate
    metaSpy.mockReturnValueOnce(null); // handleEpochTriggered

    const onSynthesisProduced = vi.fn();
    const deps = makeDeps({
      onSynthesisProduced,
      resolveTopicEpochMeta: metaSpy,
      pipelineConfig: {
        resynthesis_comment_threshold: 3,
        resynthesis_unique_principal_min: 3,
      },
    });

    const pipeline = new TopicSynthesisPipeline(deps);
    feedComments(pipeline, 'topic-A', 3);

    // handleEpochTriggered got null meta, so no gatherer created
    expect(pipeline.hasActiveGatherer('topic-A')).toBe(false);
    expect(metaSpy).toHaveBeenCalledTimes(2);
  });
});

// ── Schema validation on output ────────────────────────────────────

describe('PipelineOutputSchema', () => {
  it('rejects output with forbidden fields', () => {
    const valid = runEpoch({
      topicId: 'topic-A',
      epoch: 1,
      candidates: [makeCandidate()],
      now: NOW,
      quorumRequired: 5,
      timedOut: false,
    })!;

    // Valid output should pass
    expect(PipelineOutputSchema.safeParse(valid).success).toBe(true);

    // Extra fields should fail (strict mode)
    const withExtra = { ...valid, nullifier: 'bad' };
    expect(PipelineOutputSchema.safeParse(withExtra).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = PipelineOutputSchema.safeParse({
      schemaVersion: 'topic-synthesis-v2',
      topic_id: 'topic-A',
    });
    expect(result.success).toBe(false);
  });
});
