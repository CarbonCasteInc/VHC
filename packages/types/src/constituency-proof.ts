/**
 * Canonical constituency proof shape.
 * Spec: spec-identity-trust-constituency.md v0.2 §4.1
 *
 * Extracted to its own module to avoid circular imports
 * between the barrel (index.ts) and constituency-verification.ts.
 */
export interface ConstituencyProof {
  district_hash: string;
  nullifier: string;
  merkle_root: string;
}
