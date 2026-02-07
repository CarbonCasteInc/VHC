import React, { useMemo } from 'react';
import useGovernance, { MIN_TRUST_TO_VOTE } from '../hooks/useGovernance';
import ProposalCard from './ProposalCard';
import { useIdentity } from '../hooks/useIdentity';

export const ProposalList: React.FC = () => {
  const { identity } = useIdentity();
  const voterId = identity?.session?.nullifier ?? null;
  const trustScore = useMemo(() => {
    if (identity?.session?.trustScore != null) return identity.session.trustScore;
    if (identity?.session?.scaledTrustScore != null) return identity.session.scaledTrustScore / 10000;
    return null;
  }, [identity]);
  const canVote = voterId != null && trustScore != null && trustScore >= MIN_TRUST_TO_VOTE;
  const { proposals, loading, error, submitVote, lastAction, votedDirections } = useGovernance(voterId, trustScore);

  if (loading) return <p className="text-sm text-slate-500">Loading proposals...</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (proposals.length === 0) return <p className="text-sm text-slate-500">No proposals yet.</p>;

  return (
    <div className="space-y-4">
      {lastAction && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {lastAction}
        </div>
      )}
      {proposals.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          onVote={(proposalId, amount, direction) => submitVote({ proposalId, amount, direction })}
          votedDirection={votedDirections[p.id]}
          canVote={canVote}
        />
      ))}
    </div>
  );
};

export default ProposalList;
