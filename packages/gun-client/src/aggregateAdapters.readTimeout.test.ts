import { describe, expect, it, vi } from 'vitest';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  readAggregateVoterNode,
  readAggregateVoterRows,
  readPointAggregateSnapshot,
} from './aggregateAdapters';

function createHangingClient(guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  const makeNode = (): any => ({
    once: vi.fn(() => undefined),
    get: vi.fn(() => makeNode()),
  });

  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: guard,
    gun: { user: vi.fn() } as unknown as VennClient['gun'],
    mesh: makeNode(),
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn(),
  };
}

describe('aggregateAdapters read timeouts', () => {
  it('returns null for voter-node reads when the chain never resolves', async () => {
    vi.useFakeTimers();
    try {
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createHangingClient(guard);

      const pending = readAggregateVoterNode(client, 'topic-1', 'synth-1', 4, 'voterA', 'pointA');
      await vi.advanceTimersByTimeAsync(3_000);

      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns an empty row set when voter-root reads never resolve', async () => {
    vi.useFakeTimers();
    try {
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createHangingClient(guard);

      const pending = readAggregateVoterRows(client, 'topic-1', 'synth-1', 4, 'pointA');
      await vi.advanceTimersByTimeAsync(3_000);

      await expect(pending).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null for point-snapshot reads when the chain never resolves', async () => {
    vi.useFakeTimers();
    try {
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createHangingClient(guard);

      const pending = readPointAggregateSnapshot(client, 'topic-1', 'synth-1', 4, 'pointA');
      await vi.advanceTimersByTimeAsync(3_000);

      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
