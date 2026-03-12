function normalizeSearchString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
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

export function buildStorylineSearch(
  search: unknown,
  selectedStorylineId: string | null,
  selectedStoryId: string | null = null,
): Record<string, unknown> {
  const nextSearch =
    search && typeof search === 'object' ? { ...(search as Record<string, unknown>) } : {};

  if (selectedStorylineId) {
    nextSearch.storyline = selectedStorylineId;
    if (selectedStoryId) {
      nextSearch.story = selectedStoryId;
    } else {
      delete nextSearch.story;
    }
    return nextSearch;
  }

  delete nextSearch.storyline;
  delete nextSearch.story;
  return nextSearch;
}

export const storylineSearchInternal = {
  buildStorylineSearch,
  normalizeStorySearchValue,
  normalizeStorylineSearchValue,
};
