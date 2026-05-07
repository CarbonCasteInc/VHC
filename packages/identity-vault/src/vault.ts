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
  LEGACY_VAULT_VERSION,
  isValidIdentity,
  isVaultV2,
  isWalletBindingCompartment,
} from './types';
import type {
  DeviceCredentialCompartment,
  Identity,
  SeaDevicePairCompartment,
  VaultRecord,
  VaultV2,
  WalletBindingCompartment
} from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Retrieve the master CryptoKey, or null if none exists.
 */
async function getMasterKey(db: IDBDatabase): Promise<CryptoKey | null> {
  const key = await idbGet<CryptoKey>(db, KEYS_STORE, MASTER_KEY);
  return key ?? null;
}

/** Attempt to add the master key only if absent (IDB add is insert-only). */
async function addMasterKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEYS_STORE, 'readwrite');
    const store = tx.objectStore(KEYS_STORE);
    const request = store.add(key, MASTER_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function isConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'ConstraintError'
  );
}

/**
 * Ensure a master CryptoKey exists; create one if needed.
 *
 * Uses insert-only semantics to avoid TOCTOU races across tabs.
 */
async function ensureMasterKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await getMasterKey(db);
  if (existing) return existing;

  const candidate = await generateMasterKey();

  try {
    await addMasterKey(db, candidate);
    return candidate;
  } catch (error) {
    if (!isConstraintError(error)) throw error;

    const raced = await getMasterKey(db);
    if (raced) return raced;
    throw error;
  }
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
    const vault = await loadVaultV2FromDb(db);
    return vault?.identityRecord ?? null;
  });
}

/**
 * Encrypt and save an identity to the vault.
 * Creates the master key lazily if needed.
 */
export async function saveIdentity(identity: Identity): Promise<void> {
  if (!isVaultAvailable()) return;

  return withDb(undefined, async (db) => {
    const existing = await loadVaultV2FromDb(db);
    const next = mergeIdentityIntoVault(existing ?? emptyVaultV2(), identity);
    await saveVaultV2ToDb(db, next);
  });
}

/**
 * Remove the identity/session compartment from the vault (keeps the master key
 * and stable v2 key compartments).
 */
export async function clearIdentity(): Promise<void> {
  if (!isVaultAvailable()) return;

  return withDb(undefined, async (db) => {
    const vault = await loadVaultV2FromDb(db);
    if (!vault) return;

    const { identityRecord: _identityRecord, ...stableCompartments } = vault;
    await saveVaultV2ToDb(db, stableCompartments);
  });
}

export async function loadVaultV2(): Promise<VaultV2 | null> {
  if (!isVaultAvailable()) return null;

  return withDb(null, async (db) => loadVaultV2FromDb(db));
}

export async function saveVaultV2(vault: VaultV2): Promise<void> {
  if (!isVaultAvailable()) return;

  return withDb(undefined, async (db) => {
    await saveVaultV2ToDb(db, normalizeVaultV2(vault));
  });
}

export async function updateVaultV2(mutator: (vault: VaultV2) => VaultV2): Promise<VaultV2 | null> {
  if (!isVaultAvailable()) return null;

  return withDb(null, async (db) => {
    const current = await loadVaultV2FromDb(db) ?? emptyVaultV2();
    const next = normalizeVaultV2(mutator(current));
    await saveVaultV2ToDb(db, next);
    return next;
  });
}

function emptyVaultV2(): VaultV2 {
  return { schemaVersion: VAULT_VERSION };
}

async function loadVaultV2FromDb(db: IDBDatabase): Promise<VaultV2 | null> {
  const record = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
  if (!record) return null;

  const parsed = await decryptVaultRecord(db, record);
  if (!parsed) return null;

  if (record.version === VAULT_VERSION) {
    if (!isVaultV2(parsed)) {
      await idbDelete(db, VAULT_STORE, IDENTITY_KEY).catch(() => {});
      return null;
    }
    return normalizeVaultV2(parsed);
  }

  if (record.version === LEGACY_VAULT_VERSION) {
    if (!isValidIdentity(parsed)) {
      await idbDelete(db, VAULT_STORE, IDENTITY_KEY).catch(() => {});
      return null;
    }

    const migrated = migrateIdentityToVaultV2(parsed);
    await saveVaultV2ToDb(db, migrated);
    return migrated;
  }

  return null;
}

