import React from 'react';
import { useForumStore } from '../../../store/hermesForum';
import { TrustGate } from './TrustGate';

export const VoteControl: React.FC<{ commentId: string; score: number }> = ({ commentId, score }) => {
  const userVotes = useForumStore((s) => s.userVotes);
  const vote = useForumStore((s) => s.vote);
  const current = userVotes.get(commentId) ?? null;

  return (
    <TrustGate fallback={null}>
      <div className="flex flex-col items-center gap-0.5 text-xs">
        <button
          className={`rounded px-1 hover:bg-slate-100 dark:hover:bg-slate-800 ${
            current === 'up' ? 'text-teal-600' : 'text-slate-400'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            void vote(commentId, current === 'up' ? null : 'up');
          }}
          aria-label="Upvote"
        >
          ▲
        </button>
        <span className="font-mono">{score}</span>
        <button
          className={`rounded px-1 hover:bg-slate-100 dark:hover:bg-slate-800 ${
            current === 'down' ? 'text-amber-600' : 'text-slate-400'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            // W3-Budget assessment (2026-02-14): moderation/day budget primitives exist
            // (checkModerationBudget/consumeModerationBudget in xpLedgerBudget.ts) but
            // VoteControl has no hide/remove moderation surface yet — only up/down votes.
            // Wire budget enforcement when explicit moderation actions are added.
            // See: docs/foundational/WAVE3_BUDGET_BOUNDARY_ASSESSMENT.md
            void vote(commentId, current === 'down' ? null : 'down');
          }}
          aria-label="Downvote"
        >
          ▼
        </button>
      </div>
    </TrustGate>
  );
};
