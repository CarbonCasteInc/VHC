import SEA from 'gun/sea';
import {
  SentimentEventSchema,
  deriveSentimentEventId,
  type SentimentEvent,
} from '@vh/data-model';
import { createGuardedChain, type ChainWithGet, type PutAckResult } from './chain';
import { writeWithDurability } from './durableWrite';
import { readGunTimeoutMs } from './runtimeConfig';
import type { VennClient } from './types';

export interface EncryptedSentimentEnvelope {
  readonly __encrypted: true;
  readonly ciphertext: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function stripGunMetadata(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const { _, ...rest } = data as Record<string, unknown> & { _?: unknown };
  return rest;
}

function normalizeRequiredId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function getCurrentUserPub(client: VennClient): string {
  const pub = (client.gun.user() as any)?.is?.pub;
  if (typeof pub !== 'string' || !pub.trim()) {
    throw new Error('Gun user pub is unavailable; authenticate before accessing sentiment outbox');
  }
  return pub;
}

function getCurrentUserPair(client: VennClient): { epub: string; epriv: string } {
  const pair = (client.gun.user() as any)?._?.sea;
  if (!pair?.epub || !pair?.epriv) {
    throw new Error('Gun SEA keypair unavailable; authenticate before writing sentiment events');
  }
  return pair;
}

function sentimentOutboxPath(client: VennClient): string {
  return `~${getCurrentUserPub(client)}/outbox/sentiment/`;
}

function sentimentOutboxEventPath(client: VennClient, eventId: string): string {
  return `${sentimentOutboxPath(client)}${eventId}/`;
}

async function encryptSentimentEvent(
  client: VennClient,
  event: SentimentEvent,
): Promise<EncryptedSentimentEnvelope> {
  const pair = getCurrentUserPair(client);
  const encrypted = await SEA.encrypt(JSON.stringify(event), pair);
  if (encrypted === null || encrypted === undefined) {
    throw new Error('Sentiment event encryption failed');
  }

  return {
    __encrypted: true,
    ciphertext: typeof encrypted === 'string' ? encrypted : JSON.stringify(encrypted),
  };
}

async function decryptSentimentEvent(client: VennClient, envelope: unknown): Promise<SentimentEvent | null> {
  if (!isRecord(envelope) || envelope.__encrypted !== true || typeof envelope.ciphertext !== 'string') {
    return null;
  }

  const pair = getCurrentUserPair(client);
  const decrypted = await SEA.decrypt(envelope.ciphertext, pair);
  if (!decrypted) {
    return null;
  }

  const payload = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
  const parsed = SentimentEventSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function readOnce<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(null);
    }, READ_ONCE_TIMEOUT_MS);

    chain.once((data) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve((data ?? null) as T | null);
    });
  });
}

const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_READ_TIMEOUT_MS', 'VH_GUN_READ_TIMEOUT_MS'],
  2_500,
);

const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_PUT_ACK_TIMEOUT_MS', 'VH_GUN_PUT_ACK_TIMEOUT_MS'],
  1_000,
);

async function putWithAck<T>(
  chain: ChainWithGet<T>,
  value: T,
  options: {
    readonly writeClass: string;
    readonly timeoutError?: string;
    readonly readback?: () => Promise<unknown>;
    readonly readbackPredicate?: (observed: unknown) => boolean;
  },
): Promise<PutAckResult> {
  const result = await writeWithDurability({
    chain,
    value,
    writeClass: options.writeClass,
    timeoutMs: PUT_ACK_TIMEOUT_MS,
    timeoutError: options.timeoutError,
    readback: options.readback,
    readbackPredicate: options.readbackPredicate,
    onAckTimeout: () => console.warn('[vh:gun-client] sentiment outbox put ack timed out, requiring readback confirmation'),
  });
  return result.ack;
}

export function getSentimentOutboxChain(client: VennClient): ChainWithGet<EncryptedSentimentEnvelope> {
  const chain = (client.gun.user() as any)
    .get('outbox')
    .get('sentiment') as unknown as ChainWithGet<EncryptedSentimentEnvelope>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    sentimentOutboxPath(client),
  );
}

export async function writeSentimentEvent(
  client: VennClient,
  event: unknown,
): Promise<{ eventId: string; event: SentimentEvent; ack: PutAckResult }> {
  const sanitized = SentimentEventSchema.parse(event);
  const eventId = await deriveSentimentEventId({
    nullifier: sanitized.constituency_proof.nullifier,
    topic_id: sanitized.topic_id,
    synthesis_id: sanitized.synthesis_id,
    epoch: sanitized.epoch,
    point_id: sanitized.point_id,
  });

  const envelope = await encryptSentimentEvent(client, sanitized);
  const eventChain = getSentimentOutboxChain(client).get(eventId);
  const ack = await putWithAck(eventChain, envelope, {
    writeClass: 'sentiment-outbox',
    timeoutError: 'sentiment outbox write timed out and readback did not confirm persistence',
    readback: async () => decryptSentimentEvent(client, stripGunMetadata(await readOnce(eventChain))),
    readbackPredicate: (observed) => {
      const candidate = observed as SentimentEvent | null;
      return Boolean(
        candidate
        && candidate.topic_id === sanitized.topic_id
        && candidate.synthesis_id === sanitized.synthesis_id
        && candidate.epoch === sanitized.epoch
        && candidate.point_id === sanitized.point_id
      );
    },
  });

  return { eventId, event: sanitized, ack };
}

export async function readUserEvents(
  client: VennClient,
  topicId: string,
  epoch: number,
): Promise<SentimentEvent[]> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedEpoch = Math.floor(epoch);

  const raw = await readOnce(getSentimentOutboxChain(client) as unknown as ChainWithGet<unknown>);
  if (!isRecord(raw)) {
    return [];
  }

  const events: SentimentEvent[] = [];
  for (const [eventId, value] of Object.entries(raw)) {
    if (eventId === '_') {
      continue;
    }

    const parsed = await decryptSentimentEvent(client, stripGunMetadata(value));
    if (!parsed) {
      continue;
    }

    if (parsed.topic_id === normalizedTopicId && parsed.epoch === normalizedEpoch) {
      events.push(parsed);
    }
  }

  return events.sort((a, b) => a.emitted_at - b.emitted_at);
}

export const sentimentEventAdapterInternal = {
  sentimentOutboxEventPath,
  sentimentOutboxPath,
};
