/**
 * SubtleCrypto wrappers for the identity vault.
 * Uses AES-GCM with a non-extractable CryptoKey stored in IndexedDB.
 */

const AES_ALGO = 'AES-GCM';
const AES_KEY_LENGTH = 256;
const IV_BYTES = 12;

/** Generate a new AES-GCM master key (non-extractable). */
export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: AES_ALGO, length: AES_KEY_LENGTH },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}

/** Encrypt plaintext bytes with AES-GCM. Returns fresh IV + ciphertext. */
export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<{ iv: Uint8Array; ciphertext: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGO, iv: iv as BufferSource },
    key,
    plaintext as BufferSource
  );
  return { iv, ciphertext };
}

/** Decrypt AES-GCM ciphertext. Returns plaintext bytes or null on failure. */
export async function decrypt(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: ArrayBuffer
): Promise<Uint8Array | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: AES_ALGO, iv: iv as BufferSource },
      key,
      ciphertext
    );
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}
