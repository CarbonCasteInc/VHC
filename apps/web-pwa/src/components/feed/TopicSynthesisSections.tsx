import React from 'react';
import type { TopicSynthesisV2 } from '@vh/data-model';

export interface TopicSynthesisSectionProps {
  readonly synthesis: TopicSynthesisV2 | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly fallback: string;
}

export const CollapsedSummary: React.FC<TopicSynthesisSectionProps> = ({
  synthesis,
  loading,
  error,
  fallback,
}) => {
  if (loading) {
    return (
      <p className="mt-3 text-xs text-slate-500" data-testid="topic-card-synthesis-loading">
        Loading synthesis...
      </p>
    );
  }

  if (error) {
    return (
      <p className="mt-3 text-xs text-amber-700" data-testid="topic-card-synthesis-error">
        Synthesis unavailable.
      </p>
    );
  }

  return (
    <p className="mt-3 text-sm leading-6 text-slate-700" data-testid="topic-card-summary">
      {synthesis?.facts_summary ?? fallback}
    </p>
  );
};

export const SynthesisSection: React.FC<TopicSynthesisSectionProps> = ({
  synthesis,
  loading,
  error,
  fallback,
}) => {
  if (loading) {
    return (
      <p className="mt-1 text-xs text-slate-400" data-testid="topic-card-synthesis-loading">
        Loading synthesis...
      </p>
    );
  }

  if (error) {
    return (
      <p className="mt-1 text-xs text-red-400" data-testid="topic-card-synthesis-error">
        Synthesis unavailable. Conversation remains open below.
      </p>
    );
  }

  if (synthesis) {
    return (
      <div className="space-y-2">
        <p className="text-sm leading-6 text-slate-700" data-testid="topic-card-synthesis-facts">
          {synthesis.facts_summary}
        </p>
        {synthesis.warnings.length > 0 && (
          <div
            className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
            data-testid="synthesis-warnings"
          >
            {synthesis.warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </div>
        )}
        {synthesis.divergence_metrics.disagreement_score > 0.5 && (
          <span
            className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
            data-testid="synthesis-divergence"
          >
            High divergence
          </span>
        )}
      </div>
    );
  }

  return (
    <p className="mt-1 text-sm leading-6 text-slate-700" data-testid="topic-card-synthesis-fallback">
      {fallback}
    </p>
  );
};
