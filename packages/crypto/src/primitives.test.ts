import { describe, expect, it } from 'vitest';
import { randomBytes, sha256 } from './primitives';

describe('crypto primitives', () => {
  it('creates deterministic SHA-256 digests', async () => {
    const digest = await sha256('hello world');
    expect(digest).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('returns secure random bytes of the requested length', async () => {
    const size = 32;
    const bytes = await randomBytes(size);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(size);
    const uniqueValues = new Set(bytes);
    expect(uniqueValues.size).toBeGreaterThan(1);
  });
});
