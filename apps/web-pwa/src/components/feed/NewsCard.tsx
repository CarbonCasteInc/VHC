import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StoryBundle, StorylineGroup } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { useForumStore } from '../../store/hermesForum';
import { useViewTracking } from '../../hooks/useViewTracking';
import { useAnalysis } from './useAnalysis';
import { NewsCardBack } from './NewsCardBack';
import { sanitizePublicationNeutralSummary } from './newsCardAnalysis';
import { useExpandedCardStore } from './expandedCardStore';
import { useDiscoveryStore } from '../../store/discovery';
import { getPrimaryStorySource, resolveStoryDiscussionThread } from '../../utils/feedDiscussionThreads';
import { getFeedItemDetailId, normalizeStoryId } from '../../utils/feedItemIdentity';
import { NewsCardFront } from './NewsCardFront';
import {
  formatIsoTimestamp,
  mergeRelatedLinks,
  normalizeStorylineHeadline,
  previewText,
  resolveAnalysisProviderModel,
  resolveDisplaySources,
  resolveSingletonVideoSource,
  resolveStoryBundle,
  resolveStoryMedia,
} from './newsCardModel';

export interface NewsCardProps {
  readonly item: FeedItem;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function resolveFlipFaceStyle(
  isExpanded: boolean,
  face: 'front' | 'back',
  reducedMotion: boolean,
): React.CSSProperties {
  if (reducedMotion) {
    return {
      transform: 'none',
      display: face === 'front' ? (isExpanded ? 'none' : 'block') : (isExpanded ? 'block' : 'none'),
      transition: 'none',
    };
  }

  return {
    transform:
      face === 'front'
        ? isExpanded ? 'rotateY(-180deg)' : 'rotateY(0deg)'
        : isExpanded ? 'rotateY(0deg)' : 'rotateY(180deg)',
    transition: 'transform 180ms ease',
    backfaceVisibility: 'hidden',
    transformStyle: 'preserve-3d',
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
  const storylineStoryCount = storyline?.story_ids.length ?? 0;
  const hasStorylineCoverage = storylineStoryCount > 1;
  const storylineHeadline = hasStorylineCoverage
    ? normalizeStorylineHeadline(storyline?.headline)
    : null;
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
  const synthesisSummary = synthesis?.facts_summary?.trim() ?? '';
  const analysisSummary =
    analysisPipelineEnabled && analysisStatus === 'success'
      ? analysis?.summary?.trim() ?? ''
      : '';
  const hasSynthesisSummary = synthesisSummary.length > 0;
  const hasAnalysisSummary = analysisSummary.length > 0;
  const rawSummary =
    synthesisSummary ||
    analysisSummary ||
    story?.summary_hint?.trim() ||
    'Summary pending synthesis.';
  const summary = sanitizePublicationNeutralSummary(
    rawSummary,
    (story?.sources ?? []).flatMap((source) => [source.source_id, source.publisher]),
  );
  const synthesisFrameRows = synthesis?.frames ?? [];
  const analysisFrameRows =
    analysisPipelineEnabled && analysisStatus === 'success' && analysis
      ? analysis.frames
      : [];
  const useAnalysisFrames = synthesisFrameRows.length === 0 && analysisFrameRows.length > 0;
  const frameRows = synthesisFrameRows.length > 0 ? synthesisFrameRows : analysisFrameRows;
  const frameAnalysis = useAnalysisFrames ? analysis : null;
  const analysisNeedsRegeneration =
    analysisPipelineEnabled
    && analysisStatus === 'success'
    && !!analysis
    && synthesisFrameRows.length === 0
    && analysisFrameRows.length === 0;
  const analyzedSourceCount = analysis?.analyses.length ?? 0;
  const expectedSourceCount = displaySources.length || story?.sources.length || 0;
  const summaryBasisLabel = hasSynthesisSummary
    ? 'Topic synthesis v2'
    : hasAnalysisSummary
      ? analyzedSourceCount > 0 && expectedSourceCount > analyzedSourceCount
        ? `Provisional card analysis (${analyzedSourceCount}/${expectedSourceCount} sources)`
        : 'Provisional card analysis'
      : undefined;
  const frameBasisLabel = synthesisFrameRows.length > 0
    ? 'Topic synthesis frames'
    : useAnalysisFrames
      ? `${analyzedSourceCount} ${analyzedSourceCount === 1 ? 'source' : 'sources'} analyzed`
      : undefined;
  const analysisProvider =
    analysisPipelineEnabled &&
    analysisStatus === 'success' &&
    (useAnalysisFrames || (!hasSynthesisSummary && hasAnalysisSummary))
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
  const frontRegionId = `news-card-front-${item.topic_id}`;
  const backRegionId = `news-card-back-region-${item.topic_id}`;
  const sourceSurfaceLabel =
    displaySources.length > 1 ? 'Story cluster' : displaySources.length === 1 ? 'Singleton report' : 'Developing';
  const summaryPreview = previewText(summary);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const frontFaceStyle = resolveFlipFaceStyle(isExpanded, 'front', reducedMotion);
  const backFaceStyle = resolveFlipFaceStyle(isExpanded, 'back', reducedMotion);
  useViewTracking(item.topic_id, isExpanded);

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
      className="group relative overflow-hidden rounded-[1.5rem] p-4 shadow-[0_20px_52px_-40px_rgba(15,23,42,0.38)] transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px hover:shadow-[0_24px_58px_-42px_rgba(15,23,42,0.42)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 md:p-5"
      style={{
        backgroundColor: 'var(--headline-card-bg)',
        borderColor: isExpanded ? 'rgba(15, 23, 42, 0.14)' : 'var(--headline-card-border)',
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
      <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/80 to-transparent dark:via-slate-600/80" />
      <div id={frontRegionId} data-testid="flip-front" aria-hidden={isExpanded} style={frontFaceStyle}>
        <NewsCardFront
          item={item}
          storyId={storyId}
          heroImage={heroImage}
          galleryImages={galleryImages}
          sourceSurfaceLabel={sourceSurfaceLabel}
          hasLiveThread={Boolean(discussionThread?.isHeadline)}
          isExpanded={isExpanded}
          displaySources={displaySources}
          summaryPreview={summaryPreview}
          storylineHeadline={storylineHeadline}
          createdAt={createdAt}
          latestActivity={latestActivity}
          onToggle={isExpanded ? collapseCard : openDetail}
          onOpenDetail={openDetail}
          onStorylineFocus={handleStorylineFocus}
        />
      </div>

      <div id={backRegionId} data-testid="flip-back" aria-hidden={!isExpanded} style={backFaceStyle}>
        {isExpanded && (
          <section
            className="mt-4 border-t border-slate-200/80 pt-4 dark:border-slate-800"
            data-testid={`news-card-detail-${item.topic_id}`}
          >
            <NewsCardBack
              headline={item.title}
              topicId={item.topic_id}
              summary={summary}
              summaryBasisLabel={summaryBasisLabel}
              frameRows={frameRows}
              frameBasisLabel={frameBasisLabel}
              analysisProvider={analysisProvider}
              galleryImages={galleryImages}
              relatedCoverage={hasStorylineCoverage ? storyline?.related_coverage ?? [] : []}
              relatedLinks={relatedLinks}
              storylineHeadline={storylineHeadline}
              storylineStoryCount={storylineStoryCount}
              analysisFeedbackStatus={analysisFeedbackStatus}
              analysisError={analysisError}
              retryAnalysis={retryAnalysis}
              analysisNeedsRegeneration={analysisNeedsRegeneration}
              synthesisLoading={synthesisLoading}
              synthesisError={synthesisError}
              analysis={frameAnalysis}
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
                      sourceSynthesisId: synthesisId ?? undefined,
                      sourceEpoch: synthesisEpoch,
                      sourceUrl: primaryStorySource.url,
                      topicId: item.topic_id,
                    }
                  : null
              }
              onCollapse={collapseCard}
            />
          </section>
        )}
      </div>
    </article>
  );
};

export default NewsCard;
