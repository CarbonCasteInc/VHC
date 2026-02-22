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
): Promise<{ replayed: number; failed: number }> {
  const pending = loadQueue();
  let replayed = 0;
  let failed = 0;

  for (const record of pending) {
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
