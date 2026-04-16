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
      className="flex max-w-full flex-nowrap gap-1.5 overflow-x-auto rounded-full bg-slate-100/90 p-1 dark:bg-slate-900/80"
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
          ? 'shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white'
          : 'shrink-0 rounded-full border border-transparent bg-transparent px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-200 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white'
      }
    >
      {label}
    </button>
  );
};

export default SortControls;
