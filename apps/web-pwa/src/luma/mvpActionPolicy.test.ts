import { describe, expect, it, vi } from 'vitest';
import { createBetaLocalAssuranceEnvelope, createLumaPublicAuthorId, createSignedWriteEnvelope } from '@vh/luma-sdk';
import type { IdentityRecord } from '@vh/types';
import {
  assertCanPerformMvpAction,
  assertMvpActionIdentityReady,
  deriveIdentitySignedWriteSessionRef,
} from './mvpActionPolicy';

vi.mock('@vh/identity-vault', () => ({
  getDelegationSigningPublicKey: vi.fn(async () => ({
    signatureSuite: 'jcs-ed25519-sha256-v1',
    publicKey: { encoding: 'base64url', material: 'test-public-key' },
    createdAt: 1,
  })),
  verifyWithDelegationSigningPublicKey: vi.fn(async () => true),
}));

const PUBLIC_AUTHOR = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ISSUED_AT = 1_777_777_777_000;

async function identity(overrides: Partial<IdentityRecord> = {}): Promise<IdentityRecord> {
  return {
    id: 'identity-1',
    createdAt: ISSUED_AT,
    attestation: {
      platform: 'web',
      integrityToken: 'token',
      deviceKey: 'device-key',
      nonce: 'nonce',
    },
    assuranceEnvelope: await createBetaLocalAssuranceEnvelope({
      deviceCredential: 'device-key',
      issuedAt: ISSUED_AT,
      ttlSeconds: 600,
    }),
    session: {
      token: 'session-token',
      trustScore: 0.5,
      scaledTrustScore: 5000,
      nullifier: 'nullifier',
      createdAt: ISSUED_AT,
      expiresAt: ISSUED_AT + 600_000,
    },
    ...overrides,
  };
}

async function signedEnvelope(record: IdentityRecord) {
  return createSignedWriteEnvelope({
    profile: 'public-beta',
    audience: 'vh-forum-thread',
    origin: 'https://vh.example',
    scheme: 'forum-author-v1',
    publicAuthor: createLumaPublicAuthorId(PUBLIC_AUTHOR, 'forum-author-v1'),
    sessionRef: await deriveIdentitySignedWriteSessionRef(record),
    payload: {
      schemaVersion: 'hermes-thread-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'forum-author-v1',
      id: 'thread-1',
      title: 'Hello',
      content: 'World',
      author: PUBLIC_AUTHOR,
      timestamp: ISSUED_AT,
      tags: ['mvp'],
    },
    sequence: ISSUED_AT,
    nonce: '00112233445566778899aabbccddeeff',
    issuedAt: ISSUED_AT,
    sign: async () => 'test-signature',
  });
}

describe('MVP LUMA action policy', () => {
  it('allows public-beta signed writes only with an active beta-local AssuranceEnvelope session', async () => {
    const record = await identity();
    const envelope = await signedEnvelope(record);

    await expect(assertCanPerformMvpAction({
      identity: record,
      profile: 'public-beta',
      action: 'vh-forum-thread',
      envelope,
      scheme: 'forum-author-v1',
      publicAuthor: PUBLIC_AUTHOR,
      origin: 'https://vh.example',
      now: ISSUED_AT + 1,
    })).resolves.toMatchObject({
      allowed: true,
      limitations: expect.arrayContaining(['no-remote-attestation']),
    });
  });

  it('fails closed when the AssuranceEnvelope is missing or expired', async () => {
    const missingEnvelope = await identity({ assuranceEnvelope: undefined });
    expect(() => assertMvpActionIdentityReady({
      identity: missingEnvelope,
      profile: 'public-beta',
      action: 'vh-stance-vote',
      now: ISSUED_AT + 1,
    })).toThrow(/AssuranceEnvelope/);

    const malformedEnvelope = await identity({
      assuranceEnvelope: {
        ...(await createBetaLocalAssuranceEnvelope({
          deviceCredential: 'device-key',
          issuedAt: ISSUED_AT,
          ttlSeconds: 600,
        })),
        signatureSuite: 'jcs-ed25519-sha512-v1',
      },
    });
    expect(() => assertMvpActionIdentityReady({
      identity: malformedEnvelope,
      profile: 'public-beta',
      action: 'vh-stance-vote',
      now: ISSUED_AT + 1,
    })).toThrow(/signatureSuite/);

    const expired = await identity({
      session: {
        token: 'session-token',
        trustScore: 0.5,
        scaledTrustScore: 5000,
        nullifier: 'nullifier',
        createdAt: ISSUED_AT,
        expiresAt: ISSUED_AT + 10,
      },
    });
    expect(() => assertMvpActionIdentityReady({
      identity: expired,
      profile: 'public-beta',
      action: 'vh-stance-clear',
      now: ISSUED_AT + 11,
    })).toThrow(/expired/);
  });

  it('rejects unsupported actions, missing sessions, and wrong deployment profiles', async () => {
    const record = await identity();

    expect(() => assertMvpActionIdentityReady({
      identity: record,
      profile: 'public-beta',
      action: 'vh-unsupported' as never,
      now: ISSUED_AT + 1,
    })).toThrow(/Unsupported MVP LUMA action/);
    expect(() => assertMvpActionIdentityReady({
      identity: null,
      profile: 'public-beta',
      action: 'vh-forum-thread',
      now: ISSUED_AT + 1,
    })).toThrow(/active identity/);
    expect(() => assertMvpActionIdentityReady({
      identity: record,
      profile: 'e2e',
      action: 'vh-forum-thread',
      now: ISSUED_AT + 1,
    })).toThrow(/requires public-beta profile/);
  });

  it('derives legacy session refs only when an explicit compatibility caller asks for them', async () => {
    const missingToken = await identity({
      session: {
        trustScore: 0.5,
        scaledTrustScore: 5000,
        nullifier: 'nullifier',
        createdAt: ISSUED_AT,
        expiresAt: ISSUED_AT + 600_000,
      } as IdentityRecord['session'],
    });
    await expect(deriveIdentitySignedWriteSessionRef(missingToken))
      .rejects.toThrow(/active session token/);

    const legacy = await identity({ assuranceEnvelope: undefined });
    await expect(deriveIdentitySignedWriteSessionRef(legacy))
      .rejects.toThrow(/AssuranceEnvelope/);
    await expect(deriveIdentitySignedWriteSessionRef(legacy, { allowLegacySessionDigest: true }))
      .resolves.toMatchObject({
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        envelopeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
  });

  it('rejects mismatched signed-write policy boundaries', async () => {
    const record = await identity();
    const envelope = await signedEnvelope(record);

    await expect(assertCanPerformMvpAction({
      identity: record,
      profile: 'public-beta',
      action: 'vh-forum-comment',
      envelope,
      scheme: 'forum-author-v1',
      publicAuthor: PUBLIC_AUTHOR,
      origin: 'https://vh.example',
      now: ISSUED_AT + 1,
    })).rejects.toThrow(/audience_mismatch/);
  });
});
