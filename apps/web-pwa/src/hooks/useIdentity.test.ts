// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  delegationSigningKey,
  deviceCredential,
  saveIdentity as vaultSave,
  loadIdentity as vaultLoad,
  clearIdentity as vaultClear,
  LEGACY_STORAGE_KEY,
  walletBinding,
} from '@vh/identity-vault';
import type { Identity } from '@vh/identity-vault';
import type { AttestationPayload } from '@vh/types';

const createSessionMock = vi.fn();
const pairMock = vi.fn();

const SEA_PAIR_1 = Object.freeze({ pub: 'pub', priv: 'priv', epub: 'epub', epriv: 'epriv' });
const SEA_PAIR_2 = Object.freeze({ pub: 'pub-2', priv: 'priv-2', epub: 'epub-2', epriv: 'epriv-2' });

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

async function loadHook(e2eMode = false, envOverrides: Record<string, string | boolean | undefined> = {}) {
  const freshMod = await loadIdentityModule(e2eMode, envOverrides);
  return freshMod.useIdentity;
}

async function loadIdentityModule(
  e2eMode = false,
  envOverrides: Record<string, string | boolean | undefined> = {}
) {
  vi.resetModules();
  const env = {
    VITE_E2E_MODE: e2eMode ? 'true' : 'false',
    VITE_ATTESTATION_URL: 'http://verifier',
    MODE: 'test',
    VITEST: 'true',
    DEV: false,
    ...envOverrides
  };
  vi.stubGlobal('import.meta', {
    env
  });
  vi.stubGlobal('__VH_IMPORT_META_ENV__', env);

  return import('./useIdentity');
}

function mockVerifierByDeviceCredential(trustScore = 0.83) {
  createSessionMock.mockImplementation((attestation: AttestationPayload) => Promise.resolve({
    token: `srv-token:${attestation.deviceKey}`,
    trustScore,
    nullifier: `nullifier:${attestation.deviceKey}`
  }));
}

