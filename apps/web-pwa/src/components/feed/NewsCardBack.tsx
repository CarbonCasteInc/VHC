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

function isBiasTableV2Enabled(): boolean {
  return import.meta.env.VITE_VH_BIAS_TABLE_V2 === 'true';
}

/**
 * Card-back content for a NewsCard showing summary + frame/reframe table.
 * Feature-flagged: VITE_VH_BIAS_TABLE_V2 switches to expandable BiasTable.
 */
export const NewsCardBack: React.FC<NewsCardBackProps> = ({
  topicId,
  summary,
  frameRows,
  analysisProvider,
  perSourceSummaries,
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
  const biasTableV2 = isBiasTableV2Enabled();
  const votingEnabled = biasTableV2;

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

        {biasTableV2 ? (
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
              votingEnabled={votingEnabled}
            />
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table
              className="min-w-full border border-slate-200 text-left text-xs"
              data-testid={`news-card-frame-table-${topicId}`}
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
                      data-testid={`news-card-frame-empty-${topicId}`}
                    >
                      No frame/reframe pairs yet for this topic.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default NewsCardBack;
