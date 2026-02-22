import type { ConstituencyProof } from '@vh/types';
import type { VoteAdmissionReceipt } from '@vh/data-model';
import { logVoteAdmission } from '../utils/sentimentTelemetry';

/**
 * Vote admission validation and receipt creation.
 *
 * Extracts denial/admit logic from useSentimentState to keep file sizes manageable.
 * All denial conditions and error messages are preserved exactly from the original.
 */

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
