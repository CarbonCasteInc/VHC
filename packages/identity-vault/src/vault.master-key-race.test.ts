import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_KEY, KEYS_STORE, MASTER_KEY, VAULT_STORE } from './types';
import type { Identity, VaultRecord } from './types';

type AddOutcome = 'success' | 'constraint' | 'error';

interface HarnessConfig {
  generatedKeys: CryptoKey[];
  masterReads: Array<CryptoKey | undefined>;
  addOutcomes: AddOutcome[];
}

interface HarnessState {
  masterKey: CryptoKey | null;
  encryptKeys: CryptoKey[];
  vaultWrites: VaultRecord[];
}

function mockCryptoKey(id: string): CryptoKey {
  return { id } as unknown as CryptoKey;
}

async function createSaveIdentityHarness(config: HarnessConfig): Promise<{
  saveIdentity: (identity: Identity) => Promise<void>;
  state: HarnessState;
}> {
  /**
   * Test harness for exercising master-key race conditions in saveIdentity.
   *
   * Strategy: We use vi.doMock to replace the vault's DB, crypto, and env
   * modules with fakes that simulate IndexedDB request/response behavior
   * via queueMicrotask. This lets us control:
   *
   * - Whether a master key already exists in the store (masterReads)
   * - How many keys are generated (generatedKeys)
   * - Whether IDB add() succeeds, hits ConstraintError (another tab won
   *   the race), or fails with a different error (addOutcomes)
   *
   * The harness tracks which CryptoKeys were used for encryption and what
   * vault records were written, so tests can assert that concurrent
   * saveIdentity calls converge on the same winning master key.
   */
  vi.resetModules();

  const state: HarnessState = {
    masterKey: null,
    encryptKeys: [],
    vaultWrites: [],
  };

  let masterReadIndex = 0;
  let addOutcomeIndex = 0;
  let generatedIndex = 0;

  const fakeDb = {
    close: vi.fn(),
    transaction: vi.fn((storeName: string) => {
      expect(storeName).toBe(KEYS_STORE);
      return {
        objectStore: vi.fn(() => ({
          add: vi.fn((value: CryptoKey, key: string) => {
            expect(key).toBe(MASTER_KEY);
            const request: {
              onsuccess: ((this: IDBRequest<unknown>, ev: Event) => unknown) | null;
              onerror: ((this: IDBRequest<unknown>, ev: Event) => unknown) | null;
              error: { name: string } | null;
            } = {
              onsuccess: null,
              onerror: null,
              error: null,
            };

            queueMicrotask(() => {
              const outcome = config.addOutcomes[addOutcomeIndex++] ?? 'success';

              if (outcome === 'success') {
                if (!state.masterKey) state.masterKey = value;
                request.onsuccess?.call(request as unknown as IDBRequest<unknown>, {} as Event);
                return;
              }

              request.error = {
                name: outcome === 'constraint' ? 'ConstraintError' : 'AbortError',
              };
              request.onerror?.call(request as unknown as IDBRequest<unknown>, {} as Event);
            });

            return request as unknown as IDBRequest<unknown>;
          }),
        })),
      } as unknown as IDBTransaction;
    }),
  } as unknown as IDBDatabase;

  vi.doMock('./env', () => ({
    isVaultAvailable: () => true,
  }));

  vi.doMock('./db', () => ({
    openVaultDb: vi.fn(async () => fakeDb),
    idbGet: vi.fn(async (_db: IDBDatabase, storeName: string, key: string) => {
      if (storeName === KEYS_STORE && key === MASTER_KEY) {
        if (masterReadIndex < config.masterReads.length) {
          return config.masterReads[masterReadIndex++];
        }
        return state.masterKey ?? undefined;
      }

      return undefined;
    }),
    idbPut: vi.fn(async (_db: IDBDatabase, storeName: string, key: string, value: unknown) => {
      if (storeName === VAULT_STORE && key === IDENTITY_KEY) {
        state.vaultWrites.push(value as VaultRecord);
      }
    }),
    idbDelete: vi.fn(async () => undefined),
  }));

  vi.doMock('./crypto', () => ({
    generateMasterKey: vi.fn(async () => {
      const key = config.generatedKeys[generatedIndex++];
      if (!key) throw new Error('Missing generated key in test harness');
      return key;
    }),
    encrypt: vi.fn(async (key: CryptoKey, plaintext: Uint8Array) => {
      state.encryptKeys.push(key);
      return {
        iv: new Uint8Array([1]),
        ciphertext: plaintext.buffer.slice(0),
      };
    }),
    decrypt: vi.fn(async () => null),
  }));

  const { saveIdentity } = await import('./vault');
  return { saveIdentity, state };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('ensureMasterKey race handling', () => {
  it('uses the same winning master key when add hits ConstraintError', async () => {
    const { saveIdentity, state } = await createSaveIdentityHarness({
      generatedKeys: [mockCryptoKey('key-a'), mockCryptoKey('key-b')],
      masterReads: [undefined, undefined],
      addOutcomes: ['success', 'constraint'],
    });

    await Promise.all([
      saveIdentity({ id: 'first' }),
      saveIdentity({ id: 'second' }),
    ]);

    expect(state.masterKey).not.toBeNull();
    expect(state.encryptKeys).toHaveLength(2);
    expect(state.encryptKeys[0]).toBe(state.masterKey);
    expect(state.encryptKeys[1]).toBe(state.masterKey);
    expect(state.vaultWrites).toHaveLength(2);
  });

  it('fails closed when add errors with a non-constraint error', async () => {
    const { saveIdentity, state } = await createSaveIdentityHarness({
      generatedKeys: [mockCryptoKey('key-a')],
      masterReads: [undefined],
      addOutcomes: ['error'],
    });

    await expect(saveIdentity({ id: 'identity' })).resolves.toBeUndefined();

    expect(state.encryptKeys).toHaveLength(0);
    expect(state.vaultWrites).toHaveLength(0);
  });

  it('fails closed when constraint error occurs but no key can be re-read', async () => {
    const { saveIdentity, state } = await createSaveIdentityHarness({
      generatedKeys: [mockCryptoKey('key-a')],
      masterReads: [undefined, undefined],
      addOutcomes: ['constraint'],
    });

    await expect(saveIdentity({ id: 'identity' })).resolves.toBeUndefined();

    expect(state.encryptKeys).toHaveLength(0);
    expect(state.vaultWrites).toHaveLength(0);
  });
});
