/**
 * IndexedDB-backed storage for Civic Action Kit local persistence.
 *
 * Storage keys per spec §6.1:
 * - vh_bridge_actions:<nullifier>
 * - vh_bridge_receipts:<nullifier>
 * - vh_bridge_reports:<nullifier>
 * - vh_bridge_profile:<nullifier>
 *
 * Encrypted profile uses Web Crypto AES-GCM (spec §6.2).
 */

const DB_NAME = 'vh_bridge';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

/* ── IndexedDB helpers ──────────────────────────────────────── */

let _dbPromise: Promise<IDBDatabase> | null = null;

/* v8 ignore start -- IndexedDB requires browser runtime; mocked in unit tests */
function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

export async function idbGet<T = unknown>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result ?? null) as T | null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
/* v8 ignore stop */

/* ── Storage key builders ───────────────────────────────────── */

export function actionsKey(nullifier: string): string {
  return `vh_bridge_actions:${nullifier}`;
}

export function receiptsKey(nullifier: string): string {
  return `vh_bridge_receipts:${nullifier}`;
}

export function reportsKey(nullifier: string): string {
  return `vh_bridge_reports:${nullifier}`;
}

export function profileKey(nullifier: string): string {
  return `vh_bridge_profile:${nullifier}`;
}

/* ── Encrypted profile (spec §6.2) ──────────────────────────── */

const PROFILE_ALGO = 'AES-GCM';
const IV_BYTES = 12;

/** Derive a stable encryption key from nullifier via PBKDF2. */
async function deriveKey(nullifier: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(nullifier), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('vh_bridge_profile'), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: PROFILE_ALGO, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptLocal(data: unknown): Promise<string> {
  const key = await deriveKey('profile');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: PROFILE_ALGO, iv }, key, plaintext);
  const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_BYTES);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptLocal(encoded: string): Promise<unknown> {
  const key = await deriveKey('profile');
  const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, IV_BYTES);
  const ciphertext = raw.slice(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: PROFILE_ALGO, iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export interface UserProfile {
  displayName?: string;
  district?: string;
  state?: string;
  [key: string]: unknown;
}

/* v8 ignore next 4 -- IndexedDB write; mocked in unit tests */
export async function saveUserProfile(nullifier: string, profile: UserProfile): Promise<void> {
  const encrypted = await encryptLocal(profile);
  await idbSet(profileKey(nullifier), encrypted);
}

export async function loadUserProfile(nullifier: string): Promise<UserProfile | null> {
  try {
    /* v8 ignore start -- idbGet/decrypt path requires real IndexedDB; mocked in store tests */
    const encrypted = await idbGet<string>(profileKey(nullifier));
    if (!encrypted || typeof encrypted !== 'string') return null;
    return await decryptLocal(encrypted) as UserProfile;
    /* v8 ignore stop */
  } catch {
    return null;
  }
}

/* ── Test utilities ─────────────────────────────────────────── */

export function _resetDbForTesting(): void {
  _dbPromise = null;
}
