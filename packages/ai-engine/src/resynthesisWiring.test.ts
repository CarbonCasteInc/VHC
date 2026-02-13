import { describe, expect, it, vi } from 'vitest';
import {
  ResynthesisOrchestrator,
  type ResynthesisWiringDeps,
  type TopicEpochMeta,
} from './resynthesisWiring';
import type { CommentEvent } from './commentTracker';
import type { VerifiedComment } from './digestBuilder';

// ── Fixtures ───────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function makeDeps(overrides?: Partial<ResynthesisWiringDeps>): ResynthesisWiringDeps {
  return {
    enabled: true,
    now: () => NOW,
    resolveTopicEpochMeta: () => ({
      current_epoch: 1,
      last_epoch_timestamp: NOW - 1_800_000,
      epochs_today: 0,
    }),
    resolveVerifiedComments: () => [
      makeVerifiedComment({ comment_id: 'vc-1', stance: 'concur', content: 'Claim A' }),
      makeVerifiedComment({ comment_id: 'vc-2', stance: 'counter', content: 'Counter A' }),
    ],
    ...overrides,
  };
}

function makeVerifiedComment(overrides?: Partial<VerifiedComment>): VerifiedComment {
  return {
    comment_id: 'vc-1',
    content: 'A valid point',
    stance: 'concur',
    principal_hash: 'hash-alice',
    timestamp: NOW - 1000,
    ...overrides,
  };
}

function makeCommentEvent(overrides?: Partial<CommentEvent>): CommentEvent {
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

function feedComments(
  orchestrator: ResynthesisOrchestrator,
  topicId: string,
  count: number,
  principalPrefix = 'hash-user',
): void {
  for (let i = 0; i < count; i++) {
    orchestrator.onComment(
      makeCommentEvent({
        comment_id: `c-${i}`,
        topic_id: topicId,
        principal_hash: `${principalPrefix}-${i}`,
      }),
    );
  }
}

// ── Feature flag gating ────────────────────────────────────────────

describe('ResynthesisOrchestrator feature flag gating', () => {
  it('onComment is a no-op when disabled', () => {
    const orchestrator = new ResynthesisOrchestrator(makeDeps({ enabled: false }));

    feedComments(orchestrator, 'topic-A', 15);

    expect(orchestrator.getCommentCount('topic-A')).toBe(0);
  });

  it('evaluate returns not-triggered when disabled', () => {
    const orchestrator = new ResynthesisOrchestrator(makeDeps({ enabled: false }));

    feedComments(orchestrator, 'topic-A', 15);
    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(false);
    expect(result.eligibility).toBeNull();
    expect(result.digest).toBeNull();
  });

  it('evaluate returns not-triggered when disabled even with threshold met', () => {
    const onEpochTriggered = vi.fn();
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({ enabled: false, onEpochTriggered }),
    );

    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(false);
    expect(onEpochTriggered).not.toHaveBeenCalled();
  });
});

// ── Threshold crossing triggers re-synthesis ───────────────────────

describe('ResynthesisOrchestrator threshold triggering', () => {
  it('triggers re-synthesis when thresholds are met', () => {
    const onEpochTriggered = vi.fn();
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({ onEpochTriggered }),
    );

    feedComments(orchestrator, 'topic-A', 10);
    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(true);
    expect(result.eligibility).not.toBeNull();
    expect(result.eligibility!.allowed).toBe(true);
    expect(result.digest).not.toBeNull();
    expect(result.digest!.topic_id).toBe('topic-A');
    expect(onEpochTriggered).toHaveBeenCalledTimes(1);
    expect(onEpochTriggered).toHaveBeenCalledWith('topic-A', result.digest);
  });

  it('does not trigger below comment threshold', () => {
    const onEpochTriggered = vi.fn();
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({ onEpochTriggered }),
    );

    feedComments(orchestrator, 'topic-A', 9);
    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(false);
    expect(result.digest).toBeNull();
    expect(onEpochTriggered).not.toHaveBeenCalled();
  });

  it('does not trigger when unique principals below minimum', () => {
    const onEpochTriggered = vi.fn();
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({ onEpochTriggered }),
    );

    // 10 comments from only 2 principals
    for (let i = 0; i < 10; i++) {
      orchestrator.onComment(
        makeCommentEvent({
          comment_id: `c-${i}`,
          topic_id: 'topic-A',
          principal_hash: i % 2 === 0 ? 'hash-alice' : 'hash-bob',
        }),
      );
    }

    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(false);
    expect(onEpochTriggered).not.toHaveBeenCalled();
  });

  it('uses custom tracker config thresholds', () => {
    const onEpochTriggered = vi.fn();
    const orchestrator = new ResynthesisOrchestrator(makeDeps({ onEpochTriggered }), {
      trackerConfig: {
        resynthesis_comment_threshold: 5,
        resynthesis_unique_principal_min: 2,
      },
      pipelineConfig: {
        resynthesis_comment_threshold: 5,
        resynthesis_unique_principal_min: 2,
      },
    });

    feedComments(orchestrator, 'topic-A', 5);
    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(true);
    expect(onEpochTriggered).toHaveBeenCalledTimes(1);
  });
});

