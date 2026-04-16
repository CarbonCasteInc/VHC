import React, { useCallback } from 'react';
import { FILTER_CHIPS, type FilterChip } from '@vh/data-model';

/**
 * Filter chip labels for display.
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §2
 */
const CHIP_LABELS: Record<FilterChip, string> = {
  ALL: 'All',
  NEWS: 'News',
  TOPICS: 'Topics',
  SOCIAL: 'Social',
  ARTICLES: 'Articles',
};

export interface FilterChipsProps {
  /** Currently active filter chip. */
  readonly active: FilterChip;
  /** Called when a chip is clicked. */
  readonly onSelect: (chip: FilterChip) => void;
}

/**
 * Horizontal chip bar for filtering the discovery feed by kind.
 * Renders one chip per FILTER_CHIPS value; highlights the active chip.
 *
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §2
 */
export const FilterChips: React.FC<FilterChipsProps> = ({ active, onSelect }) => {
  return (
    <div
      className="flex max-w-full flex-nowrap gap-1.5 overflow-x-auto rounded-full bg-slate-100/90 p-1 dark:bg-slate-900/80"
      role="group"
      aria-label="Feed filter"
      data-testid="filter-chips"
    >
      {FILTER_CHIPS.map((chip) => (
        <FilterChipButton
          key={chip}
          chip={chip}
          label={CHIP_LABELS[chip]}
          isActive={chip === active}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};

// ---- Internal chip button ----

interface FilterChipButtonProps {
  readonly chip: FilterChip;
  readonly label: string;
  readonly isActive: boolean;
  readonly onSelect: (chip: FilterChip) => void;
}

const FilterChipButton: React.FC<FilterChipButtonProps> = ({
  chip,
  label,
  isActive,
  onSelect,
}) => {
  const handleClick = useCallback(() => {
    onSelect(chip);
  }, [chip, onSelect]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={isActive}
      data-testid={`filter-chip-${chip}`}
      className={
        isActive
          ? 'shrink-0 rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm dark:border-white dark:bg-white dark:text-slate-900'
          : 'shrink-0 rounded-full border border-transparent bg-transparent px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-200 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white'
      }
    >
      {label}
    </button>
  );
};

export default FilterChips;
