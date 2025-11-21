import Gun from 'gun';
import type { IGunInstance } from 'gun';
import { createStorageAdapter, type StorageAdapter } from './storage/adapter';
import { HydrationBarrier, createHydrationBarrier } from './sync/barrier';
import type { Namespace, VennClientConfig } from './types';

interface ChainAck {
  err?: string;
}

interface ChainLike<T> {
  once(callback: (data: T | undefined) => void): unknown;
  put(value: T, callback?: (ack?: ChainAck) => void): unknown;
}

const DEFAULT_PEERS = ['http://localhost:7777/gun'];

export interface VennClient {
  config: VennClientConfig & { peers: string[] };
  hydrationBarrier: HydrationBarrier;
  storage: StorageAdapter;
  user: Namespace<Record<string, unknown>>;
  chat: Namespace<Record<string, unknown>>;
  outbox: Namespace<Record<string, unknown>>;
  shutdown(): Promise<void>;
}

function normalizePeers(peers?: string[]): string[] {
  const list = peers && peers.length > 0 ? peers : DEFAULT_PEERS;
  return list.map((peer) => {
    const trimmed = peer.trim();
    if (trimmed.endsWith('/gun')) {
      return trimmed;
    }
    return `${trimmed.replace(/\/+$, '')}/gun`;
  });
}

function createNamespace<T>(chain: ChainLike<T>, barrier: HydrationBarrier): Namespace<T> {
  return {
    async read(): Promise<T | null> {
      await barrier.prepare();
      return new Promise<T | null>((resolve) => {
        chain.once((data) => {
          resolve(((data ?? null) as T | null));
        });
      });
    },
    async write(value: T): Promise<void> {
      await barrier.prepare();
      await new Promise<void>((resolve, reject) => {
        chain.put(value, (ack?: ChainAck) => {
          if (ack?.err) {
            reject(new Error(ack.err));
            return;
          }
          resolve();
        });
      });
    }
  };
}

function hydrate(barrier: HydrationBarrier, storage: StorageAdapter): void {
  const timeout = setTimeout(() => {
    if (!barrier.ready) {
      barrier.markReady();
    }
  }, 5000);

  storage
    .hydrate()
    .catch((error) => {
      console.warn('[vh] storage hydration failed', error);
    })
    .finally(() => {
      clearTimeout(timeout);
      barrier.markReady();
    });
}

export function createClient(config: VennClientConfig = {}): VennClient {
  const peers = normalizePeers(config.peers);
  const storage = config.storage ?? createStorageAdapter();
  const hydrationBarrier = createHydrationBarrier();
  const gun = Gun({ peers }) as IGunInstance;

  hydrate(hydrationBarrier, storage);

  const root = gun.get('vh');
  const userChain = gun.user() as unknown as ChainLike<Record<string, unknown>>;
  const chatChain = root.get('chat') as unknown as ChainLike<Record<string, unknown>>;
  const outboxChain = root.get('outbox') as unknown as ChainLike<Record<string, unknown>>;

  return {
    config: { ...config, peers },
    hydrationBarrier,
    storage,
    user: createNamespace(userChain, hydrationBarrier),
    chat: createNamespace(chatChain, hydrationBarrier),
    outbox: createNamespace(outboxChain, hydrationBarrier),
    async shutdown(): Promise<void> {
      hydrationBarrier.markReady();
      if (typeof (gun as IGunInstance & { off?: () => void }).off === 'function') {
        (gun as IGunInstance & { off?: () => void }).off();
      }
      await storage.close();
    }
  };
}

export { HydrationBarrier } from './sync/barrier';
export { createStorageAdapter } from './storage/adapter';
export type { StorageAdapter, StorageRecord } from './storage/adapter';
export type { VennClientConfig, Namespace } from './types';
