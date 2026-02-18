/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisLoadingState } from './AnalysisLoadingState';

describe('AnalysisLoadingState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows rotating staged messages during loading', () => {
    render(
      <AnalysisLoadingState
        status="loading"
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId('analysis-status-message')).toHaveTextContent(
      'Extracting article text…',
    );

    act(() => {
      vi.advanceTimersByTime(4_500);
    });
    expect(screen.getByTestId('analysis-status-message')).toHaveTextContent(
      'Analyzing perspectives and bias…',
    );

    act(() => {
      vi.advanceTimersByTime(4_500);
    });
    expect(screen.getByTestId('analysis-status-message')).toHaveTextContent(
      'Generating balanced summary…',
    );
  });

  it('messages rotate on interval and wrap around', () => {
    render(
      <AnalysisLoadingState
        status="loading"
        error={null}
        onRetry={vi.fn()}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(13_500);
    });
    expect(screen.getByTestId('analysis-status-message')).toHaveTextContent(
      'Almost ready…',
    );

    act(() => {
      vi.advanceTimersByTime(4_500);
    });
    expect(screen.getByTestId('analysis-status-message')).toHaveTextContent(
      'Extracting article text…',
    );
  });

  it('shows error message and retry button on error', () => {
    const onRetry = vi.fn();

    render(
      <AnalysisLoadingState
        status="error"
        error="analysis service unavailable"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByTestId('analysis-status-message')).toHaveTextContent(
      'analysis service unavailable',
    );

    fireEvent.click(screen.getByTestId('analysis-retry-button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('uses generic error text when explicit error detail is unavailable', () => {
    render(
      <AnalysisLoadingState
        status="error"
        error="   "
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId('analysis-status-message')).toHaveTextContent(
      'Analysis failed. Please retry.',
    );
  });

  it('shows timeout message with retry action', () => {
    const onRetry = vi.fn();

    render(
      <AnalysisLoadingState
        status="timeout"
        error={null}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByTestId('analysis-status-message')).toHaveTextContent(
      'Analysis timed out. The server may be busy.',
    );

    fireEvent.click(screen.getByTestId('analysis-retry-button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows budget exceeded message', () => {
    const onRetry = vi.fn();

    render(
      <AnalysisLoadingState
        status="budget_exceeded"
        error={null}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByTestId('analysis-status-message')).toHaveTextContent(
      'Daily analysis limit reached. Try again tomorrow.',
    );

    fireEvent.click(screen.getByTestId('analysis-retry-button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
