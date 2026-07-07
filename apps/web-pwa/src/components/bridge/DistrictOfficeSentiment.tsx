/**
 * DistrictOfficeSentiment — aggregate-only district/office sentiment surface.
 *
 * Renders which office/district the aggregate refers to, which
 * topic/synthesis/epoch, per-point agree/disagree, cohort size + threshold
 * status, and the computed time + source snapshot version. Below the cohort
 * floor (or when no record is published) it shows "not enough local signal yet"
 * and never a small-cell count.
 *
 * Copy is strictly beta-local (Slice E4): it describes participation in VHC's
 * beta-local civic sentiment aggregate for a configured/local office. It does
 * not assert residence verification, human-uniqueness proof, or official message
 * delivery to an office — those are separate, unimplemented flows. Passes
 * check:luma-forbidden-claims.
 *
 * Spec: spec-luma-service-v0.md §9.4; spec-identity-trust-constituency.md §4.
 */

import React from 'react';
import { useConstituencyProof } from '../../hooks/useConstituencyProof';
import { getConfiguredDistrict } from '../../store/bridge/districtConfig';
import { useDistrictAggregate } from '../../hooks/useDistrictAggregate';

export interface DistrictOfficeSentimentProps {
  /** Optional accepted-current context; a parent with story context supplies it. */
  readonly topicId?: string;
  readonly synthesisId?: string;
  readonly epoch?: number;
  /** Overrides the active/configured district hash. */
  readonly districtHash?: string;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

const OFFICE_LABELS: Record<string, string> = {
  senate: 'Senate office',
  house: 'House office',
  state: 'State office',
  local: 'Local office',
};

export const DistrictOfficeSentiment: React.FC<DistrictOfficeSentimentProps> = ({
  topicId,
  synthesisId,
  epoch,
  districtHash,
}) => {
  const { proof } = useConstituencyProof();
  const activeDistrictHash = districtHash ?? proof?.district_hash ?? getConfiguredDistrict();

  const { summary, status, minCohortSize } = useDistrictAggregate({
    topicId,
    synthesisId,
    epoch,
    districtHash: activeDistrictHash,
  });

  return (
    <section data-testid="district-office-sentiment" className="space-y-3">
      <header>
        <h3 className="text-sm font-semibold text-gray-800">Local civic sentiment (beta)</h3>
        <p data-testid="district-sentiment-blurb" className="text-xs text-gray-500">
          Register your opinion in the beta-local civic sentiment aggregate for your local
          office. Counts below are aggregate-only for your configured district.
        </p>
      </header>

      {status === 'ready' && summary ? (
        <div data-testid="district-sentiment-ready" className="space-y-2 rounded border border-gray-200 p-3">
          <div className="text-xs text-gray-600">
            <span data-testid="district-sentiment-office">
              {OFFICE_LABELS[summary.office] ?? summary.office}
            </span>
            {' · '}
            <span data-testid="district-sentiment-district">District {summary.district_hash}</span>
          </div>
          <div data-testid="district-sentiment-context" className="text-xs text-gray-400">
            Topic {summary.topic_id} · Synthesis {summary.synthesis_id} · Epoch {summary.epoch}
          </div>

          <ul data-testid="district-sentiment-points" className="space-y-1">
            {summary.points.map((point) => (
              <li
                key={point.point_id}
                data-testid={`district-sentiment-point-${point.point_id}`}
                className="flex justify-between text-xs text-gray-700"
              >
                <span>{point.point_id}</span>
                <span>
                  <span data-testid={`district-sentiment-agree-${point.point_id}`}>
                    {point.agree} agree
                  </span>
                  {' · '}
                  <span data-testid={`district-sentiment-disagree-${point.point_id}`}>
                    {point.disagree} disagree
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div data-testid="district-sentiment-cohort" className="text-xs text-gray-500">
            Cohort size {summary.cohortSize} (meets the {minCohortSize}+ threshold)
          </div>
          <div data-testid="district-sentiment-provenance" className="text-xs text-gray-400">
            Computed {formatTime(summary.computed_at)} · source {summary.source_snapshot_version}
          </div>
        </div>
      ) : status === 'loading' ? (
        <p data-testid="district-sentiment-loading" className="text-xs text-gray-500">
          Loading local aggregate…
        </p>
      ) : status === 'error' ? (
        <p data-testid="district-sentiment-error" className="text-xs text-amber-600">
          Could not load the local aggregate right now.
        </p>
      ) : (
        <p data-testid="district-sentiment-withheld" className="text-xs text-gray-500">
          Not enough local signal yet. Aggregate counts appear once at least {minCohortSize}
          {' '}
          local participants have taken part.
        </p>
      )}
    </section>
  );
};
