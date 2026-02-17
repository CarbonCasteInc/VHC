/* @vitest-environment jsdom */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { RemovalIndicator } from './RemovalIndicator';

describe('RemovalIndicator', () => {
  afterEach(() => cleanup());

  it('renders the extraction failure message for known reason', () => {
    render(<RemovalIndicator reason="extraction-failed-permanently" />);
    expect(screen.getByTestId('removal-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('removal-indicator-reason')).toHaveTextContent(
      'Article text could not be extracted after multiple attempts.',
    );
  });

  it('renders policy removal message', () => {
    render(<RemovalIndicator reason="removed-by-policy" />);
    expect(screen.getByTestId('removal-indicator-reason')).toHaveTextContent(
      'This article was removed by content policy.',
    );
  });

  it('renders fallback message for unknown reason', () => {
    render(<RemovalIndicator reason="some-unknown-reason" />);
    expect(screen.getByTestId('removal-indicator-reason')).toHaveTextContent(
      'Article text could not be extracted after multiple attempts.',
    );
  });

  it('has role="status" for accessibility', () => {
    render(<RemovalIndicator reason="extraction-failed-permanently" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has aria-live="polite" for screen readers', () => {
    render(<RemovalIndicator reason="extraction-failed-permanently" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('renders dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<RemovalIndicator reason="extraction-failed-permanently" onDismiss={onDismiss} />);
    const btn = screen.getByTestId('removal-indicator-dismiss');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-label', 'Dismiss removal notice');
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<RemovalIndicator reason="extraction-failed-permanently" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('removal-indicator-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render dismiss button when onDismiss is not provided', () => {
    render(<RemovalIndicator reason="extraction-failed-permanently" />);
    expect(screen.queryByTestId('removal-indicator-dismiss')).not.toBeInTheDocument();
  });
});
