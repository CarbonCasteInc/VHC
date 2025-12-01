import React from 'react';
import type { Proposal } from '../hooks/useGovernance';
import VoteControl from './VoteControl';

interface ProposalCardProps {
  proposal: Proposal;
  onVote: (proposalId: string, amount: number, direction: 'for' | 'against') => Promise<'recorded' | 'updated' | 'switched' | void>;
  votedDirection?: 'for' | 'against';
  canVote?: boolean;
}

export const ProposalCard: React.FC<ProposalCardProps> = ({ proposal, onVote, votedDirection, canVote }) => {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-card p-5 shadow-sm shadow-slate-900/5 dark:border-slate-700">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-[0.01em] text-slate-900">{proposal.title}</h3>
          <p className="text-sm text-slate-700 dark:text-slate-300">{proposal.summary}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Author: {proposal.author}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Request: {proposal.fundingRequest} RVU</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Recipient: {proposal.recipient}</p>
        </div>
        <div className="text-sm text-slate-700 dark:text-slate-200 space-y-1 text-right">
          <p>For: {proposal.votesFor}</p>
          <p>Against: {proposal.votesAgainst}</p>
          {votedDirection && (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
              You voted {votedDirection}
            </span>
          )}
        </div>
      </div>
      <div className="mt-4">
        <VoteControl
          onSubmit={(amount, direction) => onVote(proposal.id, amount, direction)}
          votedDirection={votedDirection}
          disabled={canVote === false}
        />
      </div>
    </div>
  );
};

export default ProposalCard;
