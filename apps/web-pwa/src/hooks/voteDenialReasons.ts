/**
 * Canonical admission denial reasons.
 *
 * Every deny path funnels through one of these so support and telemetry can
 * classify blocked votes without ever inspecting proof/nullifier material
 * (`docs/specs/spec-civic-sentiment.md` §9.1 unified vote admission).
 *
 * Leaf module by design: `voteAdmission.ts` imports the vote intent queue,
 * and the queue's eviction telemetry needs these reasons — keeping them here
 * (and re-exporting from `voteAdmission.ts` so call sites do not churn)
 * avoids an import cycle between the two.
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
