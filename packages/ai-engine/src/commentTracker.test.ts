import { describe, expect, it } from 'vitest';
import {
  CommentTracker,
  CommentEventSchema,
  CommentTrackerConfigSchema,
  type CommentEvent,
} from './commentTracker';

// ── Fixtures ───────────────────────────────────────────────────────

function makeEvent(overrides?: Partial<CommentEvent>): CommentEvent {
  return {
    comment_id: 'comment-1',
    topic_id: 'topic-A',
    principal_hash: 'hash-alice',
    verified: true,
    kind: 'add',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function addComments(
  tracker: CommentTracker,
  topicId: string,
  count: number,
  principalPrefix = 'hash-user',
  startId = 1,
): void {
  for (let i = 0; i < count; i++) {
    tracker.onComment(
      makeEvent({
        comment_id: `c-${startId + i}`,
        topic_id: topicId,
        principal_hash: `${principalPrefix}-${i}`,
      }),
    );
  }
}

// ── Schema tests ───────────────────────────────────────────────────

describe('CommentEventSchema', () => {
  it('accepts valid add event', () => {
    expect(CommentEventSchema.safeParse(makeEvent()).success).toBe(true);
  });

  it('accepts valid retract event', () => {
    expect(
      CommentEventSchema.safeParse(makeEvent({ kind: 'retract' })).success,
    ).toBe(true);
  });

  it('rejects empty comment_id', () => {
    expect(
      CommentEventSchema.safeParse(makeEvent({ comment_id: '' })).success,
    ).toBe(false);
  });

  it('rejects empty topic_id', () => {
    expect(
      CommentEventSchema.safeParse(makeEvent({ topic_id: '' })).success,
    ).toBe(false);
  });

  it('rejects empty principal_hash', () => {
    expect(
      CommentEventSchema.safeParse(makeEvent({ principal_hash: '' })).success,
    ).toBe(false);
  });

  it('rejects invalid kind', () => {
    expect(
      CommentEventSchema.safeParse(makeEvent({ kind: 'update' as 'add' })).success,
    ).toBe(false);
  });

  it('rejects negative timestamp', () => {
    expect(
      CommentEventSchema.safeParse(makeEvent({ timestamp: -1 })).success,
    ).toBe(false);
  });
});

describe('CommentTrackerConfigSchema', () => {
  it('applies defaults when empty', () => {
    const config = CommentTrackerConfigSchema.parse({});
    expect(config.resynthesis_comment_threshold).toBe(10);
    expect(config.resynthesis_unique_principal_min).toBe(3);
  });

  it('accepts custom thresholds', () => {
    const config = CommentTrackerConfigSchema.parse({
      resynthesis_comment_threshold: 5,
      resynthesis_unique_principal_min: 2,
    });
    expect(config.resynthesis_comment_threshold).toBe(5);
    expect(config.resynthesis_unique_principal_min).toBe(2);
  });

  it('rejects non-positive threshold', () => {
    expect(
      CommentTrackerConfigSchema.safeParse({
        resynthesis_comment_threshold: 0,
      }).success,
    ).toBe(false);
  });
});

// ── Threshold logic ────────────────────────────────────────────────

describe('CommentTracker threshold logic', () => {
  it('returns false when no comments tracked', () => {
    const tracker = new CommentTracker();
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(false);
  });

  it('returns false when comment count below threshold', () => {
    const tracker = new CommentTracker();
    addComments(tracker, 'topic-A', 9);
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(false);
  });

  it('returns false when unique principals below threshold', () => {
    const tracker = new CommentTracker();
    // 10 comments from only 2 principals
    for (let i = 0; i < 10; i++) {
      tracker.onComment(
        makeEvent({
          comment_id: `c-${i}`,
          topic_id: 'topic-A',
          principal_hash: i % 2 === 0 ? 'hash-alice' : 'hash-bob',
        }),
      );
    }
    expect(tracker.getCommentCount('topic-A')).toBe(10);
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(2);
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(false);
  });

  it('returns true at exactly 10 comments and 3 principals', () => {
    const tracker = new CommentTracker();
    // 10 comments from exactly 3 principals
    for (let i = 0; i < 10; i++) {
      tracker.onComment(
        makeEvent({
          comment_id: `c-${i}`,
          topic_id: 'topic-A',
          principal_hash: `hash-user-${i % 3}`,
        }),
      );
    }
    expect(tracker.getCommentCount('topic-A')).toBe(10);
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(3);
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(true);
  });

  it('returns true above thresholds', () => {
    const tracker = new CommentTracker();
    addComments(tracker, 'topic-A', 15);
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(true);
  });

  it('uses custom config thresholds', () => {
    const tracker = new CommentTracker({
      resynthesis_comment_threshold: 5,
      resynthesis_unique_principal_min: 2,
    });
    addComments(tracker, 'topic-A', 5, 'hash-user', 1);
    // 5 comments from 5 principals → passes custom threshold
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(true);
  });
});

// ── Counter reset on epoch ack ─────────────────────────────────────

describe('CommentTracker epoch acknowledgment', () => {
  it('resets counters for topic on acknowledgeEpoch', () => {
    const tracker = new CommentTracker();
    addComments(tracker, 'topic-A', 15);
    expect(tracker.getCommentCount('topic-A')).toBe(15);
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(true);

    tracker.acknowledgeEpoch('topic-A');
    expect(tracker.getCommentCount('topic-A')).toBe(0);
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(0);
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(false);
  });

  it('acknowledging non-existent topic is a no-op', () => {
    const tracker = new CommentTracker();
    tracker.acknowledgeEpoch('topic-nonexistent');
    expect(tracker.getCommentCount('topic-nonexistent')).toBe(0);
  });

  it('does not affect other topics on epoch ack', () => {
    const tracker = new CommentTracker();
    addComments(tracker, 'topic-A', 12);
    addComments(tracker, 'topic-B', 11, 'hash-b-user');

    tracker.acknowledgeEpoch('topic-A');

    expect(tracker.getCommentCount('topic-A')).toBe(0);
    expect(tracker.getCommentCount('topic-B')).toBe(11);
  });
});

// ── Dedupe / replay idempotency ────────────────────────────────────

describe('CommentTracker dedupe and idempotency', () => {
  it('ignores duplicate add for same comment_id', () => {
    const tracker = new CommentTracker();
    const event = makeEvent({ comment_id: 'dup-1' });

    tracker.onComment(event);
    tracker.onComment(event); // duplicate

    expect(tracker.getCommentCount('topic-A')).toBe(1);
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(1);
  });

  it('ignores duplicate retract for same comment_id', () => {
    const tracker = new CommentTracker();
    tracker.onComment(makeEvent({ comment_id: 'r-1' }));
    tracker.onComment(makeEvent({ comment_id: 'r-1', kind: 'retract' }));
    tracker.onComment(makeEvent({ comment_id: 'r-1', kind: 'retract' })); // duplicate retract

    expect(tracker.getCommentCount('topic-A')).toBe(0);
  });

  it('retract of never-added comment is no-op', () => {
    const tracker = new CommentTracker();
    tracker.onComment(makeEvent({ comment_id: 'ghost', kind: 'retract' }));
    expect(tracker.getCommentCount('topic-A')).toBe(0);
  });
});

// ── Edit/delete/unverify handling ──────────────────────────────────

describe('CommentTracker retraction handling', () => {
  it('decrements count on retract after add', () => {
    const tracker = new CommentTracker();
    tracker.onComment(makeEvent({ comment_id: 'c-1' }));
    tracker.onComment(makeEvent({ comment_id: 'c-2' }));
    expect(tracker.getCommentCount('topic-A')).toBe(2);

    tracker.onComment(makeEvent({ comment_id: 'c-1', kind: 'retract' }));
    expect(tracker.getCommentCount('topic-A')).toBe(1);
  });

  it('removes principal when their only comment is retracted', () => {
    const tracker = new CommentTracker();
    tracker.onComment(makeEvent({ comment_id: 'c-1', principal_hash: 'hash-alice' }));
    tracker.onComment(makeEvent({ comment_id: 'c-2', principal_hash: 'hash-bob' }));
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(2);

    tracker.onComment(
      makeEvent({ comment_id: 'c-1', principal_hash: 'hash-alice', kind: 'retract' }),
    );
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(1);
  });

  it('keeps principal when they have remaining comments after retract', () => {
    const tracker = new CommentTracker();
    tracker.onComment(makeEvent({ comment_id: 'c-1', principal_hash: 'hash-alice' }));
    tracker.onComment(makeEvent({ comment_id: 'c-2', principal_hash: 'hash-alice' }));
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(1);

    tracker.onComment(
      makeEvent({ comment_id: 'c-1', principal_hash: 'hash-alice', kind: 'retract' }),
    );
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(1);
    expect(tracker.getCommentCount('topic-A')).toBe(1);
  });

  it('retraction can drop below threshold', () => {
    const tracker = new CommentTracker();
    // Add exactly 10 comments from 3 principals
    for (let i = 0; i < 10; i++) {
      tracker.onComment(
        makeEvent({
          comment_id: `c-${i}`,
          principal_hash: `hash-user-${i % 3}`,
        }),
      );
    }
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(true);

    // Retract one comment → drops below 10
    tracker.onComment(makeEvent({ comment_id: 'c-0', principal_hash: 'hash-user-0', kind: 'retract' }));
    expect(tracker.getCommentCount('topic-A')).toBe(9);
    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(false);
  });
});

// ── Per-topic isolation ────────────────────────────────────────────

describe('CommentTracker per-topic isolation', () => {
  it('topic A counts do not affect topic B', () => {
    const tracker = new CommentTracker();
    addComments(tracker, 'topic-A', 15);
    expect(tracker.getCommentCount('topic-A')).toBe(15);
    expect(tracker.getCommentCount('topic-B')).toBe(0);
    expect(tracker.shouldTriggerResynthesis('topic-B')).toBe(false);
  });

  it('both topics can independently reach threshold', () => {
    const tracker = new CommentTracker();
    addComments(tracker, 'topic-A', 10, 'hash-a');
    addComments(tracker, 'topic-B', 10, 'hash-b');

    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(true);
    expect(tracker.shouldTriggerResynthesis('topic-B')).toBe(true);
  });

  it('epoch ack on one topic does not affect another', () => {
    const tracker = new CommentTracker();
    addComments(tracker, 'topic-A', 12);
    addComments(tracker, 'topic-B', 12, 'hash-b');

    tracker.acknowledgeEpoch('topic-A');

    expect(tracker.shouldTriggerResynthesis('topic-A')).toBe(false);
    expect(tracker.shouldTriggerResynthesis('topic-B')).toBe(true);
  });
});

// ── Privacy: no raw principal identifiers ──────────────────────────

describe('CommentTracker privacy', () => {
  it('only stores hashed principal identifiers (schema enforces non-empty)', () => {
    // The schema requires principal_hash, not raw identifiers.
    // This test verifies the schema-level contract.
    const validEvent = makeEvent({ principal_hash: 'sha256-abc123' });
    expect(CommentEventSchema.safeParse(validEvent).success).toBe(true);

    // Ensure the field is named 'principal_hash' not 'principal' or 'author'
    const withRawPrincipal = { ...makeEvent(), principal: 'raw-alice' };
    delete (withRawPrincipal as Record<string, unknown>)['principal_hash'];
    expect(CommentEventSchema.safeParse(withRawPrincipal).success).toBe(false);
  });

  it('rejects events with empty principal_hash', () => {
    expect(
      CommentEventSchema.safeParse(makeEvent({ principal_hash: '' })).success,
    ).toBe(false);
  });
});

// ── Unverified comments ignored ────────────────────────────────────

describe('CommentTracker unverified handling', () => {
  it('ignores unverified add events', () => {
    const tracker = new CommentTracker();
    tracker.onComment(makeEvent({ verified: false }));
    expect(tracker.getCommentCount('topic-A')).toBe(0);
  });

  it('processes retract even when verified=false (unverify case)', () => {
    const tracker = new CommentTracker();
    tracker.onComment(makeEvent({ comment_id: 'c-1', verified: true }));
    expect(tracker.getCommentCount('topic-A')).toBe(1);

    // Retract with verified: false (unverification event)
    tracker.onComment(makeEvent({ comment_id: 'c-1', verified: false, kind: 'retract' }));
    expect(tracker.getCommentCount('topic-A')).toBe(0);
  });
});

// ── Schema validation on invalid input ─────────────────────────────

describe('CommentTracker onComment validation', () => {
  it('throws on invalid event input', () => {
    const tracker = new CommentTracker();
    expect(() =>
      tracker.onComment({ comment_id: '', topic_id: 'x', principal_hash: 'y', verified: true, kind: 'add', timestamp: 0 }),
    ).toThrow();
  });
});
