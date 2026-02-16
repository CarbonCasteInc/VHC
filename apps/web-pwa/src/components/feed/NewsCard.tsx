import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StoryBundle } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { SourceBadgeRow } from './SourceBadgeRow';
import { synthesizeStoryFromAnalysisPipeline } from './newsCardAnalysis';

export interface NewsCardProps {
  /** Discovery feed item; expected kind: NEWS_STORY. */
  readonly item: FeedItem;
}

function formatIsoTimestamp(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    return 'unknown';
  }
  return new Date(timestampMs).toISOString();
}

function formatHotness(hotness: number): string {
  if (!Number.isFinite(hotness)) {
    return '0.00';
  }
  return hotness.toFixed(2);
}

function toSafeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function resolveStoryBundle(
  stories: ReadonlyArray<StoryBundle>,
  item: FeedItem,
): StoryBundle | null {
  const normalizedTitle = item.title.trim();
  const normalizedCreatedAt = toSafeTimestamp(item.created_at);

  const exact = stories.find(
    (story) =>
      story.topic_id === item.topic_id &&
      story.headline.trim() === normalizedTitle &&
      toSafeTimestamp(story.created_at) === normalizedCreatedAt,
  );
  if (exact) {
    return exact;
  }

  const sameTopicHeadline = stories.find(
    (story) =>
      story.topic_id === item.topic_id &&
      story.headline.trim() === normalizedTitle,
  );
  if (sameTopicHeadline) {
    return sameTopicHeadline;
  }

  const fallback = stories.find(
    (story) => story.headline.trim() === normalizedTitle,
  );
  return fallback ?? null;
}

/**
 * Clustered story card for discovery feed NEWS_STORY items.
 *
 * Front: headline + engagement metrics.
 * Back (on headline click): summary + frame/reframe table.
 *
 * Hero Path / SoT alignment:
 * - one headline from StoryBundle appears in feed
 * - headline tap reveals synthesis lens (facts summary + frame/reframe table)
 */
