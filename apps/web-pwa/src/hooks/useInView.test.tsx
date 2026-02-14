/* @vitest-environment jsdom */

import { render, screen, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, vi, beforeEach } from 'vitest';
import React from 'react';
import { useInView } from './useInView';

// Test component that uses the hook and exposes state
function TestComponent() {
  const [ref, hasBeenVisible] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="target" data-visible={String(hasBeenVisible)}>
      {hasBeenVisible ? 'visible' : 'hidden'}
    </div>
  );
}

describe('useInView', () => {
  let mockObserve: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let capturedCallback: IntersectionObserverCallback;

  beforeEach(() => {
    mockObserve = vi.fn();
    mockDisconnect = vi.fn();

    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn((callback: IntersectionObserverCallback) => {
        capturedCallback = callback;
        return { observe: mockObserve, disconnect: mockDisconnect, unobserve: vi.fn() };
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('starts as not visible', () => {
    render(<TestComponent />);
    expect(screen.getByTestId('target').getAttribute('data-visible')).toBe('false');
  });

  it('observes the element on mount', () => {
    render(<TestComponent />);
    expect(mockObserve).toHaveBeenCalledWith(screen.getByTestId('target'));
  });

  it('latches to visible after intersection', () => {
    render(<TestComponent />);

    act(() => {
      capturedCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getByTestId('target').getAttribute('data-visible')).toBe('true');
    expect(screen.getByText('visible')).toBeTruthy();
  });

  it('disconnects observer after intersection', () => {
    render(<TestComponent />);

    act(() => {
      capturedCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    // disconnect is called both by the intersection handler and the effect cleanup
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('ignores non-intersecting entries', () => {
    render(<TestComponent />);

    act(() => {
      capturedCallback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getByTestId('target').getAttribute('data-visible')).toBe('false');
  });

  it('does not re-observe after latch (early return branch)', () => {
    const { rerender } = render(<TestComponent />);

    // Trigger intersection → latch to true
    act(() => {
      capturedCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    const observeCallsBefore = mockObserve.mock.calls.length;

    // Force re-render; effect should early-return since hasBeenVisible is true
    rerender(<TestComponent />);

    // No new observer.observe calls after re-render
    expect(mockObserve.mock.calls.length).toBe(observeCallsBefore);
  });

  it('does nothing when ref has no element attached', () => {
    // Component that uses the hook but doesn't attach ref to DOM
    function NoRefComponent() {
      const [, hasBeenVisible] = useInView<HTMLDivElement>();
      return <div data-testid="no-ref" data-visible={String(hasBeenVisible)} />;
    }

    render(<NoRefComponent />);
    // Observer should not be created since ref.current is null
    expect(mockObserve).not.toHaveBeenCalled();
    expect(screen.getByTestId('no-ref').getAttribute('data-visible')).toBe('false');
  });

  it('falls back to visible when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<TestComponent />);
    expect(screen.getByTestId('target').getAttribute('data-visible')).toBe('true');
  });
});
