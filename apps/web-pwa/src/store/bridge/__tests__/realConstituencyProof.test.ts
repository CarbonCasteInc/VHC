import { describe, expect, it } from 'vitest';
import { verifyConstituencyProof } from '@vh/types';
import { ConstituencyProofSchema } from '@vh/data-model';
import {
  BETA_LOCAL_MERKLE_ROOT_PREFIX,
  getRealConstituencyProof,
  isBetaLocalConstituencyProof,
} from '../realConstituencyProof';

function isMockProof(proof: { district_hash: string; merkle_root: string }): boolean {
  return proof.district_hash === 'mock-district-hash' || proof.merkle_root === 'mock-root';
}

function isTransitionalProof(proof: { district_hash: string; merkle_root: string }): boolean {
  return proof.district_hash.startsWith('t9n-') || proof.merkle_root.startsWith('t9n-');
}

describe('getRealConstituencyProof', () => {
  const nullifier = 'real-nullifier-abc';
  const district = 'us-ca-12-hash';

  it('returns valid ConstituencyProof shape', () => {
    const proof = getRealConstituencyProof(nullifier, district);

    expect(ConstituencyProofSchema.safeParse(proof).success).toBe(true);
    expect(proof.district_hash).toBe(district);
    expect(proof.nullifier).toBe(nullifier);
    expect(proof.merkle_root).toBeTruthy();
    expect(proof.merkle_root).toMatch(
      new RegExp(`^${BETA_LOCAL_MERKLE_ROOT_PREFIX}`),
    );
  });

  it('labels generated proof material as beta-local, not cryptographic residency proof', () => {
    const proof = getRealConstituencyProof(nullifier, district);

    expect(isBetaLocalConstituencyProof(proof)).toBe(true);
  });

  it('is not mock', () => {
    const proof = getRealConstituencyProof(nullifier, district);

    expect(isMockProof(proof)).toBe(false);
  });

  it('is not transitional', () => {
    const proof = getRealConstituencyProof(nullifier, district);

    expect(isTransitionalProof(proof)).toBe(false);
  });

  it('passes verifyConstituencyProof with matching district', () => {
    const proof = getRealConstituencyProof(nullifier, district);

    expect(verifyConstituencyProof(proof, nullifier, district)).toEqual({ valid: true });
  });

  it('is deterministic for same inputs', () => {
    const first = getRealConstituencyProof(nullifier, district);
    const second = getRealConstituencyProof(nullifier, district);

    expect(second).toEqual(first);
  });

  it('differs for different nullifiers', () => {
    const first = getRealConstituencyProof('null-1', district);
    const second = getRealConstituencyProof('null-2', district);

    expect(first.merkle_root).not.toBe(second.merkle_root);
  });

  it('differs for different districts', () => {
    const first = getRealConstituencyProof(nullifier, 'district-a');
    const second = getRealConstituencyProof(nullifier, 'district-b');

    expect(first.district_hash).not.toBe(second.district_hash);
    expect(first.merkle_root).not.toBe(second.merkle_root);
  });

  it('uses provided district hash, not a nullifier-derived district value', () => {
    const proof = getRealConstituencyProof(nullifier, district);

    expect(proof.district_hash).toBe(district);
    expect(proof.district_hash).not.toContain(nullifier);
  });
});
