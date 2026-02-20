import { useIdentity } from './useIdentity';
import type { ConstituencyProof } from '@vh/types';
import { useMemo } from 'react';
import { getRealConstituencyProof } from '../store/bridge/realConstituencyProof';
import { getConfiguredDistrict } from '../store/bridge/districtConfig';

export function useRegion(): { proof: ConstituencyProof | null } {
  const { identity } = useIdentity();

  const proof = useMemo(() => {
    const nullifier = identity?.session?.nullifier;
    if (!nullifier) return null;

    return getRealConstituencyProof(nullifier, getConfiguredDistrict());
  }, [identity?.session?.nullifier]);

  return { proof };
}
