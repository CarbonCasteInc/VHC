import { describe, expect, it, vi } from 'vitest';
import {
  computeThreadScore,
  deriveTopicId,
  deriveUrlTopicId,
  FORUM_AUTHOR_SCHEME,
  FORUM_COMMENT_AUDIENCE,
  FORUM_POST_AUDIENCE,
  FORUM_PUBLIC_PROTOCOL_VERSION,
  FORUM_THREAD_AUDIENCE,
  FORUM_WRITER_KIND,
  ForumPostSchema,
  ForumPostSchemaV1,
  forumCommentSignedPayload,
  forumPostSignedPayload,
  forumThreadSignedPayload,
  HermesCommentModerationSchema,
  HermesCommentSchema,
  HermesCommentSchemaV0,
  HermesCommentSchemaV1,
  HermesCommentSchemaV2,
  HermesCommentWriteSchema,
  HermesThreadSchema,
  HermesThreadSchemaV1,
  ModerationEventSchema,
  migrateCommentToV1,
  ProposalExtensionSchema,
  REPLY_CONTENT_MAX,
  sha256Hex,
  THREAD_TOPIC_PREFIX
} from './forum';

const now = Date.now();
const FORUM_AUTHOR_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_FORUM_AUTHOR_ID = 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const HEX_32 = '00112233445566778899aabbccddeeff';
const HEX_64 = 'a'.repeat(64);

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

function signedThreadEnvelope(payload = forumThreadSignedPayload(baseThreadV1())) {
  return {
    envelopeVersion: 1,
    signatureSuite: 'jcs-ed25519-sha256-v1',
    protocolVersion: 'luma-write-v1',
    profile: 'public-beta',
    audience: FORUM_THREAD_AUDIENCE,
    origin: 'https://vh.example',
    scheme: FORUM_AUTHOR_SCHEME,
    publicAuthor: payload.author,
    sessionRef: {
      tokenHash: HEX_64,
      envelopeDigest: 'b'.repeat(64)
    },
    payload,
    payloadDigest: 'c'.repeat(64),
    sequence: now,
    nonce: HEX_32,
    idempotencyKey: 'd'.repeat(64),
    issuedAt: now,
    signature: 'signature'
  } as const;
}

function signedCommentEnvelope(payload = forumCommentSignedPayload(baseCommentV2())) {
  return {
    envelopeVersion: 1,
    signatureSuite: 'jcs-ed25519-sha256-v1',
    protocolVersion: 'luma-write-v1',
    profile: 'public-beta',
    audience: FORUM_COMMENT_AUDIENCE,
    origin: 'https://vh.example',
    scheme: FORUM_AUTHOR_SCHEME,
    publicAuthor: payload.author,
    sessionRef: {
      tokenHash: HEX_64,
      envelopeDigest: 'b'.repeat(64)
    },
    payload,
    payloadDigest: 'c'.repeat(64),
    sequence: now,
    nonce: HEX_32,
    idempotencyKey: 'd'.repeat(64),
    issuedAt: now,
    signature: 'signature'
  } as const;
}

function signedPostEnvelope(payload = forumPostSignedPayload(basePostV1())) {
  return {
    envelopeVersion: 1,
    signatureSuite: 'jcs-ed25519-sha256-v1',
    protocolVersion: 'luma-write-v1',
    profile: 'public-beta',
    audience: FORUM_POST_AUDIENCE,
    origin: 'https://vh.example',
    scheme: FORUM_AUTHOR_SCHEME,
    publicAuthor: payload.author,
    sessionRef: {
      tokenHash: HEX_64,
      envelopeDigest: 'b'.repeat(64)
    },
    payload,
    payloadDigest: 'c'.repeat(64),
    sequence: now,
    nonce: HEX_32,
    idempotencyKey: 'd'.repeat(64),
    issuedAt: now,
    signature: 'signature'
  } as const;
}

