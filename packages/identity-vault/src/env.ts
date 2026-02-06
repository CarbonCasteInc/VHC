/**
 * Environment guards for SSR/Node safety.
 * When these return false, vault functions become safe no-ops.
 */

/** Returns true if IndexedDB is available in the current environment. */
export function isIdbAvailable(): boolean {
  return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;
}

/** Returns true if SubtleCrypto is available in the current environment. */
export function isSubtleCryptoAvailable(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    globalThis.crypto !== null &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    globalThis.crypto.subtle !== null
  );
}

/** Returns true if the vault can operate (both IDB and SubtleCrypto available). */
export function isVaultAvailable(): boolean {
  return isIdbAvailable() && isSubtleCryptoAvailable();
}
