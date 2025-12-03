import React from 'react';
import { Link } from '@tanstack/react-router';
import type { HermesThread } from '@vh/types';
import { TrustGate } from './TrustGate';

interface Props {
  thread: HermesThread;
  onVote?: (direction: 'up' | 'down' | null) => void;
  userVote?: 'up' | 'down' | null;
}

export const ThreadCard: React.FC<Props> = ({ thread, onVote, userVote }) => {
  const score = thread.upvotes - thread.downvotes;
  return (
    <div className="rounded-xl border border-slate-200 bg-card p-4 shadow-sm dark:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            to="/hermes/forum/$threadId"
            params={{ threadId: thread.id }}
            className="text-lg font-semibold text-slate-900 hover:text-teal-700 dark:text-slate-100"
          >
            {thread.title}
          </Link>
          <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{thread.content}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>By {thread.author.slice(0, 10)}…</span>
            <span>Score: {score.toFixed(2)}</span>
            <span>{new Date(thread.timestamp).toLocaleString()}</span>
            <div className="flex gap-1">
              {thread.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-2 py-[2px] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        {onVote && (
          <TrustGate>
            <div className="flex flex-col items-center gap-1 text-sm text-slate-700">
              <button
                className={`rounded border px-2 py-1 ${userVote === 'up' ? 'border-teal-500 text-teal-700' : 'border-slate-200'}`}
                onClick={() => onVote(userVote === 'up' ? null : 'up')}
              >
                ▲
              </button>
              <span className="text-xs">{score}</span>
              <button
                className={`rounded border px-2 py-1 ${userVote === 'down' ? 'border-teal-500 text-teal-700' : 'border-slate-200'}`}
                onClick={() => onVote(userVote === 'down' ? null : 'down')}
              >
                ▼
              </button>
            </div>
          </TrustGate>
        )}
      </div>
    </div>
  );
};
