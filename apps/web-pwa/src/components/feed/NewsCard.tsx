import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StoryBundle, StorylineGroup } from '@vh/data-model';
import { isLikelyVideoSourceEntry } from '@vh/ai-engine';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { useForumStore } from '../../store/hermesForum';
import { SourceBadgeRow } from './SourceBadgeRow';
import { useAnalysis } from './useAnalysis';
import { NewsCardBack } from './NewsCardBack';
import { FeedEngagement } from './FeedEngagement';
import { useExpandedCardStore } from './expandedCardStore';
import { useDiscoveryStore } from '../../store/discovery';
import { getPrimaryStorySource, resolveStoryDiscussionThread } from '../../utils/feedDiscussionThreads';
import { getFeedItemDetailId, normalizeStoryId } from '../../utils/feedItemIdentity';

export interface NewsCardProps {
  /** Discovery feed item; expected kind: NEWS_STORY. */
  readonly item: FeedItem;
}

function normalizeStorylineHeadline(headline: string | undefined): string | null {
  const normalized = headline?.trim(); return normalized ? normalized : null;
}

function formatIsoTimestamp(timestampMs: number): string {
  return Number.isFinite(timestampMs) && timestampMs >= 0 ? new Date(timestampMs).toISOString() : 'unknown';
}

function formatHotness(hotness: number): string {
  return Number.isFinite(hotness) ? hotness.toFixed(2) : '0.00';
}

