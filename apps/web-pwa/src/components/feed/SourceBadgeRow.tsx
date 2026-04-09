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
      className="mt-2 flex items-center"
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
      {overflow > 0 && (
        <span
          className="ml-3 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
          data-testid="source-badge-overflow"
        >
          +{overflow} more
        </span>
      )}
    </div>
  );
};

export default SourceBadgeRow;
