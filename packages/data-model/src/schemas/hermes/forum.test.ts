import { describe, expect, it } from 'vitest';
import {
  computeThreadScore,
  deriveTopicId,
  deriveUrlTopicId,
  ForumPostSchema,
  HermesCommentSchema,
  HermesCommentSchemaV0,
  HermesCommentSchemaV1,
  HermesCommentWriteSchema,
  HermesThreadSchema,
  ModerationEventSchema,
  migrateCommentToV1,
  ProposalExtensionSchema,
  REPLY_CONTENT_MAX,
  sha256Hex,
  THREAD_TOPIC_PREFIX
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

const baseProposal = {
  fundingRequest: '1000 RVU',
  recipient: '0xabc123',
  status: 'draft' as const,
  createdAt: now - 1_000,
  updatedAt: now
};

const baseCommentV0 = {
  id: 'comment-1',
  schemaVersion: 'hermes-comment-v0' as const,
  threadId: 'thread-1',
  parentId: null,
  content: 'Nice point',
  author: 'bob-nullifier',
  timestamp: now,
  type: 'reply' as const,
  upvotes: 1,
  downvotes: 0
};

const baseCommentV1 = {
  id: 'comment-v1',
  schemaVersion: 'hermes-comment-v1' as const,
  threadId: 'thread-1',
  parentId: null,
  content: 'Structured comment',
  author: 'carol-nullifier',
  timestamp: now,
  stance: 'concur' as const,
  upvotes: 0,
  downvotes: 0
};

describe('HermesThreadSchema', () => {
  it('accepts existing thread without new fields (backward compat)', () => {
    const parsed = HermesThreadSchema.parse(baseThread);
    expect(parsed.title).toBe('A civic conversation');
    expect(parsed.topicId).toBeUndefined();
  });

  it('accepts thread with topicId', () => {
    const parsed = HermesThreadSchema.parse({ ...baseThread, topicId: 'topic-1' });
    expect(parsed.topicId).toBe('topic-1');
  });

  it('accepts thread with sourceUrl', () => {
    const parsed = HermesThreadSchema.parse({ ...baseThread, sourceUrl: 'https://example.com/article' });
    expect(parsed.sourceUrl).toBe('https://example.com/article');
  });

  it('rejects thread with invalid sourceUrl', () => {
    const result = HermesThreadSchema.safeParse({ ...baseThread, sourceUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('accepts thread with urlHash', () => {
    const parsed = HermesThreadSchema.parse({ ...baseThread, urlHash: 'abc123' });
    expect(parsed.urlHash).toBe('abc123');
  });

  it('accepts thread with isHeadline true and false', () => {
    const headline = HermesThreadSchema.parse({ ...baseThread, isHeadline: true });
    const nonHeadline = HermesThreadSchema.parse({ ...baseThread, isHeadline: false });
    expect(headline.isHeadline).toBe(true);
    expect(nonHeadline.isHeadline).toBe(false);
  });

  it('accepts thread with proposal extension', () => {
    const parsed = HermesThreadSchema.parse({ ...baseThread, proposal: baseProposal });
    expect(parsed.proposal?.status).toBe('draft');
  });

  it('rejects thread with invalid proposal extension', () => {
    const result = HermesThreadSchema.safeParse({
      ...baseThread,
      proposal: {
        recipient: '0xabc123',
        status: 'draft',
        createdAt: now,
        updatedAt: now
      }
    });
    expect(result.success).toBe(false);
  });

  it('accepts thread with all new optional fields populated', () => {
    const parsed = HermesThreadSchema.parse({
      ...baseThread,
      topicId: 'topic-1',
      sourceUrl: 'https://example.com/article',
      urlHash: 'hash-1',
      isHeadline: true,
      proposal: {
        ...baseProposal,
        qfProjectId: 'qf-1',
        sourceTopicId: 'topic-parent',
        attestationProof: 'proof-1'
      }
    });
    expect(parsed).toMatchObject({
      topicId: 'topic-1',
      sourceUrl: 'https://example.com/article',
      urlHash: 'hash-1',
      isHeadline: true,
      proposal: {
        ...baseProposal,
        qfProjectId: 'qf-1',
        sourceTopicId: 'topic-parent',
        attestationProof: 'proof-1'
      }
    });
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

describe('ProposalExtensionSchema', () => {
  it('accepts valid proposal with required fields', () => {
    const parsed = ProposalExtensionSchema.parse(baseProposal);
    expect(parsed.status).toBe('draft');
  });

  it('accepts optional proposal fields', () => {
    const parsed = ProposalExtensionSchema.parse({
      ...baseProposal,
      qfProjectId: 'qf-123',
      sourceTopicId: 'topic-parent',
      attestationProof: 'proof-123'
    });
    expect(parsed.qfProjectId).toBe('qf-123');
    expect(parsed.sourceTopicId).toBe('topic-parent');
    expect(parsed.attestationProof).toBe('proof-123');
  });

  it('rejects missing required fields', () => {
    expect(ProposalExtensionSchema.safeParse({ ...baseProposal, fundingRequest: undefined }).success).toBe(false);
    expect(ProposalExtensionSchema.safeParse({ ...baseProposal, recipient: undefined }).success).toBe(false);
    expect(ProposalExtensionSchema.safeParse({ ...baseProposal, status: undefined }).success).toBe(false);
    expect(ProposalExtensionSchema.safeParse({ ...baseProposal, createdAt: undefined }).success).toBe(false);
    expect(ProposalExtensionSchema.safeParse({ ...baseProposal, updatedAt: undefined }).success).toBe(false);
  });

  it('rejects invalid status values', () => {
    const result = ProposalExtensionSchema.safeParse({ ...baseProposal, status: 'pending' });
    expect(result.success).toBe(false);
  });

  it('rejects empty optional fields when present', () => {
    expect(ProposalExtensionSchema.safeParse({ ...baseProposal, qfProjectId: '' }).success).toBe(false);
    expect(ProposalExtensionSchema.safeParse({ ...baseProposal, sourceTopicId: '' }).success).toBe(false);
    expect(ProposalExtensionSchema.safeParse({ ...baseProposal, attestationProof: '' }).success).toBe(false);
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
  it('accepts a v1 comment with stance', () => {
    const parsed = HermesCommentSchema.parse(baseCommentV1);
    expect(parsed.stance).toBe('concur');
  });

  it('accepts a v1 comment with discuss stance', () => {
    const parsed = HermesCommentSchema.parse({ ...baseCommentV1, stance: 'discuss' as const });
    expect(parsed.stance).toBe('discuss');
  });

  it('accepts a v0 reply without targetId', () => {
    const parsed = HermesCommentSchema.parse(baseCommentV0);
    expect(parsed.targetId).toBeUndefined();
  });

  it('requires targetId for v0 counterpoints', () => {
    const result = HermesCommentSchema.safeParse({ ...baseCommentV0, type: 'counterpoint' });
    expect(result.success).toBe(false);
  });

  it('rejects targetId on v0 replies', () => {
    const result = HermesCommentSchema.safeParse({ ...baseCommentV0, targetId: 'comment-2' });
    expect(result.success).toBe(false);
  });

  it('accepts a v0 counterpoint with targetId', () => {
    const parsed = HermesCommentSchema.parse({
      ...baseCommentV0,
      type: 'counterpoint',
      targetId: 'comment-2'
    });
    expect(parsed.type).toBe('counterpoint');
    expect(parsed.targetId).toBe('comment-2');
  });

  describe('V1 schema superRefine validations', () => {
    it('requires targetId for v1 comment with legacy type counterpoint', () => {
      const result = HermesCommentSchema.safeParse({
        ...baseCommentV1,
        stance: 'counter',
        type: 'counterpoint'
        // Missing targetId
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('targetId is required when legacy type is counterpoint');
      }
    });

    it('accepts v1 counterpoint with legacy type and targetId', () => {
      const result = HermesCommentSchema.safeParse({
        ...baseCommentV1,
        stance: 'counter',
        type: 'counterpoint',
        targetId: 'comment-target'
      });
      expect(result.success).toBe(true);
    });

    it('rejects targetId on v1 comment with legacy type reply', () => {
      const result = HermesCommentSchema.safeParse({
        ...baseCommentV1,
        stance: 'concur',
        type: 'reply',
        targetId: 'comment-2'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('targetId must be omitted for replies');
      }
    });

    it('accepts v1 reply with legacy type and no targetId', () => {
      const result = HermesCommentSchema.safeParse({
        ...baseCommentV1,
        stance: 'concur',
        type: 'reply'
      });
      expect(result.success).toBe(true);
    });

    it('warns when stance does not align with legacy type (concur vs counterpoint)', () => {
      const result = HermesCommentSchema.safeParse({
        ...baseCommentV1,
        stance: 'concur', // Should be 'counter' for counterpoint
        type: 'counterpoint',
        targetId: 'comment-target'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('stance should align with legacy type');
      }
    });

    it('warns when stance does not align with legacy type (counter vs reply)', () => {
      const result = HermesCommentSchema.safeParse({
        ...baseCommentV1,
        stance: 'counter', // Should be 'concur' for reply
        type: 'reply'
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('stance should align with legacy type');
      }
    });

    it('accepts v1 comment without legacy type (no validation conflict)', () => {
      const result = HermesCommentSchema.safeParse({
        ...baseCommentV1,
        stance: 'counter'
        // No type field
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('HermesCommentWriteSchema', () => {
  it('rejects legacy type on write payloads', () => {
    const result = HermesCommentWriteSchema.safeParse({ ...baseCommentV1, type: 'reply' });
    expect(result.success).toBe(false);
  });

  it('accepts canonical v1 payload', () => {
    const parsed = HermesCommentWriteSchema.parse(baseCommentV1);
    expect(parsed.stance).toBe('concur');
    expect((parsed as any).type).toBeUndefined();
  });

  it('accepts canonical v1 payload with discuss stance', () => {
    const parsed = HermesCommentWriteSchema.parse({ ...baseCommentV1, stance: 'discuss' as const });
    expect(parsed.stance).toBe('discuss');
    expect((parsed as any).type).toBeUndefined();
  });
});

describe('comment via field', () => {
  it('accepts v0 comments with and without via', () => {
    expect(HermesCommentSchemaV0.safeParse(baseCommentV0).success).toBe(true);
    expect(HermesCommentSchemaV0.safeParse({ ...baseCommentV0, via: 'human' }).success).toBe(true);
    expect(HermesCommentSchemaV0.safeParse({ ...baseCommentV0, via: 'familiar' }).success).toBe(true);
  });

  it('accepts v1 comments with and without via', () => {
    expect(HermesCommentSchemaV1.safeParse(baseCommentV1).success).toBe(true);
    expect(HermesCommentSchemaV1.safeParse({ ...baseCommentV1, via: 'human' }).success).toBe(true);
    expect(HermesCommentSchemaV1.safeParse({ ...baseCommentV1, via: 'familiar' }).success).toBe(true);
  });

  it('accepts write schema payloads with and without via', () => {
    expect(HermesCommentWriteSchema.safeParse(baseCommentV1).success).toBe(true);
    expect(HermesCommentWriteSchema.safeParse({ ...baseCommentV1, via: 'human' }).success).toBe(true);
  });

  it('rejects invalid via values', () => {
    expect(HermesCommentSchemaV1.safeParse({ ...baseCommentV1, via: 'bot' }).success).toBe(false);
    expect(HermesCommentWriteSchema.safeParse({ ...baseCommentV1, via: 'bot' }).success).toBe(false);
  });
});

describe('topic derivation', () => {
  it('exports THREAD_TOPIC_PREFIX', () => {
    expect(THREAD_TOPIC_PREFIX).toBe('thread:');
  });

  it('sha256Hex matches known vectors', async () => {
    await expect(sha256Hex('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    await expect(sha256Hex('hello')).resolves.toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('sha256Hex is deterministic', async () => {
    const first = await sha256Hex('deterministic-input');
    const second = await sha256Hex('deterministic-input');
    expect(first).toBe(second);
  });

  it('deriveTopicId is deterministic and uses prefixed input', async () => {
    const first = await deriveTopicId('thread-123');
    const second = await deriveTopicId('thread-123');
    const expected = await sha256Hex('thread:thread-123');
    expect(first).toBe(second);
    expect(first).toBe(expected);
  });

  it('deriveTopicId returns distinct values for different ids', async () => {
    const one = await deriveTopicId('abc');
    const two = await deriveTopicId('def');
    expect(one).not.toBe(two);
  });

  it('deriveUrlTopicId is deterministic and distinct from deriveTopicId path', async () => {
    const url = 'https://example.com/path?a=1';
    const first = await deriveUrlTopicId(url);
    const second = await deriveUrlTopicId(url);
    const expected = await sha256Hex(url);
    const threadDerived = await deriveTopicId(url);
    expect(first).toBe(second);
    expect(first).toBe(expected);
    expect(first).not.toBe(threadDerived);
  });

  it('deriveUrlTopicId handles unicode URLs', async () => {
    const unicodeUrl = 'https://example.com/naïve?emoji=🙂';
    const hash = await deriveUrlTopicId(unicodeUrl);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('migrateCommentToV1', () => {
  it('maps v0 reply to concur stance and strips type', () => {
    const migrated = migrateCommentToV1(baseCommentV0);
    expect(migrated.schemaVersion).toBe('hermes-comment-v1');
    expect(migrated.stance).toBe('concur');
    expect((migrated as any).type).toBeUndefined();
  });

  it('maps v0 counterpoint to counter stance and strips type', () => {
    const v0Counterpoint = {
      ...baseCommentV0,
      type: 'counterpoint' as const,
      targetId: 'comment-target'
    };
    const migrated = migrateCommentToV1(v0Counterpoint);
    expect(migrated.schemaVersion).toBe('hermes-comment-v1');
    expect(migrated.stance).toBe('counter');
    expect((migrated as any).type).toBeUndefined();
    expect(migrated.targetId).toBe('comment-target');
  });

  it('passes through v1 comments and removes legacy type', () => {
    const migrated = migrateCommentToV1({ ...baseCommentV1, type: 'reply' });
    expect(migrated).toMatchObject(baseCommentV1);
    expect((migrated as any).type).toBeUndefined();
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

// -- ForumPostSchema (§2.4) --

const baseReplyPost = {
  id: 'post-1',
  schemaVersion: 'hermes-post-v0' as const,
  threadId: 'thread-1',
  parentId: null,
  topicId: 'topic-1',
  author: 'alice-nullifier',
  type: 'reply' as const,
  content: 'A short reply',
  timestamp: now,
  upvotes: 0,
  downvotes: 0
};

const baseArticlePost = {
  ...baseReplyPost,
  id: 'post-2',
  type: 'article' as const,
  content: 'Full longform article content that can be much longer than a reply...',
  articleRefId: 'doc-article-1'
};

describe('ForumPostSchema', () => {
  it('exports REPLY_CONTENT_MAX constant', () => {
    expect(REPLY_CONTENT_MAX).toBe(240);
  });

  it('accepts a valid reply post', () => {
    const parsed = ForumPostSchema.parse(baseReplyPost);
    expect(parsed.type).toBe('reply');
    expect(parsed.articleRefId).toBeUndefined();
  });

  it('accepts a valid article post', () => {
    const parsed = ForumPostSchema.parse(baseArticlePost);
    expect(parsed.type).toBe('article');
    expect(parsed.articleRefId).toBe('doc-article-1');
  });

  it('accepts reply with via field', () => {
    const parsed = ForumPostSchema.parse({ ...baseReplyPost, via: 'human' });
    expect(parsed.via).toBe('human');
  });

  it('accepts reply with familiar via', () => {
    const parsed = ForumPostSchema.parse({ ...baseReplyPost, via: 'familiar' });
    expect(parsed.via).toBe('familiar');
  });

  it('rejects invalid via value', () => {
    expect(
      ForumPostSchema.safeParse({ ...baseReplyPost, via: 'bot' }).success
    ).toBe(false);
  });

  it('accepts reply at exactly 240 chars', () => {
    const result = ForumPostSchema.safeParse({
      ...baseReplyPost,
      content: 'a'.repeat(240)
    });
    expect(result.success).toBe(true);
  });

  it('rejects reply exceeding 240 chars', () => {
    const result = ForumPostSchema.safeParse({
      ...baseReplyPost,
      content: 'a'.repeat(241)
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const contentIssue = result.error.issues.find((i) => i.path.includes('content'));
      expect(contentIssue?.message).toContain('240');
    }
  });

  it('allows article content beyond 240 chars', () => {
    const result = ForumPostSchema.safeParse({
      ...baseArticlePost,
      content: 'a'.repeat(5000)
    });
    expect(result.success).toBe(true);
  });

  it('rejects article without articleRefId', () => {
    const { articleRefId: _ref, ...noRef } = baseArticlePost;
    const result = ForumPostSchema.safeParse(noRef);
    expect(result.success).toBe(false);
    if (!result.success) {
      const refIssue = result.error.issues.find((i) => i.path.includes('articleRefId'));
      expect(refIssue?.message).toContain('articleRefId is required');
    }
  });

  it('rejects reply with articleRefId', () => {
    const result = ForumPostSchema.safeParse({
      ...baseReplyPost,
      articleRefId: 'should-not-be-here'
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const refIssue = result.error.issues.find((i) => i.path.includes('articleRefId'));
      expect(refIssue?.message).toContain('articleRefId must be omitted');
    }
  });

  it('accepts non-null parentId', () => {
    const parsed = ForumPostSchema.parse({ ...baseReplyPost, parentId: 'post-parent' });
    expect(parsed.parentId).toBe('post-parent');
  });

  it('rejects missing required fields', () => {
    const { topicId: _t, ...noTopic } = baseReplyPost;
    expect(ForumPostSchema.safeParse(noTopic).success).toBe(false);

    const { threadId: _th, ...noThread } = baseReplyPost;
    expect(ForumPostSchema.safeParse(noThread).success).toBe(false);

    const { author: _a, ...noAuthor } = baseReplyPost;
    expect(ForumPostSchema.safeParse(noAuthor).success).toBe(false);
  });

  it('rejects empty content', () => {
    expect(
      ForumPostSchema.safeParse({ ...baseReplyPost, content: '' }).success
    ).toBe(false);
  });

  it('rejects invalid type', () => {
    expect(
      ForumPostSchema.safeParse({ ...baseReplyPost, type: 'comment' }).success
    ).toBe(false);
  });

  it('rejects invalid schemaVersion', () => {
    expect(
      ForumPostSchema.safeParse({ ...baseReplyPost, schemaVersion: 'hermes-post-v1' }).success
    ).toBe(false);
  });

  it('rejects negative timestamps', () => {
    expect(
      ForumPostSchema.safeParse({ ...baseReplyPost, timestamp: -1 }).success
    ).toBe(false);
  });

  it('rejects negative vote counts', () => {
    expect(
      ForumPostSchema.safeParse({ ...baseReplyPost, upvotes: -1 }).success
    ).toBe(false);
    expect(
      ForumPostSchema.safeParse({ ...baseReplyPost, downvotes: -1 }).success
    ).toBe(false);
  });
});
