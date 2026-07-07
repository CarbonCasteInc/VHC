import { z } from 'zod';

/**
 * District/office aggregate sentiment read model.
 *
 * Aggregate-only projection of accepted vote tuples onto a district/office. It
 * is the ONLY public record class permitted to carry `district_hash`, and only
 * at an allow-listed aggregate path (`vh/aggregates/topics/<topicId>/districts/
 * <districtHash>/summary`) with a cohort at or above the k-anonymity floor.
 *
 * Spec:
 * - spec-luma-service-v0.md §9.4 (district-hash k-anonymity,
 *   `MIN_DISTRICT_COHORT_SIZE = 100`).
 * - spec-identity-trust-constituency.md §4 (`district_hash` + `nullifier` pair
 *   is sensitive; only aggregated per-district stats without nullifiers may be
 *   published to reps/dashboards).
 *
 * There are NO per-user rows here: no nullifier, no proof, no token, no
 * voterId, no address, no region code. Those keys are additionally rejected by
 * the runtime topology guard and the public-namespace-leak lint.
 */

const NonEmptyString = z.string().min(1);

/** k-anonymity floor for any public record carrying `district_hash` (§9.4). */
export const MIN_DISTRICT_COHORT_SIZE = 100 as const;

export const DISTRICT_AGGREGATE_SUMMARY_VERSION = 'district-aggregate-summary-v1' as const;

/** Per-point agree/disagree counts within the district cohort. */
export const DistrictAggregatePointSchema = z
  .object({
    point_id: NonEmptyString,
    agree: z.number().int().nonnegative(),
    disagree: z.number().int().nonnegative(),
  })
  .strict();

export const DistrictAggregateSummaryV1Schema = z
  .object({
    schema_version: z.literal(DISTRICT_AGGREGATE_SUMMARY_VERSION),
    district_hash: NonEmptyString,
    /** Office reference resolved from the representative directory. */
    office: z.enum(['senate', 'house', 'state', 'local']),
    topic_id: NonEmptyString,
    synthesis_id: NonEmptyString,
    epoch: z.number().int().nonnegative(),
    /** Distinct participants across the cohort; gates public visibility (§9.4). */
    cohortSize: z.number().int().min(MIN_DISTRICT_COHORT_SIZE),
    points: z.array(DistrictAggregatePointSchema),
    computed_at: z.number().int().nonnegative(),
    /** Version of the point-aggregate snapshot shape this was computed from. */
    source_snapshot_version: NonEmptyString,
  })
  .strict();

export type DistrictAggregatePoint = z.infer<typeof DistrictAggregatePointSchema>;
export type DistrictAggregateSummaryV1 = z.infer<typeof DistrictAggregateSummaryV1Schema>;