describe('useIdentity', () => {
  beforeEach(async () => {
    await deleteDatabase('vh-vault');
    localStorage.clear();
    createSessionMock.mockReset();
    pairMock.mockReset();
    pairMock.mockResolvedValue(SEA_PAIR_1);
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

    const { useXpLedger } = await import('../store/xpLedger');
    expect(useXpLedger.getState().activeNullifier).toBe('null1');
    expect(useXpLedger.getState().budget?.nullifier).toBe('null1');
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
    const { useXpLedger } = await import('../store/xpLedger');
    const snapshot = getPublishedIdentity();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.session.nullifier).toBe('stable-nullifier');
    expect(useXpLedger.getState().activeNullifier).toBe('stable-nullifier');
    expect(useXpLedger.getState().budget?.nullifier).toBe('stable-nullifier');
    expect(snapshot!.session.trustScore).toBe(0.751);
    // Provider must NOT contain private keys
    expect((snapshot as any).devicePair).toBeUndefined();
    expect((snapshot as any).session.token).toBeUndefined();
  });

  it('creates a public-beta beta-local AssuranceEnvelope without using the verifier or dev fallback', async () => {
    const useIdentity = await loadHook(false, {
      VITE_LUMA_PROFILE: 'public-beta',
      VITE_SESSION_LIFECYCLE_ENABLED: 'true',
      MODE: 'production',
      VITEST: 'false',
      DEV: false,
      VITE_ATTESTATION_URL: undefined
    });
    const { result } = renderHook(() => useIdentity());

    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    await act(async () => {
      await result.current.createIdentity();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(result.current.identity?.assuranceEnvelope).toMatchObject({
      envelopeVersion: 1,
      signatureSuite: 'jcs-ed25519-sha256-v1',
      assuranceLevel: 'beta_local',
      verifierId: 'beta-local',
      policyVersion: 'beta-local-v1',
      evidenceRecordRef: {
        kind: 'local'
      },
      limitations: expect.arrayContaining([
        'no-remote-attestation',
        'no-residency-proof',
        'no-coercion-resistance',
        'no-recovery'
      ])
    });
    expect(result.current.identity?.assuranceEnvelope?.claimVector).toEqual({
      device_integrity: 'beta_local',
      liveness: 'beta_local',
      human_uniqueness: 'none',
      residency: 'none',
      coercion_resistance: 'none',
      recovery_strength: 'none'
    });
    expect(result.current.identity?.session.trustScore).toBe(0.5);
    expect(result.current.identity?.session.nullifier).toMatch(/^[0-9a-f]{64}$/);
    expect(result.current.identity?.session.expiresAt).toBeGreaterThan(Date.now());

    const fromVault = await vaultLoad();
    expect((fromVault as any)?.assuranceEnvelope?.verifierId).toBe('beta-local');
  });

  it.each([
    [
      'E2E mode',
      { VITE_E2E_MODE: 'true', VITE_LUMA_PROFILE: 'public-beta', MODE: 'production', VITEST: 'false', DEV: false },
      'VITE_E2E_MODE=false'
    ],
    [
      'dev build',
      { VITE_LUMA_PROFILE: 'public-beta', MODE: 'development', VITEST: 'false', DEV: true },
      'dev-mode build'
    ],
    [
      'dev fallback flag',
      { VITE_LUMA_PROFILE: 'public-beta', MODE: 'production', VITEST: 'false', DEV: false, VITE_LUMA_DEV_FALLBACK: 'true' },
      'VITE_LUMA_DEV_FALLBACK'
    ],
    [
      'localhost verifier',
      { VITE_LUMA_PROFILE: 'public-beta', MODE: 'production', VITEST: 'false', DEV: false, VITE_ATTESTATION_URL: 'http://localhost:3000/verify' },
      'localhost verifier'
    ]
  ])('fails closed for forbidden public-beta runtime case: %s', async (_label, env, message) => {
    const useIdentity = await loadHook(false, env);
    const { result } = renderHook(() => useIdentity());

    await waitFor(() => expect(['anonymous', 'error']).toContain(result.current.status));
    if (result.current.status !== 'error') {
      await act(async () => {
        await result.current.createIdentity();
      });
    }

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toContain(message);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it('signOut preserves device-bound compartments, delegation storage, and XP continuity', async () => {
    mockVerifierByDeviceCredential();

    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());
    const { useXpLedger } = await import('../store/xpLedger');
    const { delegationStorageKey, useDelegationStore } = await import('../store/delegation');

    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    await act(async () => {
      await result.current.createIdentity();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const firstNullifier = result.current.identity?.session.nullifier;
    const firstDeviceKey = createSessionMock.mock.calls[0]?.[0]?.deviceKey;
    const firstDevicePair = result.current.identity?.devicePair;
    const firstDeviceCredential = await deviceCredential.loadOrCreate();
    const firstDelegationPublicKey = await delegationSigningKey.publicKey();
    expect(firstDeviceKey).toEqual(expect.any(String));
    expect(firstNullifier).toBe(`nullifier:${firstDeviceKey}`);
    expect(firstDevicePair).toEqual(SEA_PAIR_1);
    expect(pairMock).toHaveBeenCalledTimes(1);

    useXpLedger.getState().addXp('civic', 4);
    localStorage.setItem(delegationStorageKey(firstNullifier!), '{"grants":[{"grantId":"g-1"}]}');
    useDelegationStore.getState().setActivePrincipal(firstNullifier!);
    const firstWalletBinding = await walletBinding.save({
      address: '0x1111111111111111111111111111111111111111',
      chainId: '1',
      providerKind: 'browser-injected',
      boundPrincipalNullifier: firstNullifier!,
      now: 1000
    });

    await act(async () => {
      await result.current.signOut();
    });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(useDelegationStore.getState().activePrincipal).toBeNull();
    expect(localStorage.getItem(delegationStorageKey(firstNullifier!))).toBe('{"grants":[{"grantId":"g-1"}]}');
    expect(useXpLedger.getState().activeNullifier).toBeNull();
    expect(await deviceCredential.loadOrCreate()).toEqual(firstDeviceCredential);
    expect(await delegationSigningKey.publicKey()).toEqual(firstDelegationPublicKey);
    expect(await walletBinding.load()).toEqual(firstWalletBinding);

    await act(async () => {
      await result.current.createIdentity();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.identity?.session.nullifier).toBe(firstNullifier);
    expect(createSessionMock.mock.calls[1]?.[0]?.deviceKey).toBe(firstDeviceKey);
    expect(result.current.identity?.devicePair).toEqual(firstDevicePair);
    expect(pairMock).toHaveBeenCalledTimes(1);
    expect(useXpLedger.getState().activeNullifier).toBe(firstNullifier);
    expect(useXpLedger.getState().civicXP).toBeGreaterThanOrEqual(4);

    const fromVault = await vaultLoad();
    expect((fromVault as any)?.attestation.deviceKey).toBe(firstDeviceKey);
    expect((fromVault as any)?.devicePair).toEqual(firstDevicePair);
  });

  it('resetIdentity rotates device-bound compartments and clears old-principal delegation storage', async () => {
    mockVerifierByDeviceCredential(0.9);
    pairMock
      .mockResolvedValueOnce(SEA_PAIR_1)
      .mockResolvedValueOnce(SEA_PAIR_2);

    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());
    const { delegationStorageKey, useDelegationStore } = await import('../store/delegation');

    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    await act(async () => {
      await result.current.createIdentity();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const firstNullifier = result.current.identity!.session.nullifier;
    const firstDeviceKey = createSessionMock.mock.calls[0]?.[0]?.deviceKey;
    const firstDeviceCredential = await deviceCredential.loadOrCreate();
    const firstDelegationPublicKey = await delegationSigningKey.publicKey();
    localStorage.setItem(delegationStorageKey(firstNullifier), '{"grants":[{"grantId":"old"}]}');
    useDelegationStore.getState().setActivePrincipal(firstNullifier);
    await walletBinding.save({
      address: '0x2222222222222222222222222222222222222222',
      chainId: '31337',
      providerKind: 'e2e-mock',
      boundPrincipalNullifier: firstNullifier,
      now: 1000
    });

    await act(async () => {
      await result.current.resetIdentity();
    });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    expect(localStorage.getItem(delegationStorageKey(firstNullifier))).toBeNull();
    expect(useDelegationStore.getState().activePrincipal).toBeNull();
    expect(await vaultLoad()).toBeNull();
    expect(await walletBinding.load()).toBeNull();
    expect(await deviceCredential.loadOrCreate()).not.toEqual(firstDeviceCredential);
    expect(await delegationSigningKey.publicKey()).not.toEqual(firstDelegationPublicKey);
    expect(pairMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.createIdentity();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const secondDeviceKey = createSessionMock.mock.calls[1]?.[0]?.deviceKey;
    expect(secondDeviceKey).not.toBe(firstDeviceKey);
    expect(result.current.identity?.session.nullifier).toBe(`nullifier:${secondDeviceKey}`);
    expect(result.current.identity?.session.nullifier).not.toBe(firstNullifier);
    expect(result.current.identity?.devicePair).toEqual(SEA_PAIR_2);
  });

  it('keeps revokeSession as a deprecated signOut shim', async () => {
    mockVerifierByDeviceCredential();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const useIdentity = await loadHook();
      const { result } = renderHook(() => useIdentity());

      await waitFor(() => expect(result.current.status).toBe('anonymous'));
      await act(async () => {
        await result.current.createIdentity();
      });
      await waitFor(() => expect(result.current.status).toBe('ready'));

      const firstDeviceCredential = await deviceCredential.loadOrCreate();

      await act(async () => {
        await result.current.revokeSession();
      });

      await waitFor(() => expect(result.current.status).toBe('anonymous'));
      expect(warning).toHaveBeenCalledWith('[vh:identity] useIdentity.revokeSession() is deprecated; use signOut() instead');
      expect(await deviceCredential.loadOrCreate()).toEqual(firstDeviceCredential);
    } finally {
      warning.mockRestore();
    }
  });

  it('fails closed for deferred multi-device link methods without mutating identity state', async () => {
    mockVerifierByDeviceCredential();
    const identityModule = await loadIdentityModule();
    const { MULTI_DEVICE_LINK_DEFERRED_CODE, useIdentity } = identityModule;
    const { result } = renderHook(() => useIdentity());

    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    await act(async () => {
      await result.current.createIdentity();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const originalIdentity = result.current.identity;
    expect(originalIdentity).toBeTruthy();
    expect(originalIdentity?.linkedDevices).toBeUndefined();
    expect(originalIdentity?.pendingLinkCode).toBeUndefined();

    await expect(result.current.linkDevice()).rejects.toMatchObject({
      code: MULTI_DEVICE_LINK_DEFERRED_CODE,
      capability: 'multi-device-link',
      phase: 'Phase 3+'
    });
    await expect(result.current.startLinkSession()).rejects.toMatchObject({
      code: MULTI_DEVICE_LINK_DEFERRED_CODE,
      capability: 'multi-device-link',
      phase: 'Phase 3+'
    });
    await expect(result.current.completeLinkSession('legacy-code')).rejects.toMatchObject({
      code: MULTI_DEVICE_LINK_DEFERRED_CODE,
      capability: 'multi-device-link',
      phase: 'Phase 3+'
    });

    expect(result.current.identity).toEqual(originalIdentity);
    expect(result.current.identity?.linkedDevices).toBeUndefined();
    expect(result.current.identity?.pendingLinkCode).toBeUndefined();

    const fromVault = await vaultLoad();
    expect((fromVault as any)?.linkedDevices).toBeUndefined();
    expect((fromVault as any)?.pendingLinkCode).toBeUndefined();
  });

  it('promotes legacy attestation/device pair into stable vault compartments', async () => {
    const legacyDevicePair = {
      pub: 'legacy-pub',
      priv: 'legacy-priv',
      epub: 'legacy-epub',
      epriv: 'legacy-epriv'
    };
    const legacy = {
      id: 'legacy-id',
      createdAt: 500,
      attestation: {
        platform: 'web',
        integrityToken: 'lt',
        deviceKey: 'legacy-device-key',
        nonce: 'ln'
      },
      session: {
        token: 'lt',
        trustScore: 0.8,
        scaledTrustScore: 8000,
        nullifier: 'legacy-null'
      },
      devicePair: legacyDevicePair,
      handle: 'legacy_user'
    };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));
    createSessionMock.mockResolvedValue({
      token: 'srv-token',
      trustScore: 0.84,
      nullifier: 'fresh-nullifier'
    });

    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.identity?.session.nullifier).toBe('legacy-null');

    await act(async () => {
      await result.current.signOut();
    });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    await act(async () => {
      await result.current.createIdentity();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(createSessionMock.mock.calls[0]?.[0]?.deviceKey).toBe('legacy-device-key');
    expect(result.current.identity?.devicePair).toEqual(legacyDevicePair);
    expect(pairMock).not.toHaveBeenCalled();
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
