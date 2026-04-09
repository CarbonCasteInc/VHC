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
      className="rounded-[1.75rem] border border-emerald-200/80 bg-emerald-50/70 p-5 shadow-sm transition-[box-shadow,border-color] duration-150 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 md:p-6"
      aria-label="User topic"
      aria-expanded={isExpanded}
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            Topic
          </span>
          {thread?.isHeadline && (
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
              Head thread
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs text-emerald-900"
            data-testid={`topic-card-activity-${item.topic_id}`}
          >
            My activity {myActivity}
          </span>
          <button
            type="button"
            className="rounded-full border border-emerald-300/70 bg-white/70 px-3 py-1.5 text-xs font-medium text-emerald-900 transition hover:border-emerald-400 hover:bg-white"
            onClick={isExpanded ? collapseCard : openDetail}
            data-testid={`topic-card-toggle-${item.topic_id}`}
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </header>

      <button
        type="button"
        className="text-left text-xl font-semibold tracking-tight text-slate-950 underline-offset-2 hover:underline"
        data-testid={`topic-card-headline-${item.topic_id}`}
        onClick={openDetail}
      >
        {headline}
      </button>

      <CollapsedSummary
        synthesis={synthesis}
        loading={loading}
        error={error}
        fallback={summary}
      />

      <FeedEngagement
        topicId={item.topic_id}
        eye={item.eye}
        lightbulb={item.lightbulb}
        comments={item.comments}
        testIdPrefix="topic-card"
        ariaLabel="Topic engagement"
      />

      {isExpanded && (
        <section
          className="mt-6 space-y-5 border-t border-emerald-200/80 pt-6"
          data-testid={`topic-card-detail-${item.topic_id}`}
        >
          {threadHeadMarkup && (
            <section className="space-y-2 rounded-[1.5rem] border border-emerald-200/80 bg-white/75 p-4 shadow-sm shadow-emerald-900/5">
              <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/70">
                Thread Head
              </h4>
              <div
                className="prose prose-sm max-w-none text-slate-700"
                dangerouslySetInnerHTML={{ __html: threadHeadMarkup }}
                data-testid={`topic-card-thread-head-${item.topic_id}`}
              />
            </section>
          )}

          <section className="space-y-3 rounded-[1.5rem] border border-emerald-200/80 bg-white/75 p-4 shadow-sm shadow-emerald-900/5">
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/70">
              Synthesis Summary
            </h4>
            <SynthesisSection synthesis={synthesis} loading={loading} error={error} fallback={summary} />
          </section>

          <section className="space-y-3 rounded-[1.5rem] border border-emerald-200/80 bg-white/75 p-4 shadow-sm shadow-emerald-900/5">
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/70">
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
