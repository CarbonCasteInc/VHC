import React, { useCallback } from 'react';
import { SORT_MODES, type SortMode } from '@vh/data-model';

/**
 * Sort mode labels for display.
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §2
 */
const SORT_LABELS: Record<SortMode, string> = {
  LATEST: 'Latest',
  HOTTEST: 'Hottest',
  MY_ACTIVITY: 'My Activity',
};

export interface SortControlsProps {
  /** Currently active sort mode. */
  readonly active: SortMode;
  /** Called when a sort mode is selected. */
  readonly onSelect: (mode: SortMode) => void;
}

/**
 * Sort mode selector for the discovery feed.
 * Renders one button per SORT_MODES value; highlights the active mode.
 *
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §2
 */
export const SortControls: React.FC<SortControlsProps> = ({
  active,
  onSelect,
}) => {
  return (
    <div
      className="flex gap-2"
      role="group"
      aria-label="Feed sort"
      data-testid="sort-controls"
    >
      {SORT_MODES.map((mode) => (
        <SortButton
          key={mode}
          mode={mode}
          label={SORT_LABELS[mode]}
          isActive={mode === active}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};

// ---- Internal sort button ----

interface SortButtonProps {
  readonly mode: SortMode;
  readonly label: string;
  readonly isActive: boolean;
  readonly onSelect: (mode: SortMode) => void;
}

const SortButton: React.FC<SortButtonProps> = ({
  mode,
  label,
  isActive,
  onSelect,
}) => {
  const handleClick = useCallback(() => {
    onSelect(mode);
  }, [mode, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={isActive}
      data-testid={`sort-mode-${mode}`}
      className={
        isActive
          ? 'rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white'
          : 'rounded bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700'
      }
    >
      {label}
    </button>
  );
};

export default SortControls;
