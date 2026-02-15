/* @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FeedList from './FeedList';

// Mock @tanstack/react-router Link to avoid needing full router context
vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef<HTMLAnchorElement, any>(
    ({ children, to, params, ...rest }, ref) => (
      <a ref={ref} href={typeof to === 'string' ? to : '#'} {...rest}>
        {children}
      </a>
    ),
  ),
}));

vi.mock('../hooks/useDiscoveryFeed', () => ({
  useDiscoveryFeed: vi.fn(() => ({
    feed: [],
    filter: 'ALL',
    sortMode: 'LATEST',
    loading: false,
    error: null,
    setFilter: vi.fn(),
    setSortMode: vi.fn(),
  })),
}));

vi.mock('react-virtualized-auto-sizer', () => ({
  default: ({ children }: any) => children({ height: 600, width: 800 })
}));

describe('FeedList', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders discovery feed shell', () => {
    render(<FeedList />);
    expect(screen.getByTestId('feed-shell')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(<FeedList />);
    expect(screen.getAllByTestId('feed-empty').length).toBeGreaterThan(0);
  });

  it('renders feed items when present', async () => {
    const { useDiscoveryFeed } = await import('../hooks/useDiscoveryFeed');
    vi.mocked(useDiscoveryFeed).mockReturnValue({
      feed: [
        {
          topic_id: 'test-1',
          kind: 'NEWS_STORY',
          title: 'Test Story',
          created_at: Date.now(),
          latest_activity_at: Date.now(),
          hotness: 1,
          eye: 5,
          lightbulb: 3,
          comments: 0,
        },
      ],
      filter: 'ALL',
      sortMode: 'LATEST',
      loading: false,
      error: null,
      setFilter: vi.fn(),
      setSortMode: vi.fn(),
    });
    render(<FeedList />);
    expect(screen.getByTestId('feed-list')).toBeInTheDocument();
    expect(screen.getByTestId('feed-item-test-1')).toBeInTheDocument();
  });
});
