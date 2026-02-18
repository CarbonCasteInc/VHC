import React, { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StoryBundle } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { SourceBadgeRow } from './SourceBadgeRow';
import { useAnalysis } from './useAnalysis';
import { NewsCardBack } from './NewsCardBack';
import { FeedEngagement } from './FeedEngagement';

export interface NewsCardProps {
  /** Discovery feed item; expected kind: NEWS_STORY. */
  readonly item: FeedItem;
}

function formatIsoTimestamp(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) return 'unknown';
  return new Date(timestampMs).toISOString();
}

function formatHotness(hotness: number): string {
  if (!Number.isFinite(hotness)) return '0.00';
  return hotness.toFixed(2);
}

function toSafeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function resolveStoryBundle(
  stories: ReadonlyArray<StoryBundle>,
  item: FeedItem,
): StoryBundle | null {
  const normalizedTitle = item.title.trim();
  const normalizedCreatedAt = toSafeTimestamp(item.created_at);
  const exact = stories.find(
    (s) =>
      s.topic_id === item.topic_id &&
      s.headline.trim() === normalizedTitle &&
      toSafeTimestamp(s.created_at) === normalizedCreatedAt,
  );
  if (exact) return exact;
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

/**
 * Clustered story card for discovery feed NEWS_STORY items.
 *
 * Front: headline + engagement metrics.
 * Back (on headline click): summary + frame/reframe table.
 */
export const NewsCard: React.FC<NewsCardProps> = ({ item }) => {
  const [flipped, setFlipped] = useState(false);

  const stories = useStore(useNewsStore, (state) => state.stories);
  const startSynthesisHydration = useStore(useSynthesisStore, (s) => s.startHydration);
  const refreshSynthesisTopic = useStore(useSynthesisStore, (s) => s.refreshTopic);
  const synthesisTopicState = useStore(useSynthesisStore, (s) => s.topics[item.topic_id]);

  const story = useMemo(() => resolveStoryBundle(stories, item), [stories, item]);

  const analysisPipelineEnabled = import.meta.env.VITE_VH_ANALYSIS_PIPELINE === 'true';
  const {
    analysis,
    status: analysisStatus,
    error: analysisError,
    retry: retryAnalysis,
  } = useAnalysis(story, flipped);

  const synthesis = synthesisTopicState?.synthesis ?? null;
  const synthesisLoading = synthesisTopicState?.loading ?? false;
  const synthesisError = synthesisTopicState?.error ?? null;

  const latestActivity = formatIsoTimestamp(item.latest_activity_at);
  const createdAt = formatIsoTimestamp(item.created_at);

  const computedAnalysisId = story ? `${story.story_id}:${story.provenance_hash}` : null;

  const analysisFeedbackStatus =
    analysisPipelineEnabled &&
    (analysisStatus === 'loading' ||
      analysisStatus === 'timeout' ||
      analysisStatus === 'error' ||
      analysisStatus === 'budget_exceeded')
      ? analysisStatus
      : null;

  const summary =
    (analysisPipelineEnabled &&
      analysisStatus === 'success' &&
      analysis?.summary?.trim()) ||
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

  const openBack = () => {
    setFlipped(true);
    startSynthesisHydration(item.topic_id);
    void refreshSynthesisTopic(item.topic_id);
  };

  return (
    <article
      data-testid={`news-card-${item.topic_id}`}
      className="relative overflow-hidden rounded-2xl p-5 shadow-sm transition-transform duration-150 hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-md"
      style={{
        backgroundColor: 'var(--headline-card-bg)',
        borderColor: 'var(--headline-card-border)',
        borderWidth: '1px',
        borderStyle: 'solid',
      }}
      aria-label="News story"
    >
      {!flipped ? (
        <>
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
        </>
      ) : (
        <NewsCardBack
          topicId={item.topic_id}
          summary={summary}
          frameRows={frameRows}
          analysisProvider={analysisProvider}
          perSourceSummaries={perSourceSummaries}
          analysisFeedbackStatus={analysisFeedbackStatus}
          analysisError={analysisError}
          retryAnalysis={retryAnalysis}
          synthesisLoading={synthesisLoading}
          synthesisError={synthesisError}
          analysis={analysis}
          analysisId={computedAnalysisId}
          onFlipBack={() => setFlipped(false)}
        />
      )}
    </article>
  );
};

export default NewsCard;
