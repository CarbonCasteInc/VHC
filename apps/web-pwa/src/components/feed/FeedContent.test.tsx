/* @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
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
});
