import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StoryBundle, StorylineGroup } from '@vh/data-model';
import { isLikelyVideoSourceEntry } from '@vh/ai-engine';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { useForumStore } from '../../store/hermesForum';
import { SourceBadgeRow } from './SourceBadgeRow';
import { useAnalysis } from './useAnalysis';
import { NewsCardBack, type NewsCardMediaAsset } from './NewsCardBack';
import { sanitizePublicationNeutralSummary } from './newsCardAnalysis';
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

function previewText(value: string, maxLength = 210): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
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

function resolveStoryMedia(
  story: StoryBundle | null,
): {
  heroImage: NewsCardMediaAsset | null;
  galleryImages: ReadonlyArray<NewsCardMediaAsset>;
} {
  if (!story) {
    return {
      heroImage: null,
      galleryImages: [],
    };
  }

  const orderedSources = [
    ...(story.primary_sources ?? story.sources),
    ...(story.secondary_assets ?? []),
    ...story.sources,
  ];

  const deduped = new Map<string, NewsCardMediaAsset>();
  for (const source of orderedSources) {
    const imageUrl = source.imageUrl?.trim();
    if (!imageUrl) {
      continue;
    }
    if (deduped.has(imageUrl)) {
      continue;
    }
    deduped.set(imageUrl, {
      sourceId: source.source_id,
      publisher: source.publisher,
      title: source.title,
      url: source.url,
      imageUrl,
    });
  }

  const assets = [...deduped.values()];
  return {
    heroImage: assets[0] ?? null,
    galleryImages: assets.slice(1),
  };
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
  const rawSummary =
    (analysisPipelineEnabled && analysisStatus === 'success' && analysis?.summary?.trim()) ||
    synthesis?.facts_summary?.trim() ||
    story?.summary_hint?.trim() ||
    'Summary pending synthesis.';
  const summary = sanitizePublicationNeutralSummary(
    rawSummary,
    (story?.sources ?? []).flatMap((source) => [source.source_id, source.publisher]),
  );
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
  const relatedLinks = useMemo(
    () => mergeRelatedLinks(story, analysis),
    [story, analysis],
  );
  const { heroImage, galleryImages } = useMemo(
    () => resolveStoryMedia(story),
    [story],
  );
  const detailRegionId = `news-card-detail-region-${item.topic_id}`;
  const sourceSurfaceLabel =
    displaySources.length > 1 ? 'Story cluster' : displaySources.length === 1 ? 'Singleton report' : 'Developing';
  const summaryPreview = previewText(summary);

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
      className="group relative overflow-hidden rounded-[2rem] p-6 shadow-[0_28px_70px_-40px_rgba(15,23,42,0.4)] transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[0_32px_80px_-42px_rgba(15,23,42,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 md:p-7"
      style={{
        backgroundColor: 'var(--headline-card-bg)',
        borderColor: isExpanded ? 'rgba(15, 23, 42, 0.14)' : 'var(--headline-card-border)',
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
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/80 to-transparent dark:via-slate-600/80" />
      <section data-testid={`news-card-front-${item.topic_id}`} data-story-id={storyId ?? undefined}>
        {heroImage && (
          <div
            className="mb-5"
            data-testid={`news-card-hero-${item.topic_id}`}
          >
            <div className="relative overflow-hidden rounded-[1.6rem] border border-slate-200/80 bg-slate-100 shadow-sm shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900/80">
              <img
                src={heroImage.imageUrl}
                alt={`${heroImage.publisher}: ${heroImage.title}`}
                className="h-52 w-full object-cover transition duration-200 group-hover:scale-[1.01] md:h-64"
                data-testid={`news-card-hero-image-${item.topic_id}`}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 via-slate-950/35 to-transparent p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-white/92 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-900">
                    {heroImage.publisher}
                  </span>
                  {galleryImages.length > 0 && (
                    <span className="rounded-full bg-slate-950/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                      +{galleryImages.length} more image{galleryImages.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <header className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-900 dark:bg-sky-950/60 dark:text-sky-100"
            >
              News
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {sourceSurfaceLabel}
            </span>
            {discussionThread?.isHeadline && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
                Live thread
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              style={{ color: 'var(--headline-card-muted)' }}
              data-testid={`news-card-hotness-${item.topic_id}`}
            >
              Hotness {formatHotness(item.hotness)}
            </span>
            <button
              type="button"
              className="rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={isExpanded ? collapseCard : openDetail}
              data-testid={`news-card-toggle-${item.topic_id}`}
            >
              {isExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </header>
        <button
          type="button"
          className="mt-1 text-left text-[1.8rem] leading-[1.02] text-slate-950 underline-offset-2 transition group-hover:text-slate-700 hover:underline dark:text-white dark:group-hover:text-slate-100 md:text-[2.15rem]"
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
        {!isExpanded && (
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-slate-600 dark:text-slate-300">
            {summaryPreview}
          </p>
        )}
        {storylineHeadline && (
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            style={{ color: 'var(--headline-card-muted)' }}
            data-testid={`news-card-storyline-${item.topic_id}`}
            onClick={handleStorylineFocus}
          >
            Related coverage
            <span className="normal-case tracking-normal text-slate-500 dark:text-slate-400">
              {storylineHeadline}
            </span>
          </button>
        )}
        <div className="mt-5 border-t border-slate-200/80 pt-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              className="text-xs uppercase tracking-[0.18em]"
              style={{ color: 'var(--headline-card-muted)' }}
            >
              Created {createdAt} • Updated {latestActivity}
            </p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Expand for synthesis, frame / reframe, and replies.
            </p>
          </div>
          <FeedEngagement
            topicId={item.topic_id}
            eye={item.eye}
            lightbulb={item.lightbulb}
            comments={item.comments}
            className="mt-4"
          />
        </div>
      </section>

      {isExpanded && (
        <section
          id={detailRegionId}
          className="mt-6 border-t border-slate-200/80 pt-6 dark:border-slate-800"
          data-testid={`news-card-detail-${item.topic_id}`}
        >
          <NewsCardBack
            headline={item.title}
            topicId={item.topic_id}
            summary={summary}
            frameRows={frameRows}
            analysisProvider={analysisProvider}
            galleryImages={galleryImages}
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
