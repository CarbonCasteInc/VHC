/**
 * @deprecated Compatibility shim. Import the beta-local constituency provider
 * from @vh/luma-sdk instead.
 */

import {
  BETA_LOCAL_MERKLE_ROOT_PREFIX,
  getBetaLocalConstituencyProof,
  isBetaLocalConstituencyProof,
} from '@vh/luma-sdk';
import type { ConstituencyProof } from '@vh/types';

export { BETA_LOCAL_MERKLE_ROOT_PREFIX, isBetaLocalConstituencyProof };

export function getRealConstituencyProof(
  nullifier: string,
  districtHash: string,
): ConstituencyProof {
  console.warn(
    '[luma] getRealConstituencyProof is deprecated; import BetaLocalConstituencyProvider from @vh/luma-sdk.',
  );
  return getBetaLocalConstituencyProof(nullifier, districtHash);
}
