import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCommentCountTracker,
  type CommentCountTracker,
} from './commentCounts';

// ── Basic tracking ─────────────────────────────────────────────────

describe('createCommentCountTracker basic tracking', () => {
  let tracker: CommentCountTracker;

  beforeEach(() => {
    tracker = createCommentCountTracker({ enabled: true });
  });

  it('starts with zero count for unknown topic', () => {
    expect(tracker.getCount('topic-A')).toBe(0);
  });

  it('increments count on recordComment', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    expect(tracker.getCount('topic-A')).toBe(1);
  });

  it('tracks multiple comments', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-2', 'hash-bob');
    tracker.recordComment('topic-A', 'c-3', 'hash-charlie');
    expect(tracker.getCount('topic-A')).toBe(3);
  });

  it('is idempotent for duplicate comment IDs', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    expect(tracker.getCount('topic-A')).toBe(1);
  });

  it('tracks topics independently', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-B', 'c-2', 'hash-bob');
    expect(tracker.getCount('topic-A')).toBe(1);
    expect(tracker.getCount('topic-B')).toBe(1);
  });
});

// ── Unique principal counting ──────────────────────────────────────

describe('createCommentCountTracker unique principals', () => {
  let tracker: CommentCountTracker;

  beforeEach(() => {
    tracker = createCommentCountTracker({ enabled: true });
  });

  it('starts with zero unique principals for unknown topic', () => {
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(0);
  });

  it('counts unique principals', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-2', 'hash-bob');
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(2);
  });

  it('does not double-count same principal with multiple comments', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-2', 'hash-alice');
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(1);
    expect(tracker.getCount('topic-A')).toBe(2);
  });
});

// ── Comment removal ────────────────────────────────────────────────

describe('createCommentCountTracker removal', () => {
  let tracker: CommentCountTracker;

  beforeEach(() => {
    tracker = createCommentCountTracker({ enabled: true });
  });

  it('decrements count on removeComment', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-2', 'hash-bob');
    tracker.removeComment('topic-A', 'c-1', 'hash-alice');
    expect(tracker.getCount('topic-A')).toBe(1);
  });

  it('removes principal when their only comment is removed', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-2', 'hash-bob');
    tracker.removeComment('topic-A', 'c-1', 'hash-alice');
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(1);
  });

  it('keeps principal when they have remaining comments', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-2', 'hash-alice');
    tracker.removeComment('topic-A', 'c-1', 'hash-alice');
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(1);
    expect(tracker.getCount('topic-A')).toBe(1);
  });

  it('is a no-op for untracked comment', () => {
    tracker.removeComment('topic-A', 'ghost', 'hash-alice');
    expect(tracker.getCount('topic-A')).toBe(0);
  });

  it('is a no-op for untracked topic', () => {
    tracker.removeComment('topic-unknown', 'c-1', 'hash-alice');
    expect(tracker.getCount('topic-unknown')).toBe(0);
  });
});

// ── Snapshot export ────────────────────────────────────────────────

describe('createCommentCountTracker snapshot', () => {
  let tracker: CommentCountTracker;

  beforeEach(() => {
    tracker = createCommentCountTracker({ enabled: true });
  });

  it('returns empty snapshot for unknown topic', () => {
    const snap = tracker.getSnapshot('topic-A');
    expect(snap).toEqual({
      topicId: 'topic-A',
      commentCount: 0,
      principalHashes: [],
    });
  });

  it('returns correct snapshot after recording', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-2', 'hash-bob');
    tracker.recordComment('topic-A', 'c-3', 'hash-alice');

    const snap = tracker.getSnapshot('topic-A');
    expect(snap.topicId).toBe('topic-A');
    expect(snap.commentCount).toBe(3);
    expect(snap.principalHashes).toHaveLength(2);
    expect(snap.principalHashes).toContain('hash-alice');
    expect(snap.principalHashes).toContain('hash-bob');
  });

  it('reflects removals in snapshot', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-2', 'hash-bob');
    tracker.removeComment('topic-A', 'c-1', 'hash-alice');

    const snap = tracker.getSnapshot('topic-A');
    expect(snap.commentCount).toBe(1);
    expect(snap.principalHashes).toEqual(['hash-bob']);
  });
});

// ── Topic reset ────────────────────────────────────────────────────

describe('createCommentCountTracker resetTopic', () => {
  let tracker: CommentCountTracker;

  beforeEach(() => {
    tracker = createCommentCountTracker({ enabled: true });
  });

  it('resets all counters for a topic', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-A', 'c-2', 'hash-bob');
    tracker.resetTopic('topic-A');

    expect(tracker.getCount('topic-A')).toBe(0);
    expect(tracker.getUniquePrincipalCount('topic-A')).toBe(0);
    expect(tracker.getSnapshot('topic-A')).toEqual({
      topicId: 'topic-A',
      commentCount: 0,
      principalHashes: [],
    });
  });

  it('does not affect other topics', () => {
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    tracker.recordComment('topic-B', 'c-2', 'hash-bob');
    tracker.resetTopic('topic-A');

    expect(tracker.getCount('topic-A')).toBe(0);
    expect(tracker.getCount('topic-B')).toBe(1);
  });

  it('is a no-op for unknown topic', () => {
    tracker.resetTopic('topic-unknown');
    expect(tracker.getCount('topic-unknown')).toBe(0);
  });
});

// ── Feature flag gating ────────────────────────────────────────────

describe('createCommentCountTracker feature flag', () => {
  it('recordComment is a no-op when disabled', () => {
    const tracker = createCommentCountTracker({ enabled: false });
    tracker.recordComment('topic-A', 'c-1', 'hash-alice');
    expect(tracker.getCount('topic-A')).toBe(0);
    expect(tracker.enabled).toBe(false);
  });

  it('removeComment is a no-op when disabled', () => {
    const tracker = createCommentCountTracker({ enabled: false });
    tracker.removeComment('topic-A', 'c-1', 'hash-alice');
    expect(tracker.getCount('topic-A')).toBe(0);
  });

  it('enabled flag is exposed', () => {
    const enabled = createCommentCountTracker({ enabled: true });
    const disabled = createCommentCountTracker({ enabled: false });
    expect(enabled.enabled).toBe(true);
    expect(disabled.enabled).toBe(false);
  });

  it('getCount and getSnapshot work even when disabled (return zeroes)', () => {
    const tracker = createCommentCountTracker({ enabled: false });
    expect(tracker.getCount('topic-A')).toBe(0);
    expect(tracker.getSnapshot('topic-A')).toEqual({
      topicId: 'topic-A',
      commentCount: 0,
      principalHashes: [],
    });
  });

  it('uses default feature flag when no override is provided', async () => {
    vi.stubEnv('VITE_TOPIC_SYNTHESIS_V2_ENABLED', 'false');
    vi.resetModules();

    const mod = await import('./commentCounts');
    const tracker = mod.createCommentCountTracker();
    expect(tracker.enabled).toBe(false);

    vi.unstubAllEnvs();
  });

  it('reads VITE_TOPIC_SYNTHESIS_V2_ENABLED=true from env', async () => {
    vi.stubEnv('VITE_TOPIC_SYNTHESIS_V2_ENABLED', 'true');
    vi.resetModules();

    const mod = await import('./commentCounts');
    const tracker = mod.createCommentCountTracker();
    expect(tracker.enabled).toBe(true);

    vi.unstubAllEnvs();
  });
});
