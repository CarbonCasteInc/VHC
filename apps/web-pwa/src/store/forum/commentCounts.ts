/**
 * Comment count tracking per topic for the forum store.
 *
 * Maintains a running count of comments per topicId, designed to feed
 * into CommentTracker for re-synthesis threshold detection.
 *
 * Browser-safe: no node:* imports. Pure in-memory tracking with
 * snapshot export for the synthesis pipeline.
 *
 * Feature-gated behind VITE_TOPIC_SYNTHESIS_V2_ENABLED.
 *
 * @module commentCounts
 */

// ── Feature flag ───────────────────────────────────────────────────

function isSynthesisV2Enabled(): boolean {
  const viteValue = (
    import.meta as unknown as {
      env?: { VITE_TOPIC_SYNTHESIS_V2_ENABLED?: string };
    }
  ).env?.VITE_TOPIC_SYNTHESIS_V2_ENABLED;
  /* v8 ignore next 3 -- browser runtime may not expose process */
  const nodeValue =
    typeof process !== 'undefined'
      ? process.env?.VITE_TOPIC_SYNTHESIS_V2_ENABLED
      : undefined;
  return (nodeValue ?? viteValue) === 'true';
}

// ── Types ──────────────────────────────────────────────────────────

export interface TopicCommentSnapshot {
  topicId: string;
  commentCount: number;
  /** Hashed principal identifiers with active comments on this topic. */
  principalHashes: string[];
}

export interface CommentCountTracker {
  /** Record a new comment on a topic by a given principal hash. */
  recordComment: (
    topicId: string,
    commentId: string,
    principalHash: string,
  ) => void;
  /** Remove a comment from tracking (delete/unverify). */
  removeComment: (
    topicId: string,
    commentId: string,
    principalHash: string,
  ) => void;
  /** Get comment count for a topic. */
  getCount: (topicId: string) => number;
  /** Get unique principal count for a topic. */
  getUniquePrincipalCount: (topicId: string) => number;
  /** Export a snapshot of a topic's comment state. */
  getSnapshot: (topicId: string) => TopicCommentSnapshot;
  /** Reset counters for a topic (after epoch commit). */
  resetTopic: (topicId: string) => void;
  /** Whether the tracker is active (feature flag). */
  readonly enabled: boolean;
}

// ── Internal state ─────────────────────────────────────────────────

interface TopicCountState {
  /** Set of tracked comment IDs. */
  commentIds: Set<string>;
  /** Map of principal_hash → active comment count. */
  principalCounts: Map<string, number>;
}

// ── Factory ────────────────────────────────────────────────────────

export function createCommentCountTracker(
  overrides?: { enabled?: boolean },
): CommentCountTracker {
  const enabled = overrides?.enabled ?? isSynthesisV2Enabled();
  const topics = new Map<string, TopicCountState>();

  function getOrCreate(topicId: string): TopicCountState {
    let state = topics.get(topicId);
    if (!state) {
      state = { commentIds: new Set(), principalCounts: new Map() };
      topics.set(topicId, state);
    }
    return state;
  }

  function recordComment(
    topicId: string,
    commentId: string,
    principalHash: string,
  ): void {
    if (!enabled) return;
    const state = getOrCreate(topicId);
    if (state.commentIds.has(commentId)) return; // idempotent
    state.commentIds.add(commentId);
    const current = state.principalCounts.get(principalHash) ?? 0;
    state.principalCounts.set(principalHash, current + 1);
  }

  function removeComment(
    topicId: string,
    commentId: string,
    principalHash: string,
  ): void {
    if (!enabled) return;
    const state = topics.get(topicId);
    if (!state || !state.commentIds.has(commentId)) return;
    state.commentIds.delete(commentId);
    const current = state.principalCounts.get(principalHash) ?? 0;
    if (current <= 1) {
      state.principalCounts.delete(principalHash);
    } else {
      state.principalCounts.set(principalHash, current - 1);
    }
  }

  function getCount(topicId: string): number {
    return topics.get(topicId)?.commentIds.size ?? 0;
  }

  function getUniquePrincipalCount(topicId: string): number {
    const state = topics.get(topicId);
    if (!state) return 0;
    let count = 0;
    for (const n of state.principalCounts.values()) {
      if (n > 0) count++;
    }
    return count;
  }

  function getSnapshot(topicId: string): TopicCommentSnapshot {
    const state = topics.get(topicId);
    if (!state) {
      return { topicId, commentCount: 0, principalHashes: [] };
    }
    const hashes: string[] = [];
    for (const [hash, n] of state.principalCounts.entries()) {
      if (n > 0) hashes.push(hash);
    }
    return {
      topicId,
      commentCount: state.commentIds.size,
      principalHashes: hashes,
    };
  }

  function resetTopic(topicId: string): void {
    topics.delete(topicId);
  }

  return {
    recordComment,
    removeComment,
    getCount,
    getUniquePrincipalCount,
    getSnapshot,
    resetTopic,
    enabled,
  };
}
