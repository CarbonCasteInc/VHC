// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { loadIdentity, saveIdentity, clearIdentity } from './vault';
import { migrateLegacyLocalStorage } from './migrate';
import { openVaultDb, idbGet, idbPut, idbDelete } from './db';
import { VAULT_STORE, KEYS_STORE, IDENTITY_KEY, MASTER_KEY, LEGACY_STORAGE_KEY, VAULT_VERSION } from './types';
import type { Identity, VaultRecord } from './types';

const TEST_IDENTITY: Identity = {
  displayName: 'Alice Nakamoto',
  pub: 'pk_abc123_public_key_data',
  priv: 'sk_secret_private_key_data',
  customField: 42,
};

/**
 * Helper: delete the entire IDB database between tests for isolation.
 */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  await deleteDatabase('vh-vault');
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('T-7: Round-trip', () => {
  it('saveIdentity → loadIdentity returns deep-equal identity', async () => {
    await saveIdentity(TEST_IDENTITY);
    const loaded = await loadIdentity();
    expect(loaded).toEqual(TEST_IDENTITY);
  });

  it('preserves extra fields through round-trip', async () => {
    const withExtras: Identity = { ...TEST_IDENTITY, nested: { a: 1 }, arr: [1, 2, 3] };
    await saveIdentity(withExtras);
    const loaded = await loadIdentity();
    expect(loaded).toEqual(withExtras);
  });
});

describe('T-1: Encrypt at rest', () => {
  it('raw IDB blob does not contain plaintext markers', async () => {
    await saveIdentity(TEST_IDENTITY);

    const db = await openVaultDb();
    const record = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
    db.close();

    expect(record).toBeDefined();

    // Convert ciphertext to string to search for plaintext leaks
    const bytes = new Uint8Array(record!.ciphertext);
    const asString = new TextDecoder().decode(bytes);

    expect(asString).not.toContain(TEST_IDENTITY.displayName);
    expect(asString).not.toContain(TEST_IDENTITY.pub);
    expect(asString).not.toContain(TEST_IDENTITY.priv);
  });
});

describe('T-2: Tamper detection', () => {
  it('flipping a byte in ciphertext → loadIdentity returns null', async () => {
    await saveIdentity(TEST_IDENTITY);

    const db = await openVaultDb();
    const record = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
    expect(record).toBeDefined();

    // Flip first byte of ciphertext
    const tampered = new Uint8Array(record!.ciphertext);
    tampered[0] ^= 0xff;
    const tamperedRecord: VaultRecord = {
      version: record!.version,
      iv: record!.iv,
      ciphertext: tampered.buffer,
    };
    await idbPut(db, VAULT_STORE, IDENTITY_KEY, tamperedRecord);
    db.close();

    const loaded = await loadIdentity();
    expect(loaded).toBeNull();
  });

  it('flipping a byte in IV → loadIdentity returns null', async () => {
    await saveIdentity(TEST_IDENTITY);

    const db = await openVaultDb();
    const record = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
    expect(record).toBeDefined();

    // Flip first byte of IV
    const tamperedIv = new Uint8Array(record!.iv);
    tamperedIv[0] ^= 0xff;
    const tamperedRecord: VaultRecord = {
      version: record!.version,
      iv: tamperedIv,
      ciphertext: record!.ciphertext,
    };
    await idbPut(db, VAULT_STORE, IDENTITY_KEY, tamperedRecord);
    db.close();

    const loaded = await loadIdentity();
    expect(loaded).toBeNull();
  });
});

describe('T-3: Legacy migration (happy path)', () => {
  it('migrates localStorage identity to vault and removes legacy key', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(TEST_IDENTITY));

    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('migrated');

    const loaded = await loadIdentity();
    expect(loaded).toEqual(TEST_IDENTITY);

    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});

describe('T-4: Migration noop', () => {
  it('returns "noop" when no localStorage entry exists', async () => {
    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('noop');
  });
});

describe('T-5: Migration invalid', () => {
  it('returns "invalid" for non-JSON localStorage', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, '<<<not json>>>');
    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('invalid');
  });

  it('returns "invalid" for JSON that is not a valid identity', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('invalid');
  });
});

describe('T-6: Missing crypto key', () => {
  it('returns null when master key is deleted but ciphertext remains', async () => {
    await saveIdentity(TEST_IDENTITY);

    // Delete the master key
    const db = await openVaultDb();
    await idbDelete(db, KEYS_STORE, MASTER_KEY);
    db.close();

    const loaded = await loadIdentity();
    expect(loaded).toBeNull();
  });
});

describe('T-8: Clear identity', () => {
  it('clearIdentity → loadIdentity returns null', async () => {
    await saveIdentity(TEST_IDENTITY);
    expect(await loadIdentity()).toEqual(TEST_IDENTITY);

    await clearIdentity();
    expect(await loadIdentity()).toBeNull();
  });
});

