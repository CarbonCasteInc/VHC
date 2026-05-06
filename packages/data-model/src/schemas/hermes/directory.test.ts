import { describe, expect, it } from 'vitest';
import { DirectoryEntrySchema } from './directory';

describe('DirectoryEntrySchema', () => {
  it('accepts a valid entry', () => {
    const parsed = DirectoryEntrySchema.parse({
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'user-nullifier',
      devicePub: 'device-pub',
      epub: 'device-epub',
      displayName: 'Alice',
      registeredAt: Date.now(),
      lastSeenAt: Date.now()
    });

    expect(parsed.devicePub).toBe('device-pub');
    expect(parsed.epub).toBe('device-epub');
  });

  it('accepts optional delegation signing public key material', () => {
    const parsed = DirectoryEntrySchema.parse({
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'user-nullifier',
      devicePub: 'device-pub',
      epub: 'device-epub',
      delegationSigningPublicKey: {
        signatureSuite: 'jcs-ed25519-sha256-v1',
        publicKey: { encoding: 'base64url', material: 'public-material' },
        createdAt: 1777777777000
      },
      registeredAt: Date.now(),
      lastSeenAt: Date.now()
    });

    expect(parsed.delegationSigningPublicKey?.publicKey.material).toBe('public-material');
    expect(JSON.stringify(parsed)).not.toContain('privateKey');
  });

  it('keeps legacy directory entries without delegation public key backward compatible', () => {
    expect(DirectoryEntrySchema.safeParse({
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'legacy-nullifier',
      devicePub: 'legacy-device-pub',
      epub: 'legacy-epub',
      registeredAt: 1,
      lastSeenAt: 2
    }).success).toBe(true);
  });

  it('rejects malformed delegation signing public key material', () => {
    const result = DirectoryEntrySchema.safeParse({
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'user-nullifier',
      devicePub: 'device-pub',
      epub: 'device-epub',
      delegationSigningPublicKey: {
        signatureSuite: 'jcs-ed25519-sha256-v1',
        publicKey: { encoding: 'base64url', material: '' },
        createdAt: -1
      },
      registeredAt: Date.now(),
      lastSeenAt: Date.now()
    });

    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = DirectoryEntrySchema.safeParse({
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'user-nullifier',
      registeredAt: Date.now(),
      lastSeenAt: Date.now()
    });

    expect(result.success).toBe(false);
  });

  it('rejects wrong schema version', () => {
    const result = DirectoryEntrySchema.safeParse({
      schemaVersion: 'hermes-directory-v1',
      nullifier: 'user-nullifier',
      devicePub: 'device-pub',
      epub: 'device-epub',
      registeredAt: Date.now(),
      lastSeenAt: Date.now()
    });

    expect(result.success).toBe(false);
  });
});
