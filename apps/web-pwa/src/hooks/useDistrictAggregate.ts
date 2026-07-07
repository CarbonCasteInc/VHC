import { useEffect, useState } from 'react';
import {
  MIN_DISTRICT_COHORT_SIZE,
  type DistrictAggregateSummaryV1,
} from '@vh/data-model';
import { readDistrictAggregateSummary } from '@vh/gun-client';
import { resolveClientFromAppStore } from '../store/clientResolver';

export type DistrictAggregateStatus = 'idle' | 'loading' | 'withheld' | 'ready' | 'error';

export interface UseDistrictAggregateParams {
  readonly topicId?: string;
  readonly synthesisId?: string;
  readonly epoch?: number;
  readonly districtHash?: string;
  readonly enabled?: boolean;
}

export interface UseDistrictAggregateResult {
  readonly summary: DistrictAggregateSummaryV1 | null;
  readonly status: DistrictAggregateStatus;
  readonly minCohortSize: number;
}

/**
 * Read the published district/office aggregate summary for a tuple.
 *
 * Status semantics:
 * - `idle`: not enough context (missing tuple/district) or disabled.
 * - `withheld`: no published record — the aggregate is below the k-anonymity
 *   floor or not yet materialized. Callers must render "not enough local signal
 *   yet", never a small-cell count.
 * - `ready`: a published, above-threshold aggregate is available.
 *
 * `readDistrictAggregateSummary` returns null for a missing or non-validating
 * record (including any below-threshold record), so this hook never surfaces a
 * small-cell count.
 */
export function useDistrictAggregate({
  topicId,
  synthesisId,
  epoch,
  districtHash,
  enabled = true,
}: UseDistrictAggregateParams): UseDistrictAggregateResult {
  const [result, setResult] = useState<UseDistrictAggregateResult>({
    summary: null,
    status: 'idle',
    minCohortSize: MIN_DISTRICT_COHORT_SIZE,
  });

  useEffect(() => {
    let cancelled = false;

    const hasTuple =
      enabled
      && Boolean(topicId)
      && Boolean(synthesisId)
      && epoch !== undefined
      && Boolean(districtHash);

    if (!hasTuple) {
      setResult({ summary: null, status: 'idle', minCohortSize: MIN_DISTRICT_COHORT_SIZE });
      return () => {
        cancelled = true;
      };
    }

    const client = resolveClientFromAppStore();
    if (!client) {
      setResult({ summary: null, status: 'idle', minCohortSize: MIN_DISTRICT_COHORT_SIZE });
      return () => {
        cancelled = true;
      };
    }

    setResult({ summary: null, status: 'loading', minCohortSize: MIN_DISTRICT_COHORT_SIZE });

    void (async () => {
      try {
        const summary = await readDistrictAggregateSummary(
          client,
          topicId as string,
          districtHash as string,
        );
        if (cancelled) {
          return;
        }
        const matchesTuple =
          summary !== null
          && summary.topic_id === topicId
          && summary.synthesis_id === synthesisId
          && summary.epoch === epoch;
        setResult({
          summary: matchesTuple ? summary : null,
          status: matchesTuple ? 'ready' : 'withheld',
          minCohortSize: MIN_DISTRICT_COHORT_SIZE,
        });
      } catch {
        if (cancelled) {
          return;
        }
        setResult({ summary: null, status: 'error', minCohortSize: MIN_DISTRICT_COHORT_SIZE });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [topicId, synthesisId, epoch, districtHash, enabled]);

  return result;
}
