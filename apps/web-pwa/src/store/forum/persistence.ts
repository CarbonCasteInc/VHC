import type { ForumIdentity } from './types';
import { VOTES_KEY_PREFIX } from './types';
import { getPublishedIdentity } from '../identityProvider';
import { safeGetItem, safeSetItem } from '../../utils/safeStorage';

export function loadIdentity(): ForumIdentity | null {
  const snapshot = getPublishedIdentity();
  if (!snapshot) return null;
  return { session: snapshot.session };
}

export function loadVotesFromStorage(nullifier: string): Map<string, 'up' | 'down' | null> {
  try {
    const raw = safeGetItem(`${VOTES_KEY_PREFIX}${nullifier}`);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
}

export function persistVotes(nullifier: string, votes: Map<string, 'up' | 'down' | null>): void {
  safeSetItem(`${VOTES_KEY_PREFIX}${nullifier}`, JSON.stringify(Object.fromEntries(votes)));
}