describe('T-9: SSR/Node fallback', () => {
  it('loadIdentity returns null when indexedDB unavailable', async () => {
    const original = globalThis.indexedDB;
    try {
      // @ts-expect-error — intentionally removing for test
      delete globalThis.indexedDB;
      const loaded = await loadIdentity();
      expect(loaded).toBeNull();
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('saveIdentity is a no-op when indexedDB unavailable', async () => {
    const original = globalThis.indexedDB;
    try {
      // @ts-expect-error — intentionally removing for test
      delete globalThis.indexedDB;
      await expect(saveIdentity(TEST_IDENTITY)).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('clearIdentity is a no-op when indexedDB unavailable', async () => {
    const original = globalThis.indexedDB;
    try {
      // @ts-expect-error — intentionally removing for test
      delete globalThis.indexedDB;
      await expect(clearIdentity()).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('migrateLegacyLocalStorage returns "noop" when indexedDB unavailable', async () => {
    const original = globalThis.indexedDB;
    try {
      // @ts-expect-error — intentionally removing for test
      delete globalThis.indexedDB;
      const result = await migrateLegacyLocalStorage();
      expect(result).toBe('noop');
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('loadIdentity returns null when crypto.subtle unavailable', async () => {
    const originalSubtle = crypto.subtle;
    Object.defineProperty(crypto, 'subtle', { value: undefined, configurable: true });
    try {
      const loaded = await loadIdentity();
      expect(loaded).toBeNull();
    } finally {
      Object.defineProperty(crypto, 'subtle', { value: originalSubtle, configurable: true });
    }
  });
});

describe('Error branches', () => {
  it('loadIdentity returns null when openVaultDb fails', async () => {
    const original = globalThis.indexedDB;
    // Save first while IDB works
    await saveIdentity(TEST_IDENTITY);

    // Now break IDB open by replacing it with a throwing proxy
    const brokenIdb = {
      ...original,
      open: () => { throw new Error('IDB broken'); },
    };
    Object.defineProperty(globalThis, 'indexedDB', { value: brokenIdb, configurable: true });
    try {
      const loaded = await loadIdentity();
      expect(loaded).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: original, configurable: true });
    }
  });

  it('clearIdentity is safe when openVaultDb fails', async () => {
    const original = globalThis.indexedDB;
    const brokenIdb = {
      ...original,
      open: () => { throw new Error('IDB broken'); },
    };
    Object.defineProperty(globalThis, 'indexedDB', { value: brokenIdb, configurable: true });
    try {
      await expect(clearIdentity()).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: original, configurable: true });
    }
  });

  it('loadIdentity returns null when vault record has wrong version', async () => {
    await saveIdentity(TEST_IDENTITY);

    const db = await openVaultDb();
    const record = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
    expect(record).toBeDefined();

    // Write a record with a future version
    const futureRecord: VaultRecord = { ...record!, version: 999 };
    await idbPut(db, VAULT_STORE, IDENTITY_KEY, futureRecord);
    db.close();

    const loaded = await loadIdentity();
    expect(loaded).toBeNull();
  });

  it('loadIdentity returns null when decrypted data is valid JSON but invalid Identity shape', async () => {
    await saveIdentity(TEST_IDENTITY);

    const db = await openVaultDb();
    const key = await idbGet<CryptoKey>(db, KEYS_STORE, MASTER_KEY);
    expect(key).toBeDefined();

    // Encrypt valid JSON that is NOT a valid Identity (missing required fields)
    const { encrypt } = await import('./crypto');
    const badShape = new TextEncoder().encode(JSON.stringify({ foo: 'bar', num: 42 }));
    const { iv, ciphertext } = await encrypt(key!, badShape);
    await idbPut(db, VAULT_STORE, IDENTITY_KEY, { version: VAULT_VERSION, iv, ciphertext });
    db.close();

    const loaded = await loadIdentity();
    expect(loaded).toBeNull();

    // Verify corrupt record was wiped
    const db2 = await openVaultDb();
    const remaining = await idbGet<VaultRecord>(db2, VAULT_STORE, IDENTITY_KEY);
    db2.close();
    expect(remaining).toBeUndefined();
  });

  it('loadIdentity returns null when decrypted data is not valid JSON', async () => {
    // Save a valid identity first to get a key
    await saveIdentity(TEST_IDENTITY);

    // Now replace the ciphertext with encrypted non-JSON data
    const db = await openVaultDb();
    const key = await idbGet<CryptoKey>(db, KEYS_STORE, MASTER_KEY);
    expect(key).toBeDefined();

    // Encrypt some non-JSON bytes
    const { encrypt } = await import('./crypto');
    const nonJson = new TextEncoder().encode('<<<not json>>>');
    const { iv, ciphertext } = await encrypt(key!, nonJson);
    await idbPut(db, VAULT_STORE, IDENTITY_KEY, { version: 1, iv, ciphertext });
    db.close();

    const loaded = await loadIdentity();
    expect(loaded).toBeNull();
  });

  it('migrateLegacyLocalStorage returns "noop" when localStorage.getItem throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('noop');
  });

  it('migrateLegacyLocalStorage still returns "migrated" when localStorage.removeItem throws', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(TEST_IDENTITY));
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('migrated');
    // Identity should still be in the vault
    const loaded = await loadIdentity();
    expect(loaded).toEqual(TEST_IDENTITY);
  });

  it('migrateLegacyLocalStorage returns "invalid" for non-object JSON (number)', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, '42');
    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('invalid');
  });

  it('migrateLegacyLocalStorage returns "invalid" for null JSON', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, 'null');
    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('invalid');
  });
});

describe('Edge cases', () => {
  it('loadIdentity returns null when no identity saved', async () => {
    const loaded = await loadIdentity();
    expect(loaded).toBeNull();
  });

  it('empty identity round-trips', async () => {
    const empty: Identity = { displayName: '', pub: '', priv: '' };
    await saveIdentity(empty);
    const loaded = await loadIdentity();
    expect(loaded).toEqual(empty);
  });

  it('multiple migrations: first migrated, second noop', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(TEST_IDENTITY));
    expect(await migrateLegacyLocalStorage()).toBe('migrated');
    expect(await migrateLegacyLocalStorage()).toBe('noop');
  });

  it('save overwrites previous identity (last-write-wins)', async () => {
    await saveIdentity(TEST_IDENTITY);
    const updated: Identity = { displayName: 'Bob', pub: 'pk2', priv: 'sk2' };
    await saveIdentity(updated);
    expect(await loadIdentity()).toEqual(updated);
  });
});
