import { create } from 'zustand';
import { createHermesChannel, deriveChannelId } from '@vh/data-model';
import type { DirectoryEntry, HermesChannel, HermesMessage, HermesMessageType, HermesPayload } from '@vh/types';
import {
  SEA,
  deriveSharedSecret,
  encryptMessagePayload,
  getHermesChatChain,
  getHermesInboxChain,
  getHermesOutboxChain,
  lookupByNullifier,
  type ChainWithGet,
  type VennClient
} from '@vh/gun-client';
import { useAppStore } from './index';
import { useXpLedger } from './xpLedger';

const IDENTITY_STORAGE_KEY = 'vh_identity';
const CHANNELS_KEY_PREFIX = 'vh_channels:';
const CONTACTS_KEY_PREFIX = 'vh_contacts:';
const SEEN_TTL_MS = 60_000;
const SEEN_CLEANUP_THRESHOLD = 100;

type MessageStatus = 'pending' | 'failed' | 'sent';

export interface ChatState {
  channels: Map<string, HermesChannel>;
  messages: Map<string, HermesMessage[]>;
  statuses: Map<string, MessageStatus>;
  messageStats: Map<string, { mine: number; total: number; awarded: boolean }>;
  contacts: Map<string, ContactRecord>;
  sendMessage(recipientIdentityKey: string, plaintext: HermesPayload, type: HermesMessageType): Promise<void>;
  subscribeToChannel(channelId: string): () => void;
  getOrCreateChannel(peerIdentityKey: string, peerEpub?: string, peerDevicePub?: string): Promise<HermesChannel>;
}

interface IdentityRecord {
  session: { nullifier: string; trustScore: number };
  attestation?: { deviceKey?: string };
  devicePair?: { pub: string; priv: string; epub: string; epriv: string };
}

interface ContactRecord {
  nullifier: string;
  epub?: string;
  devicePub?: string;
  displayName?: string;
  addedAt: number;
}

interface ChatDeps {
  resolveClient: () => VennClient | null;
  deriveChannelId: (participants: string[]) => Promise<string>;
  deriveSharedSecret: (recipientDevicePub: string, senderPair: { epub: string; epriv: string }) => Promise<string>;
  encryptMessagePayload: (plaintext: HermesPayload, secret: string) => Promise<string>;
  lookupDirectory: (client: VennClient, nullifier: string) => Promise<DirectoryEntry | null>;
  now: () => number;
  randomId: () => string;
}

function loadIdentity(): IdentityRecord | null {
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IdentityRecord) : null;
  } catch {
    return null;
  }
}

function tryGetIdentityNullifier(): string | null {
  return loadIdentity()?.session?.nullifier ?? null;
}

function channelsKey(nullifier: string): string {
  return `${CHANNELS_KEY_PREFIX}${nullifier}`;
}

function contactsKey(nullifier: string): string {
  return `${CONTACTS_KEY_PREFIX}${nullifier}`;
}

