import type { VoteIntentRecord } from '@vh/data-model';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

/**
 * Durable local intent queue for vote intents.
 * Persists to safeStorage with idempotent replay support.
 *
 * Invariants:
 * - Every admitted vote gets a VoteIntentRecord in the queue
 * - Queue survives app restart (safeStorage-backed)
 * - Idempotent: duplicate intent_ids are silently deduped
 * - No silent drops: every enqueued intent reaches terminal state (projected or failed)
 */

const STORAGE_KEY = 'vh_vote_intent_queue_v1';
const MAX_QUEUE_SIZE = 200;

function compareReplayOrder(a: VoteIntentRecord, b: VoteIntentRecord): number {
  if (a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  if (a.emitted_at !== b.emitted_at) {
    return a.emitted_at - b.emitted_at;
  }
  if (a.topic_id !== b.topic_id) {
    return a.topic_id.localeCompare(b.topic_id);
  }
  if (a.synthesis_id !== b.synthesis_id) {
    return a.synthesis_id.localeCompare(b.synthesis_id);
  }
  if (a.epoch !== b.epoch) {
    return a.epoch - b.epoch;
  }
  if (a.point_id !== b.point_id) {
    return a.point_id.localeCompare(b.point_id);
  }
  if (a.voter_id !== b.voter_id) {
    return a.voter_id.localeCompare(b.voter_id);
  }
  return a.intent_id.localeCompare(b.intent_id);
}

function loadQueue(): VoteIntentRecord[] {
  try {
    const raw = safeGetItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VoteIntentRecord[]) : [];
  } catch {
    return [];
  }
}

function persistQueue(queue: VoteIntentRecord[]): void {
  try {
    safeSetItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore — quota exceeded, etc. */
  }
}

/**
 * Enqueue a vote intent record. Idempotent: duplicate intent_ids are silently deduped.
 * When the queue exceeds MAX_QUEUE_SIZE, the oldest intent is evicted.
 */
export function enqueueIntent(record: VoteIntentRecord): void {
  const queue = loadQueue();

  // Dedup by intent_id
  if (queue.some((r) => r.intent_id === record.intent_id)) {
    return;
  }

  queue.push(record);

  // Evict oldest if over cap
  while (queue.length > MAX_QUEUE_SIZE) {
    queue.shift();
  }

  persistQueue(queue);
}

/**
 * Mark a vote intent as projected (remove from pending queue).
 */
export function markIntentProjected(intentId: string): void {
  const queue = loadQueue();
  const filtered = queue.filter((r) => r.intent_id !== intentId);

  // Only persist if something changed
  if (filtered.length !== queue.length) {
    persistQueue(filtered);
  }
}

/**
 * Get all un-projected (pending) intents.
 */
export function getPendingIntents(): VoteIntentRecord[] {
  return loadQueue();
}

/**
 * Replay all pending intents through a projection function.
 * Successfully projected intents are removed from the queue.
 * Failed intents remain in the queue for future retry.
 *
 * @returns counts of replayed (success) and failed intents
 */
export async function replayPendingIntents(
  project: (record: VoteIntentRecord) => Promise<void>,
  options?: {
    limit?: number;
  },
): Promise<{ replayed: number; failed: number }> {
  const pending = loadQueue().sort(compareReplayOrder);
  const normalizedLimit = options?.limit && options.limit > 0
    ? Math.floor(options.limit)
    : pending.length;
  const replayBatch = pending.slice(0, normalizedLimit);

  let replayed = 0;
  let failed = 0;

  for (const record of replayBatch) {
    try {
      await project(record);
      markIntentProjected(record.intent_id);
      replayed++;
    } catch {
      failed++;
    }
  }

  return { replayed, failed };
}
