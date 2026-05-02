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
  off?(callback?: (data: T | undefined, key?: string) => void): unknown;
  /** Iterate over child nodes */
  map?(): ChainWithGet<T>;
}

export interface PutAckResult {
  readonly acknowledged: boolean;
  readonly timedOut: boolean;
  readonly latencyMs?: number;
}

export interface PutWithAckTimeoutOptions {
  readonly timeoutMs: number;
  readonly onTimeout?: () => void;
}

const PREPARE_PHYSICAL_PUT = Symbol('vh.gun-client.preparePhysicalPut');

type PhysicalPut<T> = (callback?: (ack?: ChainAck) => void) => unknown;
type PreparedPutChain<T> = ChainWithGet<T> & {
  [PREPARE_PHYSICAL_PUT]?: (value: T) => Promise<PhysicalPut<T>>;
};

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

function rawPhysicalPut<T>(chain: ChainWithGet<T>, value: T): PhysicalPut<T> {
  return (callback?: (ack?: ChainAck) => void) => {
    const result = chain.put(value, callback);
    // Gun chains are thenable. Do not return/adopt them into promise control flow.
    void result;
  };
}

export async function putWithAckTimeout<T>(
  chain: ChainWithGet<T>,
  value: T,
  options: PutWithAckTimeoutOptions
): Promise<PutAckResult> {
  const preparedChain = chain as PreparedPutChain<T>;
  const physicalPut = preparedChain[PREPARE_PHYSICAL_PUT]
    ? await preparedChain[PREPARE_PHYSICAL_PUT](value)
    : rawPhysicalPut(chain, value);
  const startedAt = Date.now();

  return new Promise<PutAckResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      options.onTimeout?.();
      resolve({
        acknowledged: false,
        timedOut: true,
        latencyMs: Math.max(0, Date.now() - startedAt),
      });
    }, options.timeoutMs);

    try {
      physicalPut((ack?: ChainAck) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (ack?.err) {
          reject(new Error(ack.err));
          return;
        }
        resolve({
          acknowledged: true,
          timedOut: false,
          latencyMs: Math.max(0, Date.now() - startedAt),
        });
      });
    } catch (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    }
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
    const preparePhysicalPut = async (value: T): Promise<PhysicalPut<T>> => {
      guard.validateWrite(currentPath, value);
      await waitForRemote(node, barrier);
      return (callback?: (ack?: ChainAck) => void) => {
        const result = node.put(value, callback);
        // Gun chains are thenable. Do not return/adopt them into promise control flow.
        void result;
      };
    };
    const wrapped: PreparedPutChain<T> = {
      once: node.once.bind(node),
      get(key: string) {
        const nextNode = node.get(key) as ChainWithGet<T>;
        const nextPath = `${currentPath}${key}/`;
        return wrap(nextNode, nextPath);
      },
      put(value: T, callback?: (ack?: ChainAck) => void) {
        return preparePhysicalPut(value).then((physicalPut) => {
          physicalPut(callback);
        });
      },
      [PREPARE_PHYSICAL_PUT]: preparePhysicalPut,
      // Passthrough subscription methods from the underlying Gun chain
      on: typeof rawNode.on === 'function' ? rawNode.on.bind(rawNode) : undefined,
      off: typeof rawNode.off === 'function' ? rawNode.off.bind(rawNode) : undefined,
      map: typeof rawNode.map === 'function'
        ? () => wrap(rawNode.map() as ChainWithGet<T>, currentPath)
        : undefined
    };
    return wrapped;
  };

  return wrap(chain, normalized);
}
