import {
  FORUM_AUTHOR_SCHEME,
  FORUM_COMMENT_AUDIENCE,
  FORUM_POST_AUDIENCE,
  FORUM_PUBLIC_PROTOCOL_VERSION,
  FORUM_THREAD_AUDIENCE,
  FORUM_WRITER_KIND,
  type ForumCommentSignedPayload,
  type ForumPost,
  type ForumPostSignedPayload,
  type ForumThreadSignedPayload
} from '@vh/data-model';
import {
  createLumaPublicAuthorId,
  createSignedWriteEnvelope,
  type DeploymentProfile,
  type SignedWriteSessionRef
} from '@vh/luma-sdk';
import type { ProposalExtension } from '@vh/data-model';
import {
  deriveForumAuthorId,
  type IdentityRecord,
  type HermesComment,
  type HermesThread
} from '@vh/types';
import { signWithStoredDelegationSigningKey } from '@vh/identity-vault';
import {
  assertCanPerformMvpAction,
  deriveIdentitySignedWriteSessionRef
} from '../../luma/mvpActionPolicy';

type LumaForumIdentity = IdentityRecord & {
  session: IdentityRecord['session'] & {
    token: string;
    nullifier: string;
    scaledTrustScore: number;
    createdAt: number;
    expiresAt: number;
  };
};

type LumaForumEnv = Record<string, string | boolean | undefined>;

interface ThreadRecordInput {
  readonly identity: LumaForumIdentity;
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly timestamp: number;
  readonly tags: readonly string[];
  readonly sourceSynthesisId?: string;
  readonly sourceEpoch?: number;
  readonly topicId?: string;
  readonly sourceUrl?: string;
  readonly urlHash?: string;
  readonly isHeadline?: boolean;
  readonly proposal?: ProposalExtension;
}

interface CommentRecordInput {
  readonly identity: LumaForumIdentity;
  readonly id: string;
  readonly threadId: string;
  readonly parentId: string | null;
  readonly content: string;
  readonly timestamp: number;
  readonly stance: 'concur' | 'counter' | 'discuss';
  readonly targetId?: string;
  readonly via?: 'human' | 'familiar';
}

interface PostRecordInput {
  readonly identity: LumaForumIdentity;
  readonly id: string;
  readonly threadId: string;
  readonly parentId: string | null;
  readonly topicId: string;
  readonly type: 'reply' | 'article';
  readonly content: string;
  readonly timestamp: number;
  readonly articleRefId?: string;
  readonly via?: 'human' | 'familiar';
}

export function lumaForumDeploymentProfile(): DeploymentProfile {
  if (isE2EMode()) return 'e2e';
  const viteEnv = readLumaForumEnv();
  const configured = viteEnv?.VITE_LUMA_PROFILE;
  if (
    configured === 'dev'
    || configured === 'public-beta'
    || configured === 'production-attestation'
  ) {
    return configured;
  }
  if (viteEnv?.DEV === true || viteEnv?.MODE === 'development') return 'dev';
  return 'public-beta';
}

export function assertLumaForumIdentity(identity: IdentityRecord | null): LumaForumIdentity {
  if (!identity?.session?.nullifier || !identity.session.token) {
    throw new Error('LUMA forum writes require a full identity session');
  }
  if (
    typeof identity.session.scaledTrustScore !== 'number'
    || typeof identity.session.createdAt !== 'number'
    || typeof identity.session.expiresAt !== 'number'
  ) {
    throw new Error('LUMA forum writes require complete session lifecycle fields');
  }
  return identity as LumaForumIdentity;
}

export async function deriveForumSignedWriteSessionRef(
  identity: LumaForumIdentity
): Promise<SignedWriteSessionRef> {
  return deriveIdentitySignedWriteSessionRef(identity, {
    allowLegacySessionDigest: lumaForumDeploymentProfile() !== 'public-beta'
  });
}