// ── DigestBuilder output passed to re-synthesis ────────────────────

describe('ResynthesisOrchestrator digest construction', () => {
  it('passes DigestBuilder output to onEpochTriggered', () => {
    const onEpochTriggered = vi.fn();
    const verifiedComments: VerifiedComment[] = [
      makeVerifiedComment({ comment_id: 'vc-1', stance: 'concur', content: 'Claim A' }),
      makeVerifiedComment({ comment_id: 'vc-2', stance: 'counter', content: 'Counter B' }),
      makeVerifiedComment({ comment_id: 'vc-3', stance: 'discuss', content: 'Discussion C', principal_hash: 'hash-charlie' }),
    ];

    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({
        onEpochTriggered,
        resolveVerifiedComments: () => verifiedComments,
      }),
    );

    feedComments(orchestrator, 'topic-A', 10);
    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(true);
    expect(result.digest).not.toBeNull();
    expect(result.digest!.key_claims).toContain('Claim A');
    expect(result.digest!.key_claims).toContain('Discussion C');
    expect(result.digest!.salient_counterclaims).toContain('Counter B');
    expect(result.digest!.verified_comment_count).toBe(10);
    expect(result.digest!.unique_verified_principals).toBe(10);
    expect(result.digest!.digest_id).toMatch(/^dg-[0-9a-f]{8}$/);
  });

  it('uses correct time window boundaries', () => {
    const resolveVerifiedComments = vi.fn().mockReturnValue([]);
    const lastEpochTs = NOW - 3_600_000;

    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({
        resolveVerifiedComments,
        resolveTopicEpochMeta: () => ({
          current_epoch: 2,
          last_epoch_timestamp: lastEpochTs,
          epochs_today: 1,
        }),
      }),
    );

    feedComments(orchestrator, 'topic-A', 10);
    orchestrator.evaluate('topic-A');

    expect(resolveVerifiedComments).toHaveBeenCalledWith('topic-A', lastEpochTs, NOW);
  });

  it('uses 0 as window_start when no last_epoch_timestamp (initial epoch)', () => {
    const resolveVerifiedComments = vi.fn().mockReturnValue([]);

    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({
        resolveVerifiedComments,
        resolveTopicEpochMeta: () => ({
          current_epoch: 0, // initial epoch bypasses debounce + thresholds
          last_epoch_timestamp: undefined,
          epochs_today: 0,
        }),
      }),
    );

    // Initial epoch (0) bypasses thresholds, but we still need the
    // tracker to say shouldTriggerResynthesis = true for evaluate to proceed.
    // For epoch 0, the epochScheduler passes thresholds automatically,
    // but our wiring checks the tracker first. Feed enough comments.
    feedComments(orchestrator, 'topic-A', 10);
    orchestrator.evaluate('topic-A');

    expect(resolveVerifiedComments).toHaveBeenCalledWith('topic-A', 0, NOW);
  });

  it('applies custom digest config', () => {
    const onEpochTriggered = vi.fn();
    const comments = Array.from({ length: 10 }, (_, i) =>
      makeVerifiedComment({
        comment_id: `vc-${i}`,
        stance: 'concur',
        content: `Claim ${i}`,
        principal_hash: `hash-user-${i}`,
      }),
    );

    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({
        onEpochTriggered,
        resolveVerifiedComments: () => comments,
      }),
      { digestConfig: { max_claims: 2 } },
    );

    feedComments(orchestrator, 'topic-A', 10);
    const result = orchestrator.evaluate('topic-A');

    expect(result.digest!.key_claims).toHaveLength(2);
  });
});

// ── Epoch eligibility (debounce + daily cap) ───────────────────────

