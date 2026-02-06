import { create } from 'zustand';
import { createClient, publishToDirectory, type VennClient } from '@vh/gun-client';
import type { DirectoryEntry, Profile } from '@vh/data-model';
import type { DevicePair, IdentityRecord } from '@vh/types';
import { migrateLegacyLocalStorage } from '@vh/identity-vault';
import { loadIdentityRecord } from '../utils/vaultTyped';

const PROFILE_KEY = 'vh_profile';
const E2E_OVERRIDE_KEY = '__VH_E2E_OVERRIDE__';
type IdentityStatus = 'idle' | 'creating' | 'ready' | 'error';

interface AppState {
  client: VennClient | null;
  profile: Profile | null;
  sessionReady: boolean;
  initializing: boolean;
  identityStatus: IdentityStatus;
  error?: string;
  init: () => Promise<void>;
  createIdentity: (username: string) => Promise<void>;
}

function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function persistProfile(profile: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isE2EMode(): boolean {
  const override = (globalThis as any)[E2E_OVERRIDE_KEY];
  if (typeof override === 'boolean') {
    return override;
  }
  return (import.meta as any).env?.VITE_E2E_MODE === 'true';
}

function resolveGunPeers(): string[] {
  const raw = (import.meta as any).env?.VITE_GUN_PEERS;
  if (raw && typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p) => (p.endsWith('/gun') ? p : `${p.replace(/\/+$/, '')}/gun`));
      }
    } catch {
      const parts = raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => (p.endsWith('/gun') ? p : `${p.replace(/\/+$/, '')}/gun`));
      if (parts.length > 0) return parts;
    }
  }
  // Default to Tailscale-accessible relay; fallback to localhost if needed.
  return ['http://100.75.18.26:7777/gun', 'http://localhost:7777/gun'];
}

/**
 * Check if we're in a multi-user E2E test with shared mesh
 * (set by Playwright fixture via addInitScript)
 */
function useSharedMesh(): boolean {
  return typeof window !== 'undefined' && (window as any).__VH_USE_SHARED_MESH__ === true;
}

/**
 * Shared mesh functions exposed by Playwright fixture.
 * Falls back to localStorage when not in multi-user test.
 */
const sharedMeshOps = {
  async write(path: string, value: any): Promise<void> {
    if (useSharedMesh() && typeof (window as any).__vhMeshWrite === 'function') {
      await (window as any).__vhMeshWrite(path, value);
    } else {
      // Fallback to localStorage
      const key = '__VH_MESH_STORE__';
      try {
        const store = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, unknown>;
        const parts = path.split('/');
        let current: Record<string, unknown> = store;
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!part) continue;
          const existing = current[part];
          if (!existing || typeof existing !== 'object') {
            current[part] = {};
          }
          current = current[part] as Record<string, unknown>;
        }
        const leaf = parts[parts.length - 1];
        if (!leaf) return;
        current[leaf] = value;
        localStorage.setItem(key, JSON.stringify(store));
      } catch {
        /* ignore */
      }
    }
  },
  
  async read(path: string): Promise<any> {
    if (useSharedMesh() && typeof (window as any).__vhMeshRead === 'function') {
      return await (window as any).__vhMeshRead(path);
    } else {
      // Fallback to localStorage
      const key = '__VH_MESH_STORE__';
      try {
        const store = JSON.parse(localStorage.getItem(key) || '{}');
        const parts = path.split('/');
        let current = store;
        for (const part of parts) {
          current = current?.[part];
        }
        return current ?? null;
      } catch {
        return null;
      }
    }
  },
  
  async list(prefix: string): Promise<Array<{ path: string; value: any }>> {
    if (useSharedMesh() && typeof (window as any).__vhMeshList === 'function') {
      return await (window as any).__vhMeshList(prefix);
    }
    return [];
  }
};

export async function authenticateGunUser(client: VennClient, devicePair: DevicePair): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = client.gun.user();
    if ((user as any).is) {
      console.info('[vh:gun] Already authenticated');
      resolve();
      return;
    }
    user.auth(devicePair as any, (ack: any) => {
      if (ack?.err) {
        console.error('[vh:gun] Auth failed:', ack.err);
        reject(new Error(ack.err));
      } else {
        console.info('[vh:gun] Authenticated as', devicePair.pub.slice(0, 12) + '...');
        resolve();
      }
    });
  });
}

export async function publishDirectoryEntry(client: VennClient, identity: IdentityRecord): Promise<void> {
  if (!identity.devicePair) {
    throw new Error('Device keypair missing');
  }
  const entry: DirectoryEntry = {
    schemaVersion: 'hermes-directory-v0',
    nullifier: identity.session.nullifier,
    devicePub: identity.devicePair.pub,
    epub: identity.devicePair.epub,
    registeredAt: Date.now(),
    lastSeenAt: Date.now()
  };
  await publishToDirectory(client, entry);
  console.info('[vh:directory] Published entry for', identity.session.nullifier.slice(0, 20) + '...');
}

