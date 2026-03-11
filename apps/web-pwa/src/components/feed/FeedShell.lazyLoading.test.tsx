/* @vitest-environment jsdom */

import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { FeedItem } from '@vh/data-model';
import { FEED_PAGE_SIZE, useFeedStore } from '../../hooks/useFeedStore';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import { FeedShell } from './FeedShell';

const mockNavigate = vi.fn();
let mockSearch: Record<string, unknown> = {};

// Mock @tanstack/react-router hooks to avoid needing full router context
vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef<HTMLAnchorElement, any>(
    ({ children, to, params, ...rest }, ref) => (
      <a ref={ref} href={typeof to === 'string' ? to : '#'} {...rest}>
        {children}
      </a>
    ),
  ),
  useRouter: () => ({ navigate: mockNavigate }),
  useRouterState: () => ({
    location: {
      pathname: '/',
      search: mockSearch,
    },
  }),
}));

// Mock useStoryRemoval so NewsCardWithRemoval doesn't need a real Gun client
vi.mock('./useStoryRemoval', () => ({
  useStoryRemoval: () => ({
    isRemoved: false,
    removalReason: null,
    removalEntry: null,
  }),
}));

// Mock newsCardAnalysis to prevent import side effects
vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
}));

const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-1',
    kind: 'NEWS_STORY',
    title: 'Test headline',
    created_at: NOW - 2 * HOUR_MS,
    latest_activity_at: NOW - HOUR_MS,
    hotness: 5,
    eye: 10,
    lightbulb: 5,
    comments: 3,
    ...overrides,
  };
}

function makeFeedResult(feed: ReadonlyArray<FeedItem>): UseDiscoveryFeedResult {
  return {
    feed,
    selectedStorylineId: null,
    filter: 'ALL',
    sortMode: 'LATEST',
    loading: false,
    error: null,
    setFilter: vi.fn(),
    focusStoryline: vi.fn(),
    clearStorylineFocus: vi.fn(),
    setSortMode: vi.fn(),
  };
}

describe('FeedShell lazy loading', () => {
  let intersectionCallback: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    useFeedStore.setState({
      items: [],
      discoveryFeed: [],
      allDiscoveryFeed: [],
      page: 0,
      hasMore: false,
      loading: false,
    });

    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn((callback: IntersectionObserverCallback) => {
        intersectionCallback = callback;
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
          unobserve: vi.fn(),
          takeRecords: vi.fn(),
          root: null,
          rootMargin: '0px',
          thresholds: [0],
        } as unknown as IntersectionObserver;
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    intersectionCallback = null;
    mockNavigate.mockReset();
    mockSearch = {};
  });

  it('renders first page, then appends on sentinel intersection', () => {
    vi.useFakeTimers();

    const items = Array.from({ length: FEED_PAGE_SIZE + 3 }, (_, index) =>
      makeFeedItem({
        topic_id: `paged-${index}`,
        title: `Paged item ${index}`,
        created_at: NOW - index,
        latest_activity_at: NOW - index,
      }),
    );

    render(<FeedShell feedResult={makeFeedResult(items)} />);

    expect(screen.getAllByTestId(/feed-item-paged-/)).toHaveLength(FEED_PAGE_SIZE);
    expect(screen.getByTestId('feed-load-sentinel')).toBeInTheDocument();

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('feed-loading-more')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getAllByTestId(/feed-item-paged-/)).toHaveLength(FEED_PAGE_SIZE + 3);
    expect(screen.queryByTestId('feed-load-sentinel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feed-loading-more')).not.toBeInTheDocument();
  });

  it('does not render sentinel when all items fit one page', () => {
    const items = Array.from({ length: FEED_PAGE_SIZE }, (_, index) =>
      makeFeedItem({ topic_id: `fit-${index}`, title: `Fit item ${index}` }),
    );

    render(<FeedShell feedResult={makeFeedResult(items)} />);

    expect(screen.getAllByTestId(/feed-item-fit-/)).toHaveLength(FEED_PAGE_SIZE);
    expect(screen.queryByTestId('feed-load-sentinel')).not.toBeInTheDocument();
  });

  it('falls back to timed load when IntersectionObserver is unavailable', () => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', undefined);

    const items = Array.from({ length: FEED_PAGE_SIZE + 1 }, (_, index) =>
      makeFeedItem({ topic_id: `fallback-${index}`, title: `Fallback item ${index}` }),
    );

    render(<FeedShell feedResult={makeFeedResult(items)} />);

    expect(screen.getAllByTestId(/feed-item-fallback-/)).toHaveLength(FEED_PAGE_SIZE);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('feed-loading-more')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getAllByTestId(/feed-item-fallback-/)).toHaveLength(FEED_PAGE_SIZE + 1);
    expect(screen.queryByTestId('feed-load-sentinel')).not.toBeInTheDocument();
  });
});
