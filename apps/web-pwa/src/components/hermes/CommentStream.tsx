import React, { useEffect, useMemo, useState } from 'react';
import type { HermesNewsReportReasonCode } from '@vh/data-model';
import type { HermesComment, HermesCommentModeration } from '@vh/types';
import { useForumStore } from '../../store/hermesForum';
import { useNewsReportStore } from '../../store/newsReports';
import { renderMarkdown } from '../../utils/markdown';
import { cardMaxWidth, ChildrenContainer, stanceMeta } from './commentStreamLayout';
import { CommentComposer } from './forum/CommentComposer';
import { TrustGate } from './forum/TrustGate';
import { VoteControl } from './forum/VoteControl';
import {
  BranchConnector,
  getConnectorSide,
  getTrunkOffset,
  INDENT_PX,
  LINE_COLOR,
  LINE_WIDTH,
  STEP_Y
} from './forum/treeConnectors';

interface Props {
  threadId: string;
  comments: HermesComment[];
  parentId?: string | null;
  depth?: number;
}

// Comment item
interface CommentItemProps {
  threadId: string;
  comments: HermesComment[];
  comment: HermesComment;
  moderation: HermesCommentModeration | null;
  moderationByComment: Map<string, HermesCommentModeration> | undefined;
  depth: number;
  parentTrunkOffset: number;
}

