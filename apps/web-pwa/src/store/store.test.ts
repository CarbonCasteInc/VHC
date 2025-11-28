import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, isE2EMode } from './index';
import { createClient } from '@vh/gun-client';
import * as storeModule from './index';

const mockWrite = vi.fn();
const mockHydration = { prepare: vi.fn().mockResolvedValue(undefined), ready: true };

vi.mock('@vh/gun-client', () => ({
  createClient: vi.fn(() => ({
    hydrationBarrier: mockHydration,
    config: { peers: ['http://localhost:9780/gun'] },
    user: { write: mockWrite },
    chat: { read: vi.fn(), write: vi.fn() },
    outbox: { read: vi.fn(), write: vi.fn() },
    shutdown: vi.fn()
  }))
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
  mockWrite.mockReset();
  mockHydration.prepare.mockClear();
  (createClient as unknown as vi.Mock).mockClear();
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
    useAppStore.setState({ client: { config: { peers: [] } } as any });
    await useAppStore.getState().init();
    expect((createClient as unknown as vi.Mock).mock.calls.length).toBe(0);
  });

  it('init handles corrupted persisted profile gracefully', async () => {
    (globalThis as any).localStorage.setItem('vh_profile', '{bad json');
    await useAppStore.getState().init();
    expect(useAppStore.getState().profile).toBeNull();
    expect(useAppStore.getState().identityStatus).toBe('idle');
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
    (createClient as unknown as vi.Mock).mockImplementationOnce(() => {
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
    expect((createClient as unknown as vi.Mock).mock.calls).toHaveLength(0);
    expect(useAppStore.getState().client?.config.peers).toEqual([]);
    expect(useAppStore.getState().sessionReady).toBe(true);
    spy.mockRestore();
    delete (globalThis as any).__VH_E2E_OVERRIDE__;
  });
});
