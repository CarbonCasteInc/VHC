import React from 'react';
import type { HermesThread } from '@vh/types';
import type { NewsCardAnalysisSynthesis } from './newsCardAnalysis';
import { AnalysisLoadingState } from './AnalysisLoadingState';
import { BiasTable } from './BiasTable';
import { FeedDiscussionSection } from './FeedDiscussionSection';
import { RemovalIndicator } from './RemovalIndicator';
import { SourceViewerFrame } from './SourceViewerFrame';

export interface NewsCardMediaAsset {
  readonly sourceId: string;
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
  readonly imageUrl: string;
}

export interface NewsCardBackProps {
  readonly headline: string;
  readonly topicId: string;
  readonly summary: string;
  readonly summaryBasisLabel?: string;
  readonly frameRows: ReadonlyArray<{ frame: string; reframe: string }>;
  readonly frameBasisLabel?: string;
  readonly analysisProvider: string | null;
  readonly galleryImages: ReadonlyArray<NewsCardMediaAsset>;
  readonly relatedCoverage: ReadonlyArray<{
    source_id: string;
    publisher: string;
    title: string;
    url: string;
  }>;
  readonly relatedLinks: ReadonlyArray<{
    source_id: string;
    publisher: string;
    title: string;
    url: string;
  }>;
  readonly storylineHeadline: string | null;
  readonly storylineStoryCount: number;
  readonly analysisFeedbackStatus:
    | 'loading'
    | 'timeout'
    | 'error'
    | 'budget_exceeded'
    | null;
  readonly analysisError: string | null;
  readonly retryAnalysis: () => void;
  readonly synthesisLoading: boolean;
  readonly synthesisError: string | null;
  readonly analysis: NewsCardAnalysisSynthesis | null;
  readonly analysisId?: string | null;
  readonly synthesisId?: string | null;
  readonly epoch?: number;
  readonly sourceViewer?: {
    readonly publisher: string;
    readonly title: string;
    readonly url: string;
  } | null;
  readonly discussionThread: HermesThread | null;
  readonly fallbackCommentCount?: number;
  readonly createThread?: {
    readonly defaultTitle: string;
    readonly sourceSynthesisId?: string;
    readonly sourceEpoch?: number;
    readonly sourceUrl?: string;
    readonly topicId?: string;
  } | null;
  readonly onCollapse: () => void;
}

/**
 * Card-back content for a NewsCard showing summary + frame/reframe table.
 * Production wiring: BiasTable is always-on.
 */
