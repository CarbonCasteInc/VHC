import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StorylineGroup, TopicSynthesisV2 } from '@vh/data-model';
import {
  readNewsSynthesisLifecycleStatusWithRelayRestFallback,
  readTopicEpochSynthesis,
  type NewsSynthesisLifecycleRecord,
} from '@vh/gun-client';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { useForumStore } from '../../store/hermesForum';
import { resolveClientFromAppStore } from '../../store/clientResolver';
import { useViewTracking } from '../../hooks/useViewTracking';
import { NewsCardBack } from './NewsCardBack';
import { sanitizePublicationNeutralSummary } from './newsCardAnalysis';
import { useExpandedCardStore } from './expandedCardStore';
import { useDiscoveryStore } from '../../store/discovery';
import {
  getPrimaryStorySource,
  getStoryDiscussionThreadId,
  resolveStoryDiscussionThread,
} from '../../utils/feedDiscussionThreads';
import { getFeedItemDetailId, normalizeStoryId } from '../../utils/feedItemIdentity';
import { NewsCardFront } from './NewsCardFront';
import {
  formatIsoTimestamp,
  mergeRelatedLinks,
  normalizeStorylineHeadline,
  previewText,
  resolveDisplaySources,
  resolveSingletonVideoSource,
  resolveStoryBundle,
  resolveStoryMedia,
} from './newsCardModel';

export interface NewsCardProps {
  readonly item: FeedItem;
}

const PENDING_SYNTHESIS_REFRESH_INTERVAL_MS = 2_000;
const PENDING_SYNTHESIS_REFRESH_ATTEMPTS = 45;

function synthesisInputsIncludeStory(
  synthesis: NonNullable<ReturnType<typeof useSynthesisStore.getState>['topics'][string]>['synthesis'],
  storyId: string | null,
): boolean {
  if (!synthesis || !storyId) {
    return false;
  }
  return (synthesis.inputs.story_bundle_ids ?? []).includes(storyId);
}

