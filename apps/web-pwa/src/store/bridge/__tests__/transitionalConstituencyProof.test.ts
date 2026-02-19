import { describe, expect, it } from 'vitest';
import { ConstituencyProofSchema } from '@vh/data-model';
import { verifyConstituencyProof } from '@vh/types';
import { getTransitionalConstituencyProof } from '../transitionalConstituencyProof';

function isMockProof(proof: { district_hash: string; merkle_root: string }): boolean {
  return proof.district_hash === 'mock-district-hash' || proof.merkle_root === 'mock-root';
}

describe('getTransitionalConstituencyProof', () => {
  it('returns a valid ConstituencyProof shape', () => {
    const proof = getTransitionalConstituencyProof('nullifier-abc');
    const parsed = ConstituencyProofSchema.safeParse(proof);

    expect(parsed.success).toBe(true);
  });

  it('produces proof that isMockProof treats as non-mock', () => {
    const proof = getTransitionalConstituencyProof('nullifier-abc');

    expect(isMockProof(proof)).toBe(false);
  });

  it('passes verifyConstituencyProof checks', () => {
    const nullifier = 'nullifier-abc';
    const proof = getTransitionalConstituencyProof(nullifier);

    const result = verifyConstituencyProof(proof, nullifier, proof.district_hash);

    expect(result).toEqual({ valid: true });
  });

  it('is deterministic for the same nullifier', () => {
    const nullifier = 'nullifier-repeat';

    const first = getTransitionalConstituencyProof(nullifier);
    const second = getTransitionalConstituencyProof(nullifier);

    expect(second).toEqual(first);
  });

  it('produces different district/root values for different nullifiers', () => {
    const first = getTransitionalConstituencyProof('nullifier-1');
    const second = getTransitionalConstituencyProof('nullifier-2');

    expect(second.district_hash).not.toBe(first.district_hash);
    expect(second.merkle_root).not.toBe(first.merkle_root);
  });
});
