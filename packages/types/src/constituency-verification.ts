// Spec: spec-identity-trust-constituency.md v0.2 §4.2

import type { ConstituencyProof } from './constituency-proof';

export type ProofVerificationError =
  | 'nullifier_mismatch'
  | 'district_mismatch'
  | 'stale_proof'
  | 'malformed_proof';

export interface ProofVerificationResult {
  valid: boolean;
  error?: ProofVerificationError;
}

export function verifyConstituencyProof(
  proof: ConstituencyProof | null | undefined,
  expectedNullifier: string,
  expectedDistrictHash: string,
): ProofVerificationResult {
  // 1. Malformed check
  if (
    !proof ||
    !proof.district_hash ||
    !proof.nullifier ||
    proof.merkle_root === undefined ||
    proof.merkle_root === null
  ) {
    return { valid: false, error: 'malformed_proof' };
  }

  // 2. Nullifier match
  if (proof.nullifier !== expectedNullifier) {
    return { valid: false, error: 'nullifier_mismatch' };
  }

  // 3. District match
  if (proof.district_hash !== expectedDistrictHash) {
    return { valid: false, error: 'district_mismatch' };
  }

  // 4. Freshness — Season 0 no-op (empty root only fails)
  if (!proof.merkle_root.trim()) {
    return { valid: false, error: 'stale_proof' };
  }

  return { valid: true };
}