function acceptedSynthesisMatchesStoryRevision({
  synthesis,
  story,
  storyId,
  lifecycle,
}: {
  readonly synthesis: NonNullable<ReturnType<typeof useSynthesisStore.getState>['topics'][string]>['synthesis'];
  readonly story: ReturnType<typeof resolveStoryBundle>;
  readonly storyId: string | null;
  readonly lifecycle: NewsSynthesisLifecycleRecord | null;
}): boolean {
  if (!synthesisInputsIncludeStory(synthesis, storyId)) {
    return false;
  }
  if (!story?.provenance_hash?.trim()) {
    return false;
  }
  // Lifecycle synthesis_id AND epoch must both name the TopicSynthesisV2;
  // a lifecycle record missing its epoch never yields an accepted-current
  // votable state (docs/specs/topic-synthesis-v2.md join semantics).
  return Boolean(
    lifecycle
    && lifecycle.status === 'accepted_available'
    && lifecycle.story_id === story.story_id
    && lifecycle.source_set_revision === story.provenance_hash
    && lifecycle.synthesis_id === synthesis?.synthesis_id
    && typeof lifecycle.epoch === 'number'
    && lifecycle.epoch === synthesis?.epoch,
  );
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
  const loadForumThreads = useStore(useForumStore, (state) => state.loadThreads);
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
  const storyDiscussionThreadId = useMemo(
    () => getStoryDiscussionThreadId(item, story),
    [item, story],
  );
  const primaryStorySource = useMemo(() => getPrimaryStorySource(story), [story]);
  const singletonVideoSource = useMemo(
    () => resolveSingletonVideoSource(story),
    [story],
  );
  const displaySources = useMemo(
    () => resolveDisplaySources(story),
    [story],
  );
  const synthesis = synthesisTopicState?.synthesis ?? null;
  const synthesisCorrection = synthesisTopicState?.correction ?? null;
  const synthesisLoading = synthesisTopicState?.loading ?? false;
  const synthesisError = synthesisTopicState?.error ?? null;
  const synthesisInvalid = synthesisTopicState?.invalid ?? false;
  const [synthesisLifecycle, setSynthesisLifecycle] = useState<NewsSynthesisLifecycleRecord | null>(null);
  const [synthesisLifecycleLoading, setSynthesisLifecycleLoading] = useState(false);
  const [epochScopedSynthesis, setEpochScopedSynthesis] = useState<TopicSynthesisV2 | null>(null);
  const lifecycleStatus = synthesisLifecycle?.status ?? null;
  const lifecycleReason = synthesisLifecycle?.reason ?? null;
  const storyId = normalizeStoryId(item.story_id) ?? story?.story_id ?? null;
  const storySourceSetRevision = story?.provenance_hash ?? null;
  const lifecycleSynthesisId =
    typeof synthesisLifecycle?.synthesis_id === 'string' && synthesisLifecycle.synthesis_id.trim()
      ? synthesisLifecycle.synthesis_id
      : null;
  const lifecycleEpoch =
    typeof synthesisLifecycle?.epoch === 'number' && Number.isFinite(synthesisLifecycle.epoch)
      ? synthesisLifecycle.epoch
      : null;
  const latestMatchesLifecycle = acceptedSynthesisMatchesStoryRevision({
    synthesis,
    story,
    storyId,
    lifecycle: synthesisLifecycle,
  });
  // A lagging topics/latest pointer must not hide an accepted-current record:
  // when the lifecycle names a synthesis_id+epoch the hydrated latest does not
  // match, verify against the epoch node before treating the story as pending.
  const shouldReadEpochScopedSynthesis = Boolean(
    synthesisLifecycle
    && synthesisLifecycle.status === 'accepted_available'
    && lifecycleSynthesisId
    && lifecycleEpoch !== null
    && story?.provenance_hash?.trim()
    && synthesisLifecycle.story_id === story?.story_id
    && synthesisLifecycle.source_set_revision === story?.provenance_hash
    && !latestMatchesLifecycle
  );
  const epochScopedMatchesLifecycle = acceptedSynthesisMatchesStoryRevision({
    synthesis: epochScopedSynthesis,
    story,
    storyId,
    lifecycle: synthesisLifecycle,
  });
  const acceptedCurrentSynthesis = latestMatchesLifecycle
    ? synthesis
    : epochScopedMatchesLifecycle
      ? epochScopedSynthesis
      : null;
  const acceptedSynthesisCurrent = acceptedCurrentSynthesis !== null;
  const displayedSynthesis = acceptedCurrentSynthesis ?? synthesis;
  const correctionAppliesToDisplayedSynthesis = Boolean(
    synthesisCorrection
    && displayedSynthesis !== null
    && synthesisCorrection.synthesis_id === displayedSynthesis.synthesis_id
    && synthesisCorrection.epoch === displayedSynthesis.epoch
    && synthesisCorrection.topic_id === displayedSynthesis.topic_id
  );
  const correctionBlocksSynthesis = Boolean(
    correctionAppliesToDisplayedSynthesis
    && (acceptedSynthesisCurrent || lifecycleStatus === 'suppressed')
  );
  const effectiveSynthesis = correctionBlocksSynthesis || !acceptedSynthesisCurrent ? null : acceptedCurrentSynthesis;
  const latestActivity = formatIsoTimestamp(item.latest_activity_at);
  const createdAt = formatIsoTimestamp(item.created_at);
  const synthesisId = effectiveSynthesis?.synthesis_id ?? null;
  const synthesisEpoch = effectiveSynthesis?.epoch;
  const synthesisProvenance = effectiveSynthesis
    ? {
        generatedAt: formatIsoTimestamp(effectiveSynthesis.created_at),
        synthesisId: effectiveSynthesis.synthesis_id,
        epoch: effectiveSynthesis.epoch,
        candidateIds: effectiveSynthesis.provenance.candidate_ids,
        providerMix: effectiveSynthesis.provenance.provider_mix,
        warnings: effectiveSynthesis.warnings,
      }
    : null;
  const synthesisSummary = effectiveSynthesis?.facts_summary?.trim() ?? '';
  const hasSynthesisSummary = synthesisSummary.length > 0;
  const rawSummary =
    correctionBlocksSynthesis
      ? synthesisCorrection?.status === 'suppressed'
        ? 'Accepted synthesis was suppressed by an operator.'
        : 'Accepted synthesis was marked unavailable by an operator.'
      : synthesisSummary ||
        story?.summary_hint?.trim() ||
        'Analysis pending publish-time synthesis.';
  const summary = sanitizePublicationNeutralSummary(
    rawSummary,
    (story?.sources ?? []).flatMap((source) => [source.source_id, source.publisher]),
  );
  const synthesisFrameRows = effectiveSynthesis?.frames ?? [];
  const frameRows = synthesisFrameRows;
  const summaryBasisLabel = (() => {
    if (correctionBlocksSynthesis) return 'Operator correction';
    if (hasSynthesisSummary) return 'Topic synthesis v2';
    if (synthesisInvalid) return 'Publish-time synthesis failed validation';
    if (synthesisLoading || synthesisLifecycleLoading || lifecycleStatus === 'in_progress') {
      return 'Publish-time synthesis loading';
    }
    if (lifecycleStatus === 'terminal_unavailable') {
      return 'Publish-time synthesis terminal unavailable';
    }
    if (lifecycleStatus === 'retryable_failure') {
      return 'Publish-time synthesis retryable';
    }
    return story?.summary_hint?.trim()
      ? 'Feed summary hint; synthesis pending'
      : 'Publish-time synthesis pending';
  })();
  const frameBasisLabel = synthesisFrameRows.length > 0
    ? 'Topic synthesis frames'
    : undefined;
  const synthesisUnavailable = !synthesisLoading
    && !synthesisLifecycleLoading
    && !effectiveSynthesis
    && !synthesisError
    && !synthesisInvalid
    && !correctionBlocksSynthesis
    && lifecycleStatus !== 'terminal_unavailable'
    && lifecycleStatus !== 'retryable_failure';
  const [synthesisReadinessTimedOut, setSynthesisReadinessTimedOut] = useState(false);
  const relatedLinks = useMemo(
    () => mergeRelatedLinks(story, null),
    [story],
  );
  const retryAnalysis = useCallback(() => undefined, []);
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
    expandCard(cardInstanceKey);
  }, [cardInstanceKey, expandCard]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    setSynthesisReadinessTimedOut(false);
    startSynthesisHydration(item.topic_id);
    void refreshSynthesisTopic(item.topic_id);
  }, [isExpanded, item.topic_id, refreshSynthesisTopic, startSynthesisHydration]);

  useEffect(() => {
    if (!isExpanded || !storyId) {
      return;
    }

    const client = resolveClientFromAppStore();
    if (!client) {
      return;
    }

    let cancelled = false;
    setSynthesisLifecycleLoading(true);
    void readNewsSynthesisLifecycleStatusWithRelayRestFallback(client, storyId)
      .then((record) => {
        if (!cancelled) {
          setSynthesisLifecycle(record);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSynthesisLifecycle(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSynthesisLifecycleLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isExpanded, storyId, storySourceSetRevision]);

  useEffect(() => {
    if (!isExpanded || !shouldReadEpochScopedSynthesis || lifecycleEpoch === null || !lifecycleSynthesisId) {
      return;
    }

    const client = resolveClientFromAppStore();
    if (!client) {
      return;
    }

    let cancelled = false;
    // readTopicEpochSynthesis applies the same fail-closed system-writer
    // validation as the latest read; a record that does not name the
    // lifecycle synthesis_id+epoch is discarded so the story stays non-votable.
    void readTopicEpochSynthesis(client, item.topic_id, lifecycleEpoch)
      .then((record) => {
        if (cancelled) {
          return;
        }
        setEpochScopedSynthesis(
          record && record.synthesis_id === lifecycleSynthesisId && record.epoch === lifecycleEpoch
            ? record
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setEpochScopedSynthesis(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isExpanded, item.topic_id, lifecycleEpoch, lifecycleSynthesisId, shouldReadEpochScopedSynthesis]);

  useEffect(() => {
    if (!isExpanded || effectiveSynthesis || synthesisCorrection || synthesisLoading || synthesisError) {
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refreshPendingSynthesis = () => {
      if (cancelled || attempt >= PENDING_SYNTHESIS_REFRESH_ATTEMPTS) {
        if (!cancelled) {
          setSynthesisReadinessTimedOut(true);
        }
        return;
      }
      attempt += 1;
      void refreshSynthesisTopic(item.topic_id).finally(() => {
        if (cancelled || attempt >= PENDING_SYNTHESIS_REFRESH_ATTEMPTS) {
          if (!cancelled) {
            setSynthesisReadinessTimedOut(true);
          }
          return;
        }
        const latest = useSynthesisStore.getState().topics[item.topic_id];
        if (latest?.synthesis || latest?.correction || latest?.error) {
          return;
        }
        timer = setTimeout(refreshPendingSynthesis, PENDING_SYNTHESIS_REFRESH_INTERVAL_MS);
      });
    };

    timer = setTimeout(refreshPendingSynthesis, PENDING_SYNTHESIS_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    effectiveSynthesis,
    isExpanded,
    item.topic_id,
    refreshSynthesisTopic,
    synthesisCorrection,
    synthesisError,
    synthesisLoading,
  ]);

  useEffect(() => {
    if (effectiveSynthesis || synthesisCorrection || synthesisError) {
      setSynthesisReadinessTimedOut(false);
    }
  }, [effectiveSynthesis, synthesisCorrection, synthesisError]);

  useEffect(() => {
    setSynthesisLifecycle(null);
    setSynthesisLifecycleLoading(false);
    setEpochScopedSynthesis(null);
  }, [storyId, storySourceSetRevision]);

  useEffect(() => {
    if (!isExpanded) return;
    void loadForumThreads('new');
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      collapseCard();
    };
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  }, [collapseCard, isExpanded, loadForumThreads]);

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
              storyId={storyId}
              summary={summary}
              summaryBasisLabel={summaryBasisLabel}
              frameRows={frameRows}
              frameBasisLabel={frameBasisLabel}
              analysisProvider={null}
              galleryImages={galleryImages}
              relatedCoverage={hasStorylineCoverage ? storyline?.related_coverage ?? [] : []}
              relatedLinks={relatedLinks}
              storylineHeadline={storylineHeadline}
              storylineStoryCount={storylineStoryCount}
              analysisFeedbackStatus={null}
              analysisError={null}
              retryAnalysis={retryAnalysis}
              analysisNeedsRegeneration={false}
              synthesisLoading={synthesisLoading}
              synthesisError={synthesisError}
              synthesisInvalid={synthesisInvalid}
              synthesisUnavailable={synthesisUnavailable}
              synthesisReadinessTimedOut={synthesisReadinessTimedOut}
              synthesisLifecycleStatus={lifecycleStatus}
              synthesisLifecycleReason={lifecycleReason}
              synthesisCorrection={correctionBlocksSynthesis ? synthesisCorrection : null}
              synthesisDisagreementScore={effectiveSynthesis?.divergence_metrics.disagreement_score ?? null}
              analysis={null}
              analysisId={null}
              synthesisId={synthesisId}
              synthesisProvenance={synthesisProvenance}
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
                      threadId: storyDiscussionThreadId,
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
