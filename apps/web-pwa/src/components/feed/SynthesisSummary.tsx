import React, { useState } from 'react';
import type { TopicSynthesisV2 } from '@vh/data-model';
import { DivergenceBadge } from './DivergenceBadge';

export interface SynthesisSummaryProps {
  /** Validated TopicSynthesisV2 payload. */
  readonly synthesis: TopicSynthesisV2;
}

/**
 * Compact inline synthesis summary for TopicCard enrichment.
 * Renders facts_summary and a collapsible frames section.
 *
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §3 (USER_TOPIC enrichment)
 */
export const SynthesisSummary: React.FC<SynthesisSummaryProps> = ({ synthesis }) => {
  const [framesExpanded, setFramesExpanded] = useState(false);
  const hasFrames = synthesis.frames.length > 0;
  const hasWarnings = synthesis.warnings.length > 0;

  return (
    <div className="mt-2 space-y-2" data-testid="synthesis-summary">
      {/* Facts summary */}
      <p className="text-sm text-slate-700" data-testid="synthesis-facts">
        {synthesis.facts_summary}
      </p>

      {/* Warnings (if any) */}
      {hasWarnings && (
        <div
          className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
          data-testid="synthesis-warnings"
        >
          {synthesis.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      {/* Frames (collapsible) */}
      {hasFrames && (
        <div data-testid="synthesis-frames-section">
          <button
            className="text-xs font-medium text-emerald-700 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setFramesExpanded((prev) => !prev);
            }}
            aria-expanded={framesExpanded}
            data-testid="synthesis-frames-toggle"
          >
            {framesExpanded
              ? '▾ Hide perspectives'
              : `▸ ${synthesis.frames.length} perspective${synthesis.frames.length === 1 ? '' : 's'}`}
          </button>

          {framesExpanded && (
            <ul className="mt-1 space-y-1" data-testid="synthesis-frames-list">
              {synthesis.frames.map((f, i) => (
                <li
                  key={i}
                  className="rounded border-l-2 border-emerald-300 bg-emerald-50/50 py-1 pl-2 text-xs"
                  data-testid={`synthesis-frame-${i}`}
                >
                  <span className="font-medium text-slate-700">{f.frame}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span className="text-slate-600">{f.reframe}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Divergence indicator */}
      <DivergenceBadge score={synthesis.divergence_metrics.disagreement_score} label="⚡ High divergence" />
    </div>
  );
};

export default SynthesisSummary;
