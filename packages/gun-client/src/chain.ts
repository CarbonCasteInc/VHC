import type { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';

export interface ChainAck {
  err?: string;
}

export interface ChainLike<T> {
  once(callback: (data: T | undefined) => void): unknown;
  put(value: T, callback?: (ack?: ChainAck) => void): unknown;
}

export interface ChainWithGet<T> extends ChainLike<T> {
  get(key: string): ChainWithGet<T>;
  /** Subscribe to real-time updates */
  on?(callback: (data: T | undefined, key?: string) => void): unknown;
  off?(callback: (data: T | undefined, key?: string) => void): unknown;
  /** Iterate over child nodes */
  map?(): ChainWithGet<T>;
}

export async function waitForRemote<T>(chain: ChainLike<T>, barrier: HydrationBarrier): Promise<void> {
  await barrier.prepare();
  await new Promise<void>((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn('[vh:gun-client] waitForRemote timed out, proceeding anyway');
        resolve();
      }
    }, 500);
    chain.once(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

export function createGuardedChain<T>(
  chain: ChainWithGet<T>,
  barrier: HydrationBarrier,
  guard: TopologyGuard,
  path: string
): ChainWithGet<T> {
  const normalized = path.endsWith('/') ? path : `${path}/`;
  const wrap = (node: ChainWithGet<T>, currentPath: string): ChainWithGet<T> => {
    const rawNode = node as any;
    return {
      once: node.once.bind(node),
      get(key: string) {
        const nextNode = node.get(key) as ChainWithGet<T>;
        const nextPath = `${currentPath}${key}/`;
        return wrap(nextNode, nextPath);
      },
      put(value: T, callback?: (ack?: ChainAck) => void) {
        guard.validateWrite(currentPath, value);
        return waitForRemote(node, barrier).then(() => node.put(value, callback));
      },
      // Passthrough subscription methods from the underlying Gun chain
      on: typeof rawNode.on === 'function' ? rawNode.on.bind(rawNode) : undefined,
      off: typeof rawNode.off === 'function' ? rawNode.off.bind(rawNode) : undefined,
      map: typeof rawNode.map === 'function'
        ? () => wrap(rawNode.map() as ChainWithGet<T>, currentPath)
        : undefined
    };
  };

  return wrap(chain, normalized);
}
