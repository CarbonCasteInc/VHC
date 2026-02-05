import type { HermesChannel } from '@vh/types';
import type { IdentityRecord, ContactRecord, ChatState } from './types';
import { IDENTITY_STORAGE_KEY, CHANNELS_KEY_PREFIX, CONTACTS_KEY_PREFIX } from './types';
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