export const NewsCard: React.FC<NewsCardProps> = ({ item }) => {
  const [flipped, setFlipped] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [analysisFrames, setAnalysisFrames] = useState<
    ReadonlyArray<{ frame: string; reframe: string }>
  >([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const activeAnalysisRun = useRef(0);

  const stories = useStore(useNewsStore, (state) => state.stories);
  const startSynthesisHydration = useStore(
    useSynthesisStore,
    (state) => state.startHydration,
  );
  const refreshSynthesisTopic = useStore(
    useSynthesisStore,
    (state) => state.refreshTopic,
  );
  const synthesisTopicState = useStore(
    useSynthesisStore,
    (state) => state.topics[item.topic_id],
  );

  const story = useMemo(
    () => resolveStoryBundle(stories, item),
    [stories, item],
  );

  useEffect(() => {
    setAnalysisSummary(null);
    setAnalysisFrames([]);
    setAnalysisLoading(false);
    setAnalysisError(null);
  }, [story?.story_id, story?.provenance_hash, item.topic_id]);

  const synthesis = synthesisTopicState?.synthesis ?? null;
  const synthesisLoading = synthesisTopicState?.loading ?? false;
  const synthesisError = synthesisTopicState?.error ?? null;

  const latestActivity = formatIsoTimestamp(item.latest_activity_at);
  const createdAt = formatIsoTimestamp(item.created_at);

  const summary =
    (analysisLoading && !analysisSummary
      ? 'Analyzing source articles via analysis pipeline…'
      : null) ||
    analysisSummary?.trim() ||
    synthesis?.facts_summary?.trim() ||
    story?.summary_hint?.trim() ||
    'Summary pending synthesis.';

  const frameRows =
    analysisLoading && analysisFrames.length === 0
      ? []
      : analysisFrames.length > 0
        ? analysisFrames
        : (synthesis?.frames ?? []);

  const openBack = () => {
    setFlipped(true);
    startSynthesisHydration(item.topic_id);
    void refreshSynthesisTopic(item.topic_id);

    if (!story) {
      return;
    }

    const runId = activeAnalysisRun.current + 1;
    activeAnalysisRun.current = runId;

    setAnalysisLoading(true);
    setAnalysisError(null);

    void synthesizeStoryFromAnalysisPipeline(story)
      .then((result) => {
        if (activeAnalysisRun.current !== runId) {
          return;
        }
        setAnalysisSummary(result.summary);
        setAnalysisFrames(result.frames);
      })
      .catch((error: unknown) => {
        if (activeAnalysisRun.current !== runId) {
          return;
        }
        setAnalysisError(
          error instanceof Error
            ? error.message
            : 'Analysis pipeline unavailable; using synthesis fallback.',
        );
      })
      .finally(() => {
        if (activeAnalysisRun.current === runId) {
          setAnalysisLoading(false);
        }
      });
  };

  return (
    <article
      data-testid={`news-card-${item.topic_id}`}
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      aria-label="News story"
    >
      {!flipped ? (
        <>
          <header className="mb-2 flex items-center justify-between gap-2">
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
              News
            </span>
            <span className="text-xs text-slate-500" data-testid={`news-card-hotness-${item.topic_id}`}>
              Hotness {formatHotness(item.hotness)}
            </span>
          </header>

          <button
            type="button"
            className="text-left text-base font-semibold text-slate-900 underline-offset-2 hover:underline"
            data-testid={`news-card-headline-${item.topic_id}`}
            onClick={openBack}
          >
            {item.title}
          </button>

          {story && story.sources.length > 0 && (
            <SourceBadgeRow
              sources={story.sources.map((s) => ({
                source_id: s.source_id,
                publisher: s.publisher,
                url: s.url,
              }))}
            />
          )}

          <p className="mt-1 text-xs text-slate-500">
            Created {createdAt} • Updated {latestActivity}
          </p>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
            <span data-testid={`news-card-eye-${item.topic_id}`}>👁️ {item.eye}</span>
            <span data-testid={`news-card-lightbulb-${item.topic_id}`}>💡 {item.lightbulb}</span>
            <span data-testid={`news-card-comments-${item.topic_id}`}>💬 {item.comments}</span>
          </div>

          <p className="mt-3 text-xs text-blue-700">Click headline to flip →</p>
        </>
      ) : (
        <div data-testid={`news-card-back-${item.topic_id}`} className="space-y-3">
          <header className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
              Synthesis Lens
            </span>
            <button
              type="button"
              className="text-xs font-medium text-violet-700 underline-offset-2 hover:underline"
              onClick={() => setFlipped(false)}
              data-testid={`news-card-back-button-${item.topic_id}`}
            >
              ← Back to headline
            </button>
          </header>

          <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
          <p className="text-sm text-slate-700" data-testid={`news-card-summary-${item.topic_id}`}>
            {summary}
          </p>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Frame / Reframe
            </h4>

            {analysisLoading && (
              <p
                className="mt-2 text-xs text-slate-500"
                data-testid={`news-card-analysis-loading-${item.topic_id}`}
              >
                Analyzing up to 3 sources via analysis pipeline…
              </p>
            )}

            {analysisError && !analysisLoading && (
              <p
                className="mt-2 text-xs text-amber-700"
                data-testid={`news-card-analysis-error-${item.topic_id}`}
              >
                {analysisError}
              </p>
            )}

            {synthesisLoading && (
              <p
                className="mt-2 text-xs text-slate-500"
                data-testid={`news-card-synthesis-loading-${item.topic_id}`}
              >
                Loading synthesis…
              </p>
            )}

            {synthesisError && !synthesisLoading && !analysisSummary && (
              <p
                className="mt-2 text-xs text-amber-700"
                data-testid={`news-card-synthesis-error-${item.topic_id}`}
              >
                Synthesis unavailable.
              </p>
            )}

            <div className="mt-2 overflow-x-auto">
              <table
                className="min-w-full border border-slate-200 text-left text-xs"
                data-testid={`news-card-frame-table-${item.topic_id}`}
              >
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="border border-slate-200 px-2 py-1">Frame</th>
                    <th className="border border-slate-200 px-2 py-1">Reframe</th>
                  </tr>
                </thead>
                <tbody>
                  {frameRows.length > 0 ? (
                    frameRows.map((row, index) => (
                      <tr key={`${row.frame}|${row.reframe}|${index}`}>
                        <td className="border border-slate-200 px-2 py-1 text-slate-800">
                          {row.frame}
                        </td>
                        <td className="border border-slate-200 px-2 py-1 text-slate-700">
                          {row.reframe}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        className="border border-slate-200 px-2 py-2 text-slate-500"
                        colSpan={2}
                        data-testid={`news-card-frame-empty-${item.topic_id}`}
                      >
                        No frame/reframe pairs yet for this topic.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </article>
  );
};

export default NewsCard;
