import { createHermesChannel } from '@vh/data-model';
import type { HermesMessage } from '@vh/types';
import type { VennClient } from '@vh/gun-client';
import type { ChatState, ContactRecord, ChatIdentity, MessageStatus } from './types';
import { SEEN_TTL_MS, SEEN_CLEANUP_THRESHOLD } from './types';
import { getFullIdentity } from '../identityProvider';

export function ensureIdentity(): ChatIdentity {
  const record = getFullIdentity<ChatIdentity>();
  if (!record || !record.session?.nullifier) {
    throw new Error('Identity not ready');
  }
  return record;
}

export function ensureClient(resolveClient: () => VennClient | null): VennClient {
  const client = resolveClient();
  if (!client) {
    throw new Error('Gun client not ready');
  }
  return client;
}

export function isValidInboundMessage(message: HermesMessage): boolean {
  if (!message.senderDevicePub || !message.signature || !message.deviceId) {
    console.warn('[vh:chat] Rejecting message: missing required fields', message.id);
    return false;
  }
  return true;
}

export function isChatDebug(): boolean {
  try {
    return localStorage.getItem('vh_debug_chat') === 'true';
  } catch {
    return false;
  }
}

export function upsertContact(contacts: Map<string, ContactRecord>, contact: ContactRecord): Map<string, ContactRecord> {
  const next = new Map(contacts);
  const existing = next.get(contact.nullifier);
  next.set(contact.nullifier, { ...(existing ?? {}), ...contact });
  return next;
}

const seenMessages = new Map<string, number>();

export function subscribeToChain(chain: any, set: (updater: (state: ChatState) => ChatState) => void) {
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

export function upsertMessage(state: ChatState, message: HermesMessage, defaultStatus: MessageStatus = 'pending'): ChatState {
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

export function updateStatus(state: ChatState, messageId: string, status: MessageStatus): ChatState {
  const nextStatuses = new Map(state.statuses);
  nextStatuses.set(messageId, status);
  return { ...state, statuses: nextStatuses };
}

