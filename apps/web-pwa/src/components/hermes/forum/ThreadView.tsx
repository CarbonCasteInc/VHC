import React, { useEffect, useMemo, useState } from 'react';
import { useForumStore } from '../../../store/hermesForum';
import { CommentComposer } from './CommentComposer';
import { TrustGate } from './TrustGate';
import { renderMarkdown } from '../../../utils/markdown';
import { CommentStream } from '../CommentStream';
import { CommunityReactionSummary } from '../CommunityReactionSummary';
import { EngagementIcons } from '../../EngagementIcons';
import { useSentimentState } from '../../../hooks/useSentimentState';
import { useViewTracking } from '../../../hooks/useViewTracking';
import { safeGetItem, safeSetItem } from '../../../utils/safeStorage';
import type { HermesComment } from '@vh/types';

interface Props {
  threadId: string;
}

const EMPTY_COMMENTS: HermesComment[] = [];
const borderlessButton =
  'inline-flex items-center gap-2 rounded-lg px-4 py-2 shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-500';

// Keyframe animation for smooth zoom-in effect
const zoomInAnimation = `
@keyframes threadZoomIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
`;

const CALLOUT_KEY = 'vh-thread-view-updated-dismissed';

// Inject the animation styles once
if (typeof document !== 'undefined') {
  const styleId = 'thread-zoom-animation';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = zoomInAnimation;
    document.head.appendChild(style);
  }
}

export const ThreadView: React.FC<Props> = ({ threadId }) => {
  // Use individual selectors for proper reactivity
  const thread = useForumStore((s) => s.threads.get(threadId));
  const loadComments = useForumStore((s) => s.loadComments);
  const commentsForThread = useForumStore((s) => s.comments.get(threadId));
  const allComments = commentsForThread ?? EMPTY_COMMENTS;
  const eyeWeight = useSentimentState((s) => s.getEyeWeight(threadId));
  const lightbulbWeight = useSentimentState((s) => s.getLightbulbWeight(threadId));
  
  const [loaded, setLoaded] = useState(false);
  const [showRootComposer, setShowRootComposer] = useState(false);
  const [showCallout, setShowCallout] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return !safeGetItem(CALLOUT_KEY);
    } catch {
      return false;
    }
  });
  useViewTracking(threadId, true);

  // Check for reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    void loadComments(threadId).then(() => setLoaded(true));
  }, [threadId, loadComments]);

  const dismissCallout = () => {
    try {
      safeSetItem(CALLOUT_KEY, 'true');
    } catch {
      // ignore
    }
    setShowCallout(false);
  };

  if (!thread) {
    return <p className="text-sm text-slate-500">Thread not found.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Single unified thread card with zoom-in animation */}
      <div
        className="rounded-2xl p-5 shadow-sm space-y-4"
        style={{
          backgroundColor: 'var(--thread-surface)',
          borderColor: 'var(--section-container-border)',
          borderWidth: '1px',
          borderStyle: 'solid',
          animation: prefersReducedMotion ? 'none' : 'threadZoomIn 0.3s ease-out forwards',
          transformOrigin: 'center top'
        }}
      >
        {/* Thread header - no separate card, just content */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-lg font-semibold" style={{ color: 'var(--thread-title)' }}>{thread.title}</p>
            <EngagementIcons eyeWeight={eyeWeight} lightbulbWeight={lightbulbWeight} />
          </div>
          <div
            className="prose prose-sm max-w-none dark:prose-invert"
            style={{ color: 'var(--thread-text)' }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(thread.content) }}
          />
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--thread-muted)' }}>
            <span>By {thread.author.slice(0, 10)}…</span>
            <span>{new Date(thread.timestamp).toLocaleString()}</span>
            <span>Score: {(thread.upvotes - thread.downvotes).toFixed(2)}</span>
          </div>
        </div>

        {/* Conversation summary with threaded stream inside */}
        <CommunityReactionSummary threadId={threadId}>
          {!loaded && <p className="text-sm text-slate-500">Loading comments…</p>}

          {showCallout && (
            <div
              className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white/60 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200"
              role="status"
              aria-label="Thread view updated"
            >
              <p>
                Thread view updated: replies are now threaded, with stance shown as a tag.
              </p>
              <button
                type="button"
                className="shrink-0 rounded-md px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={dismissCallout}
                aria-label="Dismiss update notice"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="space-y-4 mt-4">
            {allComments.length > 0 ? (
              <CommentStream threadId={threadId} comments={allComments} />
            ) : (
              loaded && <p className="text-sm text-slate-500 italic">No comments yet. Start the discussion!</p>
            )}
          </div>
        </CommunityReactionSummary>
        
        {/* Add Comment Composer */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium" style={{ color: 'var(--thread-title)' }}>Join the discussion</p>
            <TrustGate
              fallback={
                <span className="text-xs text-slate-500" data-testid="trust-gate-msg">
                  Verify to reply
                </span>
              }
            >
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm font-medium shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-500"
                style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
                onClick={() => setShowRootComposer((v) => !v)}
                aria-label="Reply to thread"
              >
                {showRootComposer ? '✕ Close' : '↩ Reply to thread'}
              </button>
            </TrustGate>
          </div>

          {showRootComposer && (
            <div className="mt-3">
              <TrustGate>
                <CommentComposer
                  threadId={threadId}
                  onSubmit={async () => setShowRootComposer(false)}
                />
              </TrustGate>
            </div>
          )}
        </div>

        {/* Back button inside container */}
        <div className="flex justify-start pt-2">
          <button
            className={borderlessButton}
            onClick={() => window.history.back()}
            aria-label="Back to forum"
            style={{ backgroundColor: 'var(--btn-secondary-bg)', color: 'var(--btn-secondary-text)' }}
          >
            ← Back to Forum
          </button>
        </div>
      </div>
    </div>
  );
};
