import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

const { ensureNewsRuntimeStartedMock } = vi.hoisted(() => ({
  ensureNewsRuntimeStartedMock: vi.fn(),
}));

vi.mock('./newsRuntimeBootstrap', () => ({
  ensureNewsRuntimeStarted: (...args: unknown[]) => ensureNewsRuntimeStartedMock(...args),
}));

import { useAppStore, isE2EMode } from './index';
import { createClient } from '@vh/gun-client';
import * as storeModule from './index';

const mockWrite = vi.fn();
const mockHydration = { prepare: vi.fn().mockResolvedValue(undefined), ready: true };
const mockPublishDirectory = vi.fn();
const mockGunAuth = vi.fn((_pair?: any, cb?: (ack?: any) => void) => cb?.({}));
const mockGunUser = { is: null as any, auth: mockGunAuth };

/** Vault mock: stores identity in-memory for store tests (no IndexedDB needed). */
let vaultStore: unknown = null;
vi.mock('@vh/identity-vault', () => ({
  loadIdentity: vi.fn(async () => vaultStore),
  saveIdentity: vi.fn(async (id: unknown) => { vaultStore = id; }),
  clearIdentity: vi.fn(async () => { vaultStore = null; }),
  migrateLegacyLocalStorage: vi.fn(async () => {
    // Simulate migration: read from localStorage, store in vault, clear localStorage
    try {
      const raw = (globalThis as any).localStorage?.getItem('vh_identity');
      if (!raw) return 'noop';
      const parsed = JSON.parse(raw);
      vaultStore = parsed;
      (globalThis as any).localStorage?.removeItem('vh_identity');
      return 'migrated';
    } catch { return 'noop'; }
  }),
  LEGACY_STORAGE_KEY: 'vh_identity',
}));

vi.mock('@vh/gun-client', () => ({
  createClient: vi.fn(() => ({
    hydrationBarrier: mockHydration,
    config: { peers: ['http://localhost:7777/gun'] },
    user: { write: mockWrite },
    chat: { read: vi.fn(), write: vi.fn() },
    outbox: { read: vi.fn(), write: vi.fn() },
    shutdown: vi.fn(),
    gun: { user: () => mockGunUser }
  })),
  publishToDirectory: (...args: unknown[]) => mockPublishDirectory(...(args as [])),
  writeStoryBundle: vi.fn(),
}));

class MemoryStorage {
  #store = new Map<string, string>();
  getItem(key: string) {
    return this.#store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#store.set(key, value);
  }
  removeItem(key: string) {
    this.#store.delete(key);
  }
  clear() {
    this.#store.clear();
  }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
  vaultStore = null;
  mockWrite.mockReset();
  mockHydration.prepare.mockClear();
  mockPublishDirectory.mockReset();
  mockGunAuth.mockClear();
  mockGunUser.is = null;
  (createClient as unknown as Mock).mockClear();
  ensureNewsRuntimeStartedMock.mockReset();
  useAppStore.setState({
    client: null,
    profile: null,
    initializing: false,
    identityStatus: 'idle',
    error: undefined
  });
});

