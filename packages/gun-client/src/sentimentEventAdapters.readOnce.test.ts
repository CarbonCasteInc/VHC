import { describe, expect, it, vi } from 'vitest';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import { readUserEvents } from './sentimentEventAdapters';
import { HydrationBarrier } from './sync/barrier';

interface FakeNode {
  root: any;
  setRead: (path: string, value: unknown) => void;
  setReadDelay: (path: string, delayMs: number) => void;
  setReadHang: (path: string) => void;
}

function createFakeNode(): FakeNode {
  const reads = new Map<string, unknown>();
  const readHangs = new Set<string>();
  const readDelays = new Map<string, number>();

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (readHangs.has(path)) return;
        const delayMs = readDelays.get(path);
        if (delayMs !== undefined) {
          setTimeout(() => cb?.(reads.get(path)), delayMs);
          return;
        }
        cb?.(reads.get(path));
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
  };

  return {
    root: makeNode([]),
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setReadDelay(path: string, delayMs: number) {
      readDelays.set(path, delayMs);
    },
    setReadHang(path: string) {
      readHangs.add(path);
    },
  };
}

function createClient(userNode: FakeNode, guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();
  const userChain = userNode.root;
  userChain.is = { pub: 'device-pub-1' };
  userChain._ = { sea: { epub: 'epub-1', epriv: 'epriv-1' } };
  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: guard,
    gun: { user: vi.fn(() => userChain) } as unknown as VennClient['gun'],
    mesh: {} as VennClient['mesh'],
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn(),
  };
}

describe('sentimentEventAdapters readOnce coverage', () => {
  it('ignores late once callback after timeout settlement', async () => {
    vi.useFakeTimers();
    try {
      const userNode = createFakeNode();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(userNode, guard);
      userNode.setRead('outbox/sentiment', {});
      userNode.setReadDelay('outbox/sentiment', 3_000);

      const pending = readUserEvents(client, 'topic-1', 2);
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(pending).resolves.toEqual([]);
      await vi.advanceTimersByTimeAsync(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tolerates a timeout callback after early once settlement', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);

    try {
      const userNode = createFakeNode();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(userNode, guard);
      userNode.setRead('outbox/sentiment', {});

      await expect(readUserEvents(client, 'topic-1', 2)).resolves.toEqual([]);
      await vi.advanceTimersByTimeAsync(2_500);
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
