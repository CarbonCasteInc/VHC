import type {
  HermesChannel,
  HermesMessage,
  HermesMessageType,
  HermesPayload,
  DirectoryEntry,
  IdentityRecord,
} from '@vh/types';
import type { VennClient } from '@vh/gun-client';

export const CHANNELS_KEY_PREFIX = 'vh_channels:';
export const CONTACTS_KEY_PREFIX = 'vh_contacts:';
export const SEEN_TTL_MS = 60_000;
export const SEEN_CLEANUP_THRESHOLD = 100;

export type MessageStatus = 'pending' | 'failed' | 'sent';

export interface ChatState {
  channels: Map<string, HermesChannel>;
  messages: Map<string, HermesMessage[]>;
  statuses: Map<string, MessageStatus>;
  messageStats: Map<string, { mine: number; total: number; awarded: boolean }>;
  contacts: Map<string, ContactRecord>;
  sendMessage(recipientIdentityKey: string, plaintext: HermesPayload, type: HermesMessageType): Promise<void>;
  subscribeToChannel(channelId: string): () => void;
  getOrCreateChannel(peerIdentityKey: string, peerEpub?: string, peerDevicePub?: string, peerHandle?: string): Promise<HermesChannel>;
}

export type ChatIdentity = Pick<IdentityRecord, 'session' | 'attestation' | 'devicePair' | 'handle'>;

export interface ContactRecord {
  nullifier: string;
  epub?: string;
  devicePub?: string;
  displayName?: string;
  handle?: string;
  addedAt: number;
}

export interface ChatDeps {
  resolveClient: () => VennClient | null;
  deriveChannelId: (participants: string[]) => Promise<string>;
  deriveSharedSecret: (recipientDevicePub: string, senderPair: { epub: string; epriv: string }) => Promise<string>;
  encryptMessagePayload: (plaintext: HermesPayload, secret: string) => Promise<string>;
  lookupDirectory: (client: VennClient, nullifier: string) => Promise<DirectoryEntry | null>;
  now: () => number;
  randomId: () => string;
}
