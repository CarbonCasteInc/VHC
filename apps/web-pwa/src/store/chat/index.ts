import { create } from 'zustand';
import { createHermesChannel, deriveChannelId } from '@vh/data-model';
import type { HermesMessage, HermesMessageType, HermesPayload } from '@vh/types';
import {
  SEA,
  deriveSharedSecret,
  encryptMessagePayload,
  getHermesChatChain,
  getHermesInboxChain,
  getHermesOutboxChain,
  lookupByIdentityDirectoryKey,
  type ChainWithGet
} from '@vh/gun-client';
import { useAppStore } from '../index';
import { useXpLedger } from '../xpLedger';
import type { ChatState, ChatDeps, ContactRecord } from './types';
import { loadIdentity, loadChannelsFromStorage, loadContactsFromStorage, persistSnapshot } from './persistence';
import {
  ensureIdentity,
  ensureClient,
  isChatDebug,
  upsertContact,
  subscribeToChain,
  upsertMessage,
  updateStatus
} from './helpers';

export type { ChatState, ContactRecord, MessageStatus } from './types';

function createRealChatStore(deps?: Partial<ChatDeps>) {
  const defaults: ChatDeps = {
    resolveClient: () => useAppStore.getState().client,
    deriveChannelId,
    deriveSharedSecret,
    encryptMessagePayload,
    lookupDirectory: lookupByIdentityDirectoryKey,
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
      async getOrCreateChannel(peerIdentityKey: string, peerEpub?: string, peerDevicePub?: string, peerHandle?: string) {
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
        if (peerEpub) participantEpubs[peerIdentityKey] = peerEpub;
        if (peerDevicePub) participantDevicePubs[peerIdentityKey] = peerDevicePub;
        if (identity.devicePair?.epub) participantEpubs[identity.session.nullifier] = identity.devicePair.epub;
        if (identity.devicePair?.pub) participantDevicePubs[identity.session.nullifier] = identity.devicePair.pub;
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
          handle: peerHandle,
          addedAt: resolved.now()
        };
        setWithPersist((state) => ({
          ...state,
          channels: new Map(state.channels).set(channelId, channel),
          contacts: peerEpub || peerDevicePub ? upsertContact(state.contacts, contact) : state.contacts
        }));
        return channel;
      },
      async sendMessage(recipientIdentityKey: string, plaintext: HermesPayload, type: HermesMessageType) {
        hydrateFromGun();
        const identity = ensureIdentity();
        const client = ensureClient(resolved.resolveClient);
        const devicePair = identity.devicePair;
        if (!devicePair?.epub || !devicePair?.epriv || !devicePair?.pub) throw new Error('Device keypair not available');
        const sender = identity.session.nullifier;
        const channelId = await resolved.deriveChannelId([sender, recipientIdentityKey]);
        const channel = await get().getOrCreateChannel(recipientIdentityKey);
        let recipientEpub = channel.participantEpubs?.[recipientIdentityKey];
        let recipientDevicePub = channel.participantDevicePubs?.[recipientIdentityKey];
        let directoryEntry = null;
        if (!recipientDevicePub || !recipientEpub) {
          try {
            directoryEntry = await resolved.lookupDirectory(client, recipientIdentityKey);
          } catch (err) {
            console.warn('[vh:chat] Directory lookup failed', err);
          }
        }
        if (!recipientEpub && directoryEntry?.epub) recipientEpub = directoryEntry.epub;
        if (!recipientDevicePub && directoryEntry?.devicePub) recipientDevicePub = directoryEntry.devicePub;
        if (!recipientEpub) throw new Error('Recipient encryption key not available. Ask them to share their contact info again.');
        if (!recipientDevicePub) throw new Error('Recipient not found in directory. They may need to come online first.');
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
            const epubs = { ...(existingChannel.participantEpubs ?? {}) };
            const pubs = { ...(existingChannel.participantDevicePubs ?? {}) };
            if (directoryEntry.epub) epubs[recipientIdentityKey] = directoryEntry.epub;
            if (directoryEntry.devicePub) pubs[recipientIdentityKey] = directoryEntry.devicePub;
            channels.set(channelId, { ...existingChannel, participantEpubs: epubs, participantDevicePubs: pubs });
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
              stats.set(channelId, { ...entry, mine: entry.mine + 1, total: entry.total + 1 });
              return { ...state, messageStats: stats };
            });
            const stats = get().messageStats.get(channelId);
            if (stats && !stats.awarded && stats.mine >= 3 && stats.total >= 6) {
              useXpLedger.getState().applyMessagingXP({ type: 'sustained_conversation', channelId });
              setWithPersist((state) => {
                const stats = new Map(state.messageStats);
                const entry = stats.get(channelId);
                if (entry) stats.set(channelId, { ...entry, awarded: true });
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
      subscribeToChannel(channelId: string) {
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
      console.info('[vh:chat] hydrating inbox/outbox', { myDevicePub: myDevicePub.slice(0, 12) + '...', fullPub: myDevicePub });
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
    messageStats: new Map(),
    contacts: new Map(),
    async getOrCreateChannel(peerIdentityKey: string, peerEpub?: string, peerDevicePub?: string) {
      const channelId = `mock-${peerIdentityKey}`;
      const participantEpubs: Record<string, string> = {};
      const participantDevicePubs: Record<string, string> = { 'mock-sender': 'mock-device' };
      if (peerEpub) participantEpubs[peerIdentityKey] = peerEpub;
      if (peerDevicePub) participantDevicePubs[peerIdentityKey] = peerDevicePub;
      const participants = ['mock-sender', peerIdentityKey];
      const channel = createHermesChannel(channelId, participants, Date.now(), participantEpubs, participantDevicePubs);
      set((state) => ({
        ...state,
        channels: new Map(state.channels).set(channelId, channel),
        contacts:
          peerEpub || peerDevicePub
            ? upsertContact(state.contacts, { nullifier: peerIdentityKey, epub: peerEpub, devicePub: peerDevicePub, addedAt: Date.now() })
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
