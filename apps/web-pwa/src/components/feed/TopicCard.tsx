import React, { useCallback, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import type { FeedItem } from '@vh/data-model';
import { useSynthesis } from '../../hooks/useSynthesis';
import { useInView } from '../../hooks/useInView';
import { useForumStore } from '../../store/hermesForum';
import { renderMarkdown } from '../../utils/markdown';
import { resolveTopicThread } from '../../utils/feedDiscussionThreads';
import { getFeedItemDetailId } from '../../utils/feedItemIdentity';
import { BiasTable } from './BiasTable';
import { FeedDiscussionSection } from './FeedDiscussionSection';
import { FeedEngagement } from './FeedEngagement';
import { useExpandedCardStore } from './expandedCardStore';

export interface TopicCardProps {
  /** Discovery feed item; expected kind: USER_TOPIC. */
  readonly item: FeedItem;
}

function formatActivityScore(score: number | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return '0.0';
  }
  return score.toFixed(1);
}

function stripMarkdown(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/[_*`>#-]/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized ? normalized : null;
}

function previewText(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * User topic/thread card for discovery feed USER_TOPIC items.
 *
 * When the card enters the viewport, synthesis hydration starts via
 * `useSynthesis(item.topic_id)`. If synthesis data is available, the card
 * displays `facts_summary`, collapsible `frames`, and divergence indicators.
 * When synthesis is unavailable (loading, error, or absent), the card
 * preserves its original engagement-only rendering.
 *
 * Hydration containment: `useInView` defers Gun subscription until the card
 * is within 200px of the viewport, preventing burst subscriptions for
 * off-screen items in long feed lists.
 *
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §3 (USER_TOPIC)
 */
export const TopicCard: React.FC<TopicCardProps> = ({ item }) => {
  const [ref, isVisible] = useInView<HTMLElement>();
  const forumThreads = useStore(useForumStore, (state) => state.threads);
  const detailId = useMemo(() => getFeedItemDetailId(item), [item]);
  const isExpanded = useStore(useExpandedCardStore, (state) => state.expandedStoryId === detailId);
  const expandCard = useStore(useExpandedCardStore, (state) => state.expand);
  const collapseCard = useStore(useExpandedCardStore, (state) => state.collapse);
  const thread = useMemo(
    () => resolveTopicThread(forumThreads.values(), item.topic_id),
    [forumThreads, item.topic_id],
  );
  const { synthesis, loading, error } = useSynthesis(isVisible || isExpanded ? item.topic_id : null);
  const myActivity = formatActivityScore(item.my_activity_score);
  const headline = thread?.title ?? item.title;
  const summary =
    synthesis?.facts_summary ?? stripMarkdown(thread?.content) ?? 'Conversation is building around this topic.';
  const summaryPreview = previewText(summary);
  const threadHeadMarkup = useMemo(
    () => (thread?.content ? renderMarkdown(thread.content) : null),
    [thread?.content],
  );

  const openDetail = useCallback(() => {
    expandCard(detailId);
  }, [detailId, expandCard]);

  useEffect(() => {
    if (!isExpanded) return;
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      collapseCard();
    };
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  }, [collapseCard, isExpanded]);

  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (isExpanded) return;
      const target = event.target as HTMLElement;
      if (target.closest('a,button,input,select,textarea,label,[role="button"]')) return;
      openDetail();
    },
    [isExpanded, openDetail],
  );

  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.currentTarget !== event.target) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (isExpanded) {
        collapseCard();
        return;
      }
      openDetail();
    },
    [collapseCard, isExpanded, openDetail],
  );

  return (
    <article
      ref={ref}
      data-testid={`topic-card-${item.topic_id}`}
      data-feed-detail-id={detailId}
      className="group relative overflow-hidden rounded-[2rem] border border-indigo-200/40 bg-white/92 p-6 shadow-[0_28px_70px_-40px_rgba(15,23,42,0.36)] transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[0_32px_80px_-42px_rgba(15,23,42,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 md:p-7 dark:border-indigo-900/40 dark:bg-slate-950/84"
      aria-label="User topic"
      aria-expanded={isExpanded}
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-indigo-300/80 to-transparent dark:via-indigo-700/80" />
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-900 dark:bg-indigo-950/70 dark:text-indigo-100">
            Topic
          </span>
          {thread?.isHeadline && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
              Head thread
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            data-testid={`topic-card-activity-${item.topic_id}`}
          >
            My activity {myActivity}
          </span>
          <button
            type="button"
            className="rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={isExpanded ? collapseCard : openDetail}
            data-testid={`topic-card-toggle-${item.topic_id}`}
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </header>

      <button
        type="button"
        className="text-left text-[1.8rem] leading-[1.02] text-slate-950 underline-offset-2 transition group-hover:text-slate-700 hover:underline dark:text-white dark:group-hover:text-slate-100 md:text-[2.15rem]"
        data-testid={`topic-card-headline-${item.topic_id}`}
        onClick={openDetail}
      >
        {headline}
      </button>

      <CollapsedSummary
        synthesis={synthesis}
        loading={loading}
        error={error}
        fallback={summaryPreview}
      />

      <div className="mt-5 border-t border-slate-200/80 pt-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Forum topic rising through engagement and subscription activity.
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Expand to review the thread summary, frames, and replies.
          </p>
        </div>

        <FeedEngagement
          topicId={item.topic_id}
          eye={item.eye}
          lightbulb={item.lightbulb}
          comments={item.comments}
          testIdPrefix="topic-card"
          ariaLabel="Topic engagement"
          className="mt-4"
        />
      </div>

      {isExpanded && (
        <section
          className="mt-6 space-y-5 border-t border-slate-200/80 pt-6 dark:border-slate-800"
          data-testid={`topic-card-detail-${item.topic_id}`}
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.9fr)]">
            <section className="space-y-3 rounded-[1.5rem] border border-slate-200/90 bg-slate-50/85 p-4 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900/80">
              <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Synthesis Summary
              </h4>
              <SynthesisSection synthesis={synthesis} loading={loading} error={error} fallback={summary} />
            </section>

            {threadHeadMarkup ? (
              <section className="space-y-2 rounded-[1.5rem] border border-slate-200/90 bg-white/82 p-4 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80">
                <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Thread Head
                </h4>
                <div
                  className="prose prose-sm max-w-none text-slate-700 dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: threadHeadMarkup }}
                  data-testid={`topic-card-thread-head-${item.topic_id}`}
                />
              </section>
            ) : (
              <section className="space-y-3 rounded-[1.5rem] border border-slate-200/90 bg-white/82 p-4 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80">
                <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Conversation State
                </h4>
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                  This topic is rising because people are subscribing, responding, and pulling the
                  conversation into the main feed.
                </p>
              </section>
            )}
          </div>

          <section className="space-y-3 rounded-[1.5rem] border border-slate-200/90 bg-white/82 p-4 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80">
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              Frame / Reframe
            </h4>
            <BiasTable
              analyses={[]}
              frames={synthesis?.frames ?? []}
              loading={loading && !synthesis}
              topicId={item.topic_id}
              synthesisId={synthesis?.synthesis_id}
              epoch={synthesis?.epoch}
              votingEnabled={Boolean(synthesis)}
            />
          </section>

          <FeedDiscussionSection
            sectionId={`topic-card-${item.topic_id}`}
            thread={thread}
            fallbackCommentCount={item.comments}
            title="Forum replies"
            emptyMessage="This topic is waiting on its conversation thread."
          />
        </section>
      )}
    </article>
  );
};

// ---- Internal synthesis state renderer ----

interface SynthesisSectionProps {
  readonly synthesis: ReturnType<typeof useSynthesis>['synthesis'];
  readonly loading: boolean;
  readonly error: string | null;
  readonly fallback: string;
}

const CollapsedSummary: React.FC<SynthesisSectionProps> = ({
  synthesis,
  loading,
  error,
  fallback,
}) => {
  if (loading) {
    return (
      <p className="mt-3 text-xs text-slate-500" data-testid="topic-card-synthesis-loading">
        Loading synthesis…
      </p>
    );
  }

  if (error) {
    return (
      <p className="mt-3 text-xs text-amber-700" data-testid="topic-card-synthesis-error">
        Synthesis unavailable.
      </p>
    );
  }

  return (
    <p className="mt-3 text-sm leading-6 text-slate-700" data-testid="topic-card-summary">
      {synthesis?.facts_summary ?? fallback}
    </p>
  );
};

const SynthesisSection: React.FC<SynthesisSectionProps> = ({
  synthesis,
  loading,
  error,
  fallback,
}) => {
  if (loading) {
    return (
      <p className="mt-1 text-xs text-slate-400" data-testid="topic-card-synthesis-loading">
        Loading synthesis…
      </p>
    );
  }

  if (error) {
    return (
      <p className="mt-1 text-xs text-red-400" data-testid="topic-card-synthesis-error">
        Synthesis unavailable. Conversation remains open below.
      </p>
    );
  }

  if (synthesis) {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-6 text-slate-700" data-testid="topic-card-synthesis-facts">
          {synthesis.facts_summary}
        </p>
        {synthesis.warnings.length > 0 && (
          <div
            className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
            data-testid="synthesis-warnings"
          >
            {synthesis.warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </div>
        )}
        {synthesis.divergence_metrics.disagreement_score > 0.5 && (
          <span
            className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
            data-testid="synthesis-divergence"
          >
            High divergence
          </span>
        )}
      </div>
    );
  }

  return (
    <p className="mt-1 text-sm leading-6 text-slate-700" data-testid="topic-card-synthesis-fallback">
      {fallback}
    </p>
  );
};

export default TopicCard;
