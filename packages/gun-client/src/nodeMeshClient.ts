import Gun from 'gun';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IGunInstance } from 'gun';
import type { ChainWithGet } from './chain';
import { createHydrationBarrier } from './sync/barrier';
import { TopologyGuard } from './topology';
import type { Namespace, VennClient, VennClientConfig } from './types';

const DEFAULT_PEERS = ['http://127.0.0.1:7777/gun'];
const requireNodeGunModule = createRequire(import.meta.url);

let wsAdapterInstalled = false;

function normalizePeers(peers?: string[]): string[] {
  const list = peers !== undefined ? peers : DEFAULT_PEERS;
  return list.map((peer) => {
    const trimmed = peer.trim();
    if (trimmed.endsWith('/gun')) {
      return trimmed;
    }
    return `${trimmed.replace(/\/+$/, '')}/gun`;
  });
}

function defaultNodeGunFile(): string {
  const suffix = Math.random().toString(36).slice(2);
  return path.join(tmpdir(), `vh-node-mesh-${process.pid}-${suffix}`);
}

function installNodeGunWsAdapter(): void {
  if (wsAdapterInstalled) {
    return;
  }
  const gunWithInternals = Gun as unknown as {
    text?: { random?: (length?: number) => string };
    obj?: {
      map?: (obj: unknown, cb: (value: unknown, key: string) => void, ctx?: unknown) => unknown;
      del?: (obj: Record<string, unknown> | undefined, key: string) => Record<string, unknown> | undefined;
    };
  };
  gunWithInternals.text = gunWithInternals.text ?? {};
  gunWithInternals.text.random = gunWithInternals.text.random ?? ((length = 6) => {
    let value = '';
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXZabcdefghijklmnopqrstuvwxyz';
    for (let index = 0; index < length; index += 1) {
      value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return value;
  });
  gunWithInternals.obj = gunWithInternals.obj ?? {};
  gunWithInternals.obj.map = gunWithInternals.obj.map ?? ((obj, cb, ctx) => {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }
    Object.entries(obj as Record<string, unknown>).forEach(([key, value]) => cb.call(ctx, value, key));
    return obj;
  });
  gunWithInternals.obj.del = gunWithInternals.obj.del ?? ((obj, key) => {
    if (obj) {
      delete obj[key];
    }
    return obj;
  });
  requireNodeGunModule('gun/lib/ws.js');
  wsAdapterInstalled = true;
}

function createUnsupportedNamespace<T>(): Namespace<T> {
  return {
    async read(): Promise<T | null> {
      throw new Error('Stateless node mesh client does not support namespace reads');
    },
    async write(_value: T): Promise<void> {
      throw new Error('Stateless node mesh client does not support namespace writes');
    },
  };
}

function createStatelessStorage(): VennClient['storage'] {
  return {
    backend: 'memory',
    async hydrate(): Promise<void> {},
    async write(): Promise<void> {},
    async read(): Promise<null> {
      return null;
    },
    async close(): Promise<void> {},
  };
}

export function createNodeMeshClient(config: VennClientConfig = {}): VennClient {
  const peers = normalizePeers(config.peers);
  const hydrationBarrier = createHydrationBarrier();
  hydrationBarrier.markReady();

  const topologyGuard = config.topologyGuard ?? new TopologyGuard();
  const storage = createStatelessStorage();
  const gunRadisk = config.gunRadisk ?? false;
  const gunFile = config.gunFile ?? (gunRadisk ? defaultNodeGunFile() : false);
  installNodeGunWsAdapter();
  const gun = Gun({
    peers,
    localStorage: false,
    radisk: gunRadisk,
    file: gunFile,
    axe: false,
  } as never) as IGunInstance;
  const mesh = gun.get('vh') as unknown as ChainWithGet<Record<string, unknown>>;
  const unsupportedNamespace = createUnsupportedNamespace<Record<string, unknown>>();

  let sessionReady = false;

  return {
    config: { ...config, peers },
    hydrationBarrier,
    storage,
    topologyGuard,
    gun,
    mesh,
    user: unsupportedNamespace,
    chat: unsupportedNamespace,
    outbox: unsupportedNamespace,
    sessionReady,
    markSessionReady() {
      sessionReady = true;
    },
    async linkDevice(): Promise<void> {
      throw new Error('Stateless node mesh client does not support device linking');
    },
    async shutdown(): Promise<void> {
      (gun as IGunInstance & { off?: () => void }).off?.();
      await storage.close();
    },
  };
}

export const __NODE_MESH_TESTING__ = {
  defaultNodeGunFile,
  installNodeGunWsAdapter,
};
