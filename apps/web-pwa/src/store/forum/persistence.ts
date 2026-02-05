import type { IdentityRecord } from './types';
import { IDENTITY_STORAGE_KEY, VOTES_KEY_PREFIX } from './types';
import { getIdentityStorage } from '../identityStorage';

export function loadIdentity(): IdentityRecord | null {
  const storage = getIdentityStorage();
  try {
    const raw = storage.getItem(IDENTITY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IdentityRecord) : null;
  } catch {
    return null;
  }
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

