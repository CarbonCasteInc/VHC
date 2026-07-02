// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  loadIdentity,
  loadVaultV2,
  saveIdentity,
  saveVaultV2,
  updateVaultV2,
  clearIdentity
} from './vault';
import { migrateLegacyLocalStorage } from './migrate';
import { openVaultDb, idbGet, idbPut, idbDelete } from './db';
import {
  VAULT_STORE,
  KEYS_STORE,
  IDENTITY_KEY,
  MASTER_KEY,
  LEGACY_STORAGE_KEY,
  isOperatorAuthorizationTokenCompartment,
  isWalletBindingCompartment,
  LEGACY_VAULT_VERSION,
  VAULT_VERSION
} from './types';
import type { DelegationSigningKeyCompartment, Identity, VaultRecord } from './types';
import { encrypt, generateMasterKey } from './crypto';
import {
  base64UrlToBytes,
  delegationSigningKey,
  deviceCredential,
  operatorAuthorizationToken,
  randomBase64Url,
  seaDevicePair,
  validateDelegationSigningKey,
  validateDelegationSigningPublicKey,
  validateDeviceCredential,
  validateOperatorAuthorizationToken,
  validateSeaDevicePair,
  validateWalletBinding,
  walletBinding,
  VaultCompartmentError
} from './compartments';

const TEST_IDENTITY: Identity = {
  displayName: 'Alice Nakamoto',
  pub: 'pk_abc123_public_key_data',
  priv: 'sk_secret_private_key_data',
  session: { nullifier: 'test-null', trustScore: 0.9 },
  customField: 42,
};

const LEGACY_DEVICE_KEY = 'legacy-device-key-exact';
const LEGACY_SEA_PAIR = Object.freeze({
  pub: 'legacy-pub',
  priv: 'legacy-priv',
  epub: 'legacy-epub',
  epriv: 'legacy-epriv'
});
const LEGACY_IDENTITY: Identity = {
  ...TEST_IDENTITY,
  id: 'legacy-id',
  createdAt: 1700000000000,
  attestation: {
    platform: 'web',
    integrityToken: 'legacy-integrity',
    deviceKey: LEGACY_DEVICE_KEY,
    nonce: 'legacy-nonce'
  },
  devicePair: LEGACY_SEA_PAIR
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

async function writeEncryptedVaultRecord(version: number, payload: unknown): Promise<void> {
  const db = await openVaultDb();
  const key = await generateMasterKey();
  await idbPut(db, KEYS_STORE, MASTER_KEY, key);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const { iv, ciphertext } = await encrypt(key, plaintext);
  await idbPut(db, VAULT_STORE, IDENTITY_KEY, {
    version,
    iv,
    ciphertext
  } satisfies VaultRecord);
  db.close();
}

async function writeLegacyVaultRecord(identity: unknown): Promise<void> {
  await writeEncryptedVaultRecord(LEGACY_VAULT_VERSION, identity);
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

  it('returns "noop" and does not clobber vault when identity already exists', async () => {
    const vaultIdentity: Identity = {
      ...TEST_IDENTITY,
      linkedDevices: ['device-1'],
      devicePair: { pub: 'pub', priv: 'priv', epub: 'epub', epriv: 'epriv' },
      session: { token: 'session-token', nullifier: 'vault-null', trustScore: 1 },
    };
    const redactedLegacy = {
      id: 'legacy-id',
      session: { nullifier: 'legacy-null', trustScore: 0.5 },
      devicePair: { pub: 'legacy-pub', epub: 'legacy-epub' },
    };

    await saveIdentity(vaultIdentity);
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(redactedLegacy));

    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('noop');
    expect(await loadIdentity()).toEqual(vaultIdentity);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it('returns "noop" when legacy removal throws while vault identity already exists', async () => {
    await saveIdentity(TEST_IDENTITY);
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ stale: true }));
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    const result = await migrateLegacyLocalStorage();

    expect(result).toBe('noop');
    expect(await loadIdentity()).toEqual(TEST_IDENTITY);
  });
});