describe('useAppStore', () => {
  it('init sets client after hydration', async () => {
    await useAppStore.getState().init();
    const state = useAppStore.getState();
    expect(state.client).toBeTruthy();
    expect(mockHydration.prepare).toHaveBeenCalled();
    expect(state.identityStatus === 'idle' || state.identityStatus === 'ready').toBe(true);
    expect(ensureNewsRuntimeStartedMock).toHaveBeenCalledWith(state.client);
  });

  it('news runtime bootstrap path remains idempotent across repeated init calls', async () => {
    await useAppStore.getState().init();
    await useAppStore.getState().init();

    expect((createClient as unknown as Mock).mock.calls.length).toBe(1);
    expect(ensureNewsRuntimeStartedMock).toHaveBeenCalledTimes(2);
  });

  it('createIdentity throws when client missing', async () => {
    await expect(useAppStore.getState().createIdentity('alice')).rejects.toThrow('Client not ready');
  });

  it('createIdentity stores profile and persists', async () => {
    await useAppStore.getState().init();
    await useAppStore.getState().createIdentity('alice');
    const state = useAppStore.getState();
    expect(state.profile?.username).toBe('alice');
    expect(mockWrite).toHaveBeenCalled();
    expect((globalThis as any).localStorage.getItem('vh_profile')).toContain('alice');
  });

  it('init respects existing client (early return)', async () => {
    const existingClient = { config: { peers: [] } } as any;
    useAppStore.setState({ client: existingClient });
    await useAppStore.getState().init();
    expect((createClient as unknown as Mock).mock.calls.length).toBe(0);
    expect(ensureNewsRuntimeStartedMock).toHaveBeenCalledWith(existingClient);
  });

  it('init handles corrupted persisted profile gracefully', async () => {
    (globalThis as any).localStorage.setItem('vh_profile', '{bad json');
    await useAppStore.getState().init();
    expect(useAppStore.getState().profile).toBeNull();
    expect(useAppStore.getState().identityStatus).toBe('idle');
  });

  it('authenticates gun user and publishes directory when identity exists', async () => {
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({
        session: { nullifier: 'n1', trustScore: 1 },
        devicePair: { pub: 'device-pub', priv: 'priv', epub: 'epub', epriv: 'epriv' }
      })
    );
    await useAppStore.getState().init();
    expect(mockGunAuth).toHaveBeenCalled();
    expect(mockPublishDirectory).toHaveBeenCalledWith(expect.anything(), {
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'n1',
      devicePub: 'device-pub',
      epub: 'epub',
      registeredAt: expect.any(Number),
      lastSeenAt: expect.any(Number)
    });
  });

  it('continues init when auth fails', async () => {
    mockGunAuth.mockImplementationOnce((_pair?: any, cb?: (ack?: { err?: string }) => void) => cb?.({ err: 'nope' }));
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({
        session: { nullifier: 'n2', trustScore: 1 },
        devicePair: { pub: 'device-pub', priv: 'priv', epub: 'epub', epriv: 'epriv' }
      })
    );
    await useAppStore.getState().init();
    expect(useAppStore.getState().client).toBeTruthy();
    expect(mockPublishDirectory).not.toHaveBeenCalled();
  });

  it('createIdentity falls back when randomUUID is missing and surfaces write errors', async () => {
    vi.stubGlobal('crypto', {} as any);
    await useAppStore.getState().init();
    mockWrite.mockRejectedValueOnce(new Error('fail'));
    await expect(useAppStore.getState().createIdentity('bob')).rejects.toThrow('fail');
    expect(useAppStore.getState().identityStatus).toBe('error');
    vi.unstubAllGlobals();
  });

  it('init surfaces client creation failures', async () => {
    (createClient as unknown as Mock).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await useAppStore.getState().init();
    expect(useAppStore.getState().identityStatus).toBe('error');
    expect(useAppStore.getState().error).toContain('boom');
  });

  it('init loads persisted profile and marks ready', async () => {
    (globalThis as any).localStorage.setItem(
      'vh_profile',
      JSON.stringify({ pubkey: 'pk', username: 'persisted' })
    );
    await useAppStore.getState().init();
    expect(useAppStore.getState().profile?.username).toBe('persisted');
    expect(useAppStore.getState().identityStatus).toBe('ready');
  });

  it('init uses empty peers in E2E mode', async () => {
    (globalThis as any).__VH_E2E_OVERRIDE__ = true;
    const spy = vi.spyOn(storeModule, 'isE2EMode');
    expect(isE2EMode()).toBe(true);
    await useAppStore.getState().init();
    expect((createClient as unknown as Mock).mock.calls).toHaveLength(0);
    expect(useAppStore.getState().client?.config.peers).toEqual([]);
    expect(useAppStore.getState().sessionReady).toBe(true);
    spy.mockRestore();
    delete (globalThis as any).__VH_E2E_OVERRIDE__;
  });
});
