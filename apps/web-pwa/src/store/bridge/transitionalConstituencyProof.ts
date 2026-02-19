// TRANSITIONAL: Remove when Phase 1 real proof-provider ships (see FPD RFC Phase 1/S1)

import type { ConstituencyProof } from '@vh/types';

function hashFragment(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deriveValue(kind: 'district' | 'root', nullifier: string): string {
  const basis = `${kind}:${nullifier}`;
  const first = hashFragment(basis);
  const second = hashFragment(`${basis}:${first}`);
  return `t9n-${kind}-${first}${second}`;
}

export function getTransitionalConstituencyProof(nullifier: string): ConstituencyProof {
  return {
    district_hash: deriveValue('district', nullifier),
    nullifier,
    merkle_root: deriveValue('root', nullifier),
  };
}
