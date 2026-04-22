import { useMemo } from 'react';
import type { ConstituencyProof } from '@vh/types';
import { verifyConstituencyProof } from '@vh/types';
import { useIdentity } from './useIdentity';
import { useRegion } from './useRegion';
import { isProofVerificationEnabled } from '../store/bridge/constituencyProof';
import { getConfiguredDistrict } from '../store/bridge/districtConfig';

export type ConstituencyProofAssurance = 'none' | 'beta_local';

export interface ConstituencyProofState {
  readonly proof: ConstituencyProof | null;
  readonly error: string | null;
  readonly assurance: ConstituencyProofAssurance;
  readonly canClaimVerifiedHuman: false;
  readonly canClaimDistrictProof: false;
  readonly canClaimSybilResistance: false;
}

const NO_PRODUCTION_PROOF_CLAIMS = {
  canClaimVerifiedHuman: false,
  canClaimDistrictProof: false,
  canClaimSybilResistance: false,
} as const;

function blockedProof(error: string): ConstituencyProofState {
  return {
    proof: null,
    error,
    assurance: 'none',
    ...NO_PRODUCTION_PROOF_CLAIMS,
  };
}

function acceptedBetaLocalProof(proof: ConstituencyProof): ConstituencyProofState {
  return {
    proof,
    error: null,
    assurance: 'beta_local',
    ...NO_PRODUCTION_PROOF_CLAIMS,
  };
}

function isMockProof(proof: ConstituencyProof): boolean {
  return proof.district_hash === 'mock-district-hash' || proof.merkle_root === 'mock-root';
}

function isTransitionalProof(proof: ConstituencyProof): boolean {
  return proof.district_hash.startsWith('t9n-') || proof.merkle_root.startsWith('t9n-');
}

/**
 * L1 guardrail: ensure feed voting has a valid beta-local proof derived from identity.
 * If identity/proof is missing or malformed, callers get a clear error and can hard-stop writes.
 *
 * Current Season 0 runtime intentionally does not expose production proof claims:
 * the deterministic `s0-root-*` provider can support MVP stance persistence, but
 * not verified-human, district-proof, or Sybil-resistant product language.
 */
export function useConstituencyProof(): ConstituencyProofState {
  const { identity } = useIdentity();
  const { proof } = useRegion();
  const realMode = isProofVerificationEnabled();

  return useMemo(() => {
    const nullifier = identity?.session?.nullifier;
    if (!nullifier) {
      return blockedProof('Identity unavailable; create or sign in to save your stance');
    }

    if (!proof) {
      return blockedProof('Beta-local identity proof unavailable for current identity');
    }

    if (isMockProof(proof)) {
      return blockedProof('Mock proof detected; beta-local identity required to save stance');
    }

    if (realMode && isTransitionalProof(proof)) {
      return blockedProof('Transitional proof rejected in strict mode; production proof provider required');
    }

    const expectedDistrict = realMode ? getConfiguredDistrict() : proof.district_hash;
    const verification = verifyConstituencyProof(proof, nullifier, expectedDistrict);
    if (!verification.valid) {
      return blockedProof(`Invalid beta-local proof: ${verification.error}`);
    }

    // Today every accepted runtime proof is beta-local. Do not infer stronger
    // assurance from the canonical shape until a cryptographic provider lands.
    return acceptedBetaLocalProof(proof);
  }, [identity?.session?.nullifier, proof, realMode]);
}
