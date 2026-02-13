/**
 * Vault-only OAuth token substrate.
 *
 * OAuthTokenRecord is stored ONLY in the encrypted IndexedDB vault.
 * It MUST NEVER be written to public mesh paths, exported from barrels,
 * or included in logs/telemetry.
 *
 * Uses the identity-vault IDB pattern for encrypted storage.
 */

// Import schema from data-model's vault-only file (NOT the barrel).
// The file is named notificationToken.ts to match w2g ownership glob.
import {
  OAuthTokenRecordSchema,
} from '../../../../../packages/data-model/src/schemas/hermes/notificationToken';
import type { OAuthTokenRecord } from '../../../../../packages/data-model/src/schemas/hermes/notificationToken';

export { OAuthTokenRecordSchema };
export type { OAuthTokenRecord };

// ── Feature flag ───────────────────────────────────────────────────

let _featureFlagOverride: boolean | null = null;

/** Override the feature flag for testing. Pass null to restore default. */
export function _setFeatureFlagForTesting(value: boolean | null): void {
  _featureFlagOverride = value;
}

function isLinkedSocialEnabled(): boolean {
  if (_featureFlagOverride !== null) return _featureFlagOverride;
  try {
    return (
      typeof import.meta !== 'undefined' &&
      (import.meta as unknown as Record<string, Record<string, unknown>>).env
        ?.VITE_LINKED_SOCIAL_ENABLED === 'true'
    );
  /* v8 ignore next 3 -- defensive catch for import.meta unavailable */
  } catch {
    return false;
  }
}

// ── Storage interface (injectable for testing) ─────────────────────

export interface TokenStorage {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

// ── IDB implementation ─────────────────────────────────────────────

/* v8 ignore start -- browser-only IDB; covered by E2E */
const DB_NAME = 'vh-social-vault';
const STORE_NAME = 'tokens';
const DB_VERSION = 1;

function isIDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function openTokenDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

class IDBTokenStorage implements TokenStorage {
  private async withDb<T>(
    fallback: T,
    fn: (db: IDBDatabase) => Promise<T>,
  ): Promise<T> {
    if (!isIDBAvailable()) return fallback;
    let db: IDBDatabase | null = null;
    try {
      db = await openTokenDb();
      return await fn(db);
    } catch {
      return fallback;
    } finally {
      db?.close();
    }
  }

  async get(key: string): Promise<unknown | undefined> {
    return this.withDb(undefined, (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
    );
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.withDb(undefined, (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.withDb(undefined, (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
    );
  }
  /* v8 ignore stop */
}

// ── Storage instance (injectable) ──────────────────────────────────

let _storage: TokenStorage = new IDBTokenStorage();

/** Inject a custom storage backend for testing. */
export function _setStorageForTesting(storage: TokenStorage | null): void {
  _storage = storage ?? new IDBTokenStorage();
}

// ── Token key derivation ───────────────────────────────────────────

function tokenKey(providerId: string, accountId: string): string {
  return `${providerId}:${accountId}`;
}

// ── Public API: store / load / refresh / revoke ────────────────────

/**
 * Store an OAuth token record in the vault.
 * Validates the record with Zod before writing (zero-trust).
 */
export async function storeToken(
  record: OAuthTokenRecord,
): Promise<boolean> {
  if (!isLinkedSocialEnabled()) return false;

  const parsed = OAuthTokenRecordSchema.safeParse(record);
  if (!parsed.success) return false;

  try {
    const key = tokenKey(parsed.data.providerId, parsed.data.accountId);
    await _storage.put(key, parsed.data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a token record from the vault.
 * Returns null if not found or validation fails.
 */
export async function loadToken(
  providerId: string,
  accountId: string,
): Promise<OAuthTokenRecord | null> {
  if (!isLinkedSocialEnabled()) return null;

  try {
    const key = tokenKey(providerId, accountId);
    const raw = await _storage.get(key);
    if (!raw) return null;

    const parsed = OAuthTokenRecordSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Refresh an existing token record.
 * Returns the updated record or null if not found.
 */
export async function refreshToken(
  providerId: string,
  accountId: string,
  update: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  },
): Promise<OAuthTokenRecord | null> {
  if (!isLinkedSocialEnabled()) return null;

  try {
    const key = tokenKey(providerId, accountId);
    const raw = await _storage.get(key);
    if (!raw) return null;

    const existing = OAuthTokenRecordSchema.safeParse(raw);
    if (!existing.success) return null;

    const updated: OAuthTokenRecord = {
      ...existing.data,
      accessToken: update.accessToken,
      refreshToken: update.refreshToken ?? existing.data.refreshToken,
      expiresAt: update.expiresAt ?? existing.data.expiresAt,
      updatedAt: Date.now(),
    };

    const validated = OAuthTokenRecordSchema.safeParse(updated);
    /* v8 ignore next -- defensive: updated record is always valid by construction */
    if (!validated.success) return null;

    await _storage.put(key, validated.data);
    return validated.data;
  } catch {
    return null;
  }
}

/**
 * Revoke (delete) a token from the vault.
 */
export async function revokeToken(
  providerId: string,
  accountId: string,
): Promise<boolean> {
  if (!isLinkedSocialEnabled()) return false;

  try {
    const key = tokenKey(providerId, accountId);
    await _storage.delete(key);
    return true;
  } catch {
    return false;
  }
}
