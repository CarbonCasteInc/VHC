import type { HermesChannel } from '@vh/types';
import type { ChatIdentity, ContactRecord, ChatState } from './types';
import { CHANNELS_KEY_PREFIX, CONTACTS_KEY_PREFIX } from './types';
import { getFullIdentity } from '../identityProvider';

/**
 * Load identity for chat operations from the in-memory identity provider.
 *
 * This returns the full record when available (including device keypairs),
 * without writing secrets to localStorage.
 */
export function loadIdentity(): ChatIdentity | null {
  const record = getFullIdentity<ChatIdentity>();
  if (!record || !record.session?.nullifier) {
    return null;
  }
  return record;
}

export function tryGetIdentityNullifier(): string | null {
  return loadIdentity()?.session?.nullifier ?? null;
}

function channelsKey(nullifier: string): string {
  return `${CHANNELS_KEY_PREFIX}${nullifier}`;
}

function contactsKey(nullifier: string): string {
  return `${CONTACTS_KEY_PREFIX}${nullifier}`;
}

export function loadChannelsFromStorage(nullifier: string | null): Map<string, HermesChannel> {
  if (!nullifier) return new Map();
  try {
    const raw = localStorage.getItem(channelsKey(nullifier));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, HermesChannel>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function persistChannels(nullifier: string | null, channels: Map<string, HermesChannel>): void {
  if (!nullifier) return;
  try {
    const serialized = JSON.stringify(Object.fromEntries(channels));
    localStorage.setItem(channelsKey(nullifier), serialized);
  } catch {
    /* ignore */
  }
}

export function loadContactsFromStorage(nullifier: string | null): Map<string, ContactRecord> {
  if (!nullifier) return new Map();
  try {
    const raw = localStorage.getItem(contactsKey(nullifier));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, ContactRecord>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function persistContacts(nullifier: string | null, contacts: Map<string, ContactRecord>): void {
  if (!nullifier) return;
  try {
    const serialized = JSON.stringify(Object.fromEntries(contacts));
    localStorage.setItem(contactsKey(nullifier), serialized);
  } catch {
    /* ignore */
  }
}

export function persistSnapshot(state: ChatState): void {
  const nullifier = tryGetIdentityNullifier();
  persistChannels(nullifier, state.channels);
  persistContacts(nullifier, state.contacts);
}

