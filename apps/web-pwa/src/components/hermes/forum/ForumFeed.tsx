import React, { useMemo, useState } from 'react';
import { useForumStore } from '../../../store/hermesForum';
import { ThreadCard } from './ThreadCard';
import { NewThreadForm } from './NewThreadForm';
import { TrustGate } from './TrustGate';

interface ForumFeedProps {
  sourceAnalysisId?: string;
  defaultTitle?: string;
  sourceUrl?: string;
}

export const ForumFeed: React.FC<ForumFeedProps> = ({ sourceAnalysisId, defaultTitle, sourceUrl }) => {
  const { threads, userVotes, vote, loadThreads } = useForumStore();
  const [sort, setSort] = useState<'hot' | 'new' | 'top'>('hot');
  const [showNewThread, setShowNewThread] = useState(false);

  const sortedThreads = useMemo(() => loadThreads(sort), [loadThreads, sort, threads]);

  const [resolved, setResolved] = useState<Awaited<ReturnType<typeof loadThreads>> | null>(null);

  React.useEffect(() => {
    let canceled = false;
    void sortedThreads.then((items) => {
      if (!canceled) {
        setResolved(items);
      }
    });
    return () => {
      canceled = true;
    };
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
        <button
          className={`rounded-full px-3 py-1 text-sm ${showNewThread ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}
          data-testid="new-thread-btn"
          onClick={() => setShowNewThread((prev) => !prev)}
        >
          {showNewThread ? '✕ Cancel' : '+ New Thread'}
        </button>
      </div>

      {showNewThread && (
        <TrustGate fallback={<p className="text-xs text-amber-600" data-testid="trust-gate-msg">Verify identity to participate.</p>}>
          <NewThreadForm
            sourceAnalysisId={sourceAnalysisId}
            defaultTitle={defaultTitle}
            sourceUrl={sourceUrl}
            onSuccess={() => setShowNewThread(false)}
          />
        </TrustGate>
      )}

      {(resolved ?? []).map((thread) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          userVote={userVotes.get(thread.id) ?? null}
          onVote={(direction) => vote(thread.id, direction)}
        />
      ))}
      {(resolved ?? []).length === 0 && !showNewThread && <p className="text-sm text-slate-500">No threads yet. Click "+ New Thread" to start one.</p>}
    </div>
  );
};
