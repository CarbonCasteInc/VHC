import { useMemo } from 'react';
import type { ConstituencyProof } from '@vh/types';
import { verifyConstituencyProof } from '@vh/types';
import { useIdentity } from './useIdentity';
import { useRegion } from './useRegion';

export interface ConstituencyProofState {
  readonly proof: ConstituencyProof | null;
  readonly error: string | null;
}

function isMockProof(proof: ConstituencyProof): boolean {
  return proof.district_hash === 'mock-district-hash' || proof.merkle_root === 'mock-root';
}

/**
 * L1 guardrail: ensure feed voting has a valid constituency proof derived from identity.
 * If identity/proof is missing or malformed, callers get a clear error and can hard-stop writes.
 */
export function useConstituencyProof(): ConstituencyProofState {
  const { identity } = useIdentity();
  const { proof } = useRegion();

  return useMemo(() => {
    const nullifier = identity?.session?.nullifier;
    if (!nullifier) {
      return {
        proof: null,
        error: 'Identity nullifier unavailable; create/sign in before voting',
      };
    }

    if (!proof) {
      return {
        proof: null,
        error: 'Constituency proof unavailable for current identity',
      };
    }

    if (isMockProof(proof)) {
      return {
        proof: null,
        error: 'Mock constituency proof detected; voting requires a verified proof source',
      };
    }

    const verification = verifyConstituencyProof(proof, nullifier, proof.district_hash);
    if (!verification.valid) {
      return {
        proof: null,
        error: `Invalid constituency proof: ${verification.error}`,
      };
    }

    return { proof, error: null };
  }, [identity?.session?.nullifier, proof]);
}
