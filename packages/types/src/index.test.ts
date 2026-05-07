import { describe, expect, it } from 'vitest';
import {
  AttestationPayloadSchema,
  VerificationResultSchema,
  SessionResponseSchema,
  RegionProofSchema,
  type AttestationPayload,
  type DirectoryEntry,
  type HermesComment,
  type HermesThread,
  type VerificationResult,
  type SessionResponse,
  type RegionProof
} from './index';

describe('types schemas', () => {
  it('validates attestation payload', () => {
    const payload: AttestationPayload = {
      platform: 'web',
      integrityToken: 'tok',
      deviceKey: 'dev',
      nonce: 'n1'
    };
    expect(() => AttestationPayloadSchema.parse(payload)).not.toThrow();
  });

  it('rejects attestation payload with bad platform', () => {
    expect(() =>
      AttestationPayloadSchema.parse({
        platform: 'pc',
        integrityToken: 'tok',
        deviceKey: 'dev',
        nonce: 'n1'
      })
    ).toThrow();
  });

  it('validates verification result', () => {
    const result: VerificationResult = { success: true, trustScore: 0.9, issuedAt: Date.now() };
    expect(() => VerificationResultSchema.parse(result)).not.toThrow();
  });

  it('rejects verification result out of range', () => {
    expect(() =>
      VerificationResultSchema.parse({ success: true, trustScore: 2, issuedAt: 1 })
    ).toThrow();
  });

  it('validates session response', () => {
    const resp: SessionResponse = {
      token: 't', trustScore: 0.8, scaledTrustScore: 8000,
      nullifier: 'n', createdAt: 1000, expiresAt: 2000,
    };
    expect(() => SessionResponseSchema.parse(resp)).not.toThrow();
  });

  it('validates session response with zero expiresAt (transitional)', () => {
    const resp: SessionResponse = {
      token: 't', trustScore: 0.5, scaledTrustScore: 5000,
      nullifier: 'n', createdAt: 1000, expiresAt: 0,
    };
    expect(() => SessionResponseSchema.parse(resp)).not.toThrow();
  });

  it('rejects session response with low trust type', () => {
    expect(() =>
      SessionResponseSchema.parse({
        token: '', trustScore: -1, scaledTrustScore: 0,
        nullifier: '', createdAt: 0, expiresAt: 0,
      })
    ).toThrow();
  });

  it('validates region proof', () => {
    expect(() =>
      RegionProofSchema.parse({
        proof: 'base64-proof',
        publicSignals: ['district-hash', 'nullifier', 'root'],
        timestamp: Date.now()
      })
    ).not.toThrow();
  });

  it('rejects region proof with empty signals or negative timestamp', () => {
    expect(() =>
      RegionProofSchema.parse({
        proof: '',
        publicSignals: [],
        timestamp: -10
      })
    ).toThrow();
  });

  it('decodes region proof tuple', async () => {
    const { decodeRegionProof } = await import('./index');
    const tuple: [string, string, string] = ['d-hash', 'n-1', 'root'];
    const decoded = decodeRegionProof(tuple);
    expect(decoded).toEqual({ district_hash: 'd-hash', nullifier: 'n-1', merkle_root: 'root' });
  });

  it('types directory entries with optional delegation signing public key only', () => {
    const entry: DirectoryEntry = {
      schemaVersion: 'hermes-directory-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'identity-directory-v1',
      identityDirectoryKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      devicePub: 'device-pub',
      epub: 'device-epub',
      delegationSigningPublicKey: {
        signatureSuite: 'jcs-ed25519-sha256-v1',
        publicKey: { encoding: 'base64url', material: 'public-key-material' },
        createdAt: 1777777777000
      },
      registeredAt: 1,
      lastSeenAt: 2,
      signedWriteEnvelope: {
        envelopeVersion: 1,
        signatureSuite: 'jcs-ed25519-sha256-v1',
        protocolVersion: 'luma-write-v1',
        profile: 'public-beta',
        audience: 'vh-directory-entry',
        origin: 'https://vh.example',
        scheme: 'identity-directory-v1',
        publicAuthor: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        sessionRef: {
          tokenHash: 'token-hash',
          envelopeDigest: 'envelope-digest'
        },
        payload: {},
        payloadDigest: 'payload-digest',
        sequence: 1,
        nonce: 'nonce',
        idempotencyKey: 'idempotency-key',
        issuedAt: 1,
        signature: 'signature'
      }
    };

    expect(entry.delegationSigningPublicKey?.publicKey.material).toBe('public-key-material');
    expect(entry.identityDirectoryKey).toHaveLength(64);
    expect(JSON.stringify(entry)).not.toContain('privateKey');
    expect(JSON.stringify(entry)).not.toContain('nullifier');
  });

  it('types LUMA forum thread and comment public-author records', () => {
    const forumAuthorId = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const threadPayload = {
      schemaVersion: 'hermes-thread-v1' as const,
      _protocolVersion: 'luma-public-v1' as const,
      _writerKind: 'luma' as const,
      _authorScheme: 'forum-author-v1' as const,
      id: 'thread-1',
      title: 'LUMA thread',
      content: 'Thread body',
      author: forumAuthorId,
      timestamp: 1,
      tags: ['luma']
    };
    const thread: HermesThread = {
      ...threadPayload,
      upvotes: 0,
      downvotes: 0,
      score: 0,
      signedWriteEnvelope: {
        envelopeVersion: 1,
        signatureSuite: 'jcs-ed25519-sha256-v1',
        protocolVersion: 'luma-write-v1',
        profile: 'public-beta',
        audience: 'vh-forum-thread',
        origin: 'https://vh.example',
        scheme: 'forum-author-v1',
        publicAuthor: forumAuthorId,
        sessionRef: { tokenHash: 'token-hash', envelopeDigest: 'envelope-digest' },
        payload: threadPayload,
        payloadDigest: 'payload-digest',
        sequence: 1,
        nonce: 'nonce',
        idempotencyKey: 'idempotency-key',
        issuedAt: 1,
        signature: 'signature'
      }
    };
    const commentPayload = {
      schemaVersion: 'hermes-comment-v2' as const,
      _protocolVersion: 'luma-public-v1' as const,
      _writerKind: 'luma' as const,
      _authorScheme: 'forum-author-v1' as const,
      id: 'comment-1',
      threadId: 'thread-1',
      parentId: null,
      content: 'Comment body',
      author: forumAuthorId,
      timestamp: 2,
      stance: 'concur' as const
    };
    const comment: HermesComment = {
      ...commentPayload,
      upvotes: 0,
      downvotes: 0,
      signedWriteEnvelope: {
        envelopeVersion: 1,
        signatureSuite: 'jcs-ed25519-sha256-v1',
        protocolVersion: 'luma-write-v1',
        profile: 'public-beta',
        audience: 'vh-forum-comment',
        origin: 'https://vh.example',
        scheme: 'forum-author-v1',
        publicAuthor: forumAuthorId,
        sessionRef: { tokenHash: 'token-hash', envelopeDigest: 'envelope-digest' },
        payload: commentPayload,
        payloadDigest: 'payload-digest',
        sequence: 2,
        nonce: 'nonce',
        idempotencyKey: 'idempotency-key',
        issuedAt: 2,
        signature: 'signature'
      }
    };

    expect(thread.author).toBe(forumAuthorId);
    expect(comment.author).toBe(forumAuthorId);
    expect(JSON.stringify({ thread, comment })).not.toContain('principal-nullifier');
  });
});
