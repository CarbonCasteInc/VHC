/* @vitest-environment jsdom */

import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useViewTracking } from './useViewTracking';
import { useSentimentState } from './useSentimentState';

describe('useViewTracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSentimentState.setState({
      ...useSentimentState.getState(),
      recordRead: vi.fn()
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('marks viewed after timer and scroll', () => {
    const recordSpy = useSentimentState.getState().recordRead as any;
    const { result } = renderHook(() => useViewTracking('item-1'));
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(5000);
    });

    expect(recordSpy).toHaveBeenCalledWith('item-1');
    expect(result.current).toBe(true);
  });

  it('does nothing when disabled', () => {
    const recordSpy = useSentimentState.getState().recordRead as any;
    const { result } = renderHook(() => useViewTracking('item-2', false));

    act(() => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(5000);
    });

    expect(recordSpy).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it('records after timer then scroll', () => {
    const recordSpy = useSentimentState.getState().recordRead as any;
    renderHook(() => useViewTracking('item-3'));

    act(() => {
      vi.advanceTimersByTime(5000);
      window.dispatchEvent(new Event('scroll'));
    });

    expect(recordSpy).toHaveBeenCalledWith('item-3');
  });

  it('resets its one-shot guard when the tracked item changes', () => {
    const recordSpy = useSentimentState.getState().recordRead as any;
    const { rerender } = renderHook(({ itemId }) => useViewTracking(itemId), {
      initialProps: { itemId: 'item-a' },
    });

    act(() => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(5000);
    });
    expect(recordSpy).toHaveBeenCalledWith('item-a');

    rerender({ itemId: 'item-b' });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(5000);
    });

    expect(recordSpy).toHaveBeenCalledWith('item-b');
  });
});
