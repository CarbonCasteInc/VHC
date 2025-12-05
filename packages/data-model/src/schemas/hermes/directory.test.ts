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
