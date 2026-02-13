/**
 * CommentTracker — pure threshold tracker for comment-driven re-synthesis.
 *
 * Tracks verified comment counts and unique verified principals per topic
 * since the last epoch commit. Exposes `shouldTriggerResynthesis()` for
 * threshold-only checks. Does NOT enforce debounce or daily caps — those
 * are epochScheduler's responsibility.
 *
 * Privacy: principal identifiers are hashed before storage — no raw
 * principal IDs are retained.
 *
 * @module commentTracker
 */

import { z } from 'zod';

// ── Schemas ────────────────────────────────────────────────────────

export const CommentEventSchema = z.object({
  comment_id: z.string().min(1),
  topic_id: z.string().min(1),
  /** Hashed principal identifier (caller must hash before passing). */
  principal_hash: z.string().min(1),
  verified: z.boolean(),
  /** Event kind: 'add' for new/edit-verified, 'retract' for delete/unverify. */
  kind: z.enum(['add', 'retract']),
  timestamp: z.number().int().nonnegative(),
});

export type CommentEvent = z.infer<typeof CommentEventSchema>;

export const CommentTrackerConfigSchema = z.object({
  resynthesis_comment_threshold: z.number().int().positive().default(10),
  resynthesis_unique_principal_min: z.number().int().positive().default(3),
});

export type CommentTrackerConfig = z.infer<typeof CommentTrackerConfigSchema>;

// ── Internal per-topic state ───────────────────────────────────────

interface TopicState {
  /** Set of comment IDs currently counted (verified, not retracted). */
  commentIds: Set<string>;
  /** Map of principal_hash → count of active (non-retracted) comments. */
  principalCounts: Map<string, number>;
}

// ── CommentTracker class ───────────────────────────────────────────

export class CommentTracker {
  private readonly topics = new Map<string, TopicState>();
  private readonly config: CommentTrackerConfig;

  constructor(configOverrides?: Partial<CommentTrackerConfig>) {
    this.config = CommentTrackerConfigSchema.parse(configOverrides ?? {});
  }

  /**
   * Process a comment event. Idempotent — duplicate `add` events for the
   * same comment_id are ignored; duplicate `retract` events are no-ops.
   */
  onComment(event: CommentEvent): void {
    const parsed = CommentEventSchema.parse(event);

    if (!parsed.verified && parsed.kind === 'add') {
      return; // Only verified comments count
    }

    const state = this.getOrCreateTopicState(parsed.topic_id);

    if (parsed.kind === 'add') {
      this.handleAdd(state, parsed);
    } else {
      this.handleRetract(state, parsed);
    }
  }

  /**
   * Threshold-only check: ≥ threshold verified comments AND
   * ≥ min unique verified principals since last epoch.
   */
  shouldTriggerResynthesis(topicId: string): boolean {
    const state = this.topics.get(topicId);
    if (!state) return false;

    const commentCount = state.commentIds.size;
    const uniquePrincipals = this.countUniquePrincipals(state);

    return (
      commentCount >= this.config.resynthesis_comment_threshold &&
      uniquePrincipals >= this.config.resynthesis_unique_principal_min
    );
  }

  /** Current verified comment count for a topic since last epoch. */
  getCommentCount(topicId: string): number {
    return this.topics.get(topicId)?.commentIds.size ?? 0;
  }

  /** Current unique verified principal count for a topic since last epoch. */
  getUniquePrincipalCount(topicId: string): number {
    const state = this.topics.get(topicId);
    if (!state) return 0;
    return this.countUniquePrincipals(state);
  }

  /** Reset counters for a topic after successful epoch commit. */
  acknowledgeEpoch(topicId: string): void {
    this.topics.delete(topicId);
  }

  // ── Private helpers ────────────────────────────────────────────

  private getOrCreateTopicState(topicId: string): TopicState {
    let state = this.topics.get(topicId);
    if (!state) {
      state = { commentIds: new Set(), principalCounts: new Map() };
      this.topics.set(topicId, state);
    }
    return state;
  }

  private handleAdd(state: TopicState, event: CommentEvent): void {
    if (state.commentIds.has(event.comment_id)) {
      return; // Idempotent: already counted
    }
    state.commentIds.add(event.comment_id);
    const current = state.principalCounts.get(event.principal_hash) ?? 0;
    state.principalCounts.set(event.principal_hash, current + 1);
  }

  private handleRetract(state: TopicState, event: CommentEvent): void {
    if (!state.commentIds.has(event.comment_id)) {
      return; // Not tracked — retract is a no-op
    }
    state.commentIds.delete(event.comment_id);

    // We need to know which principal originally added this comment.
    // Since retract events carry the principal_hash, decrement that principal.
    /* v8 ignore next -- defensive ?? 0: principalCounts is always set by handleAdd */
    const current = state.principalCounts.get(event.principal_hash) ?? 0;
    if (current <= 1) {
      state.principalCounts.delete(event.principal_hash);
    } else {
      state.principalCounts.set(event.principal_hash, current - 1);
    }
  }

  private countUniquePrincipals(state: TopicState): number {
    // Count principals with at least one active comment
    let count = 0;
    for (const n of state.principalCounts.values()) {
      if (n > 0) count++;
    }
    return count;
  }
}
