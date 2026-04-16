import React from 'react';
import type { HermesThread } from '@vh/types';
import type { NewsCardAnalysisSynthesis } from './newsCardAnalysis';
import { AnalysisLoadingState } from './AnalysisLoadingState';
import { BiasTable } from './BiasTable';
import { FeedDiscussionSection } from './FeedDiscussionSection';
import { RemovalIndicator } from './RemovalIndicator';
import { SourceViewerFrame } from './SourceViewerFrame';

export interface NewsCardBackProps {
  readonly headline: string;
  readonly topicId: string;
  readonly summary: string;
  readonly frameRows: ReadonlyArray<{ frame: string; reframe: string }>;
  readonly analysisProvider: string | null;
  readonly perSourceSummaries: ReadonlyArray<{
    source_id: string;
    publisher: string;
    summary: string;
  }>;
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
    readonly sourceAnalysisId?: string;
    readonly sourceUrl?: string;
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
  frameRows,
  analysisProvider,
  perSourceSummaries,
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
            {sourceViewer ? 'Source View' : 'Synthesis Lens'}
          </span>
          <h3 className="text-xl font-semibold tracking-tight text-slate-950">{headline}</h3>
        </div>
        <button
          type="button"
          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
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

      <section className="space-y-3 rounded-[1.5rem] border border-slate-200/90 bg-slate-50/80 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Synthesis Summary
        </h4>
        {analysisFeedbackStatus ? (
          <AnalysisLoadingState
            status={analysisFeedbackStatus}
            error={analysisError}
            onRetry={retryAnalysis}
          />
        ) : (
          <>
            <p className="text-sm leading-6 text-slate-700" data-testid={`news-card-summary-${topicId}`}>
              {summary}
            </p>

            {analysisProvider && (
              <p
                className="text-xs text-slate-500"
                data-testid={`news-card-analysis-provider-${topicId}`}
              >
                Analysis by {analysisProvider}
              </p>
            )}

            {perSourceSummaries.length > 0 && (
              <ul
                className="list-disc space-y-1 pl-5 text-xs text-slate-600"
                data-testid={`news-card-analysis-source-summaries-${topicId}`}
              >
                {perSourceSummaries.map((entry) => (
                  <li key={`${entry.source_id}|${entry.publisher}`}>
                    <span className="font-medium text-slate-700">{entry.publisher}:</span>{' '}
                    {entry.summary}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {relatedLinks.length > 0 && (
        <section
          className="space-y-2 rounded-[1.5rem] border border-amber-200/90 bg-amber-50/80 p-4 shadow-sm shadow-amber-900/5"
          data-testid={`news-card-related-links-${topicId}`}
        >
          <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
            Related Stories
          </h4>
          <p className="text-xs text-amber-700/80">
            These links were not used in the framing table or analysis summary.
          </p>
          <ul className="space-y-1.5 text-sm text-amber-900">
            {relatedLinks.map((entry) => (
              <li key={`${entry.source_id}|${entry.url}`}>
                <span className="font-medium">{entry.publisher}:</span>{' '}
                <a
                  className="underline decoration-amber-300 underline-offset-2 hover:text-amber-950"
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

      {relatedCoverage.length > 0 && (
        <section
          className="space-y-2 rounded-[1.5rem] border border-slate-200/90 bg-white/80 p-4 shadow-sm shadow-slate-900/5"
          data-testid={`news-card-related-coverage-${topicId}`}
        >
          <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Related Coverage
          </h4>
          {storylineHeadline && (
            <p
              className="text-xs text-slate-500"
              data-testid={`news-card-storyline-headline-${topicId}`}
            >
              {storylineHeadline}
              {storylineStoryCount > 0
                ? ` • ${storylineStoryCount} ${storylineStoryCount === 1 ? 'story' : 'stories'}`
                : ''}
            </p>
          )}
          <ul className="space-y-1.5 text-sm text-slate-600">
            {relatedCoverage.map((entry) => (
              <li key={`${entry.source_id}|${entry.url}`}>
                <span className="font-medium text-slate-700">{entry.publisher}:</span>{' '}
                <a
                  className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
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

      <section className="space-y-3 rounded-[1.5rem] border border-slate-200/90 bg-white/80 p-4 shadow-sm shadow-slate-900/5">
        <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
