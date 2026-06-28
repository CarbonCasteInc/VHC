/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { FeedContent } from './FeedContent';

function renderEmptyFeed(overrides: Partial<React.ComponentProps<typeof FeedContent>> = {}) {
  return render(
    <FeedContent
      feed={[]}
      loading={false}
      error={null}
      hasMore={false}
      loadingMore={false}
      loadMore={vi.fn()}
      {...overrides}
    />,
  );
}

describe('FeedContent', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the default empty state when no override is provided', () => {
    renderEmptyFeed();

    expect(screen.getByTestId('feed-empty')).toBeInTheDocument();
    expect(screen.getByText('No items to show.')).toBeInTheDocument();
  });

  it('renders a custom empty state and action', () => {
    const onAction = vi.fn();

    renderEmptyFeed({
      emptyState: {
        title: 'Offline',
        description: 'Reconnect before refreshing.',
        actionLabel: 'Retry',
        onAction,
      },
    });

    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('Reconnect before refreshing.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders an actionable error state without losing the error detail', () => {
    const onRetry = vi.fn();

    renderEmptyFeed({
      error: 'Public feed request timed out.',
      errorActionLabel: 'Retry',
      onErrorAction: onRetry,
    });

    expect(screen.getByTestId('feed-error')).toHaveTextContent('Feed unavailable');
    expect(screen.getByTestId('feed-error')).toHaveTextContent('Public feed request timed out.');
    fireEvent.click(screen.getByTestId('feed-error-action'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders stable loading skeleton rows while the feed is loading', () => {
    renderEmptyFeed({ loading: true });

    expect(screen.getByTestId('feed-loading')).toHaveTextContent('Loading feed...');
    expect(screen.getByTestId('feed-loading')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('feed-loading-skeleton').children).toHaveLength(3);
  });
});
