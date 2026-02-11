/* @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FeedList from './FeedList';
import { useFeedStore } from '../hooks/useFeedStore';

vi.mock('react-virtualized-auto-sizer', () => ({
  default: ({ children }: any) => children({ height: 600, width: 800 })
}));

describe('FeedList', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FEED_V2_ENABLED', 'false');
    useFeedStore.setState({ items: [], page: 0, hasMore: true, loading: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders items from the store', async () => {
    useFeedStore.getState().hydrate();
    render(<FeedList />);
    const matches = await screen.findAllByText(/Democratic Party/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('shows empty state when no items', () => {
    useFeedStore.setState((state) => ({
      ...state,
      items: [],
      hydrate: () => {},
      hasMore: false
    }));
    render(<FeedList />);
    expect(screen.getAllByText(/No stories yet/).length).toBeGreaterThan(0);
  });
});
