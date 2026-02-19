import Gun from 'gun';
import 'gun/sea';
import type { IGunInstance } from 'gun';
import { waitForRemote, type ChainAck, type ChainLike, type ChainWithGet } from './chain';
import { createStorageAdapter } from './storage/adapter';
import type { StorageAdapter, StorageRecord } from './storage/types';
import { HydrationBarrier, createHydrationBarrier } from './sync/barrier';
import type { Namespace, VennClient, VennClientConfig } from './types';
import { TopologyGuard } from './topology';

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

function createNamespace<T>(
  chain: ChainLike<T>,
  barrier: HydrationBarrier,
  sessionReadyRef: () => boolean,
  guard: TopologyGuard,
  path: string
): Namespace<T> {
  return {
    async read(): Promise<T | null> {
      if (!sessionReadyRef()) {
        throw new Error('Session not ready');
      }
      await barrier.prepare();
      return new Promise<T | null>((resolve) => {
        chain.once((data) => {
          resolve(((data ?? null) as T | null));
        });
      });
    },
    async write(value: T): Promise<void> {
      if (!sessionReadyRef()) {
        throw new Error('Session not ready');
      }
      guard.validateWrite(path, value);
      await waitForRemote(chain, barrier);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          console.warn('[vh:gun-client] put timed out, proceeding without ack');
          resolve();
        }, 1000);

        chain.put(value, (ack?: ChainAck) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
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

export function createClient(config: VennClientConfig = {}): VennClient {
  const hydrationBarrier = createHydrationBarrier();
  const peers = normalizePeers(config.peers);
  const storage = config.storage ?? createStorageAdapter(hydrationBarrier);
  const guard = config.topologyGuard ?? new TopologyGuard();
  const gun = Gun({ peers }) as IGunInstance;
  let sessionReady = false;

  storage
    .hydrate()
    .then(() => {
      if (!hydrationBarrier.ready) {
        hydrationBarrier.markReady();
      }
    })
    .catch((error: unknown) => {
      console.warn('[vh] storage hydration failed', error);
      if (!hydrationBarrier.ready) {
        hydrationBarrier.markReady();
      }
    });

  const root = gun.get('vh');
  const userChain = gun.user() as unknown as ChainLike<Record<string, unknown>>;
  const chatChain = root.get('chat') as unknown as ChainLike<Record<string, unknown>>;
  const outboxChain = root.get('outbox') as unknown as ChainLike<Record<string, unknown>>;
  const devicesChain = (userChain as unknown as ChainWithGet<Record<string, unknown>>).get('devices');

  async function ensureSession() {
    if (!sessionReady && config.requireSession !== false) {
      throw new Error('Session not ready');
    }
  }

  async function linkDevice(deviceKey: string): Promise<void> {
    await ensureSession();
    await waitForRemote(devicesChain, hydrationBarrier);
    await new Promise<void>((resolve, reject) => {
      devicesChain.get(deviceKey).put({ linkedAt: Date.now() }, (ack?: ChainAck) => {
        if (ack?.err) {
          reject(new Error(ack.err));
          return;
        }
        resolve();
      });
    });
  }

  return {
    config: { ...config, peers },
    hydrationBarrier,
    storage,
    topologyGuard: guard,
    gun,
    mesh: root as unknown as ChainWithGet<Record<string, unknown>>,
    sessionReady,
    markSessionReady() {
      sessionReady = true;
    },
    linkDevice,
    user: createNamespace(userChain, hydrationBarrier, () => sessionReady || config.requireSession === false, guard, 'vh/user/'),
    chat: createNamespace(chatChain, hydrationBarrier, () => sessionReady || config.requireSession === false, guard, 'vh/chat/'),
    outbox: createNamespace(outboxChain, hydrationBarrier, () => sessionReady || config.requireSession === false, guard, 'vh/outbox/'),
    async shutdown(): Promise<void> {
      hydrationBarrier.markReady();
      (gun as IGunInstance & { off?: () => void }).off?.();
      await storage.close();
    }
  };
}

export { HydrationBarrier } from './sync/barrier';
export { createStorageAdapter } from './storage/adapter';
export type { StorageAdapter, StorageRecord } from './storage/types';
export type { VennClient, VennClientConfig, Namespace } from './types';
export { createSession } from './auth';
export * from './hermesAdapters';
export * from './hermesCrypto';
export * from './forumAdapters';
export * from './directoryAdapters';
export * from './docsAdapters';
export * from './docsKeyManagement';
export * from './synthesisAdapters';
export * from './newsAdapters';
export * from './analysisAdapters';
export * from './sentimentEventAdapters';
export * from './aggregateAdapters';
export * from './sentimentAdapters';
export * from './bridgeAdapters';
export type { ChainWithGet } from './chain';
export { default as SEA } from 'gun/sea';
