/**
 * Opaque vault blob — the vault encrypts any JSON-serializable object.
 * Shape validation is the consumer's responsibility.
 */
export type Identity = Record<string, unknown>;

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

/**
 * Runtime shape check for vault-stored objects.
 * Accepts any non-null, non-array object — the vault encrypts opaque blobs;
 * detailed shape validation belongs to the consumer.
 */
export function isValidIdentity(value: unknown): value is Identity {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