function baseThreadV1() {
  const payload = {
    schemaVersion: 'hermes-thread-v1' as const,
    _protocolVersion: FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: FORUM_WRITER_KIND,
    _authorScheme: FORUM_AUTHOR_SCHEME,
    id: 'thread-luma-1',
    title: 'A LUMA civic conversation',
    content: 'Signed markdown content',
    author: FORUM_AUTHOR_ID,
    timestamp: now,
    tags: ['infrastructure'],
    topicId: 'topic-1'
  };
  return {
    ...payload,
    upvotes: 0,
    downvotes: 0,
    score: 0,
    signedWriteEnvelope: signedThreadEnvelope(payload)
  };
}

function baseCommentV2() {
  const payload = {
    schemaVersion: 'hermes-comment-v2' as const,
    _protocolVersion: FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: FORUM_WRITER_KIND,
    _authorScheme: FORUM_AUTHOR_SCHEME,
    id: 'comment-luma-1',
    threadId: 'thread-luma-1',
    parentId: null,
    content: 'Signed comment content',
    author: FORUM_AUTHOR_ID,
    timestamp: now,
    stance: 'concur' as const
  };
  return {
    ...payload,
    upvotes: 0,
    downvotes: 0,
    signedWriteEnvelope: signedCommentEnvelope(payload)
  };
}

function basePostV1() {
  const payload = {
    schemaVersion: 'hermes-post-v1' as const,
    _protocolVersion: FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: FORUM_WRITER_KIND,
    _authorScheme: FORUM_AUTHOR_SCHEME,
    id: 'post-luma-1',
    threadId: 'thread-luma-1',
    parentId: null,
    topicId: 'topic-luma-1',
    author: FORUM_AUTHOR_ID,
    type: 'article' as const,
    content: 'Signed article publish-back content',
    timestamp: now,
    articleRefId: 'article-luma-1'
  };
  return {
    ...payload,
    upvotes: 0,
    downvotes: 0,
    signedWriteEnvelope: signedPostEnvelope(payload)
  };
}

