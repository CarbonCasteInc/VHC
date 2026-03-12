import React from 'react';
import type { StorylineGroup } from '@vh/data-model';

export interface StorylineFocusPanelProps {
  readonly storyline: StorylineGroup;
  readonly visibleStoryCount: number;
  readonly onBack?: () => void;
  readonly onClear: () => void;
}

function formatStoryCount(count: number): string {
  return `${count} ${count === 1 ? 'story' : 'stories'}`;
}

export const StorylineFocusPanel: React.FC<StorylineFocusPanelProps> = ({
  storyline,
  visibleStoryCount,
  onBack,
  onClear,
}) => {
  return (
    <section
      data-testid={`storyline-focus-panel-${storyline.storyline_id}`}
      className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Storyline focus
          </p>
          <h2 className="text-sm font-semibold text-slate-900">{storyline.headline}</h2>
          <p
            className="text-xs text-slate-600"
            data-testid={`storyline-focus-count-${storyline.storyline_id}`}
          >
            Showing {formatStoryCount(visibleStoryCount)} from this storyline in the feed.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
              onClick={onBack}
              data-testid={`storyline-focus-back-${storyline.storyline_id}`}
            >
              ← Back
            </button>
          ) : null}
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
            onClick={onClear}
            data-testid={`storyline-focus-clear-${storyline.storyline_id}`}
          >
            Clear storyline
          </button>
        </div>
      </div>

      {storyline.related_coverage.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Related coverage
          </h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {storyline.related_coverage.map((entry) => (
              <li key={`${entry.source_id}|${entry.url}`}>
                <span className="font-medium text-slate-900">{entry.publisher}:</span>{' '}
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                >
                  {entry.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default StorylineFocusPanel;
