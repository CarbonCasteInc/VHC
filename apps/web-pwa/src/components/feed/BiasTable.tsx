import React, { useCallback, useEffect, useState } from 'react';
import type { NewsCardSourceAnalysis } from './newsCardAnalysis';
import { CellVoteControls } from './CellVoteControls';
import { pointMapKey, useBiasPointIds } from './useBiasPointIds';

export interface BiasTableFrameRow {
  readonly frame_point_id?: string;
  readonly frame: string;
  readonly reframe_point_id?: string;
  readonly reframe: string;
}

export interface BiasTableProps {
  readonly analyses: ReadonlyArray<NewsCardSourceAnalysis>;
  readonly frames: ReadonlyArray<BiasTableFrameRow>;
  readonly providerLabel?: string;
  readonly basisLabel?: string;
  readonly loading?: boolean;
  readonly topicId?: string;
  readonly analysisId?: string;
  readonly synthesisId?: string;
  readonly epoch?: number;
  readonly votingEnabled?: boolean;
  readonly votingPointIdMode?: 'legacy-compatible' | 'accepted-synthesis';
}

function biasTableDiagnosticsEnabled(): boolean {
  const viteValue = (import.meta as unknown as { env?: Record<string, unknown> }).env
    ?.VITE_BIAS_TABLE_DIAGNOSTICS;
  const processValue = typeof process !== 'undefined'
    ? process.env?.VITE_BIAS_TABLE_DIAGNOSTICS
    : undefined;
  return `${viteValue ?? processValue ?? ''}`.trim().toLowerCase() === 'true';
}

function SkeletonRows(): React.ReactElement {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={`skeleton-${i}`} data-testid={`bias-table-skeleton-row-${i}`}>
          <td className="border border-slate-200 px-2 py-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
          </td>
          <td className="border border-slate-200 px-2 py-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
          </td>
        </tr>
      ))}
    </>
  );
}

interface ExpandableRowProps {
  readonly frame: string;
  readonly reframe: string;
  readonly analysis: NewsCardSourceAnalysis | undefined;
  readonly rowIndex: number;
  readonly topicId?: string;
  readonly analysisId?: string;
  readonly synthesisId?: string;
  readonly epoch?: number;
  readonly framePointId?: string;
  readonly reframePointId?: string;
  readonly synthesisFramePointId?: string;
  readonly synthesisReframePointId?: string;
  readonly votingEnabled?: boolean;
  readonly votingPointIdMode?: 'legacy-compatible' | 'accepted-synthesis';
}

