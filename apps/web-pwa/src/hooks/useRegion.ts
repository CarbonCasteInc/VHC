import { useIdentity } from './useIdentity';
import type { ConstituencyProof } from '@vh/types';
import { useMemo } from 'react';
import { isProofVerificationEnabled } from '../store/bridge/constituencyProof';
import { getTransitionalConstituencyProof } from '../store/bridge/transitionalConstituencyProof';

// TRANSITIONAL: Remove when Phase 1 real proof-provider ships (see FPD RFC Phase 1/S1)
export function useRegion(): { proof: ConstituencyProof | null } {
  const { identity } = useIdentity();

  const proof = useMemo(() => {
    const nullifier = identity?.session?.nullifier;
    if (!nullifier) return null;

    if (isProofVerificationEnabled()) {
      return null;
    }

    return getTransitionalConstituencyProof(nullifier);
  }, [identity?.session?.nullifier]);

  return { proof };
}
