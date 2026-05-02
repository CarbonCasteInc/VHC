/* @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getAggregatePointsChainMock = vi.hoisted(() => vi.fn());
const getAggregateVotersChainMock = vi.hoisted(() => vi.fn());

vi.mock('@vh/gun-client', () => ({
  getAggregatePointsChain: (...args: unknown[]) => getAggregatePointsChainMock(...args),
  getAggregateVotersChain: (...args: unknown[]) => getAggregateVotersChainMock(...args),
}));

import { subscribePointAggregateSignals } from './usePointAggregateSubscriptions';

function createSignalChain(options?: { includeOn?: boolean; includeMap?: boolean }) {
  const handlers = new Set<(...args: unknown[]) => void>();
  const includeOn = options?.includeOn ?? true;
  const includeMap = options?.includeMap ?? true;
  const chain: Record<string, unknown> = {
    get() {
      return chain;
    },
  };
  if (includeMap) {
    chain.map = () => chain;
  }
  if (includeOn) {
    chain.on = (handler: (...args: unknown[]) => void) => {
      handlers.add(handler);
      return chain;
    };
    chain.off = (handler: (...args: unknown[]) => void) => {
      handlers.delete(handler);
      return chain;
    };
  }
  return Object.assign(chain, {
    emit(...args: unknown[]) {
      for (const handler of handlers) {
        handler(...args);
      }
    },
    handlerCount() {
      return handlers.size;
    },
  });
}

describe('subscribePointAggregateSignals', () => {
  beforeEach(() => {
    getAggregatePointsChainMock.mockReset();
    getAggregateVotersChainMock.mockReset();
  });

  it('subscribes to point, voter root, and voter map signals and coalesces refreshes', async () => {
    const pointChain = createSignalChain();
    const voterChain = createSignalChain();
    getAggregatePointsChainMock.mockReturnValue(pointChain);
    getAggregateVotersChainMock.mockReturnValue(voterChain);
    const onSignal = vi.fn();

    const unsubscribe = subscribePointAggregateSignals({
      client: {} as never,
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
      onSignal,
    });

    expect(pointChain.handlerCount()).toBe(1);
    expect(voterChain.handlerCount()).toBe(2);

    pointChain.emit();
    voterChain.emit();
    await Promise.resolve();

    expect(onSignal).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(pointChain.handlerCount()).toBe(0);
    expect(voterChain.handlerCount()).toBe(0);
  });

  it('gracefully no-ops when the chains do not expose subscription methods', () => {
    getAggregatePointsChainMock.mockReturnValue(createSignalChain({ includeOn: false, includeMap: false }));
    getAggregateVotersChainMock.mockReturnValue(createSignalChain({ includeOn: false, includeMap: false }));

    const unsubscribe = subscribePointAggregateSignals({
      client: {} as never,
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
      onSignal: vi.fn(),
    });

    expect(() => unsubscribe()).not.toThrow();
  });

  it('ignores late signal callbacks when a Gun chain cannot unsubscribe precisely', async () => {
    const pointChain = createSignalChain();
    const voterChain = createSignalChain();
    pointChain.off = () => pointChain;
    voterChain.off = () => voterChain;
    getAggregatePointsChainMock.mockReturnValue(pointChain);
    getAggregateVotersChainMock.mockReturnValue(voterChain);
    const onSignal = vi.fn();

    const unsubscribe = subscribePointAggregateSignals({
      client: {} as never,
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
      onSignal,
    });

    unsubscribe();
    pointChain.emit();
    voterChain.emit();
    await Promise.resolve();

    expect(onSignal).not.toHaveBeenCalled();
  });
});
