/**
 * Forum → synthesis pipeline bridge.
 *
 * Maps forum comments to CommentEvent and forwards them to the
 * TopicSynthesisPipeline. Only active when VITE_TOPIC_SYNTHESIS_V2_ENABLED
 * is true.
 *
 * @module synthesisBridge
 */

import type { HermesComment, HermesThread } from '@vh/types';
import { CommentEventSchema, type CommentEvent } from '@vh/ai-engine';

// ── Feature flag ───────────────────────────────────────────────────

export function isSynthesisV2Enabled(): boolean {
  try {
    return (
      (import.meta as unknown as { env?: { VITE_TOPIC_SYNTHESIS_V2_ENABLED?: string } })
        .env?.VITE_TOPIC_SYNTHESIS_V2_ENABLED === 'true'
    );
    /* v8 ignore next 3 -- env access may throw in non-Vite contexts */
  } catch {
    return false;
  }
}

// ── Comment → CommentEvent mapping ─────────────────────────────────

/**
 * Map a forum comment + its thread to a CommentEvent for the pipeline.
 * Returns null if the thread has no topicId (required for pipeline).
 */
export function mapCommentToEvent(
  comment: HermesComment,
  thread: HermesThread,
): CommentEvent | null {
  if (!thread.topicId) return null;

  const raw: CommentEvent = {
    comment_id: comment.id,
    topic_id: thread.topicId,
    principal_hash: comment.author,
    verified: true,
    kind: 'add',
    timestamp: comment.timestamp,
  };

  const parsed = CommentEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ── Bridge callback type ───────────────────────────────────────────

export type OnCommentEventFn = (event: CommentEvent) => void;

let _onCommentEvent: OnCommentEventFn | null = null;

/** Register the pipeline's onCommentEvent handler. */
export function setSynthesisBridgeHandler(
  handler: OnCommentEventFn | null,
): void {
  _onCommentEvent = handler;
}

/**
 * Notify the synthesis pipeline about a new forum comment.
 * No-op when feature flag is off or no handler is registered.
 */
export function notifySynthesisPipeline(
  comment: HermesComment,
  thread: HermesThread,
): void {
  if (!isSynthesisV2Enabled()) return;
  if (!_onCommentEvent) return;

  const event = mapCommentToEvent(comment, thread);
  if (!event) return;

  _onCommentEvent(event);
}
