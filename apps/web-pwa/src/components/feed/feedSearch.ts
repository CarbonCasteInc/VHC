import { FILTER_CHIPS, SORT_MODES, type FilterChip, type SortMode } from '@vh/data-model';

const FILTER_VALUES = new Set<FilterChip>(FILTER_CHIPS);
const SORT_VALUES = new Set<SortMode>(SORT_MODES);

function normalizeSearchString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeSearchEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T | null {
  const normalized = normalizeSearchString(value);
  return normalized && allowed.has(normalized as T) ? (normalized as T) : null;
}

function toSearchRecord(search: unknown): Record<string, unknown> {
  return search && typeof search === 'object' ? { ...(search as Record<string, unknown>) } : {};
}

function stableSearchStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSearchStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSearchStringify(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function normalizeFeedFilterSearchValue(search: unknown): FilterChip | null {
  if (!search || typeof search !== 'object') {
    return null;
  }

  return normalizeSearchEnum((search as { feedFilter?: unknown }).feedFilter, FILTER_VALUES);
}

export function normalizeFeedSortSearchValue(search: unknown): SortMode | null {
  if (!search || typeof search !== 'object') {
    return null;
  }

  return normalizeSearchEnum((search as { feedSort?: unknown }).feedSort, SORT_VALUES);
}

export function normalizeFeedDetailSearchValue(search: unknown): string | null {
  if (!search || typeof search !== 'object') {
    return null;
  }

  return normalizeSearchString((search as { detail?: unknown }).detail);
}

export function normalizeStorylineSearchValue(search: unknown): string | null {
  if (!search || typeof search !== 'object') {
    return null;
  }

  return normalizeSearchString((search as { storyline?: unknown }).storyline);
}

export function normalizeStorySearchValue(search: unknown): string | null {
  if (!search || typeof search !== 'object') {
    return null;
  }

  return normalizeSearchString((search as { story?: unknown }).story);
}

export function buildFeedSearch(
  search: unknown,
  options: {
    readonly filter?: FilterChip | null;
    readonly sortMode?: SortMode | null;
    readonly detailId?: string | null;
    readonly selectedStorylineId?: string | null;
    readonly selectedStoryId?: string | null;
  },
): Record<string, unknown> {
  const nextSearch = toSearchRecord(search);

  if (options.filter && options.filter !== 'ALL') {
    nextSearch.feedFilter = options.filter;
  } else {
    delete nextSearch.feedFilter;
  }

  if (options.sortMode && options.sortMode !== 'LATEST') {
    nextSearch.feedSort = options.sortMode;
  } else {
    delete nextSearch.feedSort;
  }

  if (options.detailId) {
    nextSearch.detail = options.detailId;
  } else {
    delete nextSearch.detail;
  }

  if (options.selectedStorylineId) {
    nextSearch.storyline = options.selectedStorylineId;
    if (options.selectedStoryId) {
      nextSearch.story = options.selectedStoryId;
    } else {
      delete nextSearch.story;
    }
    return nextSearch;
  }

  delete nextSearch.storyline;
  delete nextSearch.story;
  return nextSearch;
}

export function areSearchValuesEqual(left: unknown, right: unknown): boolean {
  return stableSearchStringify(left) === stableSearchStringify(right);
}
