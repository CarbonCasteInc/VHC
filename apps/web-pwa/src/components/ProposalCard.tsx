import React from 'react';
import type { Proposal } from '../hooks/useGovernance';
import VoteControl from './VoteControl';

interface ProposalCardProps {
  proposal: Proposal;
  onVote: (proposalId: string, amount: number, direction: 'for' | 'against') => Promise<void>;
}

export const ProposalCard: React.FC<ProposalCardProps> = ({ proposal, onVote }) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-slate-900">{proposal.title}</h3>
          <p className="text-sm text-slate-700">{proposal.summary}</p>
          <p className="text-xs text-slate-500">Author: {proposal.author}</p>
          <p className="text-xs text-slate-500">Request: {proposal.fundingRequest} RVU</p>
          <p className="text-xs text-slate-500">Recipient: {proposal.recipient}</p>
        </div>
        <div className="text-sm text-slate-700">
          <p>For: {proposal.votesFor}</p>
          <p>Against: {proposal.votesAgainst}</p>
        </div>
      </div>
      <div className="mt-4">
        <VoteControl onSubmit={(amount, direction) => onVote(proposal.id, amount, direction)} />
      </div>
    </div>
  );
};

export default ProposalCard;
