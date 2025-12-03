import React, { useMemo, useState } from 'react';
import { useForumStore } from '../../../store/hermesForum';
import { ThreadCard } from './ThreadCard';

export const ForumFeed: React.FC = () => {
  const { threads, userVotes, vote, loadThreads } = useForumStore();
  const [sort, setSort] = useState<'hot' | 'new' | 'top'>('hot');

  const sortedThreads = useMemo(() => {
    return loadThreads(sort);
  }, [loadThreads, sort, threads]);

  const [resolved, setResolved] = useState<ReturnType<typeof loadThreads> | null>(null);

  React.useEffect(() => {
    sortedThreads.then(setResolved);
  }, [sortedThreads]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {(['hot', 'new', 'top'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setSort(mode)}
            className={`rounded-full px-3 py-1 text-sm ${sort === mode ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}
          >
            {mode.toUpperCase()}
          </button>
        ))}
      </div>
      {(resolved ?? []).map((thread) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          userVote={userVotes.get(thread.id) ?? null}
          onVote={(direction) => vote(thread.id, direction)}
        />
      ))}
      {(resolved ?? []).length === 0 && <p className="text-sm text-slate-500">No threads yet.</p>}
    </div>
  );
};
