import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveForumAuthorId, type IdentityRecord } from '@vh/types';
import { NominationEventSchemaV1 } from '@vh/data-model';
import { createLumaNominationEvent } from './nominationLumaRecords';

vi.mock('@vh/identity-vault', () => ({
  signWithStoredDelegationSigningKey: vi.fn(async () => 'nomination-delegation-signature')
}));

const rawNullifier = 'nomination-helper-raw-nullifier';
const identity: IdentityRecord = {
  id: 'identity-1',
  createdAt: 1,
  attestation: {
    platform: 'web',
    integrityToken: 'integrity-token',
    deviceKey: 'device-key',
    nonce: 'nonce'
  },
  session: {
    token: 'session-token',
    trustScore: 1,
    scaledTrustScore: 10_000,
    nullifier: rawNullifier,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_086_400_000
  }
};

describe('createLumaNominationEvent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives a forum author nominator id and signs immutable nomination fields', async () => {
    vi.stubGlobal('location', { origin: 'https://vh.example' });
    const expectedAuthorId = await deriveForumAuthorId(rawNullifier);

    const nomination = await createLumaNominationEvent({
      identity,
      id: 'nom-1',
      topicId: 'topic-42',
      sourceType: 'news',
      sourceId: 'source-99',
      createdAt: 123
    });

    expect(nomination).toMatchObject({
      schemaVersion: 'hermes-nomination-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'forum-author-v1',
      nominatorAuthorId: expectedAuthorId,
      signedWriteEnvelope: {
        audience: 'vh-forum-nomination',
        origin: 'https://vh.example',
        scheme: 'forum-author-v1',
        publicAuthor: expectedAuthorId,
        payload: {
          id: 'nom-1',
          topicId: 'topic-42',
          sourceType: 'news',
          sourceId: 'source-99',
          nominatorAuthorId: expectedAuthorId,
          createdAt: 123
        }
      }
    });
    expect(NominationEventSchemaV1.safeParse(nomination).success).toBe(true);
    expect(JSON.stringify(nomination)).not.toContain(rawNullifier);
  });

  it('falls back to local origin', async () => {
    const nomination = await createLumaNominationEvent({
      identity,
      id: 'nom-2',
      topicId: 'topic-42',
      sourceType: 'article',
      sourceId: 'article-1',
      createdAt: 124
    });

    expect(nomination.signedWriteEnvelope.origin).toBe('vh://local');
  });

  it('fails closed without a complete identity session', async () => {
    await expect(createLumaNominationEvent({
      identity: null,
      id: 'nom-3',
      topicId: 'topic-42',
      sourceType: 'topic',
      sourceId: 'topic-42',
      createdAt: 125
    })).rejects.toThrow('LUMA forum writes require a full identity session');
  });
});