async function decryptVaultRecord(
  db: IDBDatabase,
  record: VaultRecord
): Promise<unknown | null> {
  const key = await getMasterKey(db);
  if (!key) return null;

  const plaintext = await decrypt(key, record.iv, record.ciphertext);
  if (!plaintext) {
    await idbDelete(db, VAULT_STORE, IDENTITY_KEY).catch(() => {});
    return null;
  }

  try {
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    await idbDelete(db, VAULT_STORE, IDENTITY_KEY).catch(() => {});
    return null;
  }
}

async function saveVaultV2ToDb(db: IDBDatabase, vault: VaultV2): Promise<void> {
  const key = await ensureMasterKey(db);
  const plaintext = encoder.encode(JSON.stringify(normalizeVaultV2(vault)));
  const { iv, ciphertext } = await encrypt(key, plaintext);

  const record: VaultRecord = {
    version: VAULT_VERSION,
    iv,
    ciphertext,
  };

  await idbPut(db, VAULT_STORE, IDENTITY_KEY, record);
}

function mergeIdentityIntoVault(vault: VaultV2, identity: Identity): VaultV2 {
  return normalizeVaultV2({
    ...vault,
    identityRecord: identity,
    deviceCredential: vault.deviceCredential ?? legacyDeviceCredential(identity),
    seaDevicePair: vault.seaDevicePair ?? legacySeaDevicePair(identity)
  });
}

function migrateIdentityToVaultV2(identity: Identity): VaultV2 {
  return normalizeVaultV2({
    ...emptyVaultV2(),
    identityRecord: identity,
    deviceCredential: legacyDeviceCredential(identity),
    seaDevicePair: legacySeaDevicePair(identity)
  });
}

function normalizeVaultV2(vault: VaultV2): VaultV2 {
  const identityRecord = vault.identityRecord;
  if (identityRecord !== undefined && !isValidIdentity(identityRecord)) {
    throw new Error('Invalid v2 identityRecord compartment');
  }
  const walletBinding = vault.walletBinding;
  if (walletBinding !== undefined && !isWalletBindingCompartment(walletBinding)) {
    throw new Error('Invalid v2 walletBinding compartment');
  }

  return {
    schemaVersion: VAULT_VERSION,
    ...(identityRecord !== undefined ? { identityRecord } : {}),
    ...(vault.deviceCredential ? { deviceCredential: vault.deviceCredential } : {}),
    ...(vault.seaDevicePair ? { seaDevicePair: vault.seaDevicePair } : {}),
    ...(vault.delegationSigningKey ? { delegationSigningKey: vault.delegationSigningKey } : {}),
    ...(walletBinding ? { walletBinding: walletBinding as WalletBindingCompartment } : {})
  };
}

function legacyDeviceCredential(identity: Identity): DeviceCredentialCompartment | undefined {
  const attestation = identity.attestation;
  if (!isValidIdentity(attestation)) return undefined;

  const material = attestation.deviceKey;
  if (typeof material !== 'string' || material.length === 0) return undefined;

  return {
    schemaVersion: 1,
    material,
    createdAt: createdAtFromIdentity(identity),
    source: 'legacy-v1'
  };
}

function legacySeaDevicePair(identity: Identity): SeaDevicePairCompartment | undefined {
  const pair = identity.devicePair;
  if (!isValidIdentity(pair)) return undefined;

  const { pub, priv, epub, epriv } = pair;
  if (
    typeof pub !== 'string'
    || typeof priv !== 'string'
    || typeof epub !== 'string'
    || typeof epriv !== 'string'
    || pub.length === 0
    || priv.length === 0
    || epub.length === 0
    || epriv.length === 0
  ) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    pub,
    priv,
    epub,
    epriv,
    createdAt: createdAtFromIdentity(identity)
  };
}

function createdAtFromIdentity(identity: Identity): number {
  return typeof identity.createdAt === 'number' && Number.isSafeInteger(identity.createdAt)
    ? identity.createdAt
    : Date.now();
}
