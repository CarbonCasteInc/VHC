import type { Page } from '@playwright/test';

const VAULT_CONFIG = {
  dbName: 'vh-vault',
  dbVersion: 1,
  vaultStore: 'vault',
  keysStore: 'keys',
  identityKey: 'identity',
  masterKey: 'master',
  vaultVersion: 1,
  aesGcmIvBytes: 12,
} as const;

export interface VaultIdentity {
  session?: {
    nullifier?: string;
    trustScore?: number;
    scaledTrustScore?: number;
    [key: string]: unknown;
  };
  devicePair?: {
    pub?: string;
    epub?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readVaultIdentity(page: Page): Promise<VaultIdentity | null> {
  const identity = await page.evaluate(async (config) => {
    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(config.dbName, config.dbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(config.vaultStore)) {
          db.createObjectStore(config.vaultStore);
        }
        if (!db.objectStoreNames.contains(config.keysStore)) {
          db.createObjectStore(config.keysStore);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open vault DB.'));
    });

    const idbGet = (db: IDBDatabase, storeName: string, key: string) =>
      new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`Failed to read ${storeName}/${key}`));
      });

    const asArrayBuffer = (value: unknown): ArrayBuffer | null => {
      if (value instanceof ArrayBuffer) {
        return value;
      }

      if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        const bytes = new Uint8Array(view.byteLength);
        bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        return bytes.buffer;
      }

      return null;
    };

    const asUint8Array = (value: unknown): Uint8Array | null => {
      if (value instanceof Uint8Array) {
        return value;
      }

      const buffer = asArrayBuffer(value);
      return buffer ? new Uint8Array(buffer) : null;
    };

    const db = await openDb();

    try {
      const rawRecord = await idbGet(db, config.vaultStore, config.identityKey);
      if (!rawRecord || typeof rawRecord !== 'object') {
        return null;
      }

      const record = rawRecord as {
        version?: unknown;
        iv?: unknown;
        ciphertext?: unknown;
      };

      if (record.version !== config.vaultVersion) {
        return null;
      }

      const rawMasterKey = await idbGet(db, config.keysStore, config.masterKey);
      if (!(rawMasterKey instanceof CryptoKey)) {
        return null;
      }

      const iv = asUint8Array(record.iv);
      const ciphertext = asArrayBuffer(record.ciphertext);
      if (!iv || !ciphertext) {
        return null;
      }

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        rawMasterKey,
        ciphertext,
      );

      const json = new TextDecoder().decode(decrypted);
      const parsed = JSON.parse(json);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    } finally {
      db.close();
    }
  }, VAULT_CONFIG);

  if (!isObject(identity)) {
    return null;
  }

  return identity as VaultIdentity;
}

export async function writeVaultIdentity(page: Page, identity: VaultIdentity): Promise<boolean> {
  return page.evaluate(async ({ nextIdentity, config }) => {
    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(config.dbName, config.dbVersion);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(config.vaultStore)) {
          db.createObjectStore(config.vaultStore);
        }
        if (!db.objectStoreNames.contains(config.keysStore)) {
          db.createObjectStore(config.keysStore);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open vault DB.'));
    });

    const idbGet = (db: IDBDatabase, storeName: string, key: string) =>
      new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`Failed to read ${storeName}/${key}`));
      });

    const idbPut = (db: IDBDatabase, storeName: string, key: string, value: unknown) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        store.put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error(`Failed to write ${storeName}/${key}`));
      });

    const db = await openDb();

    try {
      const rawMasterKey = await idbGet(db, config.keysStore, config.masterKey);
      if (!(rawMasterKey instanceof CryptoKey)) {
        return false;
      }

      const rawRecord = await idbGet(db, config.vaultStore, config.identityKey);
      const existingVersion =
        rawRecord && typeof rawRecord === 'object' && typeof (rawRecord as { version?: unknown }).version === 'number'
          ? (rawRecord as { version: number }).version
          : config.vaultVersion;

      const plaintext = new TextEncoder().encode(JSON.stringify(nextIdentity));
      const iv = crypto.getRandomValues(new Uint8Array(config.aesGcmIvBytes));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        rawMasterKey,
        plaintext,
      );

      await idbPut(db, config.vaultStore, config.identityKey, {
        version: existingVersion,
        iv,
        ciphertext,
      });

      return true;
    } catch {
      return false;
    } finally {
      db.close();
    }
  }, { nextIdentity: identity, config: VAULT_CONFIG });
}

export async function waitForVaultIdentityNullifier(page: Page, timeoutMs = 15_000): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const identity = await readVaultIdentity(page);
    const nullifier = identity?.session?.nullifier;
    if (typeof nullifier === 'string' && nullifier.length > 0) {
      return nullifier;
    }

    await page.waitForTimeout(200);
  }

  throw new Error(`Timed out waiting for vault identity nullifier after ${timeoutMs}ms.`);
}

/**
 * Wait until the identity has been hydrated from the vault and published
 * to the in-memory identity provider.
 *
 * Strategy: first try the fast path (global flag set by publishIdentity).
 * If that times out, fall back to vault poll + settle delay.  The flag
 * approach works in most environments but may miss in certain build
 * configurations where the global write is optimized away.
 */
export async function waitForIdentityHydrated(page: Page, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  const flagTimeout = Math.min(timeoutMs, 5_000);

  try {
    await page.waitForFunction(
      () => !!(window as any).__vh_identity_published,
      undefined,
      { timeout: flagTimeout },
    );
    return;
  } catch {
    // Flag not detected — fall back to vault poll + settle
  }

  // Fallback: confirm vault has identity, then let React effects settle.
  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(timeoutMs - elapsed, 1_000);
  await waitForVaultIdentityNullifier(page, remaining);
  // A short delay drains the microtask + macrotask queues, ensuring
  // the React useEffect chain (which calls publishIdentity) has resolved.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
}
