import { deriveVoterId, type ConstituencyProof } from '@vh/types';
import {
  deriveVoteIntentId,
  type VoteAdmissionReceipt,
  type VoteIntentRecord,
} from '@vh/data-model';
import { logVoteAdmission } from '../utils/sentimentTelemetry';
import { enqueueIntent } from './voteIntentQueue';

/**
 * Vote admission validation and receipt creation.
 *
 * Extracts denial/admit logic from useSentimentState to keep file sizes manageable.
 * All denial conditions and error messages are preserved exactly from the original.
 */

/**
 * Canonical admission denial reasons.
 *
 * Every deny path funnels through one of these so support and telemetry can
 * classify blocked votes without ever inspecting proof/nullifier material
 * (`docs/specs/spec-civic-sentiment.md` §9.1 unified vote admission).
 */
export const VOTE_DENIAL_REASONS = Object.freeze({
  MISSING_PROOF: 'Missing constituency proof',
  MISSING_POINT_ID: 'Missing point_id',
  MISSING_SYNTHESIS_CONTEXT: 'Missing synthesis context',
  NON_CURRENT_SYNTHESIS: 'Non-current synthesis',
  MISSING_IDENTITY: 'Missing identity',
  EXPIRED_IDENTITY: 'Expired identity',
  INVALID_PROOF: 'Invalid proof',
  WRITE_QUEUE_FAILURE: 'Write queue failure',
} as const);

export type VoteDenialReason =
  (typeof VOTE_DENIAL_REASONS)[keyof typeof VOTE_DENIAL_REASONS];

/**
 * Caller-supplied accepted-current synthesis context (the story-detail join
 * result). Admission accepts stance writes only for the accepted-current
 * synthesis target; a stale/non-current target is denied.
 *
 * This shape is intentionally decoupled from the accepted-current read model
 * (`useAcceptedSynthesis.ts`, introduced by PR B / #728): admission depends
 * only on `synthesis_id + epoch + accepted_current`, not on any specific
 * exported type, so it works whether or not that read model is wired.
 */
export interface AcceptedCurrencyContext {
  readonly synthesis_id: string;
  readonly epoch: number;
  readonly accepted_current: boolean;
}

/**
 * Classify an identity-policy failure raised by `assertMvpActionIdentityReady`
 * into a canonical denial reason. Expired/absent session maps to
 * `Expired identity`; every other identity-readiness failure (missing identity,
 * missing/invalid AssuranceEnvelope) maps to `Missing identity`. The raw error
 * message is never surfaced to telemetry.
 */
export function classifyIdentityDenialReason(error: unknown): VoteDenialReason {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('non-expired active session')) {
    return VOTE_DENIAL_REASONS.EXPIRED_IDENTITY;
  }
  return VOTE_DENIAL_REASONS.MISSING_IDENTITY;
}

/**
 * Evaluate the accepted-current currency check for a vote's synthesis target.
 *
 * Returns a denial reason when the caller supplied an accepted-current context
 * that is either non-current or targets a different synthesis/epoch than the
 * vote. When no context is supplied (feature not wired) admission preserves
 * current behavior and returns `null` — it must not regress votes that predate
 * the accepted-current join.
 */
export function evaluateCurrencyDenial(params: {
  readonly context?: AcceptedCurrencyContext | null;
  readonly synthesisId: string;
  readonly epoch: number;
}): VoteDenialReason | null {
  const { context } = params;
  if (!context) {
    return null;
  }
  if (
    !context.accepted_current ||
    context.synthesis_id !== params.synthesisId ||
    context.epoch !== params.epoch
  ) {
    return VOTE_DENIAL_REASONS.NON_CURRENT_SYNTHESIS;
  }
  return null;
}

function generateReceiptId(prefix: 'deny' | 'admit'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a denial receipt with telemetry. */
export function createDenialReceipt(
  topicId: string,
  pointId: string,
  synthesisId: string,
  epoch: number,
  reason: string,
): VoteAdmissionReceipt {
  logVoteAdmission({
    topic_id: topicId,
    point_id: pointId,
    admitted: false,
    reason,
  });
  return {
    receipt_id: generateReceiptId('deny'),
    accepted: false,
    reason,
    topic_id: topicId,
    synthesis_id: synthesisId,
    epoch,
    point_id: pointId,
    admitted_at: 0,
  };
}

/** Create an admission receipt with telemetry. */
export function createAdmissionReceipt(
  topicId: string,
  pointId: string,
  synthesisId: string,
  epoch: number,
): VoteAdmissionReceipt {
  logVoteAdmission({
    topic_id: topicId,
    point_id: pointId,
    admitted: true,
  });
  return {
    receipt_id: generateReceiptId('admit'),
    accepted: true,
    topic_id: topicId,
    synthesis_id: synthesisId,
    epoch,
    point_id: pointId,
    admitted_at: Date.now(),
  };
}

/**
 * Enqueue the durable local intent that admission promises alongside the
 * receipt. Admission success must mean "receipt + durable intent", not
 * "receipt + hope": the caller awaits this before treating the front door as
 * settled, and a failure to derive/persist the intent surfaces as a
 * `Write queue failure` admission-denial telemetry event (no receipt is
 * re-issued — the synchronous receipt already went out — but the failure is
 * never silent).
 *
 * Remote projection stays asynchronous and is not part of this contract.
 */
export async function enqueueDurableVoteIntent(params: {
  readonly constituencyProof: ConstituencyProof;
  readonly topicId: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly pointId: string;
  readonly agreement: VoteIntentRecord['agreement'];
  readonly weight: number;
  readonly emittedAt: number;
}): Promise<{ ok: true; record: VoteIntentRecord } | { ok: false; error: string }> {
  try {
    const voterId = await deriveVoterId(params.constituencyProof.nullifier, {
      topicId: params.topicId,
      epoch: params.epoch,
    });
    const intentId = await deriveVoteIntentId({
      voter_id: voterId,
      topic_id: params.topicId,
      synthesis_id: params.synthesisId,
      epoch: params.epoch,
      point_id: params.pointId,
    });
    const record: VoteIntentRecord = {
      intent_id: intentId,
      voter_id: voterId,
      topic_id: params.topicId,
      synthesis_id: params.synthesisId,
      epoch: params.epoch,
      point_id: params.pointId,
      agreement: params.agreement,
      weight: params.weight,
      proof_ref: deriveProofRef(params.constituencyProof),
      seq: params.emittedAt,
      emitted_at: params.emittedAt,
    };
    enqueueIntent(record);
    return { ok: true, record };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[vh:sentiment] Failed to enqueue vote intent:', err);
    // Reason-only telemetry — never carries proof/nullifier material.
    logVoteAdmission({
      topic_id: params.topicId,
      point_id: params.pointId,
      admitted: false,
      reason: VOTE_DENIAL_REASONS.WRITE_QUEUE_FAILURE,
    });
    return { ok: false, error };
  }
}

/**
 * Derive an opaque proof_ref from a constituency proof.
 * Uses a simple deterministic hash — never leaks the raw proof.
 */
export function deriveProofRef(proof: ConstituencyProof): string {
  // Simple deterministic hash of proof fields — NOT the raw proof
  const input = `${proof.district_hash}|${proof.nullifier}|${proof.merkle_root}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return `pref-${(hash >>> 0).toString(36)}`;
}
