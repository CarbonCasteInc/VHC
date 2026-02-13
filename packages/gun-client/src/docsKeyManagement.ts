/**
 * Document key management for HERMES Docs (spec §4.1–§4.3).
 *
 * Provides deterministic key derivation for document owners,
 * ECDH-based key sharing with collaborators, and content
 * encryption/decryption for Yjs state snapshots.
 */

import SEA from 'gun/sea';

/** Minimal SEA key-pair shape for owner/device operations. */
export interface SEAPair {
  pub: string;
  priv: string;
  epub: string;
  epriv: string;
}

/**
 * Derive a deterministic document key from the document ID
 * and the owner's device key-pair (spec §4.1).
 *
 * Uses SEA.work (PBKDF2) with the docId as salt and
 * the owner pair as the key material.
 */
export async function deriveDocumentKey(
  docId: string,
  ownerDevicePair: SEAPair
): Promise<string> {
  const key = await SEA.work(docId, ownerDevicePair);
  if (!key) {
    throw new Error('Failed to derive document key');
  }
  return key;
}

/**
 * Encrypt the document key for a collaborator using ECDH (spec §4.2).
 *
 * The owner computes a shared secret with the collaborator's epub,
 * then encrypts the document key with that secret.
 */
export async function shareDocumentKey(
  documentKey: string,
  collaboratorEpub: string,
  ownerDevicePair: SEAPair
): Promise<string> {
  const sharedSecret = await SEA.secret(collaboratorEpub, ownerDevicePair);
  if (!sharedSecret) {
    throw new Error('Failed to derive shared secret for key sharing');
  }
  const encrypted = await SEA.encrypt(documentKey, sharedSecret);
  if (!encrypted) {
    throw new Error('Failed to encrypt document key');
  }
  return typeof encrypted === 'string' ? encrypted : JSON.stringify(encrypted);
}

/**
 * Decrypt a document key received from the owner (spec §4.2).
 *
 * The collaborator computes the same shared secret using the
 * owner's epub and their own device pair, then decrypts.
 */
export async function receiveDocumentKey(
  encryptedKey: string,
  ownerEpub: string,
  myDevicePair: SEAPair
): Promise<string> {
  const sharedSecret = await SEA.secret(ownerEpub, myDevicePair);
  if (!sharedSecret) {
    throw new Error('Failed to derive shared secret for key receiving');
  }
  const decrypted = await SEA.decrypt(encryptedKey, sharedSecret);
  if (!decrypted) {
    throw new Error('Failed to decrypt document key');
  }
  return typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted);
}

/** Base64 encode Uint8Array (browser-safe). */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Base64 decode to Uint8Array (browser-safe). */
function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt Yjs document state for storage (spec §4.3).
 *
 * Accepts raw Yjs state bytes (from Y.encodeStateAsUpdate),
 * base64-encodes, then encrypts with the document key.
 */
export async function encryptDocContent(
  stateBytes: Uint8Array,
  documentKey: string
): Promise<string> {
  const base64State = uint8ToBase64(stateBytes);
  const encrypted = await SEA.encrypt(base64State, documentKey);
  if (!encrypted) {
    throw new Error('Failed to encrypt document content');
  }
  return typeof encrypted === 'string' ? encrypted : JSON.stringify(encrypted);
}

/**
 * Decrypt Yjs document state from storage (spec §4.3).
 *
 * Decrypts, then base64-decodes back to Uint8Array for
 * Y.applyUpdate consumption.
 */
export async function decryptDocContent(
  encryptedContent: string,
  documentKey: string
): Promise<Uint8Array> {
  const decrypted = await SEA.decrypt(encryptedContent, documentKey);
  if (decrypted === undefined || decrypted === null || typeof decrypted !== 'string') {
    throw new Error('Failed to decrypt document content');
  }
  return base64ToUint8(decrypted);
}
