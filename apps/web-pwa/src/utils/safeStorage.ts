/* eslint-disable no-restricted-globals */
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

/**
 * Write to localStorage. Returns `true` when the value was written, `false`
 * when storage is unavailable or the write failed (quota exceeded, disabled
 * storage, private-mode restrictions). Callers that need durability (e.g. the
 * vote-intent queue) inspect the result so a failed write surfaces instead of
 * being silently dropped; callers that treat storage as best-effort can ignore
 * it.
 */
export function safeSetItem(key: string, value: string): boolean {
  if (!canUseStorage()) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // Quota exceeded, disabled/blocked storage, etc.
    return false;
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
