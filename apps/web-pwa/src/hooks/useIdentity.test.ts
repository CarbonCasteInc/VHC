// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveIdentity as vaultSave,
  loadIdentity as vaultLoad,
  clearIdentity as vaultClear,
  LEGACY_STORAGE_KEY,
} from '@vh/identity-vault';
import type { Identity } from '@vh/identity-vault';

const createSessionMock = vi.fn();
const pairMock = vi.fn();

vi.mock('@vh/gun-client', () => ({
  createSession: (...args: unknown[]) => createSessionMock(...(args as [])),
  SEA: {
    pair: (...args: unknown[]) => pairMock(...(args as []))
  }
}));

vi.mock('../store', () => ({
  useAppStore: { getState: () => ({ client: null }) },
  authenticateGunUser: vi.fn(),
  publishDirectoryEntry: vi.fn()
}));

/** Delete the IDB database between tests. */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function loadHook(e2eMode = false) {
  vi.resetModules();
  vi.stubGlobal('import.meta', {
    env: {
      VITE_E2E_MODE: e2eMode ? 'true' : 'false',
      VITE_ATTESTATION_URL: 'http://verifier'
    }
  });

  const freshMod = await import('./useIdentity');
  return freshMod.useIdentity;
}

describe('useIdentity', () => {
  beforeEach(async () => {
    await deleteDatabase('vh-vault');
    localStorage.clear();
    createSessionMock.mockReset();
    pairMock.mockReset();
    pairMock.mockResolvedValue({ pub: 'pub', priv: 'priv', epub: 'epub', epriv: 'epriv' });
  });

  it('starts in hydrating state and resolves to anonymous when vault is empty', async () => {
    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());

    // Initially hydrating
    expect(result.current.status).toBe('hydrating');

    // After vault loads (empty), transitions to anonymous
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(result.current.identity).toBeNull();
  });

  it('hydrates identity from vault on mount', async () => {
    // Pre-seed the vault
    const seeded: Identity = {
      id: 'test-id',
      createdAt: 1000,
      attestation: { platform: 'web', integrityToken: 'tok', deviceKey: 'dk', nonce: 'n' },
      session: { token: 't', trustScore: 0.9, scaledTrustScore: 9000, nullifier: 'null1' },
      handle: 'alice'
    };
    await vaultSave(seeded);

    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.identity?.handle).toBe('alice');
    expect(result.current.identity?.session.nullifier).toBe('null1');
  });

  it('migrates legacy localStorage identity to vault on startup', async () => {
    const legacy = {
      id: 'legacy-id',
      createdAt: 500,
      attestation: { platform: 'web', integrityToken: 'lt', deviceKey: 'ldk', nonce: 'ln' },
      session: { token: 'lt', trustScore: 0.8, scaledTrustScore: 8000, nullifier: 'legacy-null' },
      handle: 'legacy_user'
    };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));

    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.identity?.handle).toBe('legacy_user');
    expect(result.current.identity?.session.nullifier).toBe('legacy-null');

    // Legacy key is cleaned up after migration (no localStorage identity cache)
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

    // Vault must have the identity
    const fromVault = await vaultLoad();
    expect((fromVault as any)?.handle).toBe('legacy_user');
  });

  it('persists new identity via vault (not localStorage)', async () => {
    createSessionMock.mockResolvedValue({
      token: 'srv-token',
      trustScore: 0.751,
      nullifier: 'stable-nullifier'
    });

    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());

    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    await act(async () => {
      await result.current.createIdentity();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.identity?.session.nullifier).toBe('stable-nullifier');
    expect(result.current.identity?.session.scaledTrustScore).toBe(7510);
    expect(result.current.identity?.devicePair?.epub).toBe('epub');

    // AC3: localStorage does not contain any identity snapshot
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

    // Must be in vault
    const fromVault = await vaultLoad();
    expect((fromVault as any)?.session.nullifier).toBe('stable-nullifier');

    // Identity provider must have public snapshot (no secrets)
    const { getPublishedIdentity } = await import('../store/identityProvider');
    const snapshot = getPublishedIdentity();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.session.nullifier).toBe('stable-nullifier');
    expect(snapshot!.session.trustScore).toBe(0.751);
    // Provider must NOT contain private keys
    expect((snapshot as any).devicePair).toBeUndefined();
    expect((snapshot as any).session.token).toBeUndefined();
  });

  it('clamps scaled trust score to 10000 when verifier reports >1', async () => {
    createSessionMock.mockResolvedValue({
      token: 'srv-token',
      trustScore: 1.5,
      nullifier: 'n-high'
    });

    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());

    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    await act(async () => {
      await result.current.createIdentity();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.identity?.session.scaledTrustScore).toBe(10000);
  });

  it('persists a valid handle and rejects invalid handle', async () => {
    createSessionMock.mockResolvedValue({
      token: 'srv-token',
      trustScore: 0.9,
      nullifier: 'n-handle'
    });
    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());

    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    await act(async () => {
      await result.current.createIdentity('valid_handle');
    });
    await waitFor(() => expect(result.current.identity?.handle).toBe('valid_handle'));

    // Handle persists to vault
    const fromVault = await vaultLoad();
    expect((fromVault as any)?.handle).toBe('valid_handle');

    await expect(
      act(async () => {
        await result.current.updateHandle('!!bad');
      })
    ).rejects.toThrow(/Handle can only contain letters/);
  });

  it('vault-unavailable: identity is null, no throw', async () => {
    const originalIdb = globalThis.indexedDB;
    try {
      // @ts-expect-error — intentionally removing for test
      delete globalThis.indexedDB;

      const useIdentity = await loadHook();
      const { result } = renderHook(() => useIdentity());

      // Should resolve to anonymous without throwing
      await waitFor(() => expect(result.current.status).toBe('anonymous'));
      expect(result.current.identity).toBeNull();
    } finally {
      globalThis.indexedDB = originalIdb;
    }
  });
});
