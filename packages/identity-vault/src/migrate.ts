/**
 * Legacy localStorage → encrypted vault migration.
 */

import { isVaultAvailable } from './env';
import { LEGACY_STORAGE_KEY, isValidIdentity } from './types';
import type { Identity } from './types';
import { saveIdentity } from './vault';

/**
 * Migrate identity from plaintext localStorage to the encrypted vault.
 *
 * - "noop": no legacy entry found (or vault unavailable)
 * - "migrated": successfully migrated and removed legacy entry
 * - "invalid": legacy entry exists but is not valid JSON / not a valid identity
 */
export async function migrateLegacyLocalStorage(): Promise<'noop' | 'migrated' | 'invalid'> {
  // If vault is unavailable, don't destroy source data
  if (!isVaultAvailable()) {
    return 'noop';
  }

  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY) ?? null;
  } catch {
    return 'noop';
  }

  if (raw === null) {
    return 'noop';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalid';
  }

  if (!isValidIdentity(parsed)) {
    return 'invalid';
  }

  await saveIdentity(parsed as Identity);

  try {
    globalThis.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Best-effort removal
  }

  return 'migrated';
}
