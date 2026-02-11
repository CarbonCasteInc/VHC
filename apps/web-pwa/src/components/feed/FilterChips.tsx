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
      className="flex gap-2"
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
          ? 'rounded-full bg-blue-600 px-3 py-1 text-sm font-medium text-white'
          : 'rounded-full bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700'
      }
    >
      {label}
    </button>
  );
};

export default FilterChips;