export const NewsCardBack: React.FC<NewsCardBackProps> = ({
  headline,
  topicId,
  summary,
  summaryBasisLabel,
  frameRows,
  frameBasisLabel,
  analysisProvider,
  galleryImages,
  relatedCoverage,
  relatedLinks,
  storylineHeadline,
  storylineStoryCount,
  analysisFeedbackStatus,
  analysisError,
  retryAnalysis,
  synthesisLoading,
  synthesisError,
  analysis,
  analysisId,
  synthesisId,
  epoch,
  sourceViewer,
  discussionThread,
  fallbackCommentCount = 0,
  createThread = null,
  onCollapse,
}) => {
  return (
    <div data-testid={`news-card-back-${topicId}`} className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-[1.75rem] border border-slate-200/90 bg-slate-50/85 p-4 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900/80">
        <div className="space-y-2">
          <span className="inline-flex rounded-full bg-violet-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:bg-violet-950/70 dark:text-violet-100">
            {sourceViewer ? 'Source View' : 'Synthesis Lens'}
          </span>
          <h3 className="text-2xl leading-tight text-slate-950 dark:text-white">{headline}</h3>
        </div>
        <button
          type="button"
          className="rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={onCollapse}
          data-testid={`news-card-back-button-${topicId}`}
        >
          Collapse
        </button>
      </header>

      {sourceViewer && (
        <SourceViewerFrame
          topicId={topicId}
          publisher={sourceViewer.publisher}
          title={sourceViewer.title}
          url={sourceViewer.url}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.95fr)]">
        <section className="space-y-3 rounded-[1.5rem] border border-slate-200/90 bg-slate-50/80 p-4 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900/80">
          <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Synthesis Summary
          </h4>
          {summaryBasisLabel && (
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"
              data-testid={`news-card-summary-basis-${topicId}`}
            >
              {summaryBasisLabel}
            </p>
          )}
          <p className="text-sm leading-7 text-slate-700 dark:text-slate-200" data-testid={`news-card-summary-${topicId}`}>
            {summary}
          </p>

          {galleryImages.length > 0 && (
            <div
              className="space-y-2 border-t border-slate-200/80 pt-3 dark:border-slate-800"
              data-testid={`news-card-gallery-${topicId}`}
            >
              <h5 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                Source images
              </h5>
              <div className="grid gap-3 sm:grid-cols-2">
                {galleryImages.map((image, index) => (
                  <a
                    key={`${image.sourceId}|${image.imageUrl}`}
                    href={image.url}
                    target="_blank"
                    rel="noreferrer"
                    className="overflow-hidden rounded-[1.25rem] border border-slate-200/90 bg-white/88 shadow-sm shadow-slate-900/5 transition hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/80"
                    data-testid={`news-card-gallery-link-${topicId}-${index}`}
                  >
                    <img
                      src={image.imageUrl}
                      alt={`${image.publisher}: ${image.title}`}
                      className="h-40 w-full object-cover"
                      data-testid={`news-card-gallery-image-${topicId}-${index}`}
                    />
                    <div className="space-y-1 p-3">
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {image.publisher}
                      </span>
                      <p className="text-sm leading-5 text-slate-700 dark:text-slate-200">
                        {image.title}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {analysisFeedbackStatus && (
            <AnalysisLoadingState
              status={analysisFeedbackStatus}
              error={analysisError}
              onRetry={retryAnalysis}
            />
          )}

          {!analysisFeedbackStatus && (
            <>
              {analysisProvider && (
                <p
                  className="text-xs text-slate-500 dark:text-slate-400"
                  data-testid={`news-card-analysis-provider-${topicId}`}
                >
                  Analysis by {analysisProvider}
                </p>
              )}
            </>
          )}
        </section>

        <div className="space-y-4">
          {relatedCoverage.length > 0 && (
            <section
              className="space-y-2 rounded-[1.5rem] border border-slate-200/90 bg-white/82 p-4 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80"
              data-testid={`news-card-related-coverage-${topicId}`}
            >
              <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Related Coverage
              </h4>
              {storylineHeadline && (
                <p
                  className="text-xs text-slate-500 dark:text-slate-400"
                  data-testid={`news-card-storyline-headline-${topicId}`}
                >
                  {storylineHeadline}
                  {storylineStoryCount > 0
                    ? ` • ${storylineStoryCount} ${storylineStoryCount === 1 ? 'story' : 'stories'}`
                    : ''}
                </p>
              )}
              <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-200">
                {relatedCoverage.map((entry) => (
                  <li key={`${entry.source_id}|${entry.url}`}>
                    <span className="font-medium text-slate-700 dark:text-white">{entry.publisher}:</span>{' '}
                    <a
                      className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900 dark:decoration-slate-600 dark:hover:text-white"
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {relatedLinks.length > 0 && (
            <section
              className="space-y-2 rounded-[1.5rem] border border-amber-200/90 bg-amber-50/80 p-4 shadow-sm shadow-amber-900/5 dark:border-amber-900/60 dark:bg-amber-950/30"
              data-testid={`news-card-related-links-${topicId}`}
            >
              <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-100">
                Related Stories
              </h4>
              <p className="text-xs text-amber-700/80 dark:text-amber-100/80">
                These links were not used in the framing table or analysis summary.
              </p>
              <ul className="space-y-1.5 text-sm text-amber-900 dark:text-amber-100">
                {relatedLinks.map((entry) => (
                  <li key={`${entry.source_id}|${entry.url}`}>
                    <span className="font-medium">{entry.publisher}:</span>{' '}
                    <a
                      className="underline decoration-amber-300 underline-offset-2 hover:text-amber-950 dark:decoration-amber-700 dark:hover:text-white"
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <section className="space-y-3 rounded-[1.5rem] border border-slate-200/90 bg-white/82 p-4 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80">
        <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Frame / Reframe
        </h4>

        {analysisFeedbackStatus === 'error' && (
          <div className="mt-2" data-testid={`news-card-analysis-error-${topicId}`}>
            <RemovalIndicator reason="extraction-failed-permanently" />
          </div>
        )}

        {synthesisLoading && (
          <p
            className="mt-2 text-xs text-slate-500"
            data-testid={`news-card-synthesis-loading-${topicId}`}
          >
            Loading synthesis…
          </p>
        )}

        {synthesisError && !synthesisLoading && !analysis && (
          <p
            className="mt-2 text-xs text-amber-700"
            data-testid={`news-card-synthesis-error-${topicId}`}
          >
            Synthesis unavailable.
          </p>
        )}

        <div className="mt-2">
            <BiasTable
              analyses={analysis?.analyses ?? []}
              frames={frameRows}
              providerLabel={analysisProvider ?? undefined}
              basisLabel={frameBasisLabel}
              loading={synthesisLoading && frameRows.length === 0}
            topicId={topicId}
            analysisId={analysisId ?? undefined}
            synthesisId={synthesisId ?? undefined}
            epoch={epoch}
            votingEnabled
          />
        </div>
      </section>

      <FeedDiscussionSection
        sectionId={`news-card-${topicId}`}
        thread={discussionThread}
        fallbackCommentCount={fallbackCommentCount}
        createThread={createThread}
        emptyMessage="No thread exists yet for this story."
      />
    </div>
  );
};

export default NewsCardBack;