export async function createLumaForumThreadRecord(input: ThreadRecordInput): Promise<HermesThread> {
  const forumAuthorId = await deriveForumAuthorId(input.identity.session.nullifier);
  const timestamp = input.timestamp;
  const profile = lumaForumDeploymentProfile();
  const origin = currentOrigin();
  const payload: ForumThreadSignedPayload = stripUndefined({
    schemaVersion: 'hermes-thread-v1',
    _protocolVersion: FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: FORUM_WRITER_KIND,
    _authorScheme: FORUM_AUTHOR_SCHEME,
    id: input.id,
    title: input.title,
    content: input.content,
    author: forumAuthorId,
    timestamp,
    tags: [...input.tags],
    sourceSynthesisId: input.sourceSynthesisId,
    sourceEpoch: input.sourceEpoch,
    topicId: input.topicId,
    sourceUrl: input.sourceUrl,
    urlHash: input.urlHash,
    isHeadline: input.isHeadline,
    proposal: input.proposal
  });
  const signedWriteEnvelope = await createSignedWriteEnvelope({
    profile,
    audience: FORUM_THREAD_AUDIENCE,
    origin,
    scheme: FORUM_AUTHOR_SCHEME,
    publicAuthor: createLumaPublicAuthorId(forumAuthorId, FORUM_AUTHOR_SCHEME),
    sessionRef: await deriveForumSignedWriteSessionRef(input.identity),
    payload,
    sequence: timestamp,
    nonce: randomNonceHex(),
    issuedAt: timestamp,
    sign: ({ canonicalBytes }) => signWithStoredDelegationSigningKey(canonicalBytes)
  });
  if (profile === 'public-beta') {
    await assertCanPerformMvpAction({
      identity: input.identity,
      profile,
      action: FORUM_THREAD_AUDIENCE,
      envelope: signedWriteEnvelope,
      scheme: FORUM_AUTHOR_SCHEME,
      publicAuthor: forumAuthorId,
      origin
    });
  }

  return {
    ...payload,
    upvotes: 0,
    downvotes: 0,
    score: 0,
    signedWriteEnvelope: {
      ...signedWriteEnvelope,
      audience: FORUM_THREAD_AUDIENCE,
      scheme: FORUM_AUTHOR_SCHEME,
      publicAuthor: forumAuthorId,
      payload
    }
  };
}

export async function createLumaForumCommentRecord(input: CommentRecordInput): Promise<HermesComment> {
  const forumAuthorId = await deriveForumAuthorId(input.identity.session.nullifier);
  const timestamp = input.timestamp;
  const profile = lumaForumDeploymentProfile();
  const origin = currentOrigin();
  const payload: ForumCommentSignedPayload = stripUndefined({
    schemaVersion: 'hermes-comment-v2',
    _protocolVersion: FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: FORUM_WRITER_KIND,
    _authorScheme: FORUM_AUTHOR_SCHEME,
    id: input.id,
    threadId: input.threadId,
    parentId: input.parentId,
    content: input.content,
    author: forumAuthorId,
    timestamp,
    stance: input.stance,
    targetId: input.targetId,
    via: input.via
  });
  const signedWriteEnvelope = await createSignedWriteEnvelope({
    profile,
    audience: FORUM_COMMENT_AUDIENCE,
    origin,
    scheme: FORUM_AUTHOR_SCHEME,
    publicAuthor: createLumaPublicAuthorId(forumAuthorId, FORUM_AUTHOR_SCHEME),
    sessionRef: await deriveForumSignedWriteSessionRef(input.identity),
    payload,
    sequence: timestamp,
    nonce: randomNonceHex(),
    issuedAt: timestamp,
    sign: ({ canonicalBytes }) => signWithStoredDelegationSigningKey(canonicalBytes)
  });
  if (profile === 'public-beta') {
    await assertCanPerformMvpAction({
      identity: input.identity,
      profile,
      action: FORUM_COMMENT_AUDIENCE,
      envelope: signedWriteEnvelope,
      scheme: FORUM_AUTHOR_SCHEME,
      publicAuthor: forumAuthorId,
      origin
    });
  }

  return {
    ...payload,
    upvotes: 0,
    downvotes: 0,
    signedWriteEnvelope: {
      ...signedWriteEnvelope,
      audience: FORUM_COMMENT_AUDIENCE,
      scheme: FORUM_AUTHOR_SCHEME,
      publicAuthor: forumAuthorId,
      payload
    }
  };
}

