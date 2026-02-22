import React, { useCallback, useMemo, useState } from 'react';
import { useSentimentState } from '../../hooks/useSentimentState';
import { useConstituencyProof } from '../../hooks/useConstituencyProof';
import { usePointAggregate } from '../../hooks/usePointAggregate';

export interface CellVoteControlsProps {
  readonly topicId: string;
  readonly pointId: string;
  readonly synthesisPointId?: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly analysisId?: string;
  readonly disabled?: boolean;
}

function countSignals(
  signals: ReadonlyArray<{ point_id: string; agreement: number; synthesis_id?: string; epoch?: number }>,
  pointId: string,
  synthesisId: string,
  epoch: number,
  legacyPointId?: string,
): { agrees: number; disagrees: number } {
  let agrees = 0;
  let disagrees = 0;
  for (const s of signals) {
    const isMatchingPoint = s.point_id === pointId || (legacyPointId !== undefined && s.point_id === legacyPointId);
    if (isMatchingPoint && s.synthesis_id === synthesisId && s.epoch === epoch) {
      if (s.agreement === 1) agrees += 1;
      else if (s.agreement === -1) disagrees += 1;
    }
  }
  return { agrees, disagrees };
}

export const CellVoteControls: React.FC<CellVoteControlsProps> = ({
  topicId,
  pointId,
  synthesisPointId,
  synthesisId,
  epoch,
  analysisId,
  disabled = false,
}) => {
  const canonicalPointId = synthesisPointId ?? pointId;
  const legacyPointId = synthesisPointId && synthesisPointId !== pointId ? pointId : undefined;

  const currentVote = useSentimentState((s) =>
    s.getAgreement(topicId, canonicalPointId, synthesisId, epoch, legacyPointId),
  );
  const signals = useSentimentState((s) => s.signals);
  const setAgreement = useSentimentState((s) => s.setAgreement);
  const [denial, setDenial] = useState<string | null>(null);
  const { proof, error: proofError } = useConstituencyProof();

  const hasProof = proof !== null;
  const { agrees, disagrees } = useMemo(
    () => countSignals(signals, canonicalPointId, synthesisId, epoch, legacyPointId),
    [canonicalPointId, epoch, legacyPointId, signals, synthesisId],
  );
  const { aggregate, status: aggregateStatus } = usePointAggregate({
    topicId,
    synthesisId,
    epoch,
    pointId: canonicalPointId,
    enabled: !disabled,
  });
  const displayAgrees = aggregateStatus === 'success' && aggregate
    ? Math.max(agrees, aggregate.agree)
    : agrees;
  const displayDisagrees = aggregateStatus === 'success' && aggregate
    ? Math.max(disagrees, aggregate.disagree)
    : disagrees;

  const handleVote = useCallback(
    (desired: -1 | 1) => {
      if (disabled) return;
      setDenial(null);
      const result = setAgreement({
        topicId,
        pointId,
        synthesisPointId,
        synthesisId,
        epoch,
        analysisId,
        desired,
        constituency_proof: proof ?? undefined,
      });
      if (result && !result.accepted) {
        setDenial(result.reason ?? null);
      }
    },
    [analysisId, disabled, epoch, pointId, proof, setAgreement, synthesisId, synthesisPointId, topicId],
  );

  const denialText = denial
    ? denial.includes('synthesis context')
      ? 'Waiting for synthesis context'
      : denial.includes('constituency') || denial.includes('proof')
        ? 'Sign in to make your vote count'
        : 'Daily vote limit reached'
    : null;

  return (
    <div className="mt-1 flex flex-col gap-0.5" data-testid={`cell-vote-${pointId}`}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`rounded px-1.5 py-0.5 text-xs ${
            currentVote === 1
              ? 'bg-green-200 text-green-800'
              : 'bg-slate-100 text-slate-600 hover:bg-green-50'
          }`}
          aria-label={`Agree with ${pointId}`}
          aria-pressed={currentVote === 1}
          disabled={disabled}
          onClick={() => handleVote(1)}
          data-testid={`cell-vote-agree-${pointId}`}
        >
          + {displayAgrees}
        </button>
        <button
          type="button"
          className={`rounded px-1.5 py-0.5 text-xs ${
            currentVote === -1
              ? 'bg-red-200 text-red-800'
              : 'bg-slate-100 text-slate-600 hover:bg-red-50'
          }`}
          aria-label={`Disagree with ${pointId}`}
          aria-pressed={currentVote === -1}
          disabled={disabled}
          onClick={() => handleVote(-1)}
          data-testid={`cell-vote-disagree-${pointId}`}
        >
          - {displayDisagrees}
        </button>
      </div>
      {!hasProof && (
        <span
          className="text-[10px] text-amber-600"
          data-testid={`cell-vote-unweighted-${pointId}`}
        >
          {proofError ?? 'Voting requires verified proof'}
        </span>
      )}
      {denialText && (
        <span
          className="text-[10px] text-red-600"
          data-testid={`cell-vote-denial-${pointId}`}
        >
          {denialText}
        </span>
      )}
    </div>
  );
};

export default CellVoteControls;