function loadChannelsFromStorage(nullifier: string | null): Map<string, HermesChannel> {
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

function persistChannels(nullifier: string | null, channels: Map<string, HermesChannel>): void {
  if (!nullifier) return;
  try {
    const serialized = JSON.stringify(Object.fromEntries(channels));
    localStorage.setItem(channelsKey(nullifier), serialized);
  } catch {
    /* ignore */
  }
}

function loadContactsFromStorage(nullifier: string | null): Map<string, ContactRecord> {
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

function persistContacts(nullifier: string | null, contacts: Map<string, ContactRecord>): void {
  if (!nullifier) return;
  try {
    const serialized = JSON.stringify(Object.fromEntries(contacts));
    localStorage.setItem(contactsKey(nullifier), serialized);
  } catch {
    /* ignore */
  }
}

function upsertContact(contacts: Map<string, ContactRecord>, contact: ContactRecord): Map<string, ContactRecord> {
  const next = new Map(contacts);
  const existing = next.get(contact.nullifier);
  next.set(contact.nullifier, { ...(existing ?? {}), ...contact });
  return next;
}

function ensureIdentity(): IdentityRecord {
  const record = loadIdentity();
  if (!record || !record.session?.nullifier) {
    throw new Error('Identity not ready');
  }
  return record;
}

function ensureClient(resolveClient: () => VennClient | null): VennClient {
  const client = resolveClient();
  if (!client) {
    throw new Error('Gun client not ready');
  }
  return client;
}

function isValidInboundMessage(message: HermesMessage): boolean {
  if (!message.senderDevicePub || !message.signature || !message.deviceId) {
    console.warn('[vh:chat] Rejecting message: missing required fields', message.id);
    return false;
  }
  return true;
}

function isChatDebug(): boolean {
  try {
    return localStorage.getItem('vh_debug_chat') === 'true';
  } catch {
    return false;
  }
}

const seenMessages = new Map<string, number>();

function subscribeToChain(chain: any, set: (updater: (state: ChatState) => ChatState) => void) {
  const mapped = typeof chain.map === 'function' ? chain.map() : null;
  const target = mapped && typeof mapped.on === 'function' ? mapped : chain;
  if (!target || typeof target.on !== 'function') {
    if (isChatDebug()) console.warn('[vh:chat] subscribeToChain: no .on() method available');
    return () => {};
  }
  if (isChatDebug()) console.info('[vh:chat] subscribeToChain: subscribing to chain', { hasMap: !!mapped });
  const handler = (data?: HermesMessage, key?: string) => {
    if (isChatDebug()) console.info('[vh:chat] subscribeToChain: received data', { key, hasData: !!data, dataType: typeof data });
    const payload = data && typeof data === 'object' ? data : key && data ? (data as any)[key] : data;
    if (!payload || typeof payload !== 'object') {
      if (isChatDebug()) console.warn('[vh:chat] subscribeToChain: invalid payload', { payload });
      return;
    }
    const message = payload as HermesMessage;
    if (!isValidInboundMessage(message)) {
      if (isChatDebug())
        console.warn('[vh:chat] subscribeToChain: invalid message', { id: message.id, hasSenderPub: !!message.senderDevicePub });
      return;
    }
    const now = Date.now();
    const lastSeen = seenMessages.get(message.id);
    if (lastSeen && now - lastSeen < SEEN_TTL_MS) {
      return;
    }
    seenMessages.set(message.id, now);
    if (seenMessages.size > SEEN_CLEANUP_THRESHOLD) {
      for (const [id, ts] of seenMessages) {
        if (now - ts > SEEN_TTL_MS) {
          seenMessages.delete(id);
        }
      }
    }
    if (isChatDebug()) console.info('[vh:chat] subscribeToChain: upserting message', message.id);
    set((state) => upsertMessage(state, message, 'sent'));
  };
  target.on(handler);
  const off = target.off ?? chain.off;
  return () => {
    off?.(handler);
  };
}

function upsertMessage(state: ChatState, message: HermesMessage, defaultStatus: MessageStatus = 'pending'): ChatState {
  const nextMessages = new Map(state.messages);
  const channelMessages = nextMessages.get(message.channelId) ?? [];
  if (!channelMessages.some((m) => m.id === message.id)) {
    channelMessages.push(message);
    channelMessages.sort((a, b) => a.timestamp - b.timestamp);
    nextMessages.set(message.channelId, channelMessages);
  }
  const nextChannels = new Map(state.channels);
  const existingChannel = nextChannels.get(message.channelId);
  if (existingChannel) {
    const participantEpubs = { ...(existingChannel.participantEpubs ?? {}) };
    const participantDevicePubs = { ...(existingChannel.participantDevicePubs ?? {}) };
    if (message.sender && message.senderDevicePub && !participantEpubs[message.sender]) {
      participantEpubs[message.sender] = message.senderDevicePub;
      console.info('[vh:chat] Learned peer epub from inbound message', message.sender);
    }
    if (message.sender && message.deviceId && !participantDevicePubs[message.sender]) {
      participantDevicePubs[message.sender] = message.deviceId;
      console.info('[vh:chat] Learned peer devicePub from inbound message', message.sender);
    }
    nextChannels.set(message.channelId, {
      ...existingChannel,
      lastMessageAt: message.timestamp,
      participantEpubs,
      participantDevicePubs
    });
  } else {
    const participantEpubs: Record<string, string> = message.senderDevicePub ? { [message.sender]: message.senderDevicePub } : {};
    const participantDevicePubs: Record<string, string> =
      message.deviceId && message.sender ? { [message.sender]: message.deviceId } : {};
    nextChannels.set(
      message.channelId,
      createHermesChannel(
        message.channelId,
        [message.sender, message.recipient].sort(),
        message.timestamp,
        participantEpubs,
        participantDevicePubs
      )
    );
  }
  const nextStatuses = new Map(state.statuses);
  if (!nextStatuses.has(message.id)) {
    nextStatuses.set(message.id, defaultStatus);
  }
  return { ...state, messages: nextMessages, statuses: nextStatuses, channels: nextChannels };
}

function updateStatus(state: ChatState, messageId: string, status: MessageStatus): ChatState {
  const nextStatuses = new Map(state.statuses);
  nextStatuses.set(messageId, status);
  return { ...state, statuses: nextStatuses };
}

function persistSnapshot(state: ChatState) {
  const nullifier = tryGetIdentityNullifier();
  persistChannels(nullifier, state.channels);
  persistContacts(nullifier, state.contacts);
}

function createRealChatStore(deps?: Partial<ChatDeps>) {
  const defaults: ChatDeps = {
    resolveClient: () => useAppStore.getState().client,
    deriveChannelId,
    deriveSharedSecret,
    encryptMessagePayload,
    lookupDirectory: lookupByNullifier,
    now: () => Date.now(),
    randomId: () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  };
  const resolved = { ...defaults, ...deps };
  let hydrationStarted = false;
  let hydrateFromGun: () => void = () => {};
  const identityForBoot = loadIdentity();
  const initialChannels = loadChannelsFromStorage(identityForBoot?.session?.nullifier ?? null);
  const initialContacts = loadContactsFromStorage(identityForBoot?.session?.nullifier ?? null);

  const store = create<ChatState>((set, get) => {
    const setWithPersist = (updater: (state: ChatState) => ChatState) =>
      set((state) => {
        const next = updater(state);
        persistSnapshot(next);
        return next;
      });

    return {
      channels: initialChannels,
      messages: new Map(),
      statuses: new Map(),
      messageStats: new Map(),
      contacts: initialContacts,
      async getOrCreateChannel(
        peerIdentityKey: string,
        peerEpub?: string,
        peerDevicePub?: string
      ): Promise<HermesChannel> {
      hydrateFromGun();
      const identity = ensureIdentity();
      const participants = [identity.session.nullifier, peerIdentityKey];
      const channelId = await resolved.deriveChannelId(participants);
      const existing = get().channels.get(channelId);
      if (existing) {
        const participantEpubs = { ...(existing.participantEpubs ?? {}) };
        const participantDevicePubs = { ...(existing.participantDevicePubs ?? {}) };
        let updated = existing;
        if (peerEpub && !participantEpubs[peerIdentityKey]) {
          participantEpubs[peerIdentityKey] = peerEpub;
          updated = { ...updated, participantEpubs };
        }
        if (peerDevicePub && !participantDevicePubs[peerIdentityKey]) {
          participantDevicePubs[peerIdentityKey] = peerDevicePub;
          updated = { ...updated, participantDevicePubs };
        }
        if (updated !== existing) {
          setWithPersist((state) => ({ ...state, channels: new Map(state.channels).set(channelId, updated) }));
        }
        return updated;
      }
      const participantEpubs: Record<string, string> = {};
      const participantDevicePubs: Record<string, string> = {};
      if (peerEpub) {
        participantEpubs[peerIdentityKey] = peerEpub;
      }
      if (peerDevicePub) {
        participantDevicePubs[peerIdentityKey] = peerDevicePub;
      }
      if (identity.devicePair?.epub) {
        participantEpubs[identity.session.nullifier] = identity.devicePair.epub;
      }
      if (identity.devicePair?.pub) {
        participantDevicePubs[identity.session.nullifier] = identity.devicePair.pub;
      }
      const channel = createHermesChannel(
        channelId,
        participants.sort(),
        resolved.now(),
        participantEpubs,
        participantDevicePubs
      );
      const contact: ContactRecord = {
        nullifier: peerIdentityKey,
        epub: peerEpub,
        devicePub: peerDevicePub,
        addedAt: resolved.now()
      };
      setWithPersist((state) => ({
        ...state,
        channels: new Map(state.channels).set(channelId, channel),
        contacts: peerEpub || peerDevicePub ? upsertContact(state.contacts, contact) : state.contacts
      }));
      return channel;
    },
    async sendMessage(recipientIdentityKey, plaintext, type) {
      hydrateFromGun();
      const identity = ensureIdentity();
      const client = ensureClient(resolved.resolveClient);
      const devicePair = identity.devicePair;
      if (!devicePair?.epub || !devicePair?.epriv || !devicePair?.pub) {
        throw new Error('Device keypair not available');
      }
      const sender = identity.session.nullifier;
      const channelId = await resolved.deriveChannelId([sender, recipientIdentityKey]);
      const channel = await get().getOrCreateChannel(recipientIdentityKey);
      let recipientEpub = channel.participantEpubs?.[recipientIdentityKey];
      let recipientDevicePub = channel.participantDevicePubs?.[recipientIdentityKey];
      let directoryEntry: DirectoryEntry | null = null;
      if (!recipientDevicePub || !recipientEpub) {
        try {
          directoryEntry = await resolved.lookupDirectory(client, recipientIdentityKey);
        } catch (err) {
          console.warn('[vh:chat] Directory lookup failed', err);
        }
      }
      if (!recipientEpub && directoryEntry?.epub) {
        recipientEpub = directoryEntry.epub;
      }
      if (!recipientDevicePub && directoryEntry?.devicePub) {
        recipientDevicePub = directoryEntry.devicePub;
      }
      if (!recipientEpub) {
        throw new Error('Recipient encryption key not available. Ask them to share their contact info again.');
      }
      if (!recipientDevicePub) {
        throw new Error('Recipient not found in directory. They may need to come online first.');
      }
      const messageId = resolved.randomId();
      const timestamp = resolved.now();
      const secret = await resolved.deriveSharedSecret(recipientEpub, { epub: devicePair.epub, epriv: devicePair.epriv });
      const ciphertext = await resolved.encryptMessagePayload(plaintext, secret);
      const messageHash = `${messageId}:${timestamp}:${ciphertext}`;
      const signature = await SEA.sign(messageHash, devicePair);
      const message: HermesMessage = {
        id: messageId,
        schemaVersion: 'hermes-message-v0',
        channelId,
        sender,
        recipient: recipientIdentityKey,
        timestamp,
        content: ciphertext,
        type,
        signature,
        senderDevicePub: devicePair.epub,
        deviceId: devicePair.pub
      };
      if (directoryEntry?.devicePub || directoryEntry?.epub) {
        setWithPersist((state) => {
          const channels = new Map(state.channels);
          const existingChannel = channels.get(channelId);
          if (!existingChannel) return state;
          const participantEpubs = { ...(existingChannel.participantEpubs ?? {}) };
          const participantDevicePubs = { ...(existingChannel.participantDevicePubs ?? {}) };
          if (directoryEntry.epub) {
            participantEpubs[recipientIdentityKey] = directoryEntry.epub;
          }
          if (directoryEntry.devicePub) {
            participantDevicePubs[recipientIdentityKey] = directoryEntry.devicePub;
          }
          channels.set(channelId, { ...existingChannel, participantEpubs, participantDevicePubs });
          const contacts = upsertContact(state.contacts, {
            nullifier: recipientIdentityKey,
            epub: directoryEntry.epub,
            devicePub: directoryEntry.devicePub,
            addedAt: resolved.now()
          });
          return { ...state, channels, contacts };
        });
      }
      setWithPersist((state) => upsertMessage(state, message));

      const inbox = getHermesInboxChain(client, recipientDevicePub).get(messageId) as ChainWithGet<any>;
      const outbox = getHermesOutboxChain(client).get(messageId) as ChainWithGet<any>;
      const chat = getHermesChatChain(client, channelId).get(messageId) as ChainWithGet<any>;

      console.info('[vh:chat] sendMessage: writing to paths', {
        inboxDevicePub: recipientDevicePub.slice(0, 12) + '...',
        messageId,
        channelId: channelId.slice(0, 12) + '...'
      });

      const payload = { __encrypted: true, ...message };
      const write = (chain: ChainWithGet<any>) =>
        new Promise<'sent' | 'timeout'>((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve('timeout');
          }, 1000);
          chain.put(payload, (ack?: { err?: string }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (ack?.err) {
              reject(new Error(ack.err));
              return;
            }
            resolve('sent');
          });
        });

      try {
        const results = await Promise.all([write(inbox), write(outbox), write(chat)]);
        if (!results.includes('timeout')) {
          setWithPersist((state) => updateStatus(state, messageId, 'sent'));
          const ledger = useXpLedger.getState();
          if (!ledger.firstContacts.has(recipientIdentityKey)) {
            ledger.applyMessagingXP({ type: 'first_contact', contactKey: recipientIdentityKey });
          }
          setWithPersist((state) => {
            const stats = new Map(state.messageStats);
            const entry = stats.get(channelId) ?? { mine: 0, total: 0, awarded: false };
            const updated = { ...entry, mine: entry.mine + 1, total: entry.total + 1 };
            stats.set(channelId, updated);
            return { ...state, messageStats: stats };
          });
          const stats = get().messageStats.get(channelId);
          if (stats && !stats.awarded && stats.mine >= 3 && stats.total >= 6) {
            useXpLedger.getState().applyMessagingXP({ type: 'sustained_conversation', channelId });
            setWithPersist((state) => {
              const stats = new Map(state.messageStats);
              const entry = stats.get(channelId);
              if (entry) {
                stats.set(channelId, { ...entry, awarded: true });
              }
              return { ...state, messageStats: stats };
            });
          }
        }
      } catch (error) {
        console.warn('[vh:chat] failed to write message', error);
        setWithPersist((state) => updateStatus(state, messageId, 'failed'));
        throw error;
      }
    },
      subscribeToChannel(channelId) {
        hydrateFromGun();
        const client = resolved.resolveClient();
        if (!client) return () => {};
        const chain = getHermesChatChain(client, channelId) as any;
        return subscribeToChain(chain, setWithPersist);
      }
    };
  });

  hydrateFromGun = () => {
    if (hydrationStarted) return;
    const identity = loadIdentity();
    if (!identity?.devicePair?.pub) return;
    const client = resolved.resolveClient();
    if (!client) return;
    hydrationStarted = true;
    const myDevicePub = identity.devicePair.pub;
    if (isChatDebug()) {
      console.info('[vh:chat] hydrating inbox/outbox', {
      myDevicePub: myDevicePub.slice(0, 12) + '...',
      fullPub: myDevicePub 
      });
      console.info('[vh:chat] subscribing to inbox at vh/hermes/inbox/' + myDevicePub.slice(0, 12) + '...');
      console.info('[vh:chat] subscribing to outbox');
    }
    subscribeToChain(getHermesInboxChain(client, myDevicePub) as any, (updater) =>
      store.setState((state) => {
        const next = updater(state);
        persistSnapshot(next);
        return next;
      })
    );
    subscribeToChain(getHermesOutboxChain(client) as any, (updater) =>
      store.setState((state) => {
        const next = updater(state);
        persistSnapshot(next);
        return next;
      })
    );
  };

  void hydrateFromGun();

  return store;
}

