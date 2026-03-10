import { describe, expect, it } from 'vitest';
import { hexHammingDistance, seededHash32, sha256Hex, stableNumericSeed } from './hashUtils';

describe('hashUtils', () => {
  it('derives stable sha256 prefixes', () => {
    expect(sha256Hex('abc')).toHaveLength(16);
    expect(sha256Hex('abc', 8)).toHaveLength(8);
    expect(sha256Hex('abc', 0)).toHaveLength(64);
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
  });

  it('derives stable numeric hashes', () => {
    expect(seededHash32('alpha')).toBe(seededHash32('alpha'));
    expect(seededHash32('alpha')).not.toBe(seededHash32('beta'));
    expect(stableNumericSeed('seed')).toBe(stableNumericSeed('seed'));
  });

  it('computes hamming distance for hex strings and guards invalid inputs', () => {
    expect(hexHammingDistance(undefined, 'ff')).toBeNull();
    expect(hexHammingDistance('ff', undefined)).toBeNull();
    expect(hexHammingDistance('ff', 'fff')).toBeNull();
    expect(hexHammingDistance('zz', 'ff')).toBeNull();
    expect(hexHammingDistance('0f', 'f0')).toBe(8);
    expect(hexHammingDistance('0f', '0f')).toBe(0);
  });
});
