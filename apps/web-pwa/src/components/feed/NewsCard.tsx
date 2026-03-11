import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StoryBundle, StorylineGroup } from '@vh/data-model';
import { FlippableCard } from '../venn/FlippableCard';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { SourceBadgeRow } from './SourceBadgeRow';
import { useAnalysis } from './useAnalysis';
import { NewsCardBack } from './NewsCardBack';
import { FeedEngagement } from './FeedEngagement';
import { useExpandedCardStore } from './expandedCardStore';

export interface NewsCardProps {
  /** Discovery feed item; expected kind: NEWS_STORY. */
  readonly item: FeedItem;
}

function formatIsoTimestamp(timestampMs: number): string {
  return Number.isFinite(timestampMs) && timestampMs >= 0
    ? new Date(timestampMs).toISOString()
    : 'unknown';
}
function formatHotness(hotness: number): string {
  return Number.isFinite(hotness) ? hotness.toFixed(2) : '0.00';
}
function normalizeStoryId(storyId: string | undefined): string | null {
  const normalized = storyId?.trim();
  return normalized ? normalized : null;
}

function toCardInstanceKey(item: FeedItem): string {
  const storyId = normalizeStoryId(item.story_id);
  if (storyId) {
    return storyId;
  }

  const normalizedTitle = item.title.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${item.topic_id}|${normalizedTitle}`;
}

function resolveStoryBundle(
  stories: ReadonlyArray<StoryBundle>,
  item: FeedItem,
): StoryBundle | null {
  const normalizedStoryId = normalizeStoryId(item.story_id);
  if (normalizedStoryId) {
    const byStoryId = stories.find((s) => s.story_id === normalizedStoryId);
    if (byStoryId) {
      return byStoryId;
    }
  }

  const normalizedTitle = item.title.trim();
  const sameTopicHeadline = stories.find(
    (s) => s.topic_id === item.topic_id && s.headline.trim() === normalizedTitle,
  );
  if (sameTopicHeadline) return sameTopicHeadline;
  return stories.find((s) => s.headline.trim() === normalizedTitle) ?? null;
}

export function resolveAnalysisProviderModel(
  story: ReturnType<typeof useAnalysis>['analysis'],
): string | null {
  if (!story || story.analyses.length === 0) return null;
  const withModel = story.analyses.find((e) => (e.model_id ?? '').trim().length > 0);
  if (withModel?.model_id) return withModel.model_id;
  const withProvider = story.analyses.find((e) => (e.provider_id ?? '').trim().length > 0);
  return withProvider?.provider_id ?? null;
}

export const NewsCard: React.FC<NewsCardProps> = ({ item }) => {
  const stories = useStore(useNewsStore, (state) => state.stories);
  const storylinesById = useStore(useNewsStore, (state) => state.storylinesById);
  const startSynthesisHydration = useStore(useSynthesisStore, (s) => s.startHydration);
  const refreshSynthesisTopic = useStore(useSynthesisStore, (s) => s.refreshTopic);
  const synthesisTopicState = useStore(useSynthesisStore, (s) => s.topics[item.topic_id]);
  const cardInstanceKey = useMemo(
    () => toCardInstanceKey(item),
    [item.story_id, item.title, item.topic_id],
  );
  const isExpanded = useStore(
    useExpandedCardStore,
    (s) => s.expandedStoryId === cardInstanceKey,
  );
  const expandCard = useStore(useExpandedCardStore, (s) => s.expand);
  const collapseCard = useStore(useExpandedCardStore, (s) => s.collapse);
  const story = useMemo(
    () => resolveStoryBundle(stories, item),
    [stories, item.story_id, item.title, item.topic_id],
  );
  const storyline = useMemo<StorylineGroup | null>(() => {
    const storylineId = story?.storyline_id?.trim();
    return storylineId ? storylinesById[storylineId] ?? null : null;
  }, [story, storylinesById]);
  const analysisStoryRef = useRef<StoryBundle | null>(story);
  const analysisPipelineEnabled = import.meta.env.VITE_VH_ANALYSIS_PIPELINE === 'true';
  const analysisStory = useMemo(
    () => (isExpanded ? analysisStoryRef.current ?? story : story),
    [isExpanded, story],
  );
  const {
    analysis,
    status: analysisStatus,
    error: analysisError,
    retry: retryAnalysis,
  } = useAnalysis(analysisStory, isExpanded);
  const synthesis = synthesisTopicState?.synthesis ?? null;
  const synthesisLoading = synthesisTopicState?.loading ?? false;
  const synthesisError = synthesisTopicState?.error ?? null;
  const latestActivity = formatIsoTimestamp(item.latest_activity_at);
  const createdAt = formatIsoTimestamp(item.created_at);
  const storyId = normalizeStoryId(item.story_id) ?? story?.story_id ?? null;
  const computedAnalysisId = analysisStory
    ? `${analysisStory.story_id}:${analysisStory.provenance_hash}`
    : null;
  const synthesisId = synthesis?.synthesis_id ?? null;
  const synthesisEpoch = synthesis?.epoch;
  const analysisFeedbackStatus =
    analysisPipelineEnabled &&
    (analysisStatus === 'loading' ||
      analysisStatus === 'timeout' ||
      analysisStatus === 'error' ||
      analysisStatus === 'budget_exceeded')
      ? analysisStatus
      : null;
  const summary =
    (analysisPipelineEnabled && analysisStatus === 'success' && analysis?.summary?.trim()) ||
    synthesis?.facts_summary?.trim() ||
    story?.summary_hint?.trim() ||
    'Summary pending synthesis.';
  const frameRows =
    analysisPipelineEnabled &&
    analysisStatus === 'success' &&
    analysis &&
    analysis.frames.length > 0
      ? analysis.frames
      : (synthesis?.frames ?? []);
  const analysisProvider =
    analysisPipelineEnabled && analysisStatus === 'success'
      ? resolveAnalysisProviderModel(analysis)
      : null;
  const perSourceSummaries =
    analysisPipelineEnabled && analysisStatus === 'success' && analysis
      ? analysis.analyses.filter((e) => e.summary.trim().length > 0)
      : [];
  const frontRegionId = `news-card-front-${item.topic_id}`;
  const backRegionId = `news-card-back-region-${item.topic_id}`;

  const openBack = useCallback(() => {
    if (story) {
      analysisStoryRef.current = story;
    }
    expandCard(cardInstanceKey);
    startSynthesisHydration(item.topic_id);
    void refreshSynthesisTopic(item.topic_id);
  }, [cardInstanceKey, expandCard, item.topic_id, refreshSynthesisTopic, startSynthesisHydration, story]);

  useEffect(() => {
    if (isExpanded) {
      if (!analysisStoryRef.current && story) {
        analysisStoryRef.current = story;
      }
      return;
    }

    analysisStoryRef.current = story;
  }, [isExpanded, story]);

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

  useEffect(() => {
    return () => {
      const state = useExpandedCardStore.getState();
      if (state.expandedStoryId !== cardInstanceKey) return;
      state.collapse();
    };
  }, [cardInstanceKey]);

  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.currentTarget !== event.target) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (isExpanded) {
        collapseCard();
        return;
      }
      openBack();
    },
    [collapseCard, isExpanded, openBack],
  );

  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (isExpanded) return;
      const target = event.target as HTMLElement;
      if (target.closest('a,button,input,select,textarea,label,[role="button"]')) return;
      openBack();
    },
    [isExpanded, openBack],
  );

  return (
    <article
      data-testid={`news-card-${item.topic_id}`}
      data-story-id={storyId ?? undefined}
      className="relative overflow-hidden rounded-2xl p-5 shadow-sm transition-transform duration-150 hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
      style={{
        backgroundColor: 'var(--headline-card-bg)',
        borderColor: 'var(--headline-card-border)',
        borderWidth: '1px',
        borderStyle: 'solid',
      }}
      aria-label="News story"
      aria-expanded={isExpanded}
      aria-controls={isExpanded ? backRegionId : frontRegionId}
      tabIndex={0}
      onKeyDown={handleCardKeyDown}
      onClick={handleCardClick}
    >
      <FlippableCard
        front={
          <section id={frontRegionId} data-testid={`news-card-front-${item.topic_id}`} data-story-id={storyId ?? undefined}>
            <header className="mb-2 flex items-center justify-between gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{
                  backgroundColor: 'var(--bias-table-bg)',
                  color: 'var(--headline-card-muted)',
                }}
              >
                News
              </span>
              <span
                className="text-xs font-medium uppercase tracking-[0.12em]"
                style={{ color: 'var(--headline-card-muted)' }}
                data-testid={`news-card-hotness-${item.topic_id}`}
              >
                Hotness {formatHotness(item.hotness)}
              </span>
            </header>
            <button
              type="button"
              className="mt-1 text-left text-lg font-semibold tracking-[0.01em] underline-offset-2 hover:underline"
              style={{ color: 'var(--headline-card-text)' }}
              data-testid={`news-card-headline-${item.topic_id}`}
              data-story-id={storyId ?? undefined}
              onClick={openBack}
            >
              {item.title}
            </button>
            {story && story.sources.length > 0 && (
              <SourceBadgeRow
                sources={story.sources.map((source) => ({
                  source_id: source.source_id,
                  publisher: source.publisher,
                  url: source.url,
                }))}
              />
            )}
            <p
              className="mt-2 text-xs uppercase tracking-[0.18em]"
              style={{ color: 'var(--headline-card-muted)' }}
            >
              Created {createdAt} • Updated {latestActivity}
            </p>
            <FeedEngagement
              topicId={item.topic_id}
              eye={item.eye}
              lightbulb={item.lightbulb}
              comments={item.comments}
            />
            <p className="mt-3 text-xs" style={{ color: 'var(--headline-card-muted)' }}>
              Click headline to flip →
            </p>
          </section>
        }
        back={
          <section id={backRegionId}>
            {isExpanded ? (
              <NewsCardBack
                topicId={item.topic_id}
                summary={summary}
                frameRows={frameRows}
                analysisProvider={analysisProvider}
                perSourceSummaries={perSourceSummaries}
                relatedCoverage={storyline?.related_coverage ?? []}
                analysisFeedbackStatus={analysisFeedbackStatus}
                analysisError={analysisError}
                retryAnalysis={retryAnalysis}
                synthesisLoading={synthesisLoading}
                synthesisError={synthesisError}
                analysis={analysis}
                analysisId={computedAnalysisId}
                synthesisId={synthesisId}
                epoch={synthesisEpoch}
                onFlipBack={collapseCard}
              />
            ) : null}
          </section>
        }
        isFlipped={isExpanded}
        onFlip={isExpanded ? collapseCard : openBack}
        showDefaultControls={false}
      />
    </article>
  );
};

export default NewsCard;
