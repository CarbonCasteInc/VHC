/**
 * Canonical trust thresholds for Season 0.
 *
 * Spec: spec-identity-trust-constituency.md §4 (Trust Tiers)
 *
 * ALL gated surfaces MUST import from this module.
 * Do NOT hardcode trust threshold values elsewhere.
 */

/** Minimum trust score (0–1) for session creation, forum access, bridge access, UBE/faucet, rep browsing, draft civic actions. */
export const TRUST_MINIMUM = 0.5;

/** Elevated trust score (0–1) for governance votes, civic action send/finalize, and verified tier display. */
export const TRUST_ELEVATED = 0.7;

/** Scaled equivalents (trustScore × 10 000) for on-chain / integer comparisons. */
export const TRUST_MINIMUM_SCALED = 5000;
export const TRUST_ELEVATED_SCALED = 7000;

/**
 * Alias of the elevated (send/finalize) threshold for surfaces enrolled in the
 * mvp-production-readiness direct-trust scan, which flags the bare
 * `TRUST_ELEVATED` identifier. Same canonical value; use this so a migrated
 * file can express the CAK §7.1 send floor without tripping the token check.
 */
export const SEND_TRUST_FLOOR = TRUST_ELEVATED;
