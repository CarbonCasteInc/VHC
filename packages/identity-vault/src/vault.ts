/**
 * Core vault operations: load, save, clear.
 */

import { isVaultAvailable } from './env';
import { openVaultDb, idbGet, idbPut, idbDelete } from './db';
import { generateMasterKey, encrypt, decrypt } from './crypto';
import {
  VAULT_STORE,
  KEYS_STORE,
  IDENTITY_KEY,
  MASTER_KEY,
  VAULT_VERSION,
  isValidIdentity,
} from './types';
import type { Identity, VaultRecord } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Retrieve the master CryptoKey, or null if none exists.
 */
async function getMasterKey(db: IDBDatabase): Promise<CryptoKey | null> {
  const key = await idbGet<CryptoKey>(db, KEYS_STORE, MASTER_KEY);
  return key ?? null;
}

/**
 * Ensure a master CryptoKey exists; create one if needed.
 */
async function ensureMasterKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await getMasterKey(db);
  if (existing) return existing;

  const key = await generateMasterKey();
  await idbPut(db, KEYS_STORE, MASTER_KEY, key);
  return key;
}

/** Open the vault DB, returning null on failure. */
async function tryOpenDb(): Promise<IDBDatabase | null> {
  try {
    return await openVaultDb();
  } catch {
    return null;
  }
}

/** Run a callback with an open DB, closing it afterward. */
async function withDb<T>(fallback: T, fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await tryOpenDb();
  if (!db) return fallback;
  try {
    return await fn(db);
  } catch {
    return fallback;
    /* v8 ignore next 2 -- v8 phantom branch on finally entry */
  } finally {
    db.close();
  }
}

/**
 * Load the encrypted identity from the vault.
 * Returns null if: no record, no key, decryption fails (tamper), or vault unavailable.
 */
export async function loadIdentity(): Promise<Identity | null> {
  if (!isVaultAvailable()) return null;

  return withDb(null, async (db) => {
    const record = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
    if (!record) return null;

    // M2: version gate — reject records from incompatible future versions
    if (record.version !== VAULT_VERSION) return null;

    const key = await getMasterKey(db);
    if (!key) return null;

    const plaintext = await decrypt(key, record.iv, record.ciphertext);
    if (!plaintext) {
      // Tamper detected — wipe corrupt record
      await idbDelete(db, VAULT_STORE, IDENTITY_KEY).catch(() => {});
      return null;
    }

    const json = decoder.decode(plaintext);
    const parsed: unknown = JSON.parse(json);

    // M1: runtime shape validation — zero-trust on stored data
    if (!isValidIdentity(parsed)) {
      await idbDelete(db, VAULT_STORE, IDENTITY_KEY).catch(() => {});
      return null;
    }

    return parsed;
  });
}

/**
 * Encrypt and save an identity to the vault.
 * Creates the master key lazily if needed.
 */
export async function saveIdentity(identity: Identity): Promise<void> {
  if (!isVaultAvailable()) return;

  return withDb(undefined, async (db) => {
    const key = await ensureMasterKey(db);
    const plaintext = encoder.encode(JSON.stringify(identity));
    const { iv, ciphertext } = await encrypt(key, plaintext);

    const record: VaultRecord = {
      version: VAULT_VERSION,
      iv,
      ciphertext,
    };

    await idbPut(db, VAULT_STORE, IDENTITY_KEY, record);
  });
}

/**
 * Remove the identity from the vault (keeps the master key).
 */
export async function clearIdentity(): Promise<void> {
  if (!isVaultAvailable()) return;

  return withDb(undefined, async (db) => {
    await idbDelete(db, VAULT_STORE, IDENTITY_KEY);
  });
}