function commentV2WriteRecord() {
  const { signedWriteEnvelope: _signedWriteEnvelope, ...record } = baseCommentV2();
  return record;
}

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
      sourceSynthesisId: 'synth-1',
      sourceEpoch: 3,
      sourceAnalysisId: 'legacy-analysis-1',
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
      sourceSynthesisId: 'synth-1',
      sourceEpoch: 3,
      sourceAnalysisId: 'legacy-analysis-1',
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

  it('accepts LUMA v1 threads with forum-author metadata and signed envelope', () => {
    const thread = baseThreadV1();
    const parsed = HermesThreadSchemaV1.parse(thread);

    expect(parsed).toMatchObject({
      schemaVersion: 'hermes-thread-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'forum-author-v1',
      author: expect.stringMatching(/^[0-9a-f]{64}$/),
      signedWriteEnvelope: expect.objectContaining({
        audience: 'vh-forum-thread',
        scheme: 'forum-author-v1',
        publicAuthor: thread.author,
        payload: forumThreadSignedPayload(thread)
      })
    });
  });

  it('omits undefined optional fields from LUMA thread signed payloads', () => {
    const payload = forumThreadSignedPayload({
      ...baseThreadV1(),
      sourceSynthesisId: undefined,
      sourceEpoch: undefined,
      topicId: undefined,
      sourceUrl: undefined,
      urlHash: undefined,
      isHeadline: undefined,
      proposal: undefined
    });

    expect(Object.prototype.hasOwnProperty.call(payload, 'sourceSynthesisId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'sourceEpoch')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'topicId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'sourceUrl')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'urlHash')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'isHeadline')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'proposal')).toBe(false);
  });

  it('rejects LUMA v1 threads with raw-author, publicAuthor, or signed payload mismatches', () => {
    const thread = baseThreadV1();

    expect(HermesThreadSchema.safeParse({ ...thread, author: 'raw-nullifier' }).success).toBe(false);
    expect(HermesThreadSchema.safeParse({
      ...thread,
      signedWriteEnvelope: {
        ...thread.signedWriteEnvelope,
        publicAuthor: OTHER_FORUM_AUTHOR_ID
      }
    }).success).toBe(false);
    expect(HermesThreadSchema.safeParse({
      ...thread,
      title: 'Tampered title after signing'
    }).success).toBe(false);
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

  it('accepts LUMA v2 comments without redefining legacy v1', () => {
    const comment = baseCommentV2();
    const parsed = HermesCommentSchemaV2.parse(comment);

    expect(parsed).toMatchObject({
      schemaVersion: 'hermes-comment-v2',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'forum-author-v1',
      author: expect.stringMatching(/^[0-9a-f]{64}$/),
      signedWriteEnvelope: expect.objectContaining({
        audience: 'vh-forum-comment',
        scheme: 'forum-author-v1',
        publicAuthor: comment.author,
        payload: forumCommentSignedPayload(comment)
      })
    });
    expect(HermesCommentSchemaV1.safeParse(baseCommentV1).success).toBe(true);
  });

  it('omits undefined optional fields from LUMA comment signed payloads', () => {
    const payload = forumCommentSignedPayload({
      ...baseCommentV2(),
      targetId: undefined,
      via: undefined
    });

    expect(Object.prototype.hasOwnProperty.call(payload, 'targetId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'via')).toBe(false);
  });

  it('rejects LUMA v2 comments with raw-author, publicAuthor, or signed payload mismatches', () => {
    const comment = baseCommentV2();

    expect(HermesCommentSchema.safeParse({ ...comment, author: 'raw-nullifier' }).success).toBe(false);
    expect(HermesCommentSchema.safeParse({
      ...comment,
      signedWriteEnvelope: {
        ...comment.signedWriteEnvelope,
        publicAuthor: OTHER_FORUM_AUTHOR_ID
      }
    }).success).toBe(false);
    expect(HermesCommentSchema.safeParse({
      ...comment,
      content: 'Tampered comment after signing'
    }).success).toBe(false);
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
    const result = HermesCommentWriteSchema.safeParse({ ...commentV2WriteRecord(), type: 'reply' });
    expect(result.success).toBe(false);
  });

  it('accepts canonical LUMA v2 write payload', () => {
    const parsed = HermesCommentWriteSchema.parse(commentV2WriteRecord());
    expect(parsed.stance).toBe('concur');
    expect((parsed as any).type).toBeUndefined();
    expect(parsed.schemaVersion).toBe('hermes-comment-v2');
  });

  it('accepts canonical LUMA v2 payload with discuss stance', () => {
    const parsed = HermesCommentWriteSchema.parse({
      ...commentV2WriteRecord(),
      stance: 'discuss' as const
    });
    expect(parsed.stance).toBe('discuss');
    expect((parsed as any).type).toBeUndefined();
  });
});

describe('HermesCommentModerationSchema', () => {
  const moderation = {
    schemaVersion: 'hermes-comment-moderation-v1',
    moderation_id: 'mod-1',
    thread_id: 'news-story:story-1',
    comment_id: 'comment-1',
    status: 'hidden',
    reason_code: 'abusive_content',
    reason: 'Contains abusive language.',
    operator_id: 'ops-1',
    created_at: 123,
    audit: {
      action: 'comment_moderation',
      notes: 'fixture'
    }
  } as const;

  it('accepts hidden and restored moderation records with audit metadata', () => {
    const hidden = HermesCommentModerationSchema.parse(moderation);
    expect(hidden.status).toBe('hidden');
    expect(hidden.audit.action).toBe('comment_moderation');

    const restored = HermesCommentModerationSchema.parse({
      ...moderation,
      moderation_id: 'mod-2',
      status: 'restored',
      audit: {
        action: 'comment_moderation',
        supersedes_moderation_id: 'mod-1',
        source_report_id: 'report-1'
      }
    });
    expect(restored.status).toBe('restored');
    expect(restored.audit.supersedes_moderation_id).toBe('mod-1');
    expect(restored.audit.source_report_id).toBe('report-1');
  });

  it('rejects malformed moderation payloads', () => {
    expect(HermesCommentModerationSchema.safeParse({ ...moderation, status: 'deleted' }).success).toBe(false);
    expect(HermesCommentModerationSchema.safeParse({ ...moderation, operator_id: '' }).success).toBe(false);
    expect(HermesCommentModerationSchema.safeParse({ ...moderation, audit: { action: 'other' } }).success).toBe(false);
    expect(HermesCommentModerationSchema.safeParse({ ...moderation, token: 'secret' }).success).toBe(false);
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
    const payload = commentV2WriteRecord();
    expect(HermesCommentWriteSchema.safeParse(payload).success).toBe(true);
    expect(HermesCommentWriteSchema.safeParse({ ...payload, via: 'human' }).success).toBe(true);
  });

  it('rejects invalid via values', () => {
    expect(HermesCommentSchemaV1.safeParse({ ...baseCommentV1, via: 'bot' }).success).toBe(false);
    expect(HermesCommentWriteSchema.safeParse({
      ...commentV2WriteRecord(),
      via: 'bot'
    }).success).toBe(false);
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

  it('sha256Hex hashes through WebCrypto without a Node Buffer dependency', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest');

    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );

    expect(digest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
    digest.mockRestore();
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

  it('passes through LUMA v2 comments without downgrading schema version', () => {
    const comment = baseCommentV2();
    const migrated = migrateCommentToV1(comment);
    expect(migrated).toEqual(comment);
    expect(migrated.schemaVersion).toBe('hermes-comment-v2');
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

  it('accepts LUMA v1 article posts with forum-author metadata and signed envelope', () => {
    const post = basePostV1();
    const parsed = ForumPostSchemaV1.parse(post);

    expect(parsed).toMatchObject({
      schemaVersion: 'hermes-post-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'forum-author-v1',
      author: expect.stringMatching(/^[0-9a-f]{64}$/),
      signedWriteEnvelope: expect.objectContaining({
        audience: 'vh-forum-post',
        scheme: 'forum-author-v1',
        publicAuthor: post.author,
        payload: forumPostSignedPayload(post)
      })
    });
  });

  it('omits undefined optional fields from LUMA post signed payloads', () => {
    const payload = forumPostSignedPayload({
      ...basePostV1(),
      via: undefined
    });

    expect(Object.prototype.hasOwnProperty.call(payload, 'via')).toBe(false);
  });

  it('rejects LUMA v1 posts with raw-author, publicAuthor, audience, or signed payload mismatches', () => {
    const post = basePostV1();

    expect(ForumPostSchema.safeParse({ ...post, author: 'raw-nullifier' }).success).toBe(false);
    expect(ForumPostSchema.safeParse({
      ...post,
      signedWriteEnvelope: {
        ...post.signedWriteEnvelope,
        publicAuthor: OTHER_FORUM_AUTHOR_ID
      }
    }).success).toBe(false);
    expect(ForumPostSchema.safeParse({
      ...post,
      signedWriteEnvelope: {
        ...post.signedWriteEnvelope,
        audience: 'vh-forum-thread'
      }
    }).success).toBe(false);
    expect(ForumPostSchema.safeParse({
      ...post,
      content: 'Tampered post content after signing'
    }).success).toBe(false);
  });

  it('accepts LUMA post signed payloads regardless of envelope payload key order', () => {
    const post = basePostV1();
    const reorderedPayload = {
      articleRefId: post.signedWriteEnvelope.payload.articleRefId,
      timestamp: post.signedWriteEnvelope.payload.timestamp,
      content: post.signedWriteEnvelope.payload.content,
      type: post.signedWriteEnvelope.payload.type,
      author: post.signedWriteEnvelope.payload.author,
      topicId: post.signedWriteEnvelope.payload.topicId,
      parentId: post.signedWriteEnvelope.payload.parentId,
      threadId: post.signedWriteEnvelope.payload.threadId,
      id: post.signedWriteEnvelope.payload.id,
      _authorScheme: post.signedWriteEnvelope.payload._authorScheme,
      _writerKind: post.signedWriteEnvelope.payload._writerKind,
      _protocolVersion: post.signedWriteEnvelope.payload._protocolVersion,
      schemaVersion: post.signedWriteEnvelope.payload.schemaVersion
    };

    expect(ForumPostSchema.safeParse({
      ...post,
      signedWriteEnvelope: {
        ...post.signedWriteEnvelope,
        payload: reorderedPayload
      }
    }).success).toBe(true);
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
      ForumPostSchema.safeParse({ ...baseReplyPost, schemaVersion: 'hermes-post-v9' }).success
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