export async function createLumaForumPostRecord(input: PostRecordInput): Promise<ForumPost> {
  const forumAuthorId = await deriveForumAuthorId(input.identity.session.nullifier);
  const timestamp = input.timestamp;
  const profile = lumaForumDeploymentProfile();
  const origin = currentOrigin();
  const payload: ForumPostSignedPayload = stripUndefined({
    schemaVersion: 'hermes-post-v1',
    _protocolVersion: FORUM_PUBLIC_PROTOCOL_VERSION,
    _writerKind: FORUM_WRITER_KIND,
    _authorScheme: FORUM_AUTHOR_SCHEME,
    id: input.id,
    threadId: input.threadId,
    parentId: input.parentId,
    topicId: input.topicId,
    author: forumAuthorId,
    via: input.via,
    type: input.type,
    content: input.content,
    timestamp,
    articleRefId: input.articleRefId
  });
  const signedWriteEnvelope = await createSignedWriteEnvelope({
    profile,
    audience: FORUM_POST_AUDIENCE,
    origin,
    scheme: FORUM_AUTHOR_SCHEME,
    publicAuthor: createLumaPublicAuthorId(forumAuthorId, FORUM_AUTHOR_SCHEME),
    sessionRef: await deriveForumSignedWriteSessionRef(input.identity),
    payload,
    sequence: timestamp,
    nonce: randomNonceHex(),
    issuedAt: timestamp,
    sign: ({ canonicalBytes }) => signWithStoredDelegationSigningKey(canonicalBytes)
  });
  if (profile === 'public-beta') {
    await assertCanPerformMvpAction({
      identity: input.identity,
      profile,
      action: FORUM_POST_AUDIENCE,
      envelope: signedWriteEnvelope,
      scheme: FORUM_AUTHOR_SCHEME,
      publicAuthor: forumAuthorId,
      origin
    });
  }

  return {
    ...payload,
    upvotes: 0,
    downvotes: 0,
    signedWriteEnvelope: {
      ...signedWriteEnvelope,
      audience: FORUM_POST_AUDIENCE,
      scheme: FORUM_AUTHOR_SCHEME,
      publicAuthor: forumAuthorId,
      payload
    }
  };
}

function currentOrigin(): string {
  const origin = (globalThis as typeof globalThis & { location?: { origin?: string } }).location?.origin;
  return typeof origin === 'string' && origin.length > 0 ? origin : 'vh://local';
}

function randomNonceHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isE2EMode(): boolean {
  const override = (globalThis as typeof globalThis & { __VH_E2E_OVERRIDE__?: unknown }).__VH_E2E_OVERRIDE__;
  if (typeof override === 'boolean') {
    return override;
  }
  const viteEnv = readLumaForumEnv();
  return viteEnv?.VITE_E2E_MODE === 'true'
    || viteEnv?.MODE === 'test'
    || viteEnv?.VITEST === 'true';
}

function readLumaForumEnv(): LumaForumEnv {
  const override = (globalThis as typeof globalThis & {
    __VH_IMPORT_META_ENV__?: LumaForumEnv;
  }).__VH_IMPORT_META_ENV__;
  return override ?? (import.meta as unknown as { env?: LumaForumEnv }).env ?? {};
}

function stripUndefined<T extends object>(obj: T): T {
  const entries = Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as T;
}
