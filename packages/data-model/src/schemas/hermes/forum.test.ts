import { describe, expect, it } from 'vitest';
import {
  HermesCommentSchema,
  HermesThreadSchema,
  ModerationEventSchema,
  computeThreadScore
} from './forum';

const now = Date.now();

const baseThread = {
  id: 'thread-1',
  schemaVersion: 'hermes-thread-v0',
  title: 'A civic conversation',
  content: 'Markdown content',
  author: 'alice-nullifier',
  timestamp: now - 1_000,
  tags: ['infrastructure'],
  upvotes: 10,
  downvotes: 2,
  score: 0
};

describe('HermesThreadSchema', () => {
  it('accepts a valid thread', () => {
    const parsed = HermesThreadSchema.parse(baseThread);
    expect(parsed.title).toBe('A civic conversation');
  });

  it('rejects title over 200 chars', () => {
    const result = HermesThreadSchema.safeParse({
      ...baseThread,
      title: 'a'.repeat(201)
    });
    expect(result.success).toBe(false);
  });

  it('rejects content over 10k chars', () => {
    expect(() =>
      HermesThreadSchema.parse({
        ...baseThread,
        content: 'b'.repeat(10_001)
      })
    ).toThrow();
  });
});

describe('computeThreadScore', () => {
  it('decays score for older threads', () => {
    const freshScore = computeThreadScore(
      {
        ...baseThread,
        timestamp: now,
        score: 0
      },
      now
    );
    const oldScore = computeThreadScore(
      {
        ...baseThread,
        timestamp: now - 72 * 3_600_000,
        score: 0
      },
      now
    );

    expect(oldScore).toBeLessThan(freshScore);
  });
});

describe('HermesCommentSchema', () => {
  it('accepts a reply without targetId', () => {
    const parsed = HermesCommentSchema.parse({
      id: 'comment-1',
      schemaVersion: 'hermes-comment-v0',
      threadId: 'thread-1',
      parentId: null,
      content: 'Nice point',
      author: 'bob-nullifier',
      timestamp: now,
      type: 'reply',
      upvotes: 1,
      downvotes: 0
    });
    expect(parsed.targetId).toBeUndefined();
  });

  it('requires targetId for counterpoints', () => {
    const result = HermesCommentSchema.safeParse({
      id: 'comment-2',
      schemaVersion: 'hermes-comment-v0',
      threadId: 'thread-1',
      parentId: null,
      content: 'A counter argument',
      author: 'bob-nullifier',
      timestamp: now,
      type: 'counterpoint',
      upvotes: 0,
      downvotes: 0
    });
    expect(result.success).toBe(false);
  });

  it('rejects targetId on replies', () => {
    const result = HermesCommentSchema.safeParse({
      id: 'comment-3',
      schemaVersion: 'hermes-comment-v0',
      threadId: 'thread-1',
      parentId: null,
      content: 'Reply with target',
      author: 'bob-nullifier',
      timestamp: now,
      type: 'reply',
      targetId: 'comment-2',
      upvotes: 0,
      downvotes: 0
    });
    expect(result.success).toBe(false);
  });
});

describe('ModerationEventSchema', () => {
  it('validates a moderation event', () => {
    const parsed = ModerationEventSchema.parse({
      id: 'mod-1',
      targetId: 'thread-1',
      action: 'hide',
      moderator: 'council-key',
      reason: 'inappropriate content',
      timestamp: now,
      signature: 'signed-moderation'
    });
    expect(parsed.action).toBe('hide');
  });

  it('rejects an invalid action', () => {
    const result = ModerationEventSchema.safeParse({
      id: 'mod-2',
      targetId: 'thread-1',
      action: 'flag',
      moderator: 'council-key',
      reason: 'spam',
      timestamp: now,
      signature: 'signed-moderation'
    });
    expect(result.success).toBe(false);
  });
});
