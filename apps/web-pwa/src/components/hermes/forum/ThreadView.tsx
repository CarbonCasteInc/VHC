import React, { useEffect, useMemo, useState } from 'react';
import { useForumStore } from '../../../store/hermesForum';
import { CommentNode } from './CommentNode';
import { CommentComposer } from './CommentComposer';
import { TrustGate } from './TrustGate';
import { CounterpointPanel } from './CounterpointPanel';

interface Props {
  threadId: string;
}

export const ThreadView: React.FC<Props> = ({ threadId }) => {
  const { threads, comments, loadComments, createComment } = useForumStore();
  const thread = threads.get(threadId);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadComments(threadId).then(() => setLoaded(true));
  }, [threadId, loadComments]);

  const byParent = useMemo(() => {
    const list = comments.get(threadId) ?? [];
    return list.filter((c) => c.parentId === null);
  }, [comments, threadId]);

  if (!thread) {
    return <p className="text-sm text-slate-500">Thread not found.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-card p-4 shadow-sm dark:border-slate-700">
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{thread.title}</p>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{thread.content}</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <span>By {thread.author.slice(0, 10)}…</span>
          <span>{new Date(thread.timestamp).toLocaleString()}</span>
          <span>Score: {(thread.upvotes - thread.downvotes).toFixed(2)}</span>
        </div>
      </div>

      <TrustGate>
        <CommentComposer threadId={threadId} type="reply" />
      </TrustGate>

      {!loaded && <p className="text-sm text-slate-500">Loading comments…</p>}
      <div className="space-y-3">
        {byParent.map((comment) => {
          const counters = (comments.get(threadId) ?? []).filter(
            (c) => c.type === 'counterpoint' && c.targetId === comment.id
          );
          return (
            <div key={comment.id} className="space-y-2">
              <CommentNode comment={comment} />
              {counters.length > 0 && <CounterpointPanel base={comment} counterpoints={counters} />}
            </div>
          );
        })}
        {byParent.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
      </div>
    </div>
  );
};
