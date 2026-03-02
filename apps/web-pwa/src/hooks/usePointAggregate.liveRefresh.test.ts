/* @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readAggregatesMock = vi.hoisted(() => vi.fn());
const resolveClientFromAppStoreMock = vi.hoisted(() => vi.fn());
const consumeVoteTimestampMock = vi.hoisted(() => vi.fn());
const logConvergenceLagMock = vi.hoisted(() => vi.fn());

vi.mock('@vh/gun-client', () => ({
  readAggregates: (...args: unknown[]) => readAggregatesMock(...args),
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

describe('usePointAggregate live refresh', () => {
  beforeEach(() => {
    readAggregatesMock.mockReset();
    resolveClientFromAppStoreMock.mockReset();
    consumeVoteTimestampMock.mockReset();
    logConvergenceLagMock.mockReset();
    resolveClientFromAppStoreMock.mockReturnValue({} as any);
    consumeVoteTimestampMock.mockReturnValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    delete (globalThis as { __VH_FORCE_LIVE_AGGREGATE_REFRESH__?: boolean }).__VH_FORCE_LIVE_AGGREGATE_REFRESH__;
    delete (globalThis as { __VH_IMPORT_META_MODE__?: string }).__VH_IMPORT_META_MODE__;
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
});
