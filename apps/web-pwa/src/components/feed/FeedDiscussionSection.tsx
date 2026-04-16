import React, { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { HermesComment, HermesThread } from '@vh/types';
import { useForumStore } from '../../store/hermesForum';
import { CommentStream } from '../hermes/CommentStream';
import { CommentComposer } from '../hermes/forum/CommentComposer';
import { NewThreadForm } from '../hermes/forum/NewThreadForm';
import { TrustGate } from '../hermes/forum/TrustGate';

const EMPTY_COMMENTS: HermesComment[] = [];

export interface FeedDiscussionSectionProps {
  readonly sectionId: string;
  readonly thread: HermesThread | null;
  readonly title?: string;
  readonly emptyMessage?: string;
  readonly fallbackCommentCount?: number;
  readonly createThread?: {
    readonly defaultTitle: string;
    readonly sourceAnalysisId?: string;
    readonly sourceUrl?: string;
  } | null;
}

export const FeedDiscussionSection: React.FC<FeedDiscussionSectionProps> = ({
  sectionId,
  thread,
  title = 'Conversation',
  emptyMessage = 'No thread linked yet for this story.',
  fallbackCommentCount = 0,
  createThread = null,
}) => {
  const threadId = thread?.id ?? null;
  const loadComments = useForumStore((state) => state.loadComments);
  const comments = useForumStore((state) =>
    threadId ? state.comments.get(threadId) ?? EMPTY_COMMENTS : EMPTY_COMMENTS,
  );
  const [loaded, setLoaded] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [showNewThreadForm, setShowNewThreadForm] = useState(false);

  useEffect(() => {
    setShowComposer(false);
  }, [threadId]);

  useEffect(() => {
    if (!threadId) {
      setLoaded(false);
      return;
    }

    let active = true;
    setLoaded(false);
    void loadComments(threadId).then(() => {
      if (active) {
        setLoaded(true);
      }
    });

    return () => {
      active = false;
    };
  }, [loadComments, threadId]);

  const commentCount = Math.max(fallbackCommentCount, comments.length);

  return (
    <section
      className="space-y-4 rounded-[1.75rem] border border-slate-200/90 bg-white/84 p-4 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80"
      data-testid={`${sectionId}-discussion`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-900 dark:text-white">{title}</h4>
            <span
              className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              data-testid={`${sectionId}-discussion-count`}
            >
              {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {thread ? 'Threaded replies stay attached to this topic.' : emptyMessage}
          </p>
        </div>

        {thread && (
          <Link
            to="/hermes/$threadId"
            params={{ threadId: thread.id }}
            className="rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
            data-testid={`${sectionId}-open-thread`}
          >
            Open thread
          </Link>
        )}
      </header>

      {thread ? (
        <>
          <div
            className="rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/80"
            data-testid={`${sectionId}-thread-head`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white dark:bg-white dark:text-slate-900">
                {thread.isHeadline ? 'Headline thread' : 'Forum thread'}
              </span>
            </div>
            <p className="mt-3 text-lg text-slate-900 dark:text-white">{thread.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>By {thread.author.slice(0, 10)}…</span>
              <span>{new Date(thread.timestamp).toLocaleString()}</span>
            </div>
          </div>

          {!loaded && (
            <p className="text-sm text-slate-500 dark:text-slate-400" data-testid={`${sectionId}-discussion-loading`}>
              Loading comments…
            </p>
          )}

          {loaded && comments.length === 0 && (
            <p
              className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400"
              data-testid={`${sectionId}-discussion-empty`}
            >
              No comments yet. Start the discussion.
            </p>
          )}

          {comments.length > 0 && (
            <div className="rounded-[1.5rem] border border-slate-200/80 bg-slate-50/55 p-2 dark:border-slate-800 dark:bg-slate-900/70">
              <CommentStream threadId={thread.id} comments={comments} />
            </div>
          )}

          <div className="space-y-3 border-t border-slate-200/80 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-900 dark:text-white">Join the discussion</p>
              <TrustGate
                fallback={
                  <span
                    className="text-xs text-slate-500 dark:text-slate-400"
                    data-testid={`${sectionId}-discussion-trust-gate`}
                  >
                    Verify to reply
                  </span>
                }
              >
                <button
                  type="button"
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  onClick={() => setShowComposer((value) => !value)}
                  data-testid={`${sectionId}-discussion-compose-toggle`}
                >
                  {showComposer ? 'Close' : 'Reply'}
                </button>
              </TrustGate>
            </div>

            {showComposer && (
              <TrustGate>
                <CommentComposer
                  threadId={thread.id}
                  onSubmit={async () => setShowComposer(false)}
                />
              </TrustGate>
            )}
          </div>
        </>
      ) : createThread ? (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            onClick={() => setShowNewThreadForm((value) => !value)}
            data-testid={`${sectionId}-discussion-new-thread-toggle`}
          >
            {showNewThreadForm ? 'Close' : 'Start discussion'}
          </button>

          {showNewThreadForm && (
            <TrustGate
              fallback={
                <p
                  className="text-xs text-slate-500 dark:text-slate-400"
                  data-testid={`${sectionId}-discussion-new-thread-trust-gate`}
                >
                  Verify identity to start the discussion.
                </p>
              }
            >
              <NewThreadForm
                defaultTitle={createThread.defaultTitle}
                sourceAnalysisId={createThread.sourceAnalysisId}
                sourceUrl={createThread.sourceUrl}
                onSuccess={() => setShowNewThreadForm(false)}
              />
            </TrustGate>
          )}
        </div>
      ) : (
        <p
          className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400"
          data-testid={`${sectionId}-discussion-unavailable`}
        >
          Conversation is still syncing for this topic.
        </p>
      )}
    </section>
  );
};

export default FeedDiscussionSection;
