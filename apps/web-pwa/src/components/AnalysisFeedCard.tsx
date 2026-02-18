import React from 'react';
import { Link } from '@tanstack/react-router';
import type { CanonicalAnalysis } from '../../../../packages/ai-engine/src/analysis';

interface AnalysisFeedCardProps {
  item: CanonicalAnalysis;
  onShare: (item: CanonicalAnalysis) => void;
}

export const AnalysisFeedCard: React.FC<AnalysisFeedCardProps> = ({ item, onShare }) => {
  const providerLabel = item.engine
    ? `${item.engine.id} · ${item.engine.modelName}`
    : null;

  return (
    <div
      className="rounded-xl border border-slate-100 bg-card-muted p-3 space-y-1 dark:border-slate-700/70"
    >
      <p className="text-xs uppercase tracking-wide text-slate-500">{new Date(item.timestamp).toLocaleString()}</p>
      <p className="text-sm font-semibold text-slate-900">{item.url}</p>
      <p className="text-sm text-slate-700">{item.summary}</p>
      <p className="text-xs text-slate-600">Biases: {item.biases.join(' · ')}</p>
      {providerLabel && (
        <p className="text-xs text-slate-500" data-testid={`analysis-provider-${item.urlHash}`}>
          Provider: {providerLabel}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => onShare(item)}
          data-testid={`share-${item.urlHash}`}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Share
        </button>
        <Link
          to="/hermes"
          search={{ sourceAnalysisId: item.urlHash, title: item.summary, sourceUrl: item.url }}
          className="text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
        >
          Discuss in Forum →
        </Link>
      </div>
    </div>
  );
};
