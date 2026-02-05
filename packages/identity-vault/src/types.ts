/**
 * Minimum identity shape. Extra fields MUST survive round-trip.
 */
export interface Identity {
  displayName: string;
  pub: string;
  priv: string;
  [extra: string]: unknown;
}

/**
 * Record stored in IndexedDB "vault" object store.
 */
export interface VaultRecord {
  version: number;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

/** Database name for the identity vault. */
export const DB_NAME = 'vh-vault';

/** Object store for encrypted identity blobs. */
export const VAULT_STORE = 'vault';

/** Object store for CryptoKeys. */
export const KEYS_STORE = 'keys';

/** Key under which the identity record is stored. */
export const IDENTITY_KEY = 'identity';

/** Key under which the master CryptoKey is stored. */
export const MASTER_KEY = 'master';

/** Current vault record version. */
export const VAULT_VERSION = 1;

/** Legacy localStorage key consumed during migration. */
export const LEGACY_STORAGE_KEY = 'vh_identity';

/** Runtime shape check for Identity objects. */
export function isValidIdentity(value: unknown): value is Identity {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.displayName === 'string' &&
    typeof obj.pub === 'string' &&
    typeof obj.priv === 'string'
  );
}