function createMockClient(): VennClient {
  const mockUserChain = {
    is: { pub: 'mock-pub' },
    auth: (_pair?: any, cb?: (ack?: { err?: string }) => void) => {
      cb?.({});
      return Promise.resolve({} as any);
    }
  };
  const mesh = {
    get(scope: string) {
      return {
        get(key: string) {
          const path = `${scope}/${key}`;
          return {
            once(cb: (data: any) => void) {
              sharedMeshOps.read(path).then(cb);
            },
            put(value: any, cb?: (ack?: { err?: string }) => void) {
              sharedMeshOps.write(path, value).then(() => cb?.());
            },
            get(subKey: string) {
              const subPath = `${path}/${subKey}`;
              return {
                once(cb: (data: any) => void) {
                  sharedMeshOps.read(subPath).then(cb);
                },
                put(value: any, cb?: (ack?: { err?: string }) => void) {
                  sharedMeshOps.write(subPath, value).then(() => cb?.());
                },
                get(subSubKey: string) {
                  const subSubPath = `${subPath}/${subSubKey}`;
                  return {
                    once(cb: (data: any) => void) {
                      sharedMeshOps.read(subSubPath).then(cb);
                    },
                    put(value: any, cb?: (ack?: { err?: string }) => void) {
                      sharedMeshOps.write(subSubPath, value).then(() => cb?.());
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  } as unknown as VennClient['mesh'];

  return {
    config: { peers: [] },
    hydrationBarrier: { ready: true, prepare: async () => { } } as any,
    storage: {
      backend: 'memory',
      hydrate: async () => { },
      write: async () => { },
      read: async () => null,
      close: async () => { }
    } as any,
    gun: { user: () => mockUserChain, get: mesh.get.bind(mesh) } as any,
    topologyGuard: { validateWrite: () => {} } as any,
    user: {
      is: mockUserChain.is,
      create: async () => ({ pub: 'mock-pub', priv: 'mock-priv', epub: '', epriv: '' }),
      auth: async () => ({ pub: 'mock-pub', priv: 'mock-priv', epub: '', epriv: '' }),
      leave: async () => { }
    } as any,
    chat: { send: async () => { } } as any,
    outbox: { enqueue: async () => { } } as any,
    mesh,
    sessionReady: true,
    markSessionReady: () => { },
    linkDevice: async () => { },
    shutdown: async () => { }
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  client: null,
  profile: null,
  sessionReady: false,
  initializing: false,
  identityStatus: 'idle',
  async init() {
    if (get().client) return;
    set({ initializing: true, error: undefined });
    try {
      const e2e = isE2EMode();
      if (e2e) {
        console.info('[vh:web-pwa] Starting in E2E/Offline Mode with mocked client');
        const mockClient = createMockClient();
        const profile = loadProfile();
        set({
          client: mockClient,
          initializing: false,
          sessionReady: true,
          identityStatus: profile ? 'ready' : 'idle',
          profile
        });
        return;
      }

      const client = createClient({
        peers: resolveGunPeers(),
        requireSession: true
      });
      console.info('[vh:web-pwa] using Gun peers', client.config.peers);
      await client.hydrationBarrier.prepare();
      const profile = loadProfile();
      // Migration runs in useIdentity's ensureMigrated(); safe to call again (idempotent)
      await migrateLegacyLocalStorage();
      const identity = await loadIdentityRecord();
      if (identity?.devicePair) {
        try {
          await authenticateGunUser(client, identity.devicePair);
          await publishDirectoryEntry(client, identity);
        } catch (err) {
          console.warn('[vh:gun] Auth/directory publish failed, continuing anyway:', err);
        }
      }
      set({
        client,
        profile,
        initializing: false,
        identityStatus: profile ? 'ready' : 'idle',
        sessionReady: Boolean(profile)
      });
    } catch (err) {
      set({ initializing: false, identityStatus: 'error', error: (err as Error).message });
    }
  },
  async createIdentity(username: string) {
    const client = get().client;
    if (!client) {
      throw new Error('Client not ready');
    }
    set({ identityStatus: 'creating', error: undefined });
    try {
      const e2e = isE2EMode();
      if (e2e) {
        const profile: Profile = { pubkey: 'e2e-pub', username };
        persistProfile(profile);
        set({ sessionReady: true, profile, identityStatus: 'ready' });
        return;
      }
      const profile: Profile = {
        pubkey: randomId(),
        username
      };
      client.markSessionReady?.();
      await client.user.write(profile);
      persistProfile(profile);
      set({ profile, identityStatus: 'ready', sessionReady: true });
    } catch (err) {
      set({ identityStatus: 'error', error: (err as Error).message });
      throw err;
    }
  }
}));
