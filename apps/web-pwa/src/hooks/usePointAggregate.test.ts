/* @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePointAggregate } from './usePointAggregate';

const readAggregatesMock = vi.hoisted(() => vi.fn());
const resolveClientFromAppStoreMock = vi.hoisted(() => vi.fn());

vi.mock('@vh/gun-client', () => ({
  readAggregates: (...args: unknown[]) => readAggregatesMock(...args),
}));

vi.mock('../store/clientResolver', () => ({
  resolveClientFromAppStore: () => resolveClientFromAppStoreMock(),
}));

function HookHarness(props: {
  topicId: string;
  synthesisId: string;
  epoch: number;
  pointId: string;
  fallbackPointId?: string;
  enabled?: boolean;
}) {
  const result = usePointAggregate(props);
  return React.createElement('pre', { 'data-testid': 'point-aggregate-result' }, JSON.stringify(result));
}

function renderHarness(props: {
  topicId: string;
  synthesisId: string;
  epoch: number;
  pointId: string;
  fallbackPointId?: string;
  enabled?: boolean;
}) {
  return render(React.createElement(HookHarness, props));
}

function readHookResult(): { aggregate: any; status: string; error: string | null } {
  return JSON.parse(screen.getByTestId('point-aggregate-result').textContent ?? '{}');
}

function aggregateFixture(overrides: Record<string, unknown> = {}) {
  return {
    point_id: 'point-1',
    agree: 2,
    disagree: 1,
    weight: 3.5,
    participants: 3,
    ...overrides,
  };
}

describe('usePointAggregate', () => {
  beforeEach(() => {
    readAggregatesMock.mockReset();
    resolveClientFromAppStoreMock.mockReset();
    resolveClientFromAppStoreMock.mockReturnValue({} as any);
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns idle and skips reads when disabled or context is incomplete', async () => {
    renderHarness({
      topicId: '',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await waitFor(() => {
      expect(readHookResult()).toEqual({
        aggregate: null,
        status: 'idle',
        error: null,
      });
    });

    expect(readAggregatesMock).not.toHaveBeenCalled();

    cleanup();

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
      enabled: false,
    });

    await waitFor(() => {
      expect(readHookResult().status).toBe('idle');
    });

    expect(readAggregatesMock).not.toHaveBeenCalled();
  });

  it('returns idle when mesh client is unavailable', async () => {
    resolveClientFromAppStoreMock.mockReturnValue(null);

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await waitFor(() => {
      expect(readHookResult()).toEqual({
        aggregate: null,
        status: 'idle',
        error: null,
      });
    });

    expect(readAggregatesMock).not.toHaveBeenCalled();
  });

  it('reads aggregate successfully and emits success telemetry', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    readAggregatesMock.mockResolvedValueOnce(aggregateFixture());

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 2,
      pointId: 'point-1',
    });

    await waitFor(() => {
      const result = readHookResult();
      expect(result.status).toBe('success');
      expect(result.aggregate).toEqual(aggregateFixture());
      expect(result.error).toBeNull();
    });

    expect(readAggregatesMock).toHaveBeenCalledWith(
      expect.anything(),
      'topic-1',
      'synth-1',
      2,
      'point-1',
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:aggregate:read]',
      expect.objectContaining({
        topic_id: 'topic-1',
        point_id: 'point-1',
        status: 'success',
        attempt: 1,
      }),
    );
  });

  it('retries zero aggregate snapshots and updates once non-zero data arrives', async () => {
    vi.useFakeTimers();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    readAggregatesMock
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 3, disagree: 1, participants: 4, weight: 4 }));

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(3);

    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(readHookResult()).toEqual({
      aggregate: aggregateFixture({ agree: 3, disagree: 1, participants: 4, weight: 4 }),
      status: 'success',
      error: null,
    });

    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:aggregate:read]',
      expect.objectContaining({
        attempt: 1,
        zero_snapshot: true,
        retrying: true,
      }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:aggregate:read]',
      expect.objectContaining({
        attempt: 3,
        zero_snapshot: false,
        retrying: false,
      }),
    );
  });

  it('stops zero-snapshot retrying after max attempts and keeps success payload', async () => {
    vi.useFakeTimers();

    readAggregatesMock.mockResolvedValue(
      aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }),
    );

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();

    expect(readAggregatesMock).toHaveBeenCalledTimes(4);
    expect(readHookResult()).toEqual({
      aggregate: aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }),
      status: 'success',
      error: null,
    });
  });

  it('retries failed reads with bounded backoff and succeeds on a later attempt', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    readAggregatesMock
      .mockRejectedValueOnce(new Error('request timed out'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(aggregateFixture({ agree: 4, disagree: 2 }));

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(3);

    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(readHookResult().status).toBe('success');
    expect(readHookResult().aggregate).toEqual(aggregateFixture({ agree: 4, disagree: 2 }));

    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:aggregate:read]',
      expect.objectContaining({
        status: 'timeout',
        error_code: 'timeout',
        attempt: 1,
      }),
    );
  });

  it('stops after max retries and returns error state', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    readAggregatesMock.mockRejectedValue('mesh unavailable');

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(4);

    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(readHookResult()).toEqual({
      aggregate: null,
      status: 'error',
      error: 'mesh unavailable',
    });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(readAggregatesMock).toHaveBeenCalledTimes(4);
    expect(warnSpy).toHaveBeenLastCalledWith(
      '[vh:aggregate:read]',
      expect.objectContaining({
        status: 'error',
        error_code: 'unknown_error',
        attempt: 4,
      }),
    );
  });

  it('uses Error.message for terminal error payloads', async () => {
    vi.useFakeTimers();

    readAggregatesMock.mockRejectedValue(new Error('mesh exploded'));

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();

    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(readHookResult()).toEqual({
      aggregate: null,
      status: 'error',
      error: 'mesh exploded',
    });
  });

  it('falls back to generic error_code when Error.name is empty', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const namelessError = new Error('nameless');
    Object.defineProperty(namelessError, 'name', { value: '', configurable: true });
    readAggregatesMock.mockRejectedValue(namelessError);

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:aggregate:read]',
      expect.objectContaining({
        error_code: 'error',
      }),
    );
  });

  it('cancels state updates on unmount during pending read', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let resolvePending: ((value: ReturnType<typeof aggregateFixture>) => void) | null = null;
    readAggregatesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );

    const { unmount } = renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await waitFor(() => {
      expect(readAggregatesMock).toHaveBeenCalledTimes(1);
    });

    unmount();
    resolvePending?.(aggregateFixture());

    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('exits catch-path cleanly when request fails after unmount', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let rejectPending: ((error: unknown) => void) | null = null;
    readAggregatesMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectPending = reject;
        }),
    );

    const { unmount } = renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await waitFor(() => {
      expect(readAggregatesMock).toHaveBeenCalledTimes(1);
    });

    unmount();
    rejectPending?.(new Error('late failure'));

    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not issue another read after unmount during backoff sleep', async () => {
    vi.useFakeTimers();

    readAggregatesMock.mockRejectedValue(new Error('retry me'));

    const { unmount } = renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();

    expect(readAggregatesMock).toHaveBeenCalledTimes(1);
  });

  it('does not issue another zero-snapshot read after unmount during retry delay', async () => {
    vi.useFakeTimers();

    readAggregatesMock.mockResolvedValue(
      aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }),
    );

    const { unmount } = renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await Promise.resolve();
    expect(readAggregatesMock).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    expect(readAggregatesMock).toHaveBeenCalledTimes(1);
  });

  it('exits cleanly when unmounted before fallback read resolves', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let call = 0;
    let resolveFallback: ((value: ReturnType<typeof aggregateFixture>) => void) | null = null;
    readAggregatesMock.mockImplementation(() => {
      call += 1;
      if (call <= 4) {
        return Promise.resolve(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }));
      }
      return new Promise((resolve) => {
        resolveFallback = resolve as (value: ReturnType<typeof aggregateFixture>) => void;
      });
    });

    const { unmount } = renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'canonical-point',
      fallbackPointId: 'legacy-point',
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();

    expect(readAggregatesMock).toHaveBeenCalledTimes(5);

    unmount();
    resolveFallback?.(aggregateFixture({ point_id: 'legacy-point', agree: 4, disagree: 1, participants: 5, weight: 5 }));

    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('re-fetches when pointId changes', async () => {
    readAggregatesMock
      .mockResolvedValueOnce(aggregateFixture({ point_id: 'point-1' }))
      .mockResolvedValueOnce(aggregateFixture({ point_id: 'point-2' }));

    const { rerender } = renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'point-1',
    });

    await waitFor(() => {
      expect(readHookResult().aggregate?.point_id).toBe('point-1');
    });

    rerender(
      React.createElement(HookHarness, {
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-2',
      }),
    );

    await waitFor(() => {
      expect(readHookResult().aggregate?.point_id).toBe('point-2');
    });

    expect(readAggregatesMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'topic-1',
      'synth-1',
      0,
      'point-2',
    );
  });

  it('tries fallback point ID when canonical exhausts retries with zeros', async () => {
    vi.useFakeTimers();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    // 4 zero reads for canonical, then 1 non-zero for fallback
    readAggregatesMock
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 5, disagree: 1, participants: 6, weight: 6 }));

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'canonical-point',
      fallbackPointId: 'legacy-point',
    });

    // Exhaust all retries for canonical
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    // Should have called: 4 canonical + 1 fallback
    expect(readAggregatesMock).toHaveBeenCalledTimes(5);
    expect(readAggregatesMock).toHaveBeenLastCalledWith(
      expect.anything(),
      'topic-1',
      'synth-1',
      0,
      'legacy-point',
    );

    expect(readHookResult()).toEqual({
      aggregate: aggregateFixture({ agree: 5, disagree: 1, participants: 6, weight: 6 }),
      status: 'success',
      error: null,
    });

    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:aggregate:read]',
      expect.objectContaining({
        point_id: 'legacy-point',
        fallback_used: true,
        fallback_point_id: 'legacy-point',
        zero_snapshot: false,
      }),
    );
  });

  it('emits convergence-zero diagnostic when both canonical and fallback return zeros', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    readAggregatesMock.mockResolvedValue(
      aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }),
    );

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'canonical-point',
      fallbackPointId: 'legacy-point',
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    // 4 canonical retries + 1 fallback = 5
    expect(readAggregatesMock).toHaveBeenCalledTimes(5);

    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:aggregate:convergence-zero]',
      expect.objectContaining({
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 0,
        canonical_point_id: 'canonical-point',
        fallback_point_id: 'legacy-point',
        total_attempts: 5,
      }),
    );
  });

  it('emits convergence-zero diagnostic when fallback read throws', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    readAggregatesMock
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockRejectedValueOnce(new Error('fallback-read-failed'));

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'canonical-point',
      fallbackPointId: 'legacy-point',
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(readAggregatesMock).toHaveBeenCalledTimes(5);
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:aggregate:convergence-zero]',
      expect.objectContaining({
        canonical_point_id: 'canonical-point',
        fallback_point_id: 'legacy-point',
      }),
    );
  });

  it('does not use fallback when fallbackPointId equals pointId', async () => {
    vi.useFakeTimers();

    readAggregatesMock.mockResolvedValue(
      aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }),
    );

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'same-point',
      fallbackPointId: 'same-point',
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    // Only canonical retries, no fallback
    expect(readAggregatesMock).toHaveBeenCalledTimes(4);
  });

  it('does not use fallback when canonical returns non-zero before exhausting retries', async () => {
    vi.useFakeTimers();

    readAggregatesMock
      .mockResolvedValueOnce(aggregateFixture({ agree: 0, disagree: 0, participants: 0, weight: 0 }))
      .mockResolvedValueOnce(aggregateFixture({ agree: 2, disagree: 0, participants: 2, weight: 2 }));

    renderHarness({
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 0,
      pointId: 'canonical-point',
      fallbackPointId: 'legacy-point',
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    // Canonical succeeded on attempt 2, no fallback needed
    expect(readAggregatesMock).toHaveBeenCalledTimes(2);
    expect(readHookResult().aggregate).toEqual(
      aggregateFixture({ agree: 2, disagree: 0, participants: 2, weight: 2 }),
    );
  });
});