const CommentItem: React.FC<CommentItemProps> = ({
  threadId,
  comments,
  comment,
  moderation,
  moderationByComment,
  depth,
  parentTrunkOffset,
}) => {
  const children = useMemo(
    () => comments.filter((c) => c.parentId === comment.id).sort((a, b) => a.timestamp - b.timestamp),
    [comments, comment.id]
  );

  const meta = stanceMeta(comment.stance);
  const submitCommentReport = useNewsReportStore((state) => state.submitCommentReport);
  const score = comment.upvotes - comment.downvotes;
  const maxW = cardMaxWidth(depth);
  const isHidden = moderation?.status === 'hidden';

  const [showReply, setShowReply] = useState(false);
  const [reportReason, setReportReason] = useState<HermesNewsReportReasonCode>('abusive_content');
  const [reportStatus, setReportStatus] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
  const [reportError, setReportError] = useState<string | null>(null);
  const [childrenCollapsed, setChildrenCollapsed] = useState(() => depth >= 3 && children.length > 0);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (!userToggled && depth >= 3 && children.length > 0 && !childrenCollapsed) {
      setChildrenCollapsed(true);
    }
  }, [children.length, depth, userToggled, childrenCollapsed]);

  const handleToggle = () => {
    setUserToggled(true);
    setChildrenCollapsed((v) => !v);
  };

  const handleReportComment = async () => {
    setReportStatus('submitting');
    setReportError(null);
    try {
      await submitCommentReport({
        threadId,
        commentId: comment.id,
        reasonCode: reportReason,
      });
      setReportStatus('submitted');
    } catch (error: unknown) {
      setReportStatus('error');
      setReportError(error instanceof Error ? error.message : 'Unable to submit report');
    }
  };

  const isDiscuss = comment.stance === 'discuss';
  const connectorSide = getConnectorSide(comment.stance);
  const isLeft = connectorSide === 'left';
  const isRight = connectorSide === 'right';

  const borderRadiusClass = isDiscuss
    ? 'rounded-lg border-l-[3px]'
    : isLeft
      ? 'rounded-r-lg border-l-[3px]'
      : 'rounded-l-lg border-r-[3px]';

  const alignmentClass =
    depth === 0
      ? comment.stance === 'concur'
        ? 'justify-start'
        : comment.stance === 'counter'
          ? 'justify-end'
          : 'justify-center'
      : isRight
        ? 'justify-end'
        : 'justify-start';

  const showBranch = depth > 0;
  const hasVisibleChildren = children.length > 0 && !childrenCollapsed;
  
  // This comment's branch connector dimensions
  const myTrunkOffset = getTrunkOffset(comment.stance);
  
  // Calculate trunk offsets for children container
  // Use the MINIMUM offset (closest to container edge) so all branches can connect
  const leftChildren = children.filter((child) => getConnectorSide(child.stance) === 'left');
  const rightChildren = children.filter((child) => getConnectorSide(child.stance) === 'right');
  const leftTrunkOffset = leftChildren.length > 0 
    ? Math.min(...leftChildren.map((c) => getTrunkOffset(c.stance))) 
    : null;
  const rightTrunkOffset = rightChildren.length > 0 
    ? Math.min(...rightChildren.map((c) => getTrunkOffset(c.stance))) 
    : null;
  const lastLeftIndex = children.reduce((acc, child, idx) => (getConnectorSide(child.stance) === 'left' ? idx : acc), -1);
  const lastRightIndex = children.reduce((acc, child, idx) => (getConnectorSide(child.stance) === 'right' ? idx : acc), -1);
  const rowPaddingStyle = {
    paddingLeft: leftTrunkOffset !== null ? INDENT_PX - LINE_WIDTH : undefined,
    paddingRight: rightTrunkOffset !== null ? INDENT_PX - LINE_WIDTH : undefined,
  } as const;

  return (
    <div className="relative" data-testid={`comment-wrap-${comment.id}`}>
      <div className={`flex ${alignmentClass}`}>
        <div className="relative w-full" style={{ maxWidth: maxW }} data-testid={`comment-frame-${comment.id}`}>
          {showBranch && (
            <BranchConnector
              side={connectorSide}
              trunkOffset={myTrunkOffset}
              parentTrunkOffset={parentTrunkOffset}
            />
          )}

          <div
            className={`${borderRadiusClass} p-3 shadow-sm`}
            style={{
              borderColor: meta.border,
              backgroundColor: `var(--stream-${comment.stance}-bg)`,
              width: '100%',
            }}
            data-testid={`comment-${comment.id}`}
            role="article"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span
                    className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
                    aria-label={`Stance: ${meta.label}`}
                  >
                    {meta.icon} {meta.label}
                  </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {comment.author.slice(0, 10)}…
                  </span>
                  <span>• {new Date(comment.timestamp).toLocaleString()}</span>
                </div>

                {isHidden ? (
                  <div
                    className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
                    data-testid={`comment-hidden-${comment.id}`}
                  >
                    <p className="font-medium">Comment hidden by moderation.</p>
                    <p className="mt-1 text-xs">
                      {moderation.reason_code}
                      {moderation.reason ? `: ${moderation.reason}` : ''}
                      {' '}• {new Date(moderation.created_at).toLocaleString()}
                    </p>
                    <p className="mt-1 text-xs">Moderation id: {moderation.moderation_id}</p>
                  </div>
                ) : (
                  <div
                    className="prose prose-sm max-w-none dark:prose-invert"
                    style={{ color: 'var(--comment-text)' }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(comment.content) }}
                  />
                )}

                <div className="flex items-center gap-3 text-xs">
                  {!isHidden && (
                    <TrustGate
                      fallback={
                        <span className="text-xs text-slate-400" data-testid="reply-trust-gate">
                          Verify to reply
                        </span>
                      }
                    >
                      <button
                        className="font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowReply((v) => !v);
                        }}
                        aria-label="Reply"
                        data-testid={`reply-btn-${comment.id}`}
                      >
                        ↩ Reply
                      </button>
                    </TrustGate>
                  )}

                  {!isHidden && (
                    <div className="flex flex-wrap items-center gap-2" data-testid={`comment-report-${comment.id}`}>
                      <label className="sr-only" htmlFor={`comment-report-reason-${comment.id}`}>
                        Report reason
                      </label>
                      <select
                        id={`comment-report-reason-${comment.id}`}
                        value={reportReason}
                        onChange={(event) => setReportReason(event.currentTarget.value as HermesNewsReportReasonCode)}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        data-testid={`comment-report-reason-${comment.id}`}
                      >
                        <option value="abusive_content">Abusive content</option>
                        <option value="spam">Spam</option>
                        <option value="policy_violation">Policy issue</option>
                        <option value="other">Other</option>
                      </select>
                      <button
                        className="font-medium text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-slate-200"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleReportComment();
                        }}
                        disabled={reportStatus === 'submitting' || reportStatus === 'submitted'}
                        data-testid={`comment-report-submit-${comment.id}`}
                      >
                        {reportStatus === 'submitted' ? 'Reported' : reportStatus === 'submitting' ? 'Reporting' : 'Report'}
                      </button>
                      {reportStatus === 'error' && reportError && (
                        <span className="text-rose-700 dark:text-rose-200" role="alert">
                          {reportError}
                        </span>
                      )}
                    </div>
                  )}

                  {children.length > 0 && (
                    <button
                      className="rounded-full px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
                      style={{ color: 'var(--thread-muted)', backgroundColor: 'var(--stream-collapse-bg)' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggle();
                      }}
                      aria-expanded={!childrenCollapsed}
                      aria-label={childrenCollapsed ? `Show ${children.length} replies` : 'Collapse replies'}
                    >
                      {childrenCollapsed ? `▶ ${children.length} replies` : '▼ Collapse'}
                    </button>
                  )}
                </div>

                {!isHidden && showReply && (
                  <div className="mt-2">
                    <CommentComposer
                      threadId={threadId}
                      parentId={comment.id}
                      onSubmit={async () => setShowReply(false)}
                    />
                  </div>
                )}
              </div>

              {!isHidden && <VoteControl commentId={comment.id} score={score} />}
            </div>
          </div>

          {hasVisibleChildren && (
            <ChildrenContainer>
              {children.map((child, idx) => {
                const childSide = getConnectorSide(child.stance);
                const childTrunkOffset = getTrunkOffset(child.stance);
                const childParentTrunkOffset =
                  childSide === 'left' ? (leftTrunkOffset ?? 0) : (rightTrunkOffset ?? 0);
                const needsStep = childTrunkOffset !== childParentTrunkOffset;
                const stepRadius = needsStep
                  ? Math.min(8, Math.abs(childTrunkOffset - childParentTrunkOffset) / 2, STEP_Y - 1)
                  : 0;
                const stepStart = STEP_Y - stepRadius;
                const stepEnd = STEP_Y + stepRadius;
                const trunkStepStart = Math.max(0, stepStart - LINE_WIDTH);
                const nextChild = children[idx + 1];
                const nextChildSide = nextChild ? getConnectorSide(nextChild.stance) : null;
                const nextChildTrunkOffset = nextChild ? getTrunkOffset(nextChild.stance) : 0;
                const nextChildParentTrunkOffset =
                  nextChildSide === 'left'
                    ? (leftTrunkOffset ?? 0)
                    : nextChildSide === 'right'
                      ? (rightTrunkOffset ?? 0)
                      : 0;
                const nextNeedsStep = nextChild ? nextChildTrunkOffset !== nextChildParentTrunkOffset : false;
                const stopOverlapLeft = nextNeedsStep && nextChildSide === 'left';
                const stopOverlapRight = nextNeedsStep && nextChildSide === 'right';
                const leftOverlapBottom = stopOverlapLeft ? 0 : -12;
                const rightOverlapBottom = stopOverlapRight ? 0 : -12;
                const showLeftTrunk = leftTrunkOffset !== null && idx < lastLeftIndex;
                const showRightTrunk = rightTrunkOffset !== null && idx < lastRightIndex;

                return (
                  <div
                    key={child.id}
                    className={idx === children.length - 1 ? 'relative' : 'relative pb-3'}
                    data-testid={`child-row-${child.id}`}
                  >
                    {showLeftTrunk && (
                      <>
                        <div
                          className="absolute pointer-events-none"
                          style={{
                            left: leftTrunkOffset ?? 0,
                            width: LINE_WIDTH,
                            backgroundColor: LINE_COLOR,
                            top: 0,
                            bottom:
                              needsStep && childSide === 'left'
                                ? `calc(100% - ${trunkStepStart}px)`
                                : leftOverlapBottom,
                          }}
                          data-testid={`trunk-left-${child.id}`}
                          aria-hidden="true"
                        />
                        {needsStep && childSide === 'left' && (
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              left: leftTrunkOffset ?? 0,
                              width: LINE_WIDTH,
                              backgroundColor: LINE_COLOR,
                              top: stepEnd,
                              bottom: leftOverlapBottom,
                            }}
                            aria-hidden="true"
                          />
                        )}
                      </>
                    )}
                    {showRightTrunk && (
                      <>
                        <div
                          className="absolute pointer-events-none"
                          style={{
                            right: rightTrunkOffset ?? 0,
                            width: LINE_WIDTH,
                            backgroundColor: LINE_COLOR,
                            top: 0,
                            bottom:
                              needsStep && childSide === 'right'
                                ? `calc(100% - ${trunkStepStart}px)`
                                : rightOverlapBottom,
                          }}
                          data-testid={`trunk-right-${child.id}`}
                          aria-hidden="true"
                        />
                        {needsStep && childSide === 'right' && (
                          <div
                            className="absolute pointer-events-none"
                            style={{
                              right: rightTrunkOffset ?? 0,
                              width: LINE_WIDTH,
                              backgroundColor: LINE_COLOR,
                              top: stepEnd,
                              bottom: rightOverlapBottom,
                            }}
                            aria-hidden="true"
                          />
                        )}
                      </>
                    )}
                    <div style={rowPaddingStyle}>
                      <CommentItem
                        threadId={threadId}
                        comments={comments}
                        comment={child}
                        moderation={moderationByComment?.get(child.id) ?? null}
                        moderationByComment={moderationByComment}
                        depth={depth + 1}
                        parentTrunkOffset={childParentTrunkOffset}
                      />
                    </div>
                  </div>
                );
              })}
            </ChildrenContainer>
          )}
        </div>
      </div>
    </div>
  );
};

export const CommentStream: React.FC<Props> = ({ threadId, comments, parentId = null, depth = 0 }) => {
  const moderationMap = useForumStore((state) => state.commentModeration.get(threadId));
  const rootComments = useMemo(
    () => comments.filter((c) => c.parentId === parentId).sort((a, b) => a.timestamp - b.timestamp),
    [comments, parentId]
  );

  return (
    <div className="space-y-4" data-testid="comment-stream">
      {rootComments.map((comment) => (
        <CommentItem
          key={comment.id}
          threadId={threadId}
          comments={comments}
          comment={comment}
          moderation={moderationMap?.get(comment.id) ?? null}
          moderationByComment={moderationMap}
          depth={depth}
          parentTrunkOffset={0}
        />
      ))}
    </div>
  );
};
