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
      className="space-y-4 rounded-[1.5rem] border border-slate-200/90 bg-white/80 p-4 shadow-sm shadow-slate-900/5"
      data-testid={`${sectionId}-discussion`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
            <span
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
              data-testid={`${sectionId}-discussion-count`}
            >
              {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {thread ? 'Threaded replies stay attached to this topic.' : emptyMessage}
          </p>
        </div>

        {thread && (
          <Link
            to="/hermes/$threadId"
            params={{ threadId: thread.id }}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
            data-testid={`${sectionId}-open-thread`}
          >
            Open thread
          </Link>
        )}
      </header>

      {thread ? (
        <>
          <div
            className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3"
            data-testid={`${sectionId}-thread-head`}
          >
            <p className="text-sm font-semibold text-slate-900">{thread.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>By {thread.author.slice(0, 10)}…</span>
              <span>{new Date(thread.timestamp).toLocaleString()}</span>
              <span>{thread.isHeadline ? 'Headline thread' : 'Forum thread'}</span>
            </div>
          </div>

          {!loaded && (
            <p className="text-sm text-slate-500" data-testid={`${sectionId}-discussion-loading`}>
              Loading comments…
            </p>
          )}

          {loaded && comments.length === 0 && (
            <p
              className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500"
              data-testid={`${sectionId}-discussion-empty`}
            >
              No comments yet. Start the discussion.
            </p>
          )}

          {comments.length > 0 && <CommentStream threadId={thread.id} comments={comments} />}

          <div className="space-y-3 border-t border-slate-200/80 pt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-900">Join the discussion</p>
              <TrustGate
                fallback={
                  <span
                    className="text-xs text-slate-500"
                    data-testid={`${sectionId}-discussion-trust-gate`}
                  >
                    Verify to reply
                  </span>
                }
              >
                <button
                  type="button"
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
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
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800"
            onClick={() => setShowNewThreadForm((value) => !value)}
            data-testid={`${sectionId}-discussion-new-thread-toggle`}
          >
            {showNewThreadForm ? 'Close' : 'Start discussion'}
          </button>

          {showNewThreadForm && (
            <TrustGate
              fallback={
                <p
                  className="text-xs text-slate-500"
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
          className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500"
          data-testid={`${sectionId}-discussion-unavailable`}
        >
          Conversation is still syncing for this topic.
        </p>
      )}
    </section>
  );
};

export default FeedDiscussionSection;
