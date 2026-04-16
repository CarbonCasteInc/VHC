export function getBootSearchSnapshot(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const snapshot = (window as Window & { __VH_BOOT_SEARCH__?: string }).__VH_BOOT_SEARCH__;
  if (typeof snapshot !== 'string') {
    return null;
  }

  const normalized = snapshot.trim();
  return normalized ? normalized : null;
}

export function clearBootSearchSnapshot(): void {
  if (typeof window === 'undefined') {
    return;
  }

  delete (window as Window & { __VH_BOOT_SEARCH__?: string }).__VH_BOOT_SEARCH__;
}

export function readCurrentSearch(locationSearch: unknown): Record<string, unknown> {
  const search =
    locationSearch && typeof locationSearch === 'object'
      ? { ...(locationSearch as Record<string, unknown>) }
      : {};

  if (typeof window === 'undefined') {
    return search;
  }

  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of params.entries()) {
    search[key] = value;
  }

  return search;
}

export function buildSearchHref(pathname: string, search: Record<string, unknown>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, String(entry));
      }
      continue;
    }

    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
