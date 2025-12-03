import React, { useState } from 'react';
import type { HermesComment } from '@vh/types';
import { Button } from '@vh/ui';
import { useForumStore } from '../../../store/hermesForum';
import { TrustGate } from './TrustGate';
import { CommentComposer } from './CommentComposer';

interface Props {
  comment: HermesComment;
  depth?: number;
}

export const CommentNode: React.FC<Props> = ({ comment, depth = 0 }) => {
  const { userVotes, vote, comments } = useForumStore();
  const [showReply, setShowReply] = useState(false);
  const [showCounter, setShowCounter] = useState(false);
  const score = comment.upvotes - comment.downvotes;
  const isCollapsed = score < 0 && !showReply && !showCounter;
  const children = (comments.get(comment.threadId) ?? []).filter((c) => c.parentId === comment.id);
  return (
    <div className={`border-l border-slate-200 pl-3 dark:border-slate-700 ${depth ? 'mt-2' : ''}`}>
      <div
        className={`rounded-lg border px-3 py-2 ${
          comment.type === 'counterpoint'
            ? 'border-amber-300 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-900/30'
            : 'border-slate-200 bg-card dark:border-slate-700'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {comment.author.slice(0, 10)}…
              </span>
              <span className="text-[11px] text-slate-500">{new Date(comment.timestamp).toLocaleString()}</span>
            </div>
            {isCollapsed ? (
              <button
                className="text-xs text-slate-500 underline"
                onClick={() => {
                  setShowReply(false);
                  setShowCounter(false);
                }}
              >
                [collapsed] score {score}
              </button>
            ) : (
              <p className="text-slate-800 dark:text-slate-100">{comment.content}</p>
            )}
          </div>
          <TrustGate
            fallback={<span className="text-[11px] text-slate-500">Verify to vote</span>}
          >
            <div className="flex flex-col items-center gap-1 text-xs">
              <button
                className={`rounded border px-1 ${userVotes.get(comment.id) === 'up' ? 'border-teal-500 text-teal-700' : 'border-slate-200'}`}
                onClick={() => vote(comment.id, userVotes.get(comment.id) === 'up' ? null : 'up')}
              >
                ▲
              </button>
              <span>{score}</span>
              <button
                className={`rounded border px-1 ${userVotes.get(comment.id) === 'down' ? 'border-teal-500 text-teal-700' : 'border-slate-200'}`}
                onClick={() => vote(comment.id, userVotes.get(comment.id) === 'down' ? null : 'down')}
              >
                ▼
              </button>
            </div>
          </TrustGate>
        </div>
        <div className="mt-2 flex gap-2 text-xs">
          <Button variant="ghost" size="sm" onClick={() => setShowReply((v) => !v)}>
            Reply
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowCounter((v) => !v)}>
            Counterpoint
          </Button>
        </div>
        {showReply && (
          <div className="mt-2">
            <CommentComposer threadId={comment.threadId} parentId={comment.id} type="reply" />
          </div>
        )}
        {showCounter && (
          <div className="mt-2">
            <CommentComposer
              threadId={comment.threadId}
              parentId={comment.id}
              targetId={comment.id}
              type="counterpoint"
            />
          </div>
        )}
      </div>
      <div className="ml-3 space-y-2">
        {children.map((child) => (
          <CommentNode key={child.id} comment={child} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
};
