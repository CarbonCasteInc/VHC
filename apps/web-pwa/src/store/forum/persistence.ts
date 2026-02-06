import type { IdentityRecord } from './types';
import { VOTES_KEY_PREFIX } from './types';
import { getPublishedIdentity } from '../identityProvider';

export function loadIdentity(): IdentityRecord | null {
  const snapshot = getPublishedIdentity();
  if (!snapshot) return null;
  // Return shape compatible with IdentityRecord (only public fields populated).
  return { session: snapshot.session } as IdentityRecord;
}

export function loadVotesFromStorage(nullifier: string): Map<string, 'up' | 'down' | null> {
  try {
    const raw = localStorage.getItem(`${VOTES_KEY_PREFIX}${nullifier}`);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
}

export function persistVotes(nullifier: string, votes: Map<string, 'up' | 'down' | null>): void {
  localStorage.setItem(`${VOTES_KEY_PREFIX}${nullifier}`, JSON.stringify(Object.fromEntries(votes)));
}

