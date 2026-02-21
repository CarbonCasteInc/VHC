import SEA from 'gun/sea';
import {
  SentimentEventSchema,
  deriveSentimentEventId,
  type SentimentEvent,
} from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import type { VennClient } from './types';

export interface EncryptedSentimentEnvelope {
  readonly __encrypted: true;
  readonly ciphertext: string;
}

export interface PutAckResult {
  readonly acknowledged: boolean;
  readonly timedOut: boolean;
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
    chain.once((data) => {
      resolve((data ?? null) as T | null);
    });
  });
}

const PUT_ACK_TIMEOUT_MS = 1000;

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<PutAckResult> {
  return new Promise<PutAckResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      console.warn('[vh:gun-client] sentiment outbox put ack timed out, proceeding best-effort');
      resolve({
        acknowledged: false,
        timedOut: true,
      });
    }, PUT_ACK_TIMEOUT_MS);

    chain.put(value, (ack?: ChainAck) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (ack?.err) {
        reject(new Error(ack.err));
        return;
      }
      resolve({
        acknowledged: true,
        timedOut: false,
      });
    });
  });
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
  const ack = await putWithAck(getSentimentOutboxChain(client).get(eventId), envelope);

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
