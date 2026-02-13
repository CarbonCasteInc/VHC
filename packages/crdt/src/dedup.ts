/**
 * Operation deduplication for CRDT sync (spec §3.4).
 *
 * Tracks seen operation IDs with a TTL to prevent duplicate
 * application of Yjs updates received via Gun subscriptions.
 */

const SEEN_TTL_MS = 60_000;
const SEEN_CLEANUP_THRESHOLD = 500;

const seenOperations = new Map<string, number>();

/**
 * Check whether an operation ID has been recently processed.
 * Returns `true` if the ID was seen within the TTL window.
 */
export function isOperationSeen(id: string): boolean {
  const lastSeen = seenOperations.get(id);
  if (lastSeen === undefined) return false;
  return Date.now() - lastSeen < SEEN_TTL_MS;
}

/**
 * Record an operation ID as seen (now).
 * Triggers cleanup when the map exceeds the threshold.
 */
export function markOperationSeen(id: string): void {
  const now = Date.now();
  seenOperations.set(id, now);
  if (seenOperations.size > SEEN_CLEANUP_THRESHOLD) {
    for (const [key, ts] of seenOperations) {
      if (now - ts > SEEN_TTL_MS) seenOperations.delete(key);
    }
  }
}

/**
 * Reset all tracked operations (for testing).
 */
export function resetSeenOperations(): void {
  seenOperations.clear();
}

/** Exported constants for testing. */
export const DEDUP_TTL_MS = SEEN_TTL_MS;
export const DEDUP_CLEANUP_THRESHOLD = SEEN_CLEANUP_THRESHOLD;
