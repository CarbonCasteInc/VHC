import React, { useEffect, useMemo, useState } from 'react';
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
    readonly sourceSynthesisId?: string;
    readonly sourceEpoch?: number;
    readonly sourceUrl?: string;
    readonly topicId?: string;
    readonly threadId?: string;
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
  const [createdThread, setCreatedThread] = useState<HermesThread | null>(null);
  const effectiveThread = thread ?? createdThread;
  const threadId = effectiveThread?.id ?? null;
  const loadComments = useForumStore((state) => state.loadComments);
  const comments = useForumStore((state) =>
    threadId ? state.comments.get(threadId) ?? EMPTY_COMMENTS : EMPTY_COMMENTS,
  );
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [showNewThreadForm, setShowNewThreadForm] = useState(false);
  const createThreadKey = useMemo(
    () =>
      createThread
        ? [
            createThread.defaultTitle,
            createThread.sourceSynthesisId ?? '',
            createThread.sourceEpoch ?? '',
            createThread.sourceUrl ?? '',
            createThread.topicId ?? '',
            createThread.threadId ?? '',
          ].join('|')
        : 'none',
    [createThread],
  );

  useEffect(() => {
    if (thread) {
      setCreatedThread(null);
    }
  }, [thread]);

  useEffect(() => {
    if (thread) {
      return;
    }
    setCreatedThread(null);
    setShowNewThreadForm(false);
  }, [createThreadKey, sectionId, thread]);

  useEffect(() => {
    setShowComposer(false);
  }, [threadId]);

  useEffect(() => {
    if (!threadId) {
      setLoaded(false);
      setLoadError(null);
      return;
    }

    let active = true;
    setLoaded(false);
    setLoadError(null);
    void loadComments(threadId)
      .then(() => {
        if (active) {
          setLoaded(true);
        }
      })
      .catch((err) => {
        if (active) {
          setLoadError(err instanceof Error ? err.message : 'Unable to load comments');
        }
      });

    return () => {
      active = false;
    };
  }, [loadAttempt, loadComments, threadId]);

  const commentCount = loaded || comments.length > 0
    ? comments.length
    : Math.max(fallbackCommentCount, comments.length);

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
            {effectiveThread ? 'Threaded replies stay attached to this story.' : emptyMessage}
          </p>
        </div>

        {effectiveThread && (
          <Link
            to="/hermes/$threadId"
            params={{ threadId: effectiveThread.id }}
            className="rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
            data-testid={`${sectionId}-open-thread`}
          >
            Open thread
          </Link>
        )}
      </header>

      {effectiveThread ? (
        <>
          <div
            className="rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/80"
            data-testid={`${sectionId}-thread-head`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white dark:bg-white dark:text-slate-900">
                {effectiveThread.isHeadline ? 'Headline thread' : 'Forum thread'}
              </span>
            </div>
            <p className="mt-3 text-lg text-slate-900 dark:text-white">{effectiveThread.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>By {effectiveThread.author.slice(0, 10)}…</span>
              <span>{new Date(effectiveThread.timestamp).toLocaleString()}</span>
            </div>
          </div>

          {loadError && (
            <div
              className="space-y-2 rounded-[1.25rem] border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
              role="alert"
              data-testid={`${sectionId}-discussion-load-error`}
            >
              <p>Could not load comments: {loadError}</p>
              <button
                type="button"
                className="rounded-full border border-amber-300 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100"
                onClick={() => setLoadAttempt((value) => value + 1)}
                data-testid={`${sectionId}-discussion-retry-load`}
              >
                Retry
              </button>
            </div>
          )}

          {!loaded && !loadError && (
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
              <CommentStream threadId={effectiveThread.id} comments={comments} />
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
                  threadId={effectiveThread.id}
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
                sourceSynthesisId={createThread.sourceSynthesisId}
                sourceEpoch={createThread.sourceEpoch}
                sourceUrl={createThread.sourceUrl}
                topicId={createThread.topicId}
                threadId={createThread.threadId}
                onSuccess={(nextThread) => {
                  setCreatedThread(nextThread);
                  setShowNewThreadForm(false);
                }}
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
