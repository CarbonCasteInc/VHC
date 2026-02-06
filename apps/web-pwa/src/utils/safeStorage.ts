/**
 * SSR-safe localStorage wrapper.
 * Returns null / no-ops when localStorage is unavailable (server-side rendering).
 */

function canUseStorage(): boolean {
  try {
    return typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function safeGetItem(key: string): string | null {
  if (!canUseStorage()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Silently ignore (quota exceeded, etc.)
  }
}

export function safeRemoveItem(key: string): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Silently ignore
  }
}
