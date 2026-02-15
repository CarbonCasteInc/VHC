import type { VennClient } from '@vh/gun-client';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

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
        const store = JSON.parse(safeGetItem(key) || '{}') as Record<string, unknown>;
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
        safeSetItem(key, JSON.stringify(store));
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
        const store = JSON.parse(safeGetItem(key) || '{}');
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
  },
};

export function createMockClient(): VennClient {
  const mockUserChain = {
    is: { pub: 'mock-pub' },
    auth: (_pair?: any, cb?: (ack?: { err?: string }) => void) => {
      cb?.({});
      return Promise.resolve({} as any);
    },
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
            list() {
              return sharedMeshOps.list(path);
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
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as VennClient['mesh'];

  return {
    config: { peers: [] },
    hydrationBarrier: { ready: true, prepare: async () => {} } as any,
    storage: {
      backend: 'memory',
      hydrate: async () => {},
      write: async () => {},
      read: async () => null,
      close: async () => {},
    } as any,
    gun: { user: () => mockUserChain, get: mesh.get.bind(mesh) } as any,
    topologyGuard: { validateWrite: () => {} } as any,
    user: {
      is: mockUserChain.is,
      create: async () => ({ pub: 'mock-pub', priv: 'mock-priv', epub: '', epriv: '' }),
      auth: async () => ({ pub: 'mock-pub', priv: 'mock-priv', epub: '', epriv: '' }),
      leave: async () => {},
    } as any,
    chat: { send: async () => {} } as any,
    outbox: { enqueue: async () => {} } as any,
    mesh,
    sessionReady: true,
    markSessionReady: () => {},
    linkDevice: async () => {},
    shutdown: async () => {},
  };
}
