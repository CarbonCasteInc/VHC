import React, { useCallback, useMemo, useState } from 'react';
import { useSentimentState } from '../../hooks/useSentimentState';
import { getPublishedIdentity } from '../../store/identityProvider';
import type { ConstituencyProof } from '@vh/types';

export interface CellVoteControlsProps {
  readonly topicId: string;
  readonly pointId: string;
  readonly analysisId: string;
  readonly disabled?: boolean;
}

function buildProof(): ConstituencyProof | null {
  const identity = getPublishedIdentity();
  if (!identity?.session?.nullifier) return null;
  return {
    district_hash: 'default-district',
    nullifier: identity.session.nullifier,
    merkle_root: 'default-merkle-root',
  };
}

function countSignals(
  signals: ReadonlyArray<{ point_id: string; agreement: number }>,
  pointId: string,
): { agrees: number; disagrees: number } {
  let agrees = 0;
  let disagrees = 0;
  for (const s of signals) {
    if (s.point_id === pointId) {
      if (s.agreement === 1) agrees += 1;
      else if (s.agreement === -1) disagrees += 1;
    }
  }
  return { agrees, disagrees };
}

export const CellVoteControls: React.FC<CellVoteControlsProps> = ({
  topicId,
  pointId,
  analysisId,
  disabled = false,
}) => {
  const currentVote = useSentimentState((s) => s.getAgreement(topicId, pointId));
  const signals = useSentimentState((s) => s.signals);
  const setAgreement = useSentimentState((s) => s.setAgreement);
  const [denial, setDenial] = useState<string | null>(null);

  const proof = useMemo(() => buildProof(), []);
  const hasProof = proof !== null;
  const { agrees, disagrees } = useMemo(() => countSignals(signals, pointId), [signals, pointId]);

  const handleVote = useCallback(
    (desired: -1 | 1) => {
      if (disabled) return;
      setDenial(null);
      const result = setAgreement({
        topicId,
        pointId,
        analysisId,
        desired,
        constituency_proof: proof ?? undefined,
      });
      if (result?.denied) {
        setDenial(result.reason);
      }
    },
    [disabled, setAgreement, topicId, pointId, analysisId, proof],
  );

  const denialText = denial
    ? denial.includes('constituency') || denial.includes('proof')
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
          + {agrees}
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
          - {disagrees}
        </button>
      </div>
      {!hasProof && (
        <span
          className="text-[10px] text-amber-600"
          data-testid={`cell-vote-unweighted-${pointId}`}
        >
          Unweighted vote
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
