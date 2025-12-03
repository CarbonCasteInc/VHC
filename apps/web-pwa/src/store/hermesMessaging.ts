import { create } from 'zustand';
import { deriveChannelId } from '@vh/data-model';
import type { HermesChannel, HermesChannelType, HermesMessage, HermesMessageType, HermesPayload } from '@vh/types';
import {
  deriveSharedSecret,
  encryptMessagePayload,
  getHermesChatChain,
  getHermesInboxChain,
  getHermesOutboxChain,
  type ChainWithGet,
  type VennClient
} from '@vh/gun-client';
import { useAppStore } from './index';

const IDENTITY_STORAGE_KEY = 'vh_identity';

type MessageStatus = 'pending' | 'failed' | 'sent';

export interface ChatState {
  channels: Map<string, HermesChannel>;
  messages: Map<string, HermesMessage[]>;
  statuses: Map<string, MessageStatus>;
  sendMessage(recipientIdentityKey: string, plaintext: HermesPayload, type: HermesMessageType): Promise<void>;
  subscribeToChannel(channelId: string): () => void;
  getOrCreateChannel(peerIdentityKey: string): Promise<HermesChannel>;
}

interface IdentityRecord {
  session: { nullifier: string; trustScore: number };
  attestation?: { deviceKey?: string };
}

interface ChatDeps {
  resolveClient: () => VennClient | null;
  deriveChannelId: (participants: string[]) => Promise<string>;
  deriveSharedSecret: (recipientDevicePub: string, senderPair: { epub: string; epriv: string }) => Promise<string>;
  encryptMessagePayload: (plaintext: HermesPayload, secret: string) => Promise<string>;
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

function createHermesChannel(channelId: string, participants: string[], now: number): HermesChannel {
  return {
    id: channelId,
    schemaVersion: 'hermes-channel-v0',
    participants,
    lastMessageAt: now,
    type: 'dm' as HermesChannelType
  };
}

function upsertMessage(state: ChatState, message: HermesMessage): ChatState {
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
    nextChannels.set(message.channelId, { ...existingChannel, lastMessageAt: message.timestamp });
  }
  const nextStatuses = new Map(state.statuses);
  if (!nextStatuses.has(message.id)) {
    nextStatuses.set(message.id, 'pending');
  }
  return { ...state, messages: nextMessages, statuses: nextStatuses, channels: nextChannels };
}

function updateStatus(state: ChatState, messageId: string, status: MessageStatus): ChatState {
  const nextStatuses = new Map(state.statuses);
  nextStatuses.set(messageId, status);
  return { ...state, statuses: nextStatuses };
}

function createRealChatStore(deps?: Partial<ChatDeps>) {
  const defaults: ChatDeps = {
    resolveClient: () => useAppStore.getState().client,
    deriveChannelId,
    deriveSharedSecret,
    encryptMessagePayload,
    now: () => Date.now(),
    randomId: () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  };
  const resolved = { ...defaults, ...deps };

  return create<ChatState>((set, get) => ({
    channels: new Map(),
    messages: new Map(),
    statuses: new Map(),
    async getOrCreateChannel(peerIdentityKey: string): Promise<HermesChannel> {
      const identity = ensureIdentity();
      const participants = [identity.session.nullifier, peerIdentityKey];
      const channelId = await resolved.deriveChannelId(participants);
      const existing = get().channels.get(channelId);
      if (existing) {
        return existing;
      }
      const channel = createHermesChannel(channelId, participants.sort(), resolved.now());
      set((state) => ({ ...state, channels: new Map(state.channels).set(channelId, channel) }));
      return channel;
    },
    async sendMessage(recipientIdentityKey, plaintext, type) {
      const identity = ensureIdentity();
      const client = ensureClient(resolved.resolveClient);
      const sender = identity.session.nullifier;
      const channelId = await resolved.deriveChannelId([sender, recipientIdentityKey]);
      await get().getOrCreateChannel(recipientIdentityKey);
      const messageId = resolved.randomId();
      const deviceKey = identity.attestation?.deviceKey ?? sender;
      const secret = await resolved.deriveSharedSecret(recipientIdentityKey, { epub: deviceKey, epriv: deviceKey });
      const ciphertext = await resolved.encryptMessagePayload(plaintext, secret);
      const message: HermesMessage = {
        id: messageId,
        schemaVersion: 'hermes-message-v0',
        channelId,
        sender,
        recipient: recipientIdentityKey,
        timestamp: resolved.now(),
        content: ciphertext,
        type,
        signature: 'unsigned',
        deviceId: deviceKey
      };
      set((state) => upsertMessage(state, message));

      const inbox = getHermesInboxChain(client, recipientIdentityKey).get(messageId) as ChainWithGet<any>;
      const outbox = getHermesOutboxChain(client, sender).get(messageId) as ChainWithGet<any>;
      const chat = getHermesChatChain(client, sender, channelId).get(messageId) as ChainWithGet<any>;

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
          set((state) => updateStatus(state, messageId, 'sent'));
        }
      } catch (error) {
        console.warn('[vh:chat] failed to write message', error);
        set((state) => updateStatus(state, messageId, 'failed'));
        throw error;
      }
    },
    subscribeToChannel(channelId) {
      const identity = ensureIdentity();
      const client = resolved.resolveClient();
      if (!client) return () => {};
      const chain = getHermesChatChain(client, identity.session.nullifier, channelId) as any;
      const map = typeof chain.map === 'function' ? chain.map() : null;
      const target = map && typeof map.on === 'function' ? map : chain;
      if (!target || typeof target.on !== 'function') return () => {};
      const handler = (data?: HermesMessage, key?: string) => {
        const message = data ?? (key ? (data as any)[key] : undefined);
        if (!message || typeof message !== 'object') return;
        set((state) => upsertMessage(state, message as HermesMessage));
      };
      target.on(handler);
      const off = target.off ?? chain.off;
      return () => {
        off?.(handler);
      };
    }
  }));
}

export function createMockChatStore() {
  return create<ChatState>((set, get) => ({
    channels: new Map(),
    messages: new Map(),
    statuses: new Map(),
    async getOrCreateChannel(peerIdentityKey: string) {
      const channelId = `mock-${peerIdentityKey}`;
      const channel = createHermesChannel(channelId, [peerIdentityKey], Date.now());
      set((state) => ({ ...state, channels: new Map(state.channels).set(channelId, channel) }));
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
        signature: 'unsigned'
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