function resolveSingletonVideoSource(
  story: StoryBundle | null,
): { publisher: string; title: string; url: string } | null {
  if (!story || story.sources.length !== 1) {
    return null;
  }

  const source = story.sources[0]!;
  if (!isLikelyVideoSourceEntry({ url: source.url, title: source.title })) {
    return null;
  }

  return {
    publisher: source.publisher,
    title: source.title,
    url: source.url,
  };
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

function resolveDisplaySources(
  story: StoryBundle | null,
): ReadonlyArray<StoryBundle['sources'][number]> {
  if (!story) {
    return [];
  }

  return story.primary_sources ?? story.sources;
}

function mergeRelatedLinks(
  story: StoryBundle | null,
  analysis: ReturnType<typeof useAnalysis>['analysis'],
): ReadonlyArray<{
  source_id: string;
  publisher: string;
  title: string;
  url: string;
}> {
  const entries = [
    ...(story?.related_links ?? []),
    ...(analysis?.relatedLinks ?? []),
  ];
  const deduped = new Map<string, {
    source_id: string;
    publisher: string;
    title: string;
    url: string;
  }>();

  for (const entry of entries) {
    const key = `${entry.source_id}|${entry.url}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()];
}

export const NewsCard: React.FC<NewsCardProps> = ({ item }) => {
  const stories = useStore(useNewsStore, (state) => state.stories);
  const storylinesById = useStore(useNewsStore, (state) => state.storylinesById);
  const focusStoryline = useStore(useDiscoveryStore, (state) => state.focusStoryline);
  const startSynthesisHydration = useStore(useSynthesisStore, (s) => s.startHydration);
  const refreshSynthesisTopic = useStore(useSynthesisStore, (s) => s.refreshTopic);
  const synthesisTopicState = useStore(useSynthesisStore, (s) => s.topics[item.topic_id]);
  const forumThreads = useStore(useForumStore, (state) => state.threads);
  const cardInstanceKey = useMemo(() => getFeedItemDetailId(item), [item]);
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
  const storylineHeadline = normalizeStorylineHeadline(storyline?.headline);
  const storylineStoryCount = storyline?.story_ids.length ?? 0;
  const storylineId = story?.storyline_id?.trim() ?? null;
  const discussionThread = useMemo(
    () => resolveStoryDiscussionThread(forumThreads.values(), item, story),
    [forumThreads, item, story],
  );
  const primaryStorySource = useMemo(() => getPrimaryStorySource(story), [story]);
  const analysisStoryRef = useRef<StoryBundle | null>(story);
  const analysisPipelineEnabled = import.meta.env.VITE_VH_ANALYSIS_PIPELINE === 'true';
  const analysisStory = useMemo(
    () => (isExpanded ? analysisStoryRef.current ?? story : story),
    [isExpanded, story],
  );
  const singletonVideoSource = useMemo(
    () => resolveSingletonVideoSource(analysisStory),
    [analysisStory],
  );
  const displaySources = useMemo(
    () => resolveDisplaySources(story),
    [story],
  );
  const {
    analysis,
    status: analysisStatus,
    error: analysisError,
    retry: retryAnalysis,
  } = useAnalysis(analysisStory, isExpanded && singletonVideoSource === null);
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
  const relatedLinks = useMemo(
    () => mergeRelatedLinks(story, analysis),
    [story, analysis],
  );
  const detailRegionId = `news-card-detail-region-${item.topic_id}`;

  const openDetail = useCallback(() => {
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

  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (isExpanded) return;
      const target = event.target as HTMLElement;
      if (target.closest('a,button,input,select,textarea,label,[role="button"]')) return;
      openDetail();
    },
    [isExpanded, openDetail],
  );

  const handleStorylineFocus = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!storylineId) {
        return;
      }
      focusStoryline(storylineId);
      collapseCard();
    },
    [collapseCard, focusStoryline, storylineId],
  );

  return (
    <article
      data-testid={`news-card-${item.topic_id}`}
      data-story-id={storyId ?? undefined}
      data-storyline-id={storylineId ?? undefined}
      data-feed-detail-id={cardInstanceKey}
      className="relative overflow-hidden rounded-[1.75rem] p-5 shadow-sm transition-[box-shadow,border-color] duration-150 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 md:p-6"
      style={{
        backgroundColor: 'var(--headline-card-bg)',
        borderColor: isExpanded ? 'rgba(15, 23, 42, 0.18)' : 'var(--headline-card-border)',
        borderWidth: '1px',
        borderStyle: 'solid',
      }}
      aria-label="News story"
      aria-expanded={isExpanded}
      aria-controls={detailRegionId}
      tabIndex={0}
      onKeyDown={handleCardKeyDown}
      onClick={handleCardClick}
    >
      <section data-testid={`news-card-front-${item.topic_id}`} data-story-id={storyId ?? undefined}>
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{
                backgroundColor: 'var(--bias-table-bg)',
                color: 'var(--headline-card-muted)',
              }}
            >
              News
            </span>
            {discussionThread?.isHeadline && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                Active thread
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-medium uppercase tracking-[0.12em]"
              style={{ color: 'var(--headline-card-muted)' }}
              data-testid={`news-card-hotness-${item.topic_id}`}
            >
              Hotness {formatHotness(item.hotness)}
            </span>
            <button
              type="button"
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              onClick={isExpanded ? collapseCard : openDetail}
              data-testid={`news-card-toggle-${item.topic_id}`}
            >
              {isExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </header>
        <button
          type="button"
          className="mt-1 text-left text-xl font-semibold tracking-tight text-slate-950 underline-offset-2 hover:underline"
          style={{ color: 'var(--headline-card-text)' }}
          data-testid={`news-card-headline-${item.topic_id}`}
          data-story-id={storyId ?? undefined}
          onClick={openDetail}
        >
          {item.title}
        </button>
        {displaySources.length > 0 && (
          <SourceBadgeRow
            sources={displaySources.map((source) => ({
              source_id: source.source_id,
              publisher: source.publisher,
              url: source.url,
            }))}
          />
        )}
        {storylineHeadline && (
          <button
            type="button"
            className="mt-3 text-xs font-medium underline-offset-2 hover:underline"
            style={{ color: 'var(--headline-card-muted)' }}
            data-testid={`news-card-storyline-${item.topic_id}`}
            onClick={handleStorylineFocus}
          >
            Related coverage: {storylineHeadline}
          </button>
        )}
        <p
          className="mt-3 text-xs uppercase tracking-[0.18em]"
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
      </section>

      {isExpanded && (
        <section
          id={detailRegionId}
          className="mt-6 border-t border-slate-200/80 pt-6"
          data-testid={`news-card-detail-${item.topic_id}`}
        >
          <NewsCardBack
            headline={item.title}
            topicId={item.topic_id}
            summary={summary}
            frameRows={frameRows}
            analysisProvider={analysisProvider}
            perSourceSummaries={perSourceSummaries}
            relatedCoverage={storyline?.related_coverage ?? []}
            relatedLinks={relatedLinks}
            storylineHeadline={storylineHeadline}
            storylineStoryCount={storylineStoryCount}
            analysisFeedbackStatus={analysisFeedbackStatus}
            analysisError={analysisError}
            retryAnalysis={retryAnalysis}
            synthesisLoading={synthesisLoading}
            synthesisError={synthesisError}
            analysis={analysis}
            analysisId={computedAnalysisId}
            synthesisId={synthesisId}
            epoch={synthesisEpoch}
            sourceViewer={singletonVideoSource}
            discussionThread={discussionThread}
            fallbackCommentCount={item.comments}
            createThread={
              primaryStorySource
                ? {
                    defaultTitle: item.title,
                    sourceAnalysisId: primaryStorySource.urlHash,
                    sourceUrl: primaryStorySource.url,
                  }
                : null
            }
            onCollapse={collapseCard}
          />
        </section>
      )}
    </article>
  );
};

export default NewsCard;
