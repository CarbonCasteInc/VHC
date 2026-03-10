import Gun from 'gun';
import type { IGunInstance } from 'gun';
import type { ChainWithGet } from './chain';
import { createHydrationBarrier } from './sync/barrier';
import { TopologyGuard } from './topology';
import type { Namespace, VennClient, VennClientConfig } from './types';

const DEFAULT_PEERS = ['http://localhost:7777/gun'];

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
  const gun = Gun({
    peers,
    localStorage: false,
    radisk: false,
    file: false,
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
