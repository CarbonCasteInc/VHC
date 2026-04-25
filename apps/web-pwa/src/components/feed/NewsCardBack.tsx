import React, { useState } from 'react';
import type { HermesNewsReportReasonCode, TopicSynthesisCorrection } from '@vh/data-model';
import type { HermesThread } from '@vh/types';
import { useNewsReportStore } from '../../store/newsReports';
import type { NewsCardAnalysisSynthesis } from './newsCardAnalysis';
import { AnalysisLoadingState } from './AnalysisLoadingState';
import { BiasTable, type BiasTableFrameRow } from './BiasTable';
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

export interface NewsCardSynthesisProvenance {
  readonly generatedAt: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly candidateIds: ReadonlyArray<string>;
  readonly providerMix: ReadonlyArray<{
    readonly provider_id: string;
    readonly count: number;
  }>;
  readonly warnings: ReadonlyArray<string>;
}

export interface NewsCardBackProps {
  readonly headline: string;
  readonly topicId: string;
  readonly storyId?: string | null;
  readonly summary: string;
  readonly summaryBasisLabel?: string;
  readonly frameRows: ReadonlyArray<BiasTableFrameRow>;
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
  readonly analysisNeedsRegeneration?: boolean;
  readonly synthesisLoading: boolean;
  readonly synthesisError: string | null;
  readonly synthesisUnavailable?: boolean;
  readonly synthesisCorrection?: TopicSynthesisCorrection | null;
  readonly analysis: NewsCardAnalysisSynthesis | null;
  readonly analysisId?: string | null;
  readonly synthesisId?: string | null;
  readonly synthesisProvenance?: NewsCardSynthesisProvenance | null;
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
    readonly threadId?: string;
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
  storyId,
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
  analysisNeedsRegeneration = false,
  synthesisLoading,
  synthesisError,
  synthesisUnavailable = false,
  synthesisCorrection = null,
  analysis,
  analysisId,
  synthesisId,
  synthesisProvenance = null,
  epoch,
  sourceViewer,
  discussionThread,
  fallbackCommentCount = 0,
  createThread = null,
  onCollapse,
}) => {
  const submitSynthesisReport = useNewsReportStore((state) => state.submitSynthesisReport);
  const hasAcceptedStanceTargets = frameRows.some(
    (row) => Boolean(row.frame_point_id?.trim() || row.reframe_point_id?.trim()),
  );
  const correctionBlocksSynthesis = Boolean(synthesisCorrection);
  const correctionTimestamp = synthesisCorrection ? new Date(synthesisCorrection.created_at).toISOString() : null;
  const correctionStateLabel = synthesisCorrection?.status === 'suppressed'
    ? 'Accepted synthesis suppressed'
    : 'Accepted synthesis unavailable';
  const [reportReason, setReportReason] = useState<HermesNewsReportReasonCode>('inaccurate_summary');
  const [reportStatus, setReportStatus] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
  const [reportError, setReportError] = useState<string | null>(null);
  const canReportSynthesis = Boolean(synthesisId && epoch !== undefined && !correctionBlocksSynthesis);
  const handleReportSynthesis = async () => {
    if (!synthesisId || epoch === undefined) {
      return;
    }
    setReportStatus('submitting');
    setReportError(null);
    try {
      await submitSynthesisReport({
        topicId,
        synthesisId,
        epoch,
        storyId,
        reasonCode: reportReason,
      });
      setReportStatus('submitted');
    } catch (error: unknown) {
      setReportStatus('error');
      setReportError(error instanceof Error ? error.message : 'Unable to submit report');
    }
  };

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
          {synthesisProvenance && (
            <div
              className="space-y-1 rounded-lg border border-slate-200/80 bg-white/75 px-3 py-2 text-[11px] leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300"
              data-testid={`news-card-synthesis-provenance-${topicId}`}
            >
              <p>
                Generated {synthesisProvenance.generatedAt} · epoch {synthesisProvenance.epoch}
              </p>
              <p className="break-all">
                Synthesis {synthesisProvenance.synthesisId} · candidates {synthesisProvenance.candidateIds.length}
              </p>
              <p>
                Providers{' '}
                {synthesisProvenance.providerMix
                  .map((provider) => `${provider.provider_id} x${provider.count}`)
                  .join(', ')}
              </p>
            </div>
          )}
          {synthesisProvenance && synthesisProvenance.warnings.length > 0 && (
            <div
              className="space-y-1 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
              data-testid={`news-card-synthesis-warnings-${topicId}`}
            >
              {synthesisProvenance.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          {synthesisCorrection && (
            <div
              className="space-y-1 rounded-lg border border-rose-200/80 bg-rose-50/80 px-3 py-2 text-xs leading-5 text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-100"
              data-testid={`news-card-synthesis-correction-${topicId}`}
            >
              <p className="font-semibold">{correctionStateLabel}</p>
              <p>
                Reason {synthesisCorrection.reason_code}
                {synthesisCorrection.reason ? `: ${synthesisCorrection.reason}` : ''}
              </p>
              <p>
                Operator {synthesisCorrection.operator_id} · {correctionTimestamp}
              </p>
              <p className="break-all">Correction {synthesisCorrection.correction_id}</p>
            </div>
          )}
          <p className="text-sm leading-7 text-slate-700 dark:text-slate-200" data-testid={`news-card-summary-${topicId}`}>
            {summary}
          </p>
          {canReportSynthesis && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-white/75 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300"
              data-testid={`news-card-synthesis-report-${topicId}`}
            >
              <label className="sr-only" htmlFor={`news-card-synthesis-report-reason-${topicId}`}>
                Report reason
              </label>
              <select
                id={`news-card-synthesis-report-reason-${topicId}`}
                value={reportReason}
                onChange={(event) => setReportReason(event.currentTarget.value as HermesNewsReportReasonCode)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                data-testid={`news-card-synthesis-report-reason-${topicId}`}
              >
                <option value="inaccurate_summary">Inaccurate summary</option>
                <option value="bad_frame">Bad frame</option>
                <option value="source_attribution_error">Source attribution</option>
                <option value="policy_violation">Policy issue</option>
              </select>
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={handleReportSynthesis}
                disabled={reportStatus === 'submitting' || reportStatus === 'submitted'}
                data-testid={`news-card-synthesis-report-submit-${topicId}`}
              >
                {reportStatus === 'submitted' ? 'Reported' : reportStatus === 'submitting' ? 'Reporting' : 'Report synthesis'}
              </button>
              {reportStatus === 'error' && reportError && (
                <span className="text-rose-700 dark:text-rose-200" role="alert">
                  {reportError}
                </span>
              )}
            </div>
          )}

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
        {hasAcceptedStanceTargets && synthesisId && epoch !== undefined && !correctionBlocksSynthesis && (
          <p
            className="text-xs leading-5 text-slate-500 dark:text-slate-400"
            data-testid={`news-card-stance-scope-${topicId}`}
          >
            Stance controls apply to individual frame and reframe items about this story, not to the story as a whole.
          </p>
        )}
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
        {synthesisUnavailable && !analysis && !correctionBlocksSynthesis && (
          <p
            className="mt-2 text-xs text-amber-700"
            data-testid={`news-card-synthesis-unavailable-${topicId}`}
          >
            Publish-time synthesis has not been published for this story yet.
          </p>
        )}
        {synthesisCorrection && (
          <p
            className="mt-2 text-xs text-rose-700 dark:text-rose-100"
            data-testid={`news-card-synthesis-correction-state-${topicId}`}
          >
            {synthesisCorrection.status === 'suppressed'
              ? 'Accepted synthesis was suppressed by an operator and is not shown.'
              : 'Accepted synthesis was marked unavailable by an operator and is not shown.'}
          </p>
        )}
        {analysisNeedsRegeneration && !synthesisLoading && !correctionBlocksSynthesis && (
          <p
            className="mt-2 text-xs text-amber-700"
            data-testid={`news-card-analysis-regeneration-${topicId}`}
          >
            Analysis needs regeneration to produce frame/reframe rows.
          </p>
        )}
        {!correctionBlocksSynthesis && (
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
              votingEnabled={Boolean(synthesisId && epoch !== undefined && hasAcceptedStanceTargets)}
              votingPointIdMode="accepted-synthesis"
            />
          </div>
        )}
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
