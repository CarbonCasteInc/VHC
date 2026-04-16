import React, { useMemo } from 'react';
import { SourceBadge } from './SourceBadge';

export interface SourceBadgeRowProps {
  /** Bundle sources to render as badges. */
  readonly sources: ReadonlyArray<{
    source_id: string;
    publisher: string;
    url: string;
  }>;
  /** Maximum badges before overflow indicator. Default: 5. */
  readonly maxVisible?: number;
}

/**
 * Horizontal row of source badges with "+N more" overflow.
 * Renders nothing when sources array is empty.
 */
export const SourceBadgeRow: React.FC<SourceBadgeRowProps> = ({
  sources,
  maxVisible = 5,
}) => {
  const uniqueSources = useMemo(() => {
    const seen = new Set<string>();
    const deduped: Array<{ source_id: string; publisher: string; url: string }> = [];

    for (const source of sources) {
      const publisherKey = source.publisher.trim().toLowerCase().replace(/\s+/g, ' ') || source.source_id;
      if (seen.has(publisherKey)) {
        continue;
      }
      seen.add(publisherKey);
      deduped.push(source);
    }

    return deduped;
  }, [sources]);

  if (uniqueSources.length === 0) {
    return null;
  }

  const visible = uniqueSources.slice(0, maxVisible);
  const overflow = uniqueSources.length - maxVisible;

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-3"
      data-testid="source-badge-row"
      aria-label={`${uniqueSources.length} source${uniqueSources.length === 1 ? '' : 's'}`}
    >
      <div className="flex items-center -space-x-2.5">
        {visible.map((source, index) => (
          <div key={source.source_id} className="relative" style={{ zIndex: visible.length - index }}>
            <SourceBadge
              sourceId={source.source_id}
              publisher={source.publisher}
              url={source.url}
            />
          </div>
        ))}
      </div>
      <span
        className="rounded-full border border-slate-200/80 bg-white/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 shadow-sm shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300"
        data-testid="source-badge-count"
      >
        {uniqueSources.length === 1 ? 'Singleton' : `${uniqueSources.length} sources`}
      </span>
      {overflow > 0 && (
        <span
          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          data-testid="source-badge-overflow"
        >
          +{overflow} more
        </span>
      )}
    </div>
  );
};

export default SourceBadgeRow;
