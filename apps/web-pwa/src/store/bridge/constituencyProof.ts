import type { ConstituencyProof } from '@vh/data-model';

/* v8 ignore start */
export function isProofVerificationEnabled(): boolean {
  try {
    const importMetaEnv = (import.meta as any).env;
    const processEnv = (globalThis as any).process?.env;
    return (importMetaEnv?.VITE_CONSTITUENCY_PROOF_REAL ?? processEnv?.VITE_CONSTITUENCY_PROOF_REAL) === 'true';
  } catch {
    return false;
  }
}
/* v8 ignore stop */

export function getMockConstituencyProof(
  districtHash: string,
  nullifier?: string,
): ConstituencyProof {
  return {
    district_hash: districtHash,
    nullifier: nullifier ?? 'mock-nullifier',
    merkle_root: 'mock-root',
  };
}
