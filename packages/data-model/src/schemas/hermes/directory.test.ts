import { describe, expect, it } from 'vitest';
import {
  DIRECTORY_ENTRY_AUTHOR_SCHEME,
  DIRECTORY_ENTRY_AUDIENCE,
  DIRECTORY_ENTRY_PROTOCOL_VERSION,
  DIRECTORY_ENTRY_WRITER_KIND,
  DirectoryEntryPayloadSchema,
  DirectoryEntrySchema,
  LegacyDirectoryEntrySchema
} from './directory';

const IDENTITY_DIRECTORY_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const delegationSigningPublicKey = {
  signatureSuite: 'jcs-ed25519-sha256-v1',
  publicKey: { encoding: 'base64url', material: 'public-material' },
  createdAt: 1777777777000
} as const;

function directoryPayload() {
  return {
    schemaVersion: 'hermes-directory-v1',
    _protocolVersion: DIRECTORY_ENTRY_PROTOCOL_VERSION,
    _writerKind: DIRECTORY_ENTRY_WRITER_KIND,
    _authorScheme: DIRECTORY_ENTRY_AUTHOR_SCHEME,
    identityDirectoryKey: IDENTITY_DIRECTORY_KEY,
    devicePub: 'device-pub',
    epub: 'device-epub',
    displayName: 'Alice',
    delegationSigningPublicKey,
    registeredAt: 1777777777000,
    lastSeenAt: 1777777778000
  };
}

function signedWriteEnvelope(payload = directoryPayload()) {
  return {
    envelopeVersion: 1,
    signatureSuite: 'jcs-ed25519-sha256-v1',
    protocolVersion: 'luma-write-v1',
    profile: 'public-beta',
    audience: DIRECTORY_ENTRY_AUDIENCE,
    origin: 'https://vh.example',
    scheme: DIRECTORY_ENTRY_AUTHOR_SCHEME,
    publicAuthor: IDENTITY_DIRECTORY_KEY,
    sessionRef: {
      tokenHash: 'token-hash',
      envelopeDigest: 'envelope-digest'
    },
    payload,
    payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sequence: 1777777777000,
    nonce: '00112233445566778899aabbccddeeff',
    idempotencyKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    issuedAt: 1777777777000,
    signature: 'signature'
  };
}

describe('DirectoryEntrySchema', () => {
  it('accepts a strict LUMA v1 directory entry', () => {
    const payload = directoryPayload();
    const parsed = DirectoryEntrySchema.parse({
      ...payload,
      signedWriteEnvelope: signedWriteEnvelope(payload)
    });

    expect(parsed.identityDirectoryKey).toBe(IDENTITY_DIRECTORY_KEY);
    expect(parsed._writerKind).toBe('luma');
    expect(JSON.stringify(parsed)).not.toContain('nullifier');
    expect(JSON.stringify(parsed)).not.toContain('privateKey');
  });

  it('keeps the signed payload shape separate from the envelope field', () => {
    const payload = directoryPayload();

    expect(DirectoryEntryPayloadSchema.parse(payload)).toEqual(payload);
    expect(DirectoryEntryPayloadSchema.safeParse({
      ...payload,
      signedWriteEnvelope: signedWriteEnvelope(payload)
    }).success).toBe(false);
  });

  it('rejects raw-nullifier and private-key-shaped public records', () => {
    const payload = directoryPayload();

    expect(DirectoryEntrySchema.safeParse({
      ...payload,
      nullifier: 'raw-principal-nullifier',
      signedWriteEnvelope: signedWriteEnvelope(payload)
    }).success).toBe(false);

    expect(DirectoryEntrySchema.safeParse({
      ...payload,
      delegationSigningPublicKey: {
        ...delegationSigningPublicKey,
        privateKey: { encoding: 'base64url', material: 'secret-material' }
      },
      signedWriteEnvelope: signedWriteEnvelope(payload)
    }).success).toBe(false);
  });

  it('rejects unsupported directory protocol fields and malformed envelope metadata', () => {
    const payload = directoryPayload();

    expect(DirectoryEntrySchema.safeParse({
      ...payload,
      _authorScheme: 'legacy-nullifier',
      signedWriteEnvelope: signedWriteEnvelope(payload)
    }).success).toBe(false);

    expect(DirectoryEntrySchema.safeParse({
      ...payload,
      signedWriteEnvelope: {
        ...signedWriteEnvelope(payload),
        audience: 'vh-forum-thread'
      }
    }).success).toBe(false);

    expect(DirectoryEntrySchema.safeParse({
      ...payload,
      signedWriteEnvelope: {
        ...signedWriteEnvelope(payload),
        publicAuthor: 'not-lower-hex'
      }
    }).success).toBe(false);
  });

  it('keeps legacy v0 records read-only under the legacy schema', () => {
    const legacy = {
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'legacy-nullifier',
      devicePub: 'legacy-device-pub',
      epub: 'legacy-epub',
      delegationSigningPublicKey,
      registeredAt: 1,
      lastSeenAt: 2
    };

    expect(LegacyDirectoryEntrySchema.safeParse(legacy).success).toBe(true);
    expect(DirectoryEntrySchema.safeParse(legacy).success).toBe(false);
  });
});