export function createMockChatStore() {
  return create<ChatState>((set, get) => ({
    channels: new Map(),
    messages: new Map(),
    statuses: new Map(),
    contacts: new Map(),
    async getOrCreateChannel(peerIdentityKey: string, peerEpub?: string, peerDevicePub?: string) {
      const channelId = `mock-${peerIdentityKey}`;
      const participantEpubs: Record<string, string> = {};
      const participantDevicePubs: Record<string, string> = { 'mock-sender': 'mock-device' };
      if (peerEpub) {
        participantEpubs[peerIdentityKey] = peerEpub;
      }
      if (peerDevicePub) {
        participantDevicePubs[peerIdentityKey] = peerDevicePub;
      }
      const participants = ['mock-sender', peerIdentityKey];
      const channel = createHermesChannel(channelId, participants, Date.now(), participantEpubs, participantDevicePubs);
      set((state) => ({
        ...state,
        channels: new Map(state.channels).set(channelId, channel),
        contacts: peerEpub || peerDevicePub
          ? upsertContact(state.contacts, {
              nullifier: peerIdentityKey,
              epub: peerEpub,
              devicePub: peerDevicePub,
              addedAt: Date.now()
            })
          : state.contacts
      }));
      return channel;
    },
    async sendMessage(_recipient, plaintext, type) {
      const message: HermesMessage = {
        id: `${Date.now()}-${Math.random()}`,
        schemaVersion: 'hermes-message-v0',
        channelId: `mock-${_recipient}`,
        sender: 'mock-sender',
        recipient: _recipient,
        timestamp: Date.now(),
        content: JSON.stringify(plaintext),
        type,
        signature: 'mock-signature',
        senderDevicePub: 'mock-epub',
        deviceId: 'mock-device'
      };
      set((state) => upsertMessage(state, message));
      set((state) => updateStatus(state, message.id, 'sent'));
    },
    subscribeToChannel() {
      return () => {};
    }
  }));
}

const isE2E = (import.meta as any).env?.VITE_E2E_MODE === 'true';
export const useChatStore = isE2E ? createMockChatStore() : createRealChatStore();
export { createRealChatStore };
