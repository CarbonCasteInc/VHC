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
  isOperatorAuthorizationTokenCompartment,
  isSignInSessionCompartment,
  isWalletBindingCompartment,
  OPERATOR_AUTHORIZATION_TOKEN_COMPARTMENT_KEYS,
  SIGN_IN_SESSION_COMPARTMENT_KEYS,
  stripToKnownKeys,
  VAULT_V2_CLOSED_COMPARTMENT_KEY_SETS,
  VAULT_V2_KNOWN_TOP_LEVEL_KEYS,
  WALLET_BINDING_COMPARTMENT_KEYS,
} from './types';
import type {
  DeviceCredentialCompartment,
  Identity,
  OperatorAuthorizationTokenCompartment,
  SeaDevicePairCompartment,
  SignInSessionCompartment,
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
    // Forward-compat salvage: a shape-invalid v2 record (most commonly a
    // NEWER bundle added a compartment field this bundle does not know) must
    // NEVER destroy the vault — deleting here would wipe unrecoverable key
    // material (seaDevicePair, deviceCredential) because the whole vault is
    // one encrypted blob. Unknown keys are stripped from the returned view
    // only; invalid compartments are dropped from the view; this READ path
    // never rewrites the stored record. idbDelete stays reserved for decrypt
    // and JSON-parse failures (genuine tamper/key mismatch) above.
    //
    // Old-tab WRITES no longer erase newer-bundle data: saveVaultV2ToDb merges
    // unknown top-level compartments and unknown closed-compartment fields
    // forward from the authenticated stored record (see
    // preserveForwardCompatData), so a bundle that does not know a newer field
    // preserves rather than drops it.
    return salvageVaultV2(parsed);
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPreservableForwardCompatKey(key: string): boolean {
  return key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
}

/**
 * Read the RAW decrypted stored v2 vault object (unsalvaged, unnormalized) so the
 * write path can preserve newer-bundle data this bundle does not own. Unlike the
 * salvaged read view, this keeps unknown fields inside closed compartments
 * intact. Returns null when no v2 record exists. Genuine tamper/decrypt failures
 * still delete via decryptVaultRecord (unchanged); the write then proceeds fresh.
 */
async function loadRawStoredVaultV2ForMerge(db: IDBDatabase): Promise<Record<string, unknown> | null> {
  const record = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
  if (!record || record.version !== VAULT_VERSION) {
    return null;
  }
  const parsed = await decryptVaultRecord(db, record);
  if (!isValidIdentity(parsed) || (parsed as { schemaVersion?: unknown }).schemaVersion !== VAULT_VERSION) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Preserve forward-compat data from the authenticated stored vault when writing.
 * normalizeVaultV2 (called first) rebuilt `normalized` from THIS bundle's known
 * keys, dropping unknown top-level compartments and (via the closed-key-set
 * validators) unknown fields inside walletBinding/operatorAuthorizationToken/
 * signInSession. Without this merge, an old-bundle write would erase a newer
 * bundle's compartment/field at rest. This re-attaches such newer-bundle data —
 * but ONLY from `storedRaw` (the already-decrypted, self-authored encrypted
 * store), NEVER from the write caller's input, and only OUTSIDE this bundle's
 * owned key set. JS object/prototype magic keys are deliberately not preserved.
 * Current-bundle-owned fields always win the merge, so strict validation is
 * never bypassed and the write caller cannot smuggle in keys that were not
 * already present in the authenticated stored record.
 *
 * Caveat: a modified closed compartment re-pairs this bundle's fresh owned fields
 * with the stored newer-bundle field; if that field was semantically tied to the
 * prior compartment state it may be stale until the newer bundle rewrites it.
 * Preserving is preferred over dropping (which would be unrecoverable data loss).
 */
function preserveForwardCompatData(
  normalized: VaultV2,
  storedRaw: Record<string, unknown> | null
): VaultV2 {
  if (!storedRaw) {
    return normalized;
  }
  const result: Record<string, unknown> = { ...normalized };

  // (1) Re-attach unknown newer-bundle top-level compartments. normalizeVaultV2
  // rebuilt `result` from this bundle's known keys, so any stored key outside
  // that set is a newer-bundle compartment; the caller cannot smuggle one in
  // (it is dropped there too), so this only ever restores stored data.
  for (const [key, storedValue] of Object.entries(storedRaw)) {
    if (VAULT_V2_KNOWN_TOP_LEVEL_KEYS.has(key) || !isPreservableForwardCompatKey(key)) {
      continue;
    }
    result[key] = storedValue;
  }

  // (2) Re-attach unknown future FIELDS inside closed-key-set compartments the
  // current write also touches. The strict validators reject unknown keys, so
  // normalizeVaultV2 stripped them; restore them from the stored record only,
  // with current-owned fields winning the merge.
  for (const [compartmentKey, ownedKeys] of VAULT_V2_CLOSED_COMPARTMENT_KEY_SETS) {
    const written = result[compartmentKey];
    const stored = storedRaw[compartmentKey];
    if (!isPlainObject(written)) {
      continue;
    }
    if (!isPlainObject(stored)) {
      continue;
    }
    const foreign: Record<string, unknown> = {};
    for (const [fieldKey, fieldValue] of Object.entries(stored)) {
      if (!ownedKeys.has(fieldKey) && isPreservableForwardCompatKey(fieldKey)) {
        foreign[fieldKey] = fieldValue;
      }
    }
    if (Object.keys(foreign).length > 0) {
      result[compartmentKey] = { ...foreign, ...written };
    }
  }

  // The untyped map carries preserved newer-bundle keys that are intentionally
  // outside the VaultV2 type; every current-bundle-owned field was validated by
  // normalizeVaultV2 before the merge.
  return result as unknown as VaultV2;
}

async function saveVaultV2ToDb(db: IDBDatabase, vault: VaultV2): Promise<void> {
  const key = await ensureMasterKey(db);
  const normalized = normalizeVaultV2(vault);
  const storedRaw = await loadRawStoredVaultV2ForMerge(db);
  const plaintext = encoder.encode(JSON.stringify(preserveForwardCompatData(normalized, storedRaw)));
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

/**
 * Strip unknown keys from a closed-key-set compartment, then re-validate.
 * Returns the stripped compartment when it validates, or null when the
 * compartment is unsalvageable (dropped from the read view only).
 */
function salvageClosedCompartment(
  value: unknown,
  knownKeys: ReadonlySet<string>,
  isValid: (candidate: unknown) => boolean
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const stripped = stripToKnownKeys(value, knownKeys) as Record<string, unknown>;
  return isValid(stripped) ? stripped : null;
}

/**
 * Tolerant read-side reconstruction of a v2 vault (never deletes, never
 * persists):
 *  - non-object payloads / wrong schemaVersion -> null (fail-closed read,
 *    stored record retained);
 *  - identityRecord kept only when object-shaped;
 *  - the three closed-key-set compartments are stripped to their known keys
 *    and re-validated (a newer bundle's extra field degrades to "ignored by
 *    this tab" instead of vault destruction); invalid-after-strip
 *    compartments are dropped from the view;
 *  - every other truthy entry passes through: the
 *    deviceCredential/seaDevicePair/delegationSigningKey compartments (their
 *    strict validation lives in their compartment accessors, mirroring
 *    normalizeVaultV2) and any unknown top-level compartment from a newer
 *    bundle, which is preserved in the read view (and, on save, re-attached
 *    from the authenticated stored record by preserveForwardCompatData rather
 *    than dropped).
 * Write-side strictness is unchanged: normalizeVaultV2 keeps throwing on
 * invalid compartments; the write-path merge only re-attaches unknown data that
 * was already present in the decrypted stored record, never caller input.
 */
function salvageVaultV2(parsed: unknown): VaultV2 | null {
  if (
    !isValidIdentity(parsed)
    || (parsed as { schemaVersion?: unknown }).schemaVersion !== VAULT_VERSION
  ) {
    return null;
  }

  const source = parsed as Record<string, unknown>;
  const vault: Record<string, unknown> = { schemaVersion: VAULT_VERSION };
  for (const [key, value] of Object.entries(source)) {
    if (key === 'schemaVersion') continue;
    if (key === 'identityRecord') {
      if (isValidIdentity(value)) {
        vault.identityRecord = value;
      }
      continue;
    }
    if (key === 'walletBinding') {
      const salvaged = salvageClosedCompartment(
        value,
        WALLET_BINDING_COMPARTMENT_KEYS,
        isWalletBindingCompartment
      );
      if (salvaged) {
        vault.walletBinding = salvaged;
      }
      continue;
    }
    if (key === 'operatorAuthorizationToken') {
      const salvaged = salvageClosedCompartment(
        value,
        OPERATOR_AUTHORIZATION_TOKEN_COMPARTMENT_KEYS,
        isOperatorAuthorizationTokenCompartment
      );
      if (salvaged) {
        vault.operatorAuthorizationToken = salvaged;
      }
      continue;
    }
    if (key === 'signInSession') {
      const salvaged = salvageClosedCompartment(
        value,
        SIGN_IN_SESSION_COMPARTMENT_KEYS,
        isSignInSessionCompartment
      );
      if (salvaged) {
        vault.signInSession = salvaged;
      }
      continue;
    }
    if (value) {
      vault[key] = value;
    }
  }

  // The narrow compartments were validated above; the untyped map only
  // exists so unknown newer-bundle compartments survive into the read view.
  return vault as unknown as VaultV2;
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
  const operatorAuthorizationToken = vault.operatorAuthorizationToken;
  if (
    operatorAuthorizationToken !== undefined
    && !isOperatorAuthorizationTokenCompartment(operatorAuthorizationToken)
  ) {
    throw new Error('Invalid v2 operatorAuthorizationToken compartment');
  }
  const signInSession = vault.signInSession;
  if (signInSession !== undefined && !isSignInSessionCompartment(signInSession)) {
    throw new Error('Invalid v2 signInSession compartment');
  }

  return {
    schemaVersion: VAULT_VERSION,
    ...(identityRecord !== undefined ? { identityRecord } : {}),
    ...(vault.deviceCredential ? { deviceCredential: vault.deviceCredential } : {}),
    ...(vault.seaDevicePair ? { seaDevicePair: vault.seaDevicePair } : {}),
    ...(vault.delegationSigningKey ? { delegationSigningKey: vault.delegationSigningKey } : {}),
    ...(walletBinding ? { walletBinding: walletBinding as WalletBindingCompartment } : {}),
    ...(operatorAuthorizationToken
      ? { operatorAuthorizationToken: operatorAuthorizationToken as OperatorAuthorizationTokenCompartment }
      : {}),
    ...(signInSession ? { signInSession: signInSession as SignInSessionCompartment } : {})
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