function ExpandableRow({
  frame,
  reframe,
  analysis,
  rowIndex,
  topicId,
  analysisId,
  synthesisId,
  epoch,
  framePointId,
  reframePointId,
  synthesisFramePointId,
  synthesisReframePointId,
  votingEnabled,
  votingPointIdMode = 'legacy-compatible',
}: ExpandableRowProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const hasDetail =
    (analysis?.biasClaimQuotes?.length ?? 0) > 0 ||
    (analysis?.justifyBiasClaims?.length ?? 0) > 0;

  const showVoting = !!(votingEnabled && topicId && synthesisId && epoch !== undefined);
  const voteFramePointId = votingPointIdMode === 'accepted-synthesis'
    ? synthesisFramePointId
    : framePointId ?? synthesisFramePointId;
  const voteReframePointId = votingPointIdMode === 'accepted-synthesis'
    ? synthesisReframePointId
    : reframePointId ?? synthesisReframePointId;
  const frameSynthesisPointId = synthesisFramePointId ?? voteFramePointId;
  const reframeSynthesisPointId = synthesisReframePointId ?? voteReframePointId;

  return (
    <>
      <tr
        className={hasDetail ? 'cursor-pointer hover:bg-slate-50' : ''}
        onClick={hasDetail ? toggle : undefined}
        aria-expanded={hasDetail ? expanded : undefined}
        data-testid={`bias-table-row-${rowIndex}`}
      >
        <td className="border border-slate-200 px-2 py-1 text-slate-800">
          {frame}
          {showVoting && voteFramePointId && (
            <CellVoteControls
              topicId={topicId!}
              pointId={voteFramePointId}
              synthesisPointId={frameSynthesisPointId}
              synthesisId={synthesisId!}
              epoch={epoch!}
              analysisId={analysisId}
              pointLabel={frame}
            />
          )}
        </td>
        <td className="border border-slate-200 px-2 py-1 text-slate-700">
          {reframe}
          {showVoting && voteReframePointId && (
            <CellVoteControls
              topicId={topicId!}
              pointId={voteReframePointId}
              synthesisPointId={reframeSynthesisPointId}
              synthesisId={synthesisId!}
              epoch={epoch!}
              analysisId={analysisId}
              pointLabel={reframe}
            />
          )}
        </td>
      </tr>
      {expanded && hasDetail && (
        <tr data-testid={`bias-table-detail-${rowIndex}`}>
          <td
            className="border border-slate-200 bg-slate-50 px-4 py-2"
            colSpan={2}
          >
            {(analysis?.biasClaimQuotes?.length ?? 0) > 0 && (
              <div className="mb-1">
                <span className="text-xs font-semibold text-slate-600">
                  Claim quotes:
                </span>
                <ul className="ml-3 list-disc text-xs text-slate-600">
                  {analysis!.biasClaimQuotes.map((q, i) => (
                    <li key={`quote-${i}`}>&ldquo;{q}&rdquo;</li>
                  ))}
                </ul>
              </div>
            )}
            {(analysis?.justifyBiasClaims?.length ?? 0) > 0 && (
              <div>
                <span className="text-xs font-semibold text-slate-600">
                  Justification:
                </span>
                <ul className="ml-3 list-disc text-xs text-slate-600">
                  {analysis!.justifyBiasClaims.map((j, i) => (
                    <li key={`justify-${i}`}>{j}</li>
                  ))}
                </ul>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function buildRowAnalysisMap(
  frames: ReadonlyArray<BiasTableFrameRow>,
  analyses: ReadonlyArray<NewsCardSourceAnalysis>,
): Map<number, NewsCardSourceAnalysis> {
  const map = new Map<number, NewsCardSourceAnalysis>();
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!.frame;
    const match = analyses.find((a) => f.startsWith(`${a.publisher}:`));
    if (match) map.set(i, match);
  }
  return map;
}

// point-id derivation helpers extracted to useBiasPointIds.ts
/**
 * Two-column bias table with expandable detail rows.
 * Production wiring: always-on.
 */
export const BiasTable: React.FC<BiasTableProps> = ({
  analyses,
  frames,
  providerLabel,
  basisLabel,
  loading = false,
  topicId,
  analysisId,
  synthesisId,
  epoch,
  votingEnabled = false,
  votingPointIdMode = 'legacy-compatible',
}) => {
  const hasExplicitSynthesisContext = synthesisId !== undefined && epoch !== undefined;
  const stableVotingContextId = hasExplicitSynthesisContext
    ? synthesisId
    : analysisId;
  const effectiveSynthesisId = stableVotingContextId;
  const effectiveEpoch = epoch ?? 0;
  const hasVotingContext = Boolean(
    votingEnabled &&
      topicId &&
      effectiveSynthesisId &&
      Number.isFinite(effectiveEpoch),
  );

  const { legacyPointIds, synthesisPointIds } = useBiasPointIds({
    frames,
    analysisId,
    topicId,
    synthesisId: hasVotingContext ? effectiveSynthesisId : undefined,
    epoch: hasVotingContext ? effectiveEpoch : undefined,
    votingEnabled: hasVotingContext,
    synthesisPointIdMode: votingPointIdMode === 'accepted-synthesis'
      ? 'persisted-only'
      : 'persisted-or-derived',
  });

  useEffect(() => {
    if (!votingEnabled || frames.length === 0) {
      return;
    }

    const expectedPointMappings = frames.length * 2;
    const payload = {
      topic_id: topicId ?? null,
      analysis_id: analysisId ?? null,
      synthesis_id: synthesisId ?? null,
      epoch: epoch ?? null,
      effective_synthesis_id: effectiveSynthesisId ?? null,
      effective_epoch: hasVotingContext ? effectiveEpoch : null,
      stable_voting_context_id: stableVotingContextId ?? null,
      context_source: hasExplicitSynthesisContext
        ? stableVotingContextId
          ? 'synthesis'
          : 'none'
        : analysisId
          ? 'analysis-fallback'
          : 'none',
      frame_rows: frames.length,
      expected_point_mappings: expectedPointMappings,
      legacy_point_mappings: Object.keys(legacyPointIds).length,
      synthesis_point_mappings: Object.keys(synthesisPointIds).length,
      point_mappings_ready: Object.keys(synthesisPointIds).length === expectedPointMappings,
      point_id_mode: votingPointIdMode,
      voting_context_ready: hasVotingContext,
    };

    if (!biasTableDiagnosticsEnabled()) {
      return;
    }

    console.info('[vh:bias-table:voting-context]', payload);
  }, [
    analysisId,
    effectiveEpoch,
    effectiveSynthesisId,
    epoch,
    frames.length,
    hasExplicitSynthesisContext,
    hasVotingContext,
    legacyPointIds,
    stableVotingContextId,
    synthesisId,
    synthesisPointIds,
    topicId,
    votingEnabled,
    votingPointIdMode,
  ]);

  const rowAnalysisMap = buildRowAnalysisMap(frames, analyses);

  if (!loading && analyses.length === 0 && frames.length === 0) {
    return (
      <p
        className="text-xs text-slate-500"
        data-testid="bias-table-empty"
      >
        No bias analysis available yet
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="bias-table">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-xs font-medium text-slate-700"
          data-testid="bias-table-source-count"
        >
          {basisLabel ?? `${analyses.length} ${analyses.length === 1 ? 'source' : 'sources'} analyzed`}
        </span>
        {providerLabel && (
          <span
            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
            data-testid="bias-table-provider-badge"
          >
            Analysis by {providerLabel}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table
          className="min-w-full border border-slate-200 text-left text-xs"
          data-testid="bias-table-grid"
        >
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="border border-slate-200 px-2 py-1">Frame</th>
              <th className="border border-slate-200 px-2 py-1">Reframe</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : frames.length > 0 ? (
              frames.map((row, index) => (
                <ExpandableRow
                  key={`${row.frame}|${row.reframe}|${index}`}
                  frame={row.frame}
                  reframe={row.reframe}
                  analysis={rowAnalysisMap.get(index)}
                  rowIndex={index}
                  topicId={topicId}
                  analysisId={analysisId}
                  synthesisId={hasVotingContext ? effectiveSynthesisId : undefined}
                  epoch={hasVotingContext ? effectiveEpoch : undefined}
                  framePointId={legacyPointIds[pointMapKey(index, 'frame')]}
                  reframePointId={legacyPointIds[pointMapKey(index, 'reframe')]}
                  synthesisFramePointId={synthesisPointIds[pointMapKey(index, 'frame')]}
                  synthesisReframePointId={synthesisPointIds[pointMapKey(index, 'reframe')]}
                  votingEnabled={hasVotingContext}
                  votingPointIdMode={votingPointIdMode}
                />
              ))
            ) : (
              <tr>
                <td
                  className="border border-slate-200 px-2 py-2 text-slate-500"
                  colSpan={2}
                >
                  No frame/reframe pairs yet for this topic.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BiasTable;
