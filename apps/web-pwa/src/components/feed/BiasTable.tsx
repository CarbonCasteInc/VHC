import React, { useCallback, useState } from 'react';
import type { NewsCardSourceAnalysis } from './newsCardAnalysis';
import { CellVoteControls } from './CellVoteControls';
import { pointMapKey, useBiasPointIds } from './useBiasPointIds';

export interface BiasTableProps {
  readonly analyses: ReadonlyArray<NewsCardSourceAnalysis>;
  readonly frames: ReadonlyArray<{ frame: string; reframe: string }>;
  readonly providerLabel?: string;
  readonly loading?: boolean;
  readonly topicId?: string;
  readonly analysisId?: string;
  readonly synthesisId?: string;
  readonly epoch?: number;
  readonly votingEnabled?: boolean;
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
  readonly votingEnabled?: boolean;
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
  votingEnabled,
}: ExpandableRowProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const hasDetail =
    (analysis?.biasClaimQuotes?.length ?? 0) > 0 ||
    (analysis?.justifyBiasClaims?.length ?? 0) > 0;

  const showVoting = !!(votingEnabled && topicId && synthesisId && epoch !== undefined);

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
          {showVoting && framePointId && (
            <CellVoteControls
              topicId={topicId!}
              pointId={framePointId}
              synthesisId={synthesisId!}
              epoch={epoch!}
              analysisId={analysisId}
            />
          )}
        </td>
        <td className="border border-slate-200 px-2 py-1 text-slate-700">
          {reframe}
          {showVoting && reframePointId && (
            <CellVoteControls
              topicId={topicId!}
              pointId={reframePointId}
              synthesisId={synthesisId!}
              epoch={epoch!}
              analysisId={analysisId}
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
  frames: ReadonlyArray<{ frame: string; reframe: string }>,
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
 * Feature-flagged behind VITE_VH_BIAS_TABLE_V2.
 */
export const BiasTable: React.FC<BiasTableProps> = ({
  analyses,
  frames,
  providerLabel,
  loading = false,
  topicId,
  analysisId,
  synthesisId,
  epoch,
  votingEnabled = false,
}) => {
  const pointIds = useBiasPointIds({
    frames,
    analysisId,
    topicId,
    synthesisId,
    epoch,
    votingEnabled,
  });

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
          {analyses.length} {analyses.length === 1 ? 'source' : 'sources'} analyzed
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
                  synthesisId={synthesisId}
                  epoch={epoch}
                  framePointId={pointIds[pointMapKey(index, 'frame')]}
                  reframePointId={pointIds[pointMapKey(index, 'reframe')]}
                  votingEnabled={votingEnabled}
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
