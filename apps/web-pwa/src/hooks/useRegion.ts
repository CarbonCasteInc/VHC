import { useIdentity } from './useIdentity';
import type { ConstituencyProof } from '@vh/types';
import { betaLocalConstituencyProvider } from '@vh/luma-sdk';
import { useMemo } from 'react';
import { getConfiguredDistrict } from '../store/bridge/districtConfig';

export function useRegion(): { proof: ConstituencyProof | null } {
  const { identity } = useIdentity();

  const proof = useMemo(() => {
    const nullifier = identity?.session?.nullifier;
    if (!nullifier) return null;

    return betaLocalConstituencyProvider.getProofSync({
      nullifier,
      districtHash: getConfiguredDistrict()
    });
  }, [identity?.session?.nullifier]);

  return { proof };
}
