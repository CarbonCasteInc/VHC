/* @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchPointAggregateRefresh } from './pointAggregateRefreshEvents';

const readAggregatesMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());
const getAggregatePointsChainMock = vi.hoisted(() => vi.fn());
const getAggregateVotersChainMock = vi.hoisted(() => vi.fn());
const resolveClientFromAppStoreMock = vi.hoisted(() => vi.fn());
const consumeVoteTimestampMock = vi.hoisted(() => vi.fn());
const logConvergenceLagMock = vi.hoisted(() => vi.fn());

vi.mock('@vh/gun-client', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  readAggregatesWithRelayRestFallback: (...args: unknown[]) => readAggregatesMock(...args),
  getAggregatePointsChain: (...args: unknown[]) => getAggregatePointsChainMock(...args),
  getAggregateVotersChain: (...args: unknown[]) => getAggregateVotersChainMock(...args),
}));

vi.mock('../store/clientResolver', () => ({
  resolveClientFromAppStore: () => resolveClientFromAppStoreMock(),
}));

vi.mock('../utils/sentimentTelemetry', () => ({
  consumeVoteTimestamp: (...args: unknown[]) => consumeVoteTimestampMock(...args),
  logConvergenceLag: (...args: unknown[]) => logConvergenceLagMock(...args),
}));

function aggregateFixture(overrides: Record<string, unknown> = {}) {
  return {
    point_id: 'point-1',
    agree: 2,
    disagree: 1,
    weight: 3,
    participants: 3,
    ...overrides,
  };
}

async function loadHook(options?: { forceLiveRefresh?: boolean; mode?: string }) {
  vi.resetModules();
  (globalThis as { __VH_IMPORT_META_MODE__?: string }).__VH_IMPORT_META_MODE__ = options?.mode ?? 'development';
  if (typeof options?.forceLiveRefresh === 'boolean') {
    (globalThis as { __VH_FORCE_LIVE_AGGREGATE_REFRESH__?: boolean }).__VH_FORCE_LIVE_AGGREGATE_REFRESH__ =
      options.forceLiveRefresh;
  } else {
    delete (globalThis as { __VH_FORCE_LIVE_AGGREGATE_REFRESH__?: boolean }).__VH_FORCE_LIVE_AGGREGATE_REFRESH__;
  }
  return (await import('./usePointAggregate')).usePointAggregate;
}

async function renderHarness(props: {
  topicId: string;
  synthesisId: string;
  epoch: number;
  pointId: string;
  fallbackPointId?: string;
  enabled?: boolean;
}, options?: { forceLiveRefresh?: boolean; mode?: string }) {
  const usePointAggregate = await loadHook({
    forceLiveRefresh: options?.forceLiveRefresh,
    mode: options?.mode ?? 'development',
  });
  function HookHarness(localProps: {
    topicId: string;
    synthesisId: string;
    epoch: number;
    pointId: string;
    fallbackPointId?: string;
    enabled?: boolean;
  }) {
    const result = usePointAggregate(localProps);
    return React.createElement('pre', { 'data-testid': 'live-point-aggregate-result' }, JSON.stringify(result));
  }
  return render(React.createElement(HookHarness, props));
}

function readHookResult(): { aggregate: any; status: string; error: string | null } {
  return JSON.parse(screen.getByTestId('live-point-aggregate-result').textContent ?? '{}');
}

function createSignalChain() {
  const handlers = new Set<(...args: unknown[]) => void>();
  return {
    get() {
      return this;
    },
    map() {
      return this;
    },
    on(handler: (...args: unknown[]) => void) {
      handlers.add(handler);
      return this;
    },
    off(handler: (...args: unknown[]) => void) {
      handlers.delete(handler);
      return this;
    },
    emit(...args: unknown[]) {
      for (const handler of handlers) {
        handler(...args);
      }
    },
    handlerCount() {
      return handlers.size;
    },
  };
}

describe('usePointAggregate live refresh', () => {
  beforeEach(() => {
    readAggregatesMock.mockReset();
    createClientMock.mockReset();
    getAggregatePointsChainMock.mockReset();
    getAggregateVotersChainMock.mockReset();
    resolveClientFromAppStoreMock.mockReset();
    consumeVoteTimestampMock.mockReset();
    logConvergenceLagMock.mockReset();
    resolveClientFromAppStoreMock.mockReturnValue({} as any);
    createClientMock.mockImplementation(() => ({
      config: { peers: [] },
      markSessionReady: vi.fn(),
    }));
    consumeVoteTimestampMock.mockReturnValue(null);
    getAggregatePointsChainMock.mockImplementation(() => createSignalChain());
    getAggregateVotersChainMock.mockImplementation(() => createSignalChain());
    globalThis.localStorage?.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    globalThis.localStorage?.clear();
    delete (globalThis as { __VH_FORCE_LIVE_AGGREGATE_REFRESH__?: boolean }).__VH_FORCE_LIVE_AGGREGATE_REFRESH__;
    delete (globalThis as { __VH_IMPORT_META_MODE__?: string }).__VH_IMPORT_META_MODE__;
  });

  it('uses a read-only same-origin public client for deployed aggregate reads', async () => {
    const appClient = { config: { peers: ['wss://gun-a.carboncaste.io/gun'] } };
    const publicReadClient = { config: { peers: [] }, markSessionReady: vi.fn() };
    vi.stubGlobal('location', {
      origin: 'https://venn.carboncaste.io',
      hostname: 'venn.carboncaste.io',
      protocol: 'https:',
    });
    resolveClientFromAppStoreMock.mockReturnValue(appClient);
    createClientMock.mockReturnValue(publicReadClient);
    readAggregatesMock.mockResolvedValue(aggregateFixture({ agree: 7, participants: 7, weight: 7 }));

    await renderHarness(
      {
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-1',
      },
      { mode: 'test' },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createClientMock).toHaveBeenCalledWith({
      peers: ['wss://gun-a.carboncaste.io/gun'],
      requireSession: false,
      gunLocalStorage: false,
      gunRadisk: false,
    });
    expect(publicReadClient.markSessionReady).toHaveBeenCalledTimes(1);
    expect(readAggregatesMock).toHaveBeenCalledWith(
      publicReadClient,
      'topic-1',
      'synth-1',
      0,
      'point-1',
    );
    expect(readHookResult().aggregate).toMatchObject({ agree: 7, participants: 7 });
  });

  it('enables live refresh without force override when mode is non-test', async () => {
    let call = 0;
    readAggregatesMock.mockImplementation(() => {
      call += 1;
      return Promise.resolve(aggregateFixture());
    });

    await renderHarness(
      {
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-1',
      },
      { mode: 'development' },
    );

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(3);
  });

  it('keeps prior snapshot when live refresh returns the same aggregate reference', async () => {
    const shared = aggregateFixture();
    let call = 0;
    readAggregatesMock.mockImplementation(() => {
      call += 1;
      return Promise.resolve(shared);
    });

    await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(3);
    expect(readHookResult().aggregate).toEqual(shared);
  });

  it('honors explicit live refresh override when mode is test', async () => {
    let call = 0;
    readAggregatesMock.mockImplementation(() => {
      call += 1;
      return Promise.resolve(aggregateFixture());
    });

    await renderHarness(
      {
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-1',
      },
      { mode: 'test', forceLiveRefresh: true },
    );

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(3);
  });

  it('skips overlapping live refresh reads and cleans up interval on unmount', async () => {
    let call = 0;
    let resolvePending: ((value: ReturnType<typeof aggregateFixture>) => void) | null = null;
    readAggregatesMock.mockImplementation(() => {
      call += 1;
      if (call === 3) {
        return new Promise((resolve) => {
          resolvePending = resolve as (value: ReturnType<typeof aggregateFixture>) => void;
        });
      }
      return Promise.resolve(aggregateFixture());
    });

    const { unmount } = await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(2);

    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(2);

    resolvePending?.(aggregateFixture());
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(3);

    unmount();
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(3);
  });

  it('uses fallback point during live refresh and no-ops when aggregate is unchanged', async () => {
    let call = 0;
    readAggregatesMock.mockImplementation(() => {
      call += 1;
      if (call === 3 || call === 5) {
        return Promise.resolve(aggregateFixture({ point_id: 'point-1', agree: 0, disagree: 0, participants: 0, weight: 0 }));
      }
      if (call === 4 || call === 6) {
        return Promise.resolve(aggregateFixture({ point_id: 'legacy-point', agree: 9, disagree: 2, participants: 11, weight: 11 }));
      }
      return Promise.resolve(aggregateFixture());
    });

    await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
      fallbackPointId: 'legacy-point',
    });

    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(4);
    expect(readAggregatesMock.mock.calls.some((args) => args[4] === 'legacy-point')).toBe(true);
    expect(readHookResult().status).toBe('success');
  });

  it('ignores live refresh primary and fallback errors', async () => {
    let call = 0;
    readAggregatesMock.mockImplementation(() => {
      call += 1;
      if (call === 3) {
        return Promise.reject(new Error('live-primary-failed'));
      }
      if (call === 4) {
        return Promise.resolve(aggregateFixture({ point_id: 'point-1', agree: 0, disagree: 0, participants: 0, weight: 0 }));
      }
      if (call === 5) {
        return Promise.reject(new Error('live-fallback-failed'));
      }
      return Promise.resolve(aggregateFixture());
    });

    await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
      fallbackPointId: 'legacy-point',
    });

    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(call).toBeGreaterThanOrEqual(3);
    expect(readHookResult().status).toBe('success');
  });

  it('skips live refresh when hook context is disabled', async () => {
    readAggregatesMock.mockResolvedValue(aggregateFixture());

    await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
      enabled: false,
    });

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    expect(readAggregatesMock).not.toHaveBeenCalled();
  });

  it('skips live refresh when client is unavailable', async () => {
    resolveClientFromAppStoreMock.mockReturnValue(null);
    readAggregatesMock.mockResolvedValue(aggregateFixture());

    await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);
    await Promise.resolve();
    expect(readAggregatesMock).not.toHaveBeenCalled();
  });

  it('drops live refresh result when primary read settles after unmount', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let call = 0;
    let resolvePending: ((value: ReturnType<typeof aggregateFixture>) => void) | null = null;
    readAggregatesMock.mockImplementation(() => {
      call += 1;
      if (call === 2) {
        return new Promise((resolve) => {
          resolvePending = resolve as (value: ReturnType<typeof aggregateFixture>) => void;
        });
      }
      return Promise.resolve(aggregateFixture());
    });

    const { unmount } = await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(call).toBeGreaterThanOrEqual(2);

    unmount();
    resolvePending?.(aggregateFixture({ agree: 9, disagree: 0, participants: 9, weight: 9 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('refreshes immediately when the aggregate point subscription signals a remote update', async () => {
    const pointChain = createSignalChain();
    const voterChain = createSignalChain();
    getAggregatePointsChainMock.mockReturnValue(pointChain);
    getAggregateVotersChainMock.mockReturnValue(voterChain);

    let call = 0;
    readAggregatesMock.mockImplementation(() => {
      call += 1;
      if (call <= 2) {
        return Promise.resolve(aggregateFixture({ agree: 1, disagree: 0, participants: 1, weight: 1 }));
      }
      return Promise.resolve(aggregateFixture({ agree: 2, disagree: 0, participants: 2, weight: 2 }));
    });

    await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const beforeSignalCalls = call;

    await act(async () => {
      pointChain.emit({ agree: 1 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(call).toBeGreaterThan(beforeSignalCalls);
    expect(readHookResult().aggregate?.agree).toBe(2);
  });

  it('applies local vote refresh events and schedules authoritative mesh rereads', async () => {
    readAggregatesMock.mockResolvedValue(
      aggregateFixture({ agree: 1, disagree: 0, participants: 1, weight: 1 }),
    );

    await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const beforeEventCalls = readAggregatesMock.mock.calls.length;

    await act(async () => {
      dispatchPointAggregateRefresh({
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-1',
        previousAgreement: 0,
        nextAgreement: 1,
        previousWeight: 0,
        weight: 1,
        reason: 'local_vote',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readHookResult()).toEqual({
      aggregate: aggregateFixture({ agree: 2, disagree: 0, participants: 2, weight: 2 }),
      status: 'success',
      error: null,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readAggregatesMock.mock.calls.length).toBeGreaterThan(beforeEventCalls);
  });

  it('removes point and voter subscriptions on unmount', async () => {
    const pointChain = createSignalChain();
    const voterChain = createSignalChain();
    getAggregatePointsChainMock.mockReturnValue(pointChain);
    getAggregateVotersChainMock.mockReturnValue(voterChain);
    readAggregatesMock.mockResolvedValue(aggregateFixture());

    const rendered = await renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(pointChain.handlerCount()).toBeGreaterThan(0);
    expect(voterChain.handlerCount()).toBeGreaterThan(0);

    rendered.unmount();

    expect(pointChain.handlerCount()).toBe(0);
    expect(voterChain.handlerCount()).toBe(0);
  });
});
