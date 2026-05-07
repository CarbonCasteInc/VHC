import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryEntry } from '@vh/data-model';
import {
  createLumaPublicAuthorId,
  createSignedWriteEnvelope,
  verifySignedWriteEnvelope
} from '@vh/luma-sdk';
import {
  signWithStoredDelegationSigningKey,
  verifyWithDelegationSigningPublicKey
} from '@vh/identity-vault';
import { deriveIdentityDirectoryKey, type IdentityRecord } from '@vh/types';
import { publishDirectoryEntry } from './index';

const mockPublishToDirectory = vi.hoisted(() => vi.fn());

vi.mock('@vh/gun-client', () => ({
  createClient: vi.fn(),
  publishToDirectory: (...args: unknown[]) => mockPublishToDirectory(...args)
}));

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

const IDENTITY_RECORD: IdentityRecord = {
  id: 'identity-1',
  createdAt: 1777777777000,
  attestation: {
    platform: 'web',
    integrityToken: 'integrity-token',
    deviceKey: 'device-credential',
    nonce: 'attestation-nonce'
  },
  session: {
    token: 'session-token',
    trustScore: 1,
    scaledTrustScore: 10000,
    nullifier: 'identity-directory-id',
    createdAt: 1777777777000,
    expiresAt: 0
  },
  devicePair: {
    pub: 'device-pub',
    priv: 'device-priv',
    epub: 'device-epub',
    epriv: 'device-epriv'
  }
};

describe('LUMA delegation signer directory preflight', () => {
  beforeEach(async () => {
    await deleteDatabase('vh-vault');
    mockPublishToDirectory.mockReset();
  });

  it('publishes only the delegation public key and verifies a SignedWriteEnvelope with it', async () => {
    await publishDirectoryEntry({} as never, IDENTITY_RECORD);

    const publishedEntry = mockPublishToDirectory.mock.calls[0]?.[1] as DirectoryEntry;
    const identityDirectoryKey = await deriveIdentityDirectoryKey(IDENTITY_RECORD.session.nullifier);
    const { signedWriteEnvelope, ...signedPayload } = publishedEntry;

    expect(publishedEntry).toMatchObject({
      schemaVersion: 'hermes-directory-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'identity-directory-v1',
      identityDirectoryKey,
      devicePub: IDENTITY_RECORD.devicePair?.pub,
      epub: IDENTITY_RECORD.devicePair?.epub
    });
    expect(JSON.stringify(publishedEntry)).not.toContain(IDENTITY_RECORD.session.nullifier);
    expect(publishedEntry.delegationSigningPublicKey).toEqual({
      signatureSuite: 'jcs-ed25519-sha256-v1',
      publicKey: {
        encoding: 'base64url',
        material: expect.any(String)
      },
      createdAt: expect.any(Number)
    });
    expect(JSON.stringify(publishedEntry)).not.toContain('privateKey');
    expect(signedWriteEnvelope).toMatchObject({
      audience: 'vh-directory-entry',
      scheme: 'identity-directory-v1',
      publicAuthor: identityDirectoryKey,
      payload: signedPayload
    });

    await expect(verifySignedWriteEnvelope({
      envelope: signedWriteEnvelope,
      verify: ({ canonicalBytes, signature }) => verifyWithDelegationSigningPublicKey({
        key: publishedEntry.delegationSigningPublicKey!,
        message: canonicalBytes,
        signature
      })
    })).resolves.toMatchObject({
      valid: true,
      envelope: signedWriteEnvelope
    });

    const envelope = await createSignedWriteEnvelope({
      profile: 'public-beta',
      audience: 'vh-forum-thread',
      origin: 'https://vh.example',
      scheme: 'forum-author-v1',
      publicAuthor: createLumaPublicAuthorId(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'forum-author-v1'
      ),
      sessionRef: {
        tokenHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        envelopeDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      },
      payload: {
        title: 'directory public-key preflight',
        body: 'future adapters can verify this envelope with directory material'
      },
      sequence: 1,
      nonce: '00112233445566778899aabbccddeeff',
      issuedAt: 1777777777000,
      sign: ({ canonicalBytes }) => signWithStoredDelegationSigningKey(canonicalBytes)
    });

    await expect(verifySignedWriteEnvelope({
      envelope,
      verify: ({ canonicalBytes, signature }) => verifyWithDelegationSigningPublicKey({
        key: publishedEntry.delegationSigningPublicKey!,
        message: canonicalBytes,
        signature
      })
    })).resolves.toMatchObject({
      valid: true,
      envelope
    });
  });
});
