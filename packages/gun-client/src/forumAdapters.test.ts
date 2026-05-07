import { describe, expect, it, vi } from 'vitest';
import {
  FORUM_AUTHOR_SCHEME,
  FORUM_COMMENT_AUDIENCE,
  FORUM_PUBLIC_PROTOCOL_VERSION,
  FORUM_THREAD_AUDIENCE,
  FORUM_WRITER_KIND,
  type ForumCommentSignedPayload,
  type ForumThreadSignedPayload,
  type TrustedOperatorAuthorization
} from '@vh/data-model';
import {
  createLumaPublicAuthorId,
  createSignedWriteEnvelope
} from '@vh/luma-sdk';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './index';
import {
  getForumCommentIndexChain,
  getForumCommentModerationChain,
  getForumCommentsChain,
  getForumDateIndexChain,
  getForumLatestCommentModerationChain,
  getForumLatestCommentModerationsChain,
  getForumTagIndexChain,
  getForumThreadChain,
  readForumCommentModeration,
  readForumLatestCommentModeration,
  validateForumCommentRecord,
  validateForumThreadRecord,
  writeForumCommentModeration
} from './forumAdapters';

const MODERATION = {
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

const OPERATOR_AUTHORIZATION: TrustedOperatorAuthorization = {
  schemaVersion: 'vh-trusted-operator-authorization-v1',
  operator_id: 'ops-1',
  role: 'trusted_beta_operator',
  capabilities: [
    'review_news_report',
    'write_synthesis_correction',
    'moderate_story_thread',
    'private_support_handoff',
  ],
  granted_at: 100,
};
const FORUM_AUTHOR_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_FORUM_AUTHOR_ID = 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const SESSION_REF = Object.freeze({
  tokenHash: 'a'.repeat(64),
  envelopeDigest: 'b'.repeat(64)
});
const NONCE = '00112233445566778899aabbccddeeff';
const ISSUED_AT = 1777777777000;
const ED25519 = 'Ed25519';

function createMockChain() {
  const chain: any = {};
  chain.once = vi.fn((cb?: (data: unknown) => void) => cb?.({}));
  chain.put = vi.fn((_value: any, cb?: (ack?: any) => void) => cb?.({}));
  chain.get = vi.fn(() => chain);
  return chain;
}

function createClient(chain: any, guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();
  return {
    gun: { get: vi.fn(() => chain) } as any,
    mesh: chain,
    hydrationBarrier: barrier,
    topologyGuard: guard,
    config: { peers: [] },
    storage: {} as any,
    user: {} as any,
    chat: {} as any,
    outbox: {} as any,
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn()
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function bytesToBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function createSignedForumThread(
  overrides: Partial<ForumThreadSignedPayload> = {},
  envelopeOverrides: Record<string, unknown> = {}
) {
  const keyPair = await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']);
  if (!('privateKey' in keyPair) || !('publicKey' in keyPair)) {
    throw new Error('Ed25519 key generation failed');
  }
  const payload: ForumThreadSignedPayload = {
    schemaVersion: 'hermes-thread-v1',
    _protocolVersion: FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: FORUM_WRITER_KIND,
    _authorScheme: FORUM_AUTHOR_SCHEME,
    id: 'thread-luma-1',
    title: 'Signed thread',
    content: 'Signed body',
    author: FORUM_AUTHOR_ID,
    timestamp: ISSUED_AT,
    tags: ['luma'],
    topicId: 'topic-1',
    ...overrides
  };
  const signedWriteEnvelope = await createSignedWriteEnvelope({
    profile: 'public-beta',
    audience: FORUM_THREAD_AUDIENCE,
    origin: 'https://vh.example',
    scheme: FORUM_AUTHOR_SCHEME,
    publicAuthor: createLumaPublicAuthorId(payload.author, FORUM_AUTHOR_SCHEME),
    sessionRef: SESSION_REF,
    payload,
    sequence: ISSUED_AT,
    nonce: NONCE,
    issuedAt: ISSUED_AT,
    sign: async ({ canonicalBytes }) => bytesToBase64Url(new Uint8Array(
      await crypto.subtle.sign(ED25519, keyPair.privateKey, bytesToBufferSource(canonicalBytes))
    ))
  });

  return {
    record: {
      ...payload,
      upvotes: 0,
      downvotes: 0,
      score: 0,
      signedWriteEnvelope: {
        ...signedWriteEnvelope,
        ...envelopeOverrides
      }
    },
    verify: ({ canonicalBytes, signature }: { canonicalBytes: Uint8Array; signature: string }) =>
      crypto.subtle.verify(
        ED25519,
        keyPair.publicKey,
        bytesToBufferSource(new Uint8Array(Buffer.from(signature, 'base64url'))),
        bytesToBufferSource(canonicalBytes)
      )
  };
}

async function createSignedForumComment(
  overrides: Partial<ForumCommentSignedPayload> = {},
  envelopeOverrides: Record<string, unknown> = {}
) {
  const keyPair = await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']);
  if (!('privateKey' in keyPair) || !('publicKey' in keyPair)) {
    throw new Error('Ed25519 key generation failed');
  }
  const payload: ForumCommentSignedPayload = {
    schemaVersion: 'hermes-comment-v2',
    _protocolVersion: FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: FORUM_WRITER_KIND,
    _authorScheme: FORUM_AUTHOR_SCHEME,
    id: 'comment-luma-1',
    threadId: 'thread-luma-1',
    parentId: null,
    content: 'Signed comment',
    author: FORUM_AUTHOR_ID,
    timestamp: ISSUED_AT,
    stance: 'concur',
    ...overrides
  };
  const signedWriteEnvelope = await createSignedWriteEnvelope({
    profile: 'public-beta',
    audience: FORUM_COMMENT_AUDIENCE,
    origin: 'https://vh.example',
    scheme: FORUM_AUTHOR_SCHEME,
    publicAuthor: createLumaPublicAuthorId(payload.author, FORUM_AUTHOR_SCHEME),
    sessionRef: SESSION_REF,
    payload,
    sequence: ISSUED_AT,
    nonce: NONCE,
    issuedAt: ISSUED_AT,
    sign: async ({ canonicalBytes }) => bytesToBase64Url(new Uint8Array(
      await crypto.subtle.sign(ED25519, keyPair.privateKey, bytesToBufferSource(canonicalBytes))
    ))
  });

  return {
    record: {
      ...payload,
      upvotes: 0,
      downvotes: 0,
      signedWriteEnvelope: {
        ...signedWriteEnvelope,
        ...envelopeOverrides
      }
    },
    verify: ({ canonicalBytes, signature }: { canonicalBytes: Uint8Array; signature: string }) =>
      crypto.subtle.verify(
        ED25519,
        keyPair.publicKey,
        bytesToBufferSource(new Uint8Array(Buffer.from(signature, 'base64url'))),
        bytesToBufferSource(canonicalBytes)
      )
  };
}

describe('forumAdapters', () => {
  it('guards thread writes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const threadChain = getForumThreadChain(client, 'thread-1');
    await threadChain.put({ title: 't', content: 'c' } as any);
    expect(guard.validateWrite).toHaveBeenCalledWith('vh/forum/threads/thread-1/', expect.anything());
  });

  it('validates LUMA forum thread envelope binding and rejects tampering', async () => {
    const { record, verify } = await createSignedForumThread();

    await expect(validateForumThreadRecord(record, 'thread-luma-1', verify)).resolves.toEqual(record);
    await expect(validateForumThreadRecord(record, 'other-thread', verify)).resolves.toBeNull();
    await expect(validateForumThreadRecord({ ...record, title: 'tampered' }, 'thread-luma-1', verify)).resolves.toBeNull();
    await expect(validateForumThreadRecord({
      ...record,
      signedWriteEnvelope: {
        ...record.signedWriteEnvelope,
        publicAuthor: OTHER_FORUM_AUTHOR_ID
      }
    }, 'thread-luma-1', verify)).resolves.toBeNull();
    await expect(validateForumThreadRecord({
      ...record,
      signedWriteEnvelope: {
        ...record.signedWriteEnvelope,
        signature: 'bad-signature'
      }
    }, 'thread-luma-1', verify)).resolves.toBeNull();
  });

  it('validates LUMA forum comment envelope binding and rejects tampering', async () => {
    const { record, verify } = await createSignedForumComment();

    await expect(validateForumCommentRecord(record, 'thread-luma-1', 'comment-luma-1', verify)).resolves.toEqual(record);
    await expect(validateForumCommentRecord(record, 'thread-luma-1', 'other-comment', verify)).resolves.toBeNull();
    await expect(validateForumCommentRecord({ ...record, content: 'tampered' }, 'thread-luma-1', 'comment-luma-1', verify)).resolves.toBeNull();
    await expect(validateForumCommentRecord({
      ...record,
      signedWriteEnvelope: {
        ...record.signedWriteEnvelope,
        publicAuthor: OTHER_FORUM_AUTHOR_ID
      }
    }, 'thread-luma-1', 'comment-luma-1', verify)).resolves.toBeNull();
    await expect(validateForumCommentRecord({
      ...record,
      signedWriteEnvelope: {
        ...record.signedWriteEnvelope,
        signature: 'bad-signature'
      }
    }, 'thread-luma-1', 'comment-luma-1', verify)).resolves.toBeNull();
  });

  it('guards comment writes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const commentsChain = getForumCommentsChain(client, 'thread-2');
    await commentsChain.get('comment-1').put({ content: 'reply' } as any);
    expect(guard.validateWrite).toHaveBeenCalledWith('vh/forum/threads/thread-2/comments/comment-1/', expect.anything());
  });

  it('guards comment index writes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const indexChain = getForumCommentIndexChain(client, 'news-story:story-2');
    await indexChain.get('current').put({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: 'news-story:story-2',
      idsJson: '[]'
    });
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/forum/indexes/comment_ids/news-story%3Astory-2/current/',
      expect.anything()
    );
  });

  it('guards forum indexes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    await getForumDateIndexChain(client).put({} as any);
    await getForumTagIndexChain(client, 'infra').put({} as any);
    expect(guard.validateWrite).toHaveBeenCalledWith('vh/forum/indexes/date/', expect.anything());
    expect(guard.validateWrite).toHaveBeenCalledWith('vh/forum/indexes/tags/infra/', expect.anything());
  });

  it('guards comment moderation writes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await getForumCommentModerationChain(client, 'thread-1', 'mod-1').put(MODERATION);
    await getForumLatestCommentModerationChain(client, 'thread-1', 'comment-1').put(MODERATION);
    await getForumLatestCommentModerationsChain(client, 'thread-1').get('comment-1').put(MODERATION);

    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/forum/threads/thread-1/comment_moderations/mod-1/',
      MODERATION
    );
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/forum/threads/thread-1/comment_moderations/latest/comment-1/',
      MODERATION
    );
  });

  it('writes and reads comment moderation records with audit metadata', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeForumCommentModeration(client, MODERATION, OPERATOR_AUTHORIZATION)).resolves.toEqual(MODERATION);
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/forum/threads/news-story:story-1/comment_moderations/mod-1/',
      MODERATION
    );
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/forum/threads/news-story:story-1/comment_moderations/latest/comment-1/',
      MODERATION
    );

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(MODERATION));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toEqual(MODERATION);

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(MODERATION));
    await expect(readForumLatestCommentModeration(client, 'news-story:story-1', 'comment-1')).resolves.toEqual(MODERATION);
  });

  it('rejects malformed and path-mismatched comment moderation records', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeForumCommentModeration(client, { ...MODERATION, status: 'deleted' }, OPERATOR_AUTHORIZATION)).rejects.toThrow();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, thread_id: 'other' }));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, moderation_id: 'other' }));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, comment_id: 'other' }));
    await expect(readForumLatestCommentModeration(client, 'news-story:story-1', 'comment-1')).resolves.toBeNull();
  });

  it('rejects malformed comment moderation shapes before writing', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const invalidPayloads = [
      null,
      'not-a-record',
      { ...MODERATION, audit: null },
      { ...MODERATION, audit: { action: 'wrong' } },
      { ...MODERATION, reason: '' },
      { ...MODERATION, reason: ' ' },
      { ...MODERATION, reason: 42 },
      { ...MODERATION, audit: { action: 'comment_moderation', supersedes_moderation_id: '' } },
      { ...MODERATION, audit: { action: 'comment_moderation', supersedes_moderation_id: 42 } },
      { ...MODERATION, audit: { action: 'comment_moderation', source_report_id: '' } },
      { ...MODERATION, audit: { action: 'comment_moderation', source_report_id: 42 } },
      { ...MODERATION, audit: { action: 'comment_moderation', notes: '' } },
      { ...MODERATION, audit: { action: 'comment_moderation', notes: 42 } },
      { ...MODERATION, moderation_id: ' ' },
      { ...MODERATION, thread_id: ' ' },
      { ...MODERATION, comment_id: ' ' },
      { ...MODERATION, reason_code: ' ' },
      { ...MODERATION, operator_id: ' ' },
      { ...MODERATION, created_at: -1 },
      { ...MODERATION, created_at: 1.5 },
      { ...MODERATION, token: 'secret' },
      { ...MODERATION, audit: { action: 'comment_moderation', notes: 'fixture', token: 'secret' } }
    ];

    for (const payload of invalidPayloads) {
      await expect(writeForumCommentModeration(client, payload, OPERATOR_AUTHORIZATION)).rejects.toThrow(
        'Invalid comment moderation payload',
      );
    }
    expect(chain.put).not.toHaveBeenCalled();
  });

  it('accepts optional moderation audit fields and rejects empty read ids', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const { reason: _reason, ...moderationWithoutReason } = MODERATION;
    const restored = {
      ...moderationWithoutReason,
      moderation_id: 'mod-restore',
      status: 'restored' as const,
      audit: {
        action: 'comment_moderation' as const,
        source_report_id: 'report-1',
        supersedes_moderation_id: 'mod-1'
      }
    };

    await expect(writeForumCommentModeration(client, restored, OPERATOR_AUTHORIZATION)).resolves.toEqual(restored);
    await expect(readForumCommentModeration(client, ' ', 'mod-1')).rejects.toThrow('threadId is required');
    await expect(readForumCommentModeration(client, 'thread-1', ' ')).rejects.toThrow('moderationId is required');
    await expect(readForumLatestCommentModeration(client, 'thread-1', ' ')).rejects.toThrow('commentId is required');
  });

  it('returns null for empty or invalid moderation reads', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(undefined));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(undefined));
    await expect(readForumLatestCommentModeration(client, 'news-story:story-1', 'comment-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.('not-a-record'));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, audit: { action: 'wrong' } }));
    await expect(readForumLatestCommentModeration(client, 'news-story:story-1', 'comment-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, token: 'secret' }));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();
  });

  it('surfaces moderation write ack failures', async () => {
    const chain = createMockChain();
    chain.put.mockImplementationOnce((_value: any, cb?: (ack?: any) => void) => cb?.({ err: 'boom' }));
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeForumCommentModeration(client, MODERATION, OPERATOR_AUTHORIZATION)).rejects.toThrow('boom');
  });

  it('recovers moderation writes from ack timeout when readback confirms persistence', async () => {
    vi.useFakeTimers();
    const chain = createMockChain();
    chain.put.mockImplementation((_value: any, _cb?: (ack?: any) => void) => undefined);
    chain.once.mockImplementation((cb?: (data: unknown) => void) => cb?.(MODERATION));
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const writePromise = writeForumCommentModeration(client, MODERATION, OPERATOR_AUTHORIZATION);
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(writePromise).resolves.toEqual(MODERATION);
      expect(warnSpy).toHaveBeenCalledWith('[vh:forum] moderation put ack timed out, requiring readback confirmation');
      expect(warnSpy).toHaveBeenCalledWith('[vh:forum] latest moderation put ack timed out, requiring readback confirmation');
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('requires trusted operator authorization for comment moderation writes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeForumCommentModeration(client, MODERATION, null)).rejects.toThrow(
      'Trusted operator authorization is required',
    );
    await expect(
      writeForumCommentModeration(client, MODERATION, { ...OPERATOR_AUTHORIZATION, operator_id: 'ops-2' }),
    ).rejects.toThrow('does not match operator audit id');
    await expect(
      writeForumCommentModeration(client, MODERATION, {
        ...OPERATOR_AUTHORIZATION,
        capabilities: ['review_news_report'],
      }),
    ).rejects.toThrow('lacks moderate_story_thread');
  });
});
