import type { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import { readGunTimeoutMs } from './runtimeConfig';

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

const WAIT_FOR_REMOTE_WARN_INTERVAL_MS = 15_000;
const WAIT_FOR_REMOTE_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS', 'VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS'],
  2_500,
);
let lastWaitForRemoteWarnAt = Number.NEGATIVE_INFINITY;
let suppressedWaitForRemoteWarns = 0;

function warnWaitForRemoteTimeout(): void {
  const now = Date.now();
  if (now - lastWaitForRemoteWarnAt < WAIT_FOR_REMOTE_WARN_INTERVAL_MS) {
    suppressedWaitForRemoteWarns += 1;
    return;
  }

  const suffix =
    suppressedWaitForRemoteWarns > 0
      ? ` (suppressed ${suppressedWaitForRemoteWarns} repeats)`
      : '';
  suppressedWaitForRemoteWarns = 0;
  lastWaitForRemoteWarnAt = now;
  console.warn(`[vh:gun-client] waitForRemote timed out, proceeding anyway${suffix}`);
}

export async function waitForRemote<T>(chain: ChainLike<T>, barrier: HydrationBarrier): Promise<void> {
  await barrier.prepare();
  await new Promise<void>((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        warnWaitForRemoteTimeout();
        resolve();
      }
    }, WAIT_FOR_REMOTE_TIMEOUT_MS);
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
