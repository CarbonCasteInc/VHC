import React from 'react';
import type { NewsCardAnalysisSynthesis } from './newsCardAnalysis';
import { AnalysisLoadingState } from './AnalysisLoadingState';
import { BiasTable } from './BiasTable';
import { RemovalIndicator } from './RemovalIndicator';

export interface NewsCardBackProps {
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
  readonly onFlipBack: () => void;
}

/**
 * Card-back content for a NewsCard showing summary + frame/reframe table.
 * Production wiring: BiasTable is always-on.
 */
export const NewsCardBack: React.FC<NewsCardBackProps> = ({
  topicId,
  summary,
  frameRows,
  analysisProvider,
  perSourceSummaries,
  relatedCoverage,
  analysisFeedbackStatus,
  analysisError,
  retryAnalysis,
  synthesisLoading,
  synthesisError,
  analysis,
  analysisId,
  synthesisId,
  epoch,
  onFlipBack,
}) => {
  return (
    <div data-testid={`news-card-back-${topicId}`} className="space-y-3">
      <header className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
          Synthesis Lens
        </span>
        <button
          type="button"
          className="text-xs font-medium text-violet-700 underline-offset-2 hover:underline"
          onClick={onFlipBack}
          data-testid={`news-card-back-button-${topicId}`}
        >
          ← Back to headline
        </button>
      </header>

      <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
      {analysisFeedbackStatus ? (
        <AnalysisLoadingState
          status={analysisFeedbackStatus}
          error={analysisError}
          onRetry={retryAnalysis}
        />
      ) : (
        <>
          <p className="text-sm text-slate-700" data-testid={`news-card-summary-${topicId}`}>
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

          {relatedCoverage.length > 0 && (
            <div
              className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
              data-testid={`news-card-related-coverage-${topicId}`}
            >
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Related coverage
              </h4>
              <ul className="space-y-1 text-xs text-slate-600">
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
            </div>
          )}
        </>
      )}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
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
      </div>
    </div>
  );
};

export default NewsCardBack;