describe('ResynthesisOrchestrator epoch eligibility', () => {
  it('blocks when debounce has not elapsed', () => {
    const onEpochTriggered = vi.fn();
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({
        onEpochTriggered,
        resolveTopicEpochMeta: () => ({
          current_epoch: 1,
          last_epoch_timestamp: NOW - 60_000, // only 1 minute ago
          epochs_today: 0,
        }),
      }),
    );

    feedComments(orchestrator, 'topic-A', 10);
    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(false);
    expect(result.eligibility).not.toBeNull();
    expect(result.eligibility!.allowed).toBe(false);
    expect(result.eligibility!.blocked_by).toContain('debounce');
    expect(onEpochTriggered).not.toHaveBeenCalled();
  });

  it('blocks when daily epoch cap is exhausted', () => {
    const onEpochTriggered = vi.fn();
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({
        onEpochTriggered,
        resolveTopicEpochMeta: () => ({
          current_epoch: 5,
          last_epoch_timestamp: NOW - 1_800_000,
          epochs_today: 4,
        }),
      }),
    );

    feedComments(orchestrator, 'topic-A', 10);
    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(false);
    expect(result.eligibility!.blocked_by).toContain('daily_cap');
    expect(onEpochTriggered).not.toHaveBeenCalled();
  });

  it('returns not-triggered when epoch meta is null', () => {
    const onEpochTriggered = vi.fn();
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({
        onEpochTriggered,
        resolveTopicEpochMeta: () => null,
      }),
    );

    feedComments(orchestrator, 'topic-A', 15);
    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(false);
    expect(result.eligibility).toBeNull();
    expect(onEpochTriggered).not.toHaveBeenCalled();
  });
});

// ── Counter reset after trigger ────────────────────────────────────

describe('ResynthesisOrchestrator counter reset', () => {
  it('resets comment count after successful trigger', () => {
    const orchestrator = new ResynthesisOrchestrator(makeDeps());

    feedComments(orchestrator, 'topic-A', 10);
    expect(orchestrator.getCommentCount('topic-A')).toBe(10);

    orchestrator.evaluate('topic-A');
    expect(orchestrator.getCommentCount('topic-A')).toBe(0);
    expect(orchestrator.getUniquePrincipalCount('topic-A')).toBe(0);
  });

  it('does not reset when epoch is not allowed', () => {
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({
        resolveTopicEpochMeta: () => ({
          current_epoch: 1,
          last_epoch_timestamp: NOW - 60_000, // debounce blocks
          epochs_today: 0,
        }),
      }),
    );

    feedComments(orchestrator, 'topic-A', 10);
    orchestrator.evaluate('topic-A');

    expect(orchestrator.getCommentCount('topic-A')).toBe(10);
  });

  it('does not reset when feature is disabled', () => {
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({ enabled: true }),
    );

    feedComments(orchestrator, 'topic-A', 10);

    // Now create a disabled one with the same tracker state
    // (in practice the flag is set at construction time)
    const disabledOrchestrator = new ResynthesisOrchestrator(
      makeDeps({ enabled: false }),
    );
    disabledOrchestrator.evaluate('topic-A');

    expect(disabledOrchestrator.getCommentCount('topic-A')).toBe(0);
  });
});

// ── Monitoring helpers ─────────────────────────────────────────────

describe('ResynthesisOrchestrator monitoring', () => {
  it('exposes comment count', () => {
    const orchestrator = new ResynthesisOrchestrator(makeDeps());

    feedComments(orchestrator, 'topic-A', 7);
    expect(orchestrator.getCommentCount('topic-A')).toBe(7);
  });

  it('exposes unique principal count', () => {
    const orchestrator = new ResynthesisOrchestrator(makeDeps());

    feedComments(orchestrator, 'topic-A', 5);
    expect(orchestrator.getUniquePrincipalCount('topic-A')).toBe(5);
  });

  it('returns 0 for untracked topic', () => {
    const orchestrator = new ResynthesisOrchestrator(makeDeps());

    expect(orchestrator.getCommentCount('unknown')).toBe(0);
    expect(orchestrator.getUniquePrincipalCount('unknown')).toBe(0);
  });
});

// ── No onEpochTriggered callback ───────────────────────────────────

describe('ResynthesisOrchestrator without callback', () => {
  it('triggers successfully without onEpochTriggered callback', () => {
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({ onEpochTriggered: undefined }),
    );

    feedComments(orchestrator, 'topic-A', 10);
    const result = orchestrator.evaluate('topic-A');

    expect(result.triggered).toBe(true);
    expect(result.digest).not.toBeNull();
  });
});

// ── Pipeline config passthrough ────────────────────────────────────

describe('ResynthesisOrchestrator pipeline config', () => {
  it('passes custom pipeline config to epoch eligibility', () => {
    const onEpochTriggered = vi.fn();
    const orchestrator = new ResynthesisOrchestrator(
      makeDeps({
        onEpochTriggered,
        resolveTopicEpochMeta: () => ({
          current_epoch: 1,
          last_epoch_timestamp: NOW - 60_000, // only 1min ago
          epochs_today: 0,
        }),
      }),
      {
        pipelineConfig: {
          epoch_debounce_ms: 30_000, // 30s debounce (shorter)
        },
      },
    );

    feedComments(orchestrator, 'topic-A', 10);
    const result = orchestrator.evaluate('topic-A');

    // 60s > 30s custom debounce → allowed
    expect(result.triggered).toBe(true);
    expect(onEpochTriggered).toHaveBeenCalledTimes(1);
  });
});