describe('T-5: Migration invalid', () => {
  it('returns "invalid" for non-JSON localStorage', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, '<<<not json>>>');
    const result = await migrateLegacyLocalStorage();
    expect(result).toBe('invalid');
  });

  it('returns "invalid" for JSON that is not an object (string)', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify('just a string'));
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

  it('loadIdentity returns null when decrypted data is valid JSON but not an object', async () => {
    await saveIdentity(TEST_IDENTITY);

    const db = await openVaultDb();
    const key = await idbGet<CryptoKey>(db, KEYS_STORE, MASTER_KEY);
    expect(key).toBeDefined();

    // Encrypt valid JSON that is NOT an object (array)
    const { encrypt } = await import('./crypto');
    const badShape = new TextEncoder().encode(JSON.stringify([1, 2, 3]));
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

  it('loadIdentity rejects v2 vault records with invalid identityRecord compartments', async () => {
    await writeEncryptedVaultRecord(VAULT_VERSION, {
      schemaVersion: VAULT_VERSION,
      identityRecord: 'not-an-identity-record'
    });

    await expect(loadIdentity()).resolves.toBeNull();
    await expect(loadVaultV2()).resolves.toBeNull();

    const db = await openVaultDb();
    const remaining = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
    db.close();
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

  it('migrateLegacyLocalStorage returns "invalid" for array JSON', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, '[1,2,3]');
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

describe('M0.D-1 vault v2 compartments', () => {
  it('migrates a v1 vault record to v2 idempotently and preserves legacy key material', async () => {
    await writeLegacyVaultRecord(LEGACY_IDENTITY);

    await expect(loadIdentity()).resolves.toEqual(LEGACY_IDENTITY);
    const migrated = await loadVaultV2();
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      identityRecord: LEGACY_IDENTITY,
      deviceCredential: {
        schemaVersion: 1,
        material: LEGACY_DEVICE_KEY,
        createdAt: LEGACY_IDENTITY.createdAt,
        source: 'legacy-v1'
      },
      seaDevicePair: {
        schemaVersion: 1,
        ...LEGACY_SEA_PAIR,
        createdAt: LEGACY_IDENTITY.createdAt
      }
    });

    const db = await openVaultDb();
    const rawRecord = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
    db.close();
    expect(rawRecord?.version).toBe(VAULT_VERSION);

    await expect(loadIdentity()).resolves.toEqual(LEGACY_IDENTITY);
    await expect(loadVaultV2()).resolves.toEqual(migrated);
  });

  it('migrates legacy localStorage into v2 and reuses attestation.deviceKey exactly', async () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(LEGACY_IDENTITY));

    await expect(migrateLegacyLocalStorage()).resolves.toBe('migrated');
    const vault = await loadVaultV2();

    expect(vault?.identityRecord).toEqual(LEGACY_IDENTITY);
    expect(vault?.deviceCredential?.material).toBe(LEGACY_DEVICE_KEY);
    expect(vault?.deviceCredential?.source).toBe('legacy-v1');
  });

  it('loadOrCreate keeps generated device credentials stable until rotation', async () => {
    const first = await deviceCredential.loadOrCreate();
    const second = await deviceCredential.loadOrCreate();
    const rotated = await deviceCredential.rotate();

    expect(first.material).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(second).toEqual(first);
    expect(rotated.material).not.toBe(first.material);
    expect(rotated.source).toBe('generated');
  });

  it('rejects malformed device credential compartments without replacement', async () => {
    const valid = await deviceCredential.rotate();

    expect(() => validateDeviceCredential({
      ...valid,
      source: 'unknown'
    })).toThrow(VaultCompartmentError);
    expect(() => validateDeviceCredential({
      ...valid,
      source: undefined
    })).toThrow(VaultCompartmentError);
  });

  it('loadOrCreate keeps SEA device pairs stable and rotates only through the helper', async () => {
    const first = await seaDevicePair.loadOrCreate(() => LEGACY_SEA_PAIR);
    const second = await seaDevicePair.loadOrCreate(() => {
      throw new Error('should not create a second SEA pair');
    });
    const rotated = await seaDevicePair.rotate(() => ({
      pub: 'rotated-pub',
      priv: 'rotated-priv',
      epub: 'rotated-epub',
      epriv: 'rotated-epriv'
    }));

    expect(second).toEqual(first);
    expect(rotated).toMatchObject({
      pub: 'rotated-pub',
      priv: 'rotated-priv',
      epub: 'rotated-epub',
      epriv: 'rotated-epriv'
    });
  });

  it('fails closed on malformed SEA compartment creation and validation', async () => {
    await expect(seaDevicePair.rotate(() => ({
      pub: 'missing-epriv-pub',
      priv: 'missing-epriv-priv',
      epub: 'missing-epriv-epub',
      epriv: ''
    }))).rejects.toThrow(VaultCompartmentError);

    expect(() => validateSeaDevicePair({
      schemaVersion: 1,
      pub: 'pub',
      priv: 'priv',
      epub: 'epub',
      epriv: '',
      createdAt: 0
    })).toThrow(VaultCompartmentError);
  });

  it('keeps delegation signing keys stable and signs/verifies the frozen M0.D vector', async () => {
    const vector = 'vh:luma:m0d-vault-compartment-vector:v1';
    const first = await delegationSigningKey.loadOrCreate();
    const firstSignature = await delegationSigningKey.sign(vector, first);
    const second = await delegationSigningKey.loadOrCreate();
    const secondSignature = await delegationSigningKey.sign(vector, second);

    expect(second).toEqual(first);
    expect(secondSignature).toBe(firstSignature);
    await expect(delegationSigningKey.verify({
      key: first,
      message: vector,
      signature: firstSignature
    })).resolves.toBe(true);
    await expect(delegationSigningKey.verify({
      key: first,
      message: `${vector}:tampered`,
      signature: firstSignature
    })).resolves.toBe(false);

    const rotated = await delegationSigningKey.rotate();
    expect(rotated.publicKey.material).not.toBe(first.publicKey.material);
  });

  it('signs through the stored-key facade and exposes only public delegation material', async () => {
    const vector = 'vh:luma:m0d-delegation-signer-surface:v1';
    const publicKey = await delegationSigningKey.publicKey();
    const signature = await delegationSigningKey.signStored(vector);

    expect(JSON.stringify(publicKey)).not.toContain('privateKey');
    expect(() => validateDelegationSigningPublicKey({
      ...publicKey,
      privateKey: { encoding: 'base64url', material: 'secret' }
    })).toThrow(VaultCompartmentError);
    await expect(delegationSigningKey.verifyPublic({
      key: publicKey,
      message: vector,
      signature
    })).resolves.toBe(true);

    await clearIdentity();
    expect(await delegationSigningKey.publicKey()).toEqual(publicKey);
    await expect(delegationSigningKey.verifyPublic({
      key: publicKey,
      message: vector,
      signature: await delegationSigningKey.signStored(vector)
    })).resolves.toBe(true);
  });

  it('rotates stored delegation signing material only through the explicit helper', async () => {
    const vector = 'vh:luma:m0d-delegation-rotation:v1';
    const firstPublicKey = await delegationSigningKey.publicKey();
    const firstSignature = await delegationSigningKey.signStored(vector);

    const rotatedPublicKey = await delegationSigningKey.rotateStored();
    expect(rotatedPublicKey.publicKey.material).not.toBe(firstPublicKey.publicKey.material);
    expect(JSON.stringify(rotatedPublicKey)).not.toContain('privateKey');

    await expect(delegationSigningKey.verifyPublic({
      key: rotatedPublicKey,
      message: vector,
      signature: firstSignature
    })).resolves.toBe(false);

    await expect(delegationSigningKey.verifyPublic({
      key: rotatedPublicKey,
      message: vector,
      signature: await delegationSigningKey.signStored(vector)
    })).resolves.toBe(true);
  });

  it('handles delegation signing Uint8Array messages and rejects unsupported suites', async () => {
    const vector = new Uint8Array([1, 2, 3, 4]);
    const key = await delegationSigningKey.rotate();
    const signature = await delegationSigningKey.sign(vector, key);

    await expect(delegationSigningKey.verify({
      key,
      message: vector,
      signature
    })).resolves.toBe(true);

    await expect(delegationSigningKey.verify({
      key: { publicKey: key.publicKey, signatureSuite: 'bad-suite' as never },
      message: vector,
      signature
    })).rejects.toThrow(VaultCompartmentError);

    expect(() => validateDelegationSigningKey({
      ...key,
      createdAt: -1
    })).toThrow(VaultCompartmentError);
  });

  it('saves, loads, updates, and clears JSON-safe wallet binding records', async () => {
    await expect(walletBinding.clear()).resolves.toBeUndefined();

    await saveIdentity(LEGACY_IDENTITY);
    await expect(walletBinding.clear()).resolves.toBeUndefined();

    const first = await walletBinding.save({
      address: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
      chainId: 31337n,
      providerKind: 'browser-injected',
      boundPrincipalNullifier: 'principal-1',
      now: 1000
    });

    expect(first).toEqual({
      schemaVersion: 1,
      address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      chainId: '31337',
      providerKind: 'browser-injected',
      boundPrincipalNullifier: 'principal-1',
      boundAt: 1000,
      updatedAt: 1000
    });
    expect(await walletBinding.load()).toEqual(first);
    expect(walletBinding.matchesPrincipal(first, 'principal-1')).toBe(true);
    expect(JSON.parse(JSON.stringify(await loadVaultV2()))?.walletBinding).toEqual(first);

    const updated = await walletBinding.save({
      address: first.address,
      chainId: first.chainId,
      providerKind: first.providerKind,
      boundPrincipalNullifier: first.boundPrincipalNullifier,
      now: 1500
    });
    expect(updated.boundAt).toBe(1000);
    expect(updated.updatedAt).toBe(1500);

    await walletBinding.clear();
    const vault = await loadVaultV2();
    expect(vault?.identityRecord).toEqual(LEGACY_IDENTITY);
    expect(vault?.walletBinding).toBeUndefined();
    expect(await walletBinding.load()).toBeNull();
  });

  it('rejects invalid wallet binding shape and private-key-shaped records', async () => {
    const valid = await walletBinding.save({
      address: '0x1111111111111111111111111111111111111111',
      chainId: '1',
      providerKind: 'e2e-mock',
      boundPrincipalNullifier: 'principal-wallet',
      now: 2000
    });

    expect(() => validateWalletBinding({
      ...valid,
      privateKey: 'do-not-store'
    })).toThrow(VaultCompartmentError);
    expect(() => validateWalletBinding({
      ...valid,
      provider: { request() {} }
    })).toThrow(VaultCompartmentError);
    expect(() => validateWalletBinding({
      ...valid,
      signer: { signMessage() {} }
    })).toThrow(VaultCompartmentError);
    expect(() => validateWalletBinding(null)).toThrow(VaultCompartmentError);
    expect(() => validateWalletBinding([])).toThrow(VaultCompartmentError);
    expect(() => validateWalletBinding({
      ...valid,
      updatedAt: valid.boundAt - 1
    })).toThrow(VaultCompartmentError);
    expect(walletBinding.matchesPrincipal(null, 'principal-wallet')).toBe(false);
    expect(walletBinding.matchesPrincipal(valid, null)).toBe(false);
    expect(walletBinding.normalizeChainId('31337')).toBe('31337');
    expect(walletBinding.normalizeChainId(31337)).toBe('31337');
    expect(() => walletBinding.normalizeChainId(-1n)).toThrow(VaultCompartmentError);
    expect(() => walletBinding.normalizeChainId(-1)).toThrow(VaultCompartmentError);
    expect(() => walletBinding.normalizeChainId(1.5)).toThrow(VaultCompartmentError);
    expect(() => validateWalletBinding({
      ...valid,
      boundAt: -1
    })).toThrow(VaultCompartmentError);
    await expect(walletBinding.save({
      address: '0xabc',
      chainId: '1',
      providerKind: 'browser-injected',
      boundPrincipalNullifier: 'principal-wallet'
    })).rejects.toThrow(VaultCompartmentError);
    await expect(walletBinding.save({
      address: valid.address,
      chainId: '01',
      providerKind: 'browser-injected',
      boundPrincipalNullifier: 'principal-wallet'
    })).rejects.toThrow(VaultCompartmentError);
    await expect(walletBinding.save({
      address: valid.address,
      chainId: '1',
      providerKind: 'wallet-connect' as never,
      boundPrincipalNullifier: 'principal-wallet'
    })).rejects.toThrow(VaultCompartmentError);
    await expect(walletBinding.save({
      address: valid.address,
      chainId: '1',
      providerKind: 'browser-injected',
      boundPrincipalNullifier: ''
    })).rejects.toThrow(VaultCompartmentError);
    await expect(walletBinding.save({
      address: valid.address,
      chainId: '1',
      providerKind: 'browser-injected',
      boundPrincipalNullifier: 'principal-wallet',
      now: -1
    })).rejects.toThrow(VaultCompartmentError);
  });

  it('fails closed when a v2 vault contains a malformed wallet binding compartment', async () => {
    await writeEncryptedVaultRecord(VAULT_VERSION, {
      schemaVersion: 2,
      identityRecord: LEGACY_IDENTITY,
      walletBinding: {
        schemaVersion: 1,
        address: '0x2222222222222222222222222222222222222222',
        chainId: '1',
        providerKind: 'browser-injected',
        boundPrincipalNullifier: 'principal-wallet',
        boundAt: 1,
        updatedAt: 1,
        privateKey: 'leak'
      }
    });

    await expect(loadVaultV2()).resolves.toBeNull();

    const db = await openVaultDb();
    const remaining = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
    db.close();
    expect(remaining).toBeUndefined();
  });

  it('rejects malformed wallet binding compartments through v2 shape guards and public writers', async () => {
    expect(isWalletBindingCompartment(null)).toBe(false);
    expect(isWalletBindingCompartment([])).toBe(false);

    await writeEncryptedVaultRecord(VAULT_VERSION, {
      schemaVersion: 2,
      identityRecord: LEGACY_IDENTITY,
      walletBinding: []
    });
    await expect(loadVaultV2()).resolves.toBeNull();

    await saveIdentity(LEGACY_IDENTITY);
    await expect(saveVaultV2({
      schemaVersion: 2,
      identityRecord: LEGACY_IDENTITY,
      walletBinding: [] as never
    })).resolves.toBeUndefined();
    expect(await loadIdentity()).toEqual(LEGACY_IDENTITY);
  });

  it('fails closed when Ed25519 key generation returns an invalid shape', async () => {
    const originalSubtle = crypto.subtle;
    Object.defineProperty(crypto, 'subtle', {
      value: { generateKey: vi.fn().mockResolvedValue({}) },
      configurable: true
    });

    try {
      await expect(delegationSigningKey.rotate()).rejects.toThrow(VaultCompartmentError);
    } finally {
      Object.defineProperty(crypto, 'subtle', { value: originalSubtle, configurable: true });
    }
  });

  it('uses standard ArrayBuffer sources when the Node Buffer helper is absent', async () => {
    const originalBuffer = (globalThis as typeof globalThis & { Buffer?: unknown }).Buffer;
    const originalSubtle = crypto.subtle;
    const fakePrivateKey = {} as CryptoKey;
    const fakePublicKey = {} as CryptoKey;
    const fakeSubtle = {
      importKey: vi.fn()
        .mockResolvedValueOnce(fakePrivateKey)
        .mockResolvedValueOnce(fakePublicKey),
      sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
      verify: vi.fn().mockResolvedValue(true)
    };
    const key: DelegationSigningKeyCompartment = {
      schemaVersion: 1,
      signatureSuite: 'jcs-ed25519-sha256-v1',
      publicKey: { encoding: 'base64url', material: 'AQID' },
      privateKey: { encoding: 'base64url', material: 'BAUG' },
      createdAt: 0
    };

    Object.defineProperty(globalThis, 'Buffer', { value: undefined, configurable: true });
    Object.defineProperty(crypto, 'subtle', { value: fakeSubtle, configurable: true });

    try {
      await expect(delegationSigningKey.sign(new Uint8Array([9]), key)).resolves.toBe('AQID');
      await expect(delegationSigningKey.verify({
        key,
        message: new Uint8Array([9]),
        signature: 'AQID'
      })).resolves.toBe(true);
      expect(fakeSubtle.importKey.mock.calls[0]?.[1]).toBeInstanceOf(ArrayBuffer);
      expect(fakeSubtle.importKey.mock.calls[1]?.[1]).toBeInstanceOf(ArrayBuffer);
    } finally {
      Object.defineProperty(globalThis, 'Buffer', { value: originalBuffer, configurable: true });
      Object.defineProperty(crypto, 'subtle', { value: originalSubtle, configurable: true });
    }
  });

  it('exposes JSON-safe base64url helpers that fail closed on invalid runtime inputs', () => {
    expect(base64UrlToBytes('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => base64UrlToBytes('AQ+')).toThrow(VaultCompartmentError);

    const originalGetRandomValues = crypto.getRandomValues;
    Object.defineProperty(crypto, 'getRandomValues', { value: undefined, configurable: true });
    try {
      expect(() => randomBase64Url(4)).toThrow(VaultCompartmentError);
    } finally {
      Object.defineProperty(crypto, 'getRandomValues', {
        value: originalGetRandomValues,
        configurable: true
      });
    }
  });

  it('rotation helpers can initialize fresh material from an empty v2 vault', async () => {
    const emptyVaultPair = await seaDevicePair.rotate(() => LEGACY_SEA_PAIR);
    await clearIdentity();
    const rotatedCredential = await deviceCredential.rotate();
    await clearIdentity();
    const rotatedPair = await seaDevicePair.rotate(() => LEGACY_SEA_PAIR);
    await clearIdentity();
    const rotatedDelegationKey = await delegationSigningKey.rotate();

    expect(emptyVaultPair).toMatchObject(LEGACY_SEA_PAIR);
    expect(rotatedCredential.material).toEqual(expect.any(String));
    expect(rotatedPair).toMatchObject(LEGACY_SEA_PAIR);
    expect(rotatedDelegationKey.publicKey.material).toEqual(expect.any(String));
  });

  it('clears identity/session data without deleting stable v2 compartments', async () => {
    const firstCredential = await deviceCredential.loadOrCreate();
    const firstPair = await seaDevicePair.loadOrCreate(() => LEGACY_SEA_PAIR);
    const firstDelegationKey = await delegationSigningKey.loadOrCreate();
    const firstOperatorToken = await operatorAuthorizationToken.save({
      token: 'operator-token',
      boundPrincipalNullifier: 'principal-1',
      issuedAt: 1000,
      expiresAt: 2000
    });
    await saveIdentity(LEGACY_IDENTITY);

    await clearIdentity();

    expect(await loadIdentity()).toBeNull();
    expect(await deviceCredential.loadOrCreate()).toEqual(firstCredential);
    expect(await seaDevicePair.loadOrCreate(() => {
      throw new Error('SEA pair should have been preserved');
    })).toEqual(firstPair);
    expect(await delegationSigningKey.loadOrCreate()).toEqual(firstDelegationKey);
    expect(await operatorAuthorizationToken.load()).toEqual(firstOperatorToken);
  });

  it('validates and clears the operator authorization token compartment explicitly', async () => {
    await expect(operatorAuthorizationToken.clear()).resolves.toBeUndefined();

    const token = await operatorAuthorizationToken.save({
      token: 'operator-token',
      boundPrincipalNullifier: 'principal-1',
      issuedAt: 1000,
      expiresAt: 2000
    });

    expect(validateOperatorAuthorizationToken(token)).toEqual(token);
    expect(isOperatorAuthorizationTokenCompartment(token)).toBe(true);
    expect(isOperatorAuthorizationTokenCompartment(null)).toBe(false);
    expect(isOperatorAuthorizationTokenCompartment([])).toBe(false);
    expect(isOperatorAuthorizationTokenCompartment({
      ...token,
      unexpected: true
    })).toBe(false);
    expect(await operatorAuthorizationToken.load()).toEqual(token);

    await operatorAuthorizationToken.clear();

    expect(await operatorAuthorizationToken.load()).toBeNull();
    expect(() => validateOperatorAuthorizationToken({
      schemaVersion: 1,
      token: '',
      boundPrincipalNullifier: 'principal-1',
      issuedAt: 1000
    })).toThrow(VaultCompartmentError);
    expect(() => validateOperatorAuthorizationToken(null)).toThrow(VaultCompartmentError);
    expect(() => validateOperatorAuthorizationToken([])).toThrow(VaultCompartmentError);
    expect(() => validateOperatorAuthorizationToken({
      ...token,
      unexpected: true
    })).toThrow(VaultCompartmentError);
    expect(() => validateOperatorAuthorizationToken({
      ...token,
      issuedAt: -1
    })).toThrow(VaultCompartmentError);
    expect(() => validateOperatorAuthorizationToken({
      ...token,
      expiresAt: 999
    })).toThrow(VaultCompartmentError);

    const noExpiryToken = await operatorAuthorizationToken.save({
      token: 'operator-token-without-expiry',
      boundPrincipalNullifier: 'principal-1',
      issuedAt: 1000
    });
    expect(noExpiryToken.expiresAt).toBeUndefined();
    expect(await operatorAuthorizationToken.load()).toEqual(noExpiryToken);

    await expect(saveVaultV2({
      schemaVersion: VAULT_VERSION,
      operatorAuthorizationToken: {
        ...noExpiryToken,
        token: ''
      } as never
    })).resolves.toBeUndefined();
  });

  it('persists compartment byte material as JSON-safe strings', async () => {
    await deviceCredential.loadOrCreate();
    await delegationSigningKey.loadOrCreate();

    const vault = await loadVaultV2();
    expect(vault?.deviceCredential?.material).toEqual(expect.any(String));
    expect(vault?.delegationSigningKey?.publicKey.material).toEqual(expect.any(String));
    expect(vault?.delegationSigningKey?.privateKey.material).toEqual(expect.any(String));
    expect(JSON.parse(JSON.stringify(vault))).toEqual(vault);
  });

  it('fails closed instead of regenerating over malformed v2 compartments', async () => {
    await saveIdentity({
      ...LEGACY_IDENTITY,
      deviceCredential: {
        schemaVersion: 1,
        material: '',
        createdAt: 0,
        source: 'legacy-v1'
      }
    });
    const vault = await loadVaultV2();
    await saveVaultV2({
      schemaVersion: 2,
      identityRecord: LEGACY_IDENTITY,
      deviceCredential: {
        schemaVersion: 1,
        material: '',
        createdAt: 0,
        source: 'legacy-v1'
      } as never
    });

    expect(vault?.deviceCredential?.material).toBe(LEGACY_DEVICE_KEY);
    await expect(deviceCredential.loadOrCreate()).rejects.toThrow(VaultCompartmentError);
  });

  it('preserves fail-closed semantics for malformed v2 SEA compartments', async () => {
    await saveVaultV2({
      schemaVersion: 2,
      identityRecord: LEGACY_IDENTITY,
      seaDevicePair: {
        schemaVersion: 1,
        pub: 'pub',
        priv: 'priv',
        epub: 'epub',
        epriv: '',
        createdAt: 0
      } as never
    });

    await expect(seaDevicePair.loadOrCreate(() => LEGACY_SEA_PAIR))
      .rejects.toThrow(VaultCompartmentError);
  });

  it('updates v2 vault records through the typed mutator', async () => {
    await expect(updateVaultV2((vault) => ({
      ...vault,
      identityRecord: LEGACY_IDENTITY
    }))).resolves.toMatchObject({
      schemaVersion: 2,
      identityRecord: LEGACY_IDENTITY
    });

    await expect(loadIdentity()).resolves.toEqual(LEGACY_IDENTITY);
  });

  it('does not save invalid v2 identityRecord compartments through public writers', async () => {
    await saveIdentity(LEGACY_IDENTITY);

    await expect(saveVaultV2({
      schemaVersion: 2,
      identityRecord: 'not-an-identity-record' as never
    })).resolves.toBeUndefined();

    await expect(loadIdentity()).resolves.toEqual(LEGACY_IDENTITY);
  });

  it('typed v2 accessors fail closed when IndexedDB is unavailable', async () => {
    const original = globalThis.indexedDB;
    try {
      // @ts-expect-error — intentionally removing for test
      delete globalThis.indexedDB;
      await expect(loadVaultV2()).resolves.toBeNull();
      await expect(saveVaultV2({ schemaVersion: 2 })).resolves.toBeUndefined();
      await expect(updateVaultV2((vault) => vault)).resolves.toBeNull();
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('clearIdentity is a no-op when only stable compartments are absent', async () => {
    await expect(clearIdentity()).resolves.toBeUndefined();
    expect(await loadVaultV2()).toBeNull();
  });

  it('rejects invalid legacy v1 vault payloads before v2 migration', async () => {
    await writeLegacyVaultRecord(['not-an-identity']);

    await expect(loadVaultV2()).resolves.toBeNull();

    const db = await openVaultDb();
    const remaining = await idbGet<VaultRecord>(db, VAULT_STORE, IDENTITY_KEY);
    db.close();
    expect(remaining).toBeUndefined();
  });

  it('does not promote invalid legacy device or SEA material into v2 compartments', async () => {
    const legacyWithInvalidCompartments: Identity = {
      ...TEST_IDENTITY,
      attestation: {
        platform: 'web',
        integrityToken: 'tok',
        deviceKey: '',
        nonce: 'nonce'
      },
      devicePair: {
        pub: 'pub',
        priv: 'priv',
        epub: 'epub',
        epriv: ''
      }
    };

    await saveIdentity(legacyWithInvalidCompartments);
    const vault = await loadVaultV2();

    expect(vault?.identityRecord).toEqual(legacyWithInvalidCompartments);
    expect(vault?.deviceCredential).toBeUndefined();
    expect(vault?.seaDevicePair).toBeUndefined();
  });
});
