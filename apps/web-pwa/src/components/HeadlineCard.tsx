import React, { useEffect, useMemo, useState } from 'react';
import type { FeedItem } from '../hooks/useFeedStore';
import { useSentimentState } from '../hooks/useSentimentState';
import AnalysisView from './AnalysisView';

interface HeadlineCardProps {
  item: FeedItem;
}

export const HeadlineCard: React.FC<HeadlineCardProps> = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const dateLabel = useMemo(() => new Date(item.timestamp).toLocaleString(), [item.timestamp]);

  // Get eye weight from sentiment store for this item
  const eyeWeight = useSentimentState((s) => s.getEyeWeight(item.id));
  const lightbulbWeight = useSentimentState((s) => s.getLightbulbWeight(item.id));
  const recordRead = useSentimentState((s) => s.recordRead);

  // Calculate displayed read count: base + eye weight contribution (decayed toward 2)
  const displayedReadCount = useMemo(() => {
    return (item.readCount + eyeWeight).toFixed(1);
  }, [item.readCount, eyeWeight]);

  // Aggregate Lightbulb = seeded engagementScore (other users) + local per-user weight
  const displayedLightbulb = useMemo(() => {
    const base = Number.isFinite(item.engagementScore) ? item.engagementScore : 0;
    return (base + lightbulbWeight).toFixed(2);
  }, [item.engagementScore, lightbulbWeight]);

  // Simulate brief loading state when expanding (for UX feedback)
  useEffect(() => {
    if (expanded) {
      setLoading(true);
      // Record the read when card is expanded
      recordRead(item.id);
      const timer = setTimeout(() => setLoading(false), 300);
      return () => clearTimeout(timer);
    }
  }, [expanded, item.id, recordRead]);

  // Z-index priority: expanded cards always on top, then hovered cards
  const zIndex = expanded ? 100 : hovered ? 10 : 1;

  return (
    <article
      className="relative overflow-hidden rounded-xl border border-slate-600/40 bg-slate-900/50 p-4 shadow-lg backdrop-blur transition-transform duration-150"
      style={{ transform: hovered && !expanded ? 'scale(1.02)' : 'scale(1)', zIndex }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => setExpanded((prev) => !prev)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((prev) => !prev);
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-2">
          <h3 className="text-lg font-semibold text-slate-50">{item.title}</h3>
          <p className="text-sm text-slate-300">{item.summary}</p>
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {item.source} • {dateLabel}
          </p>
        </div>
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt={item.title}
            className="h-20 w-28 rounded-lg object-cover shadow-md"
          />
        )}
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs text-slate-300">
        <span aria-label="Read count" data-testid="read-count">👁️ {displayedReadCount}</span>
        <span aria-label="Engagement score">💡 {displayedLightbulb}</span>
        <span className="ml-auto text-slate-400">{expanded ? 'Tap to collapse' : 'Tap to expand'}</span>
      </div>
      {expanded && (
        <div className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-slate-300" data-testid="analysis-loading">
              <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Analyzing…</span>
            </div>
          ) : (
            <AnalysisView item={item} />
          )}
        </div>
      )}
    </article>
  );
};

export default HeadlineCard;
