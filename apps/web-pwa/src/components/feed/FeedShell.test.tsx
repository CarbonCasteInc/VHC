/* @vitest-environment jsdom */

import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, vi } from 'vitest';
import React from 'react';
import { FeedShell } from './FeedShell';
import { FEED_ORIENTATION_STORAGE_KEY } from './FeedShellChrome';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import type { FeedItem } from '@vh/data-model';
import { resetExpandedCardStore } from './expandedCardStore';
import { useDiscoveryStore } from '../../store/discovery';

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
const mockUseStoryRemoval = vi.fn().mockReturnValue({
  isRemoved: false,
  removalReason: null,
  removalEntry: null,
});
vi.mock('./useStoryRemoval', () => ({
  useStoryRemoval: (...args: unknown[]) => mockUseStoryRemoval(...args),
}));

// Mock newsCardAnalysis to prevent import side effects
vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
  sanitizePublicationNeutralSummary: (summary: string) => summary,
}));

// ---- Helpers ----

const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-1',
    kind: 'NEWS_STORY',
    title: 'Test headline',
    created_at: NOW - 2 * HOUR_MS,
    latest_activity_at: NOW - HOUR_MS,
    hotness: 5.0,
    eye: 10,
    lightbulb: 5,
    comments: 3,
    ...overrides,
  };
}

function makeFeedResult(
  overrides: Partial<UseDiscoveryFeedResult> = {},
): UseDiscoveryFeedResult {
  return {
    feed: [],
    selectedStorylineId: null,
    filter: 'ALL',
    sortMode: 'LATEST',
    personalization: { preferredCategories: [] },
    loading: false,
    error: null,
    setFilter: vi.fn(),
    focusStoryline: vi.fn(),
    clearStorylineFocus: vi.fn(),
    setSortMode: vi.fn(),
    ...overrides,
  };
}

describe('FeedShell', () => {
  afterEach(() => {
    cleanup();
    mockNavigate.mockReset();
    mockSearch = {};
    resetExpandedCardStore();
    useDiscoveryStore.getState().reset();
    localStorage.clear();
    delete (window as Window & { __VH_BOOT_SEARCH__?: string }).__VH_BOOT_SEARCH__;
    window.history.replaceState(window.history.state, '', '/');
  });

  // ---- Rendering structure ----

  it('renders the shell container', () => {
    render(<FeedShell feedResult={makeFeedResult()} />);
    expect(screen.getByTestId('feed-shell')).toBeInTheDocument();
  });

  it('renders compact feed chrome with live item status', () => {
    const items = [
      makeFeedItem({ topic_id: 'news-1', kind: 'NEWS_STORY' }),
      makeFeedItem({ topic_id: 'topic-1', kind: 'USER_TOPIC' }),
    ];

    render(<FeedShell feedResult={makeFeedResult({ feed: items, filter: 'NEWS', sortMode: 'HOTTEST' })} />);

    const chrome = screen.getByTestId('feed-shell-chrome');
    expect(chrome).toBeInTheDocument();
    expect(within(chrome).getByText('Main feed')).toBeInTheDocument();
    expect(screen.getByTestId('feed-shell-status')).toHaveTextContent('2 live · 1 news · 1 topics');
    expect(screen.getByTestId('feed-shell-mode')).toHaveTextContent('News/Hottest');
  });

  it('labels focused storyline mode in the compact chrome', () => {
    useDiscoveryStore.getState().setItems([
      makeFeedItem({ topic_id: 'storyline-news', story_id: 'story-a', storyline_id: 'line-1' }),
    ]);

    render(
      <FeedShell
        feedResult={makeFeedResult({
          feed: [makeFeedItem({ topic_id: 'storyline-news', story_id: 'story-a', storyline_id: 'line-1' })],
          selectedStorylineId: 'line-1',
        })}
      />,
    );

    expect(screen.getByTestId('feed-shell-mode')).toHaveTextContent('Storyline focus/Latest/1 items');
  });

  it('shows the For You orientation only on first use', async () => {
    render(<FeedShell feedResult={makeFeedResult()} />);

    const orientation = await screen.findByTestId('feed-orientation-card');
    expect(within(orientation).getByText('For You')).toBeInTheDocument();
    expect(
      within(orientation).getByText(/open any card for synthesis, frame \/ reframe, and live replies/i),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(localStorage.getItem(FEED_ORIENTATION_STORAGE_KEY)).toBe('true');
    });

    cleanup();
    render(<FeedShell feedResult={makeFeedResult()} />);
    await waitFor(() => {
      expect(screen.queryByTestId('feed-orientation-card')).not.toBeInTheDocument();
    });
  });

  it('dismisses the first-use orientation card', async () => {
    render(<FeedShell feedResult={makeFeedResult()} />);

    expect(await screen.findByTestId('feed-orientation-card')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('feed-orientation-card')).not.toBeInTheDocument();
  });

  it('renders FilterChips component', () => {
    render(<FeedShell feedResult={makeFeedResult()} />);
    expect(screen.getByTestId('filter-chips')).toBeInTheDocument();
  });

  it('renders SortControls component', () => {
    render(<FeedShell feedResult={makeFeedResult()} />);
    expect(screen.getByTestId('sort-controls')).toBeInTheDocument();
  });

  // ---- Empty state ----

  it('shows empty state when feed is empty', () => {
    render(<FeedShell feedResult={makeFeedResult({ feed: [] })} />);
    expect(screen.getByTestId('feed-empty')).toBeInTheDocument();
    expect(screen.getByText('No items to show.')).toBeInTheDocument();
  });

  // ---- Loading state ----

  it('shows loading state when loading is true', () => {
    render(<FeedShell feedResult={makeFeedResult({ loading: true })} />);
    expect(screen.getByTestId('feed-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading feed…')).toBeInTheDocument();
  });

  it('does not show feed list while loading', () => {
    render(<FeedShell feedResult={makeFeedResult({ loading: true })} />);
    expect(screen.queryByTestId('feed-list')).not.toBeInTheDocument();
  });

  // ---- Error state ----

  it('shows error state when error is set', () => {
    render(
      <FeedShell feedResult={makeFeedResult({ error: 'Network error' })} />,
    );
    expect(screen.getByTestId('feed-error')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('error has role=alert for accessibility', () => {
    render(
      <FeedShell feedResult={makeFeedResult({ error: 'Bad request' })} />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('error takes precedence over loading', () => {
    render(
      <FeedShell
        feedResult={makeFeedResult({ error: 'Err', loading: true })}
      />,
    );
    expect(screen.getByTestId('feed-error')).toBeInTheDocument();
    expect(screen.queryByTestId('feed-loading')).not.toBeInTheDocument();
  });

  it('error takes precedence over feed items', () => {
    const items = [makeFeedItem({ topic_id: 'a' })];
    render(
      <FeedShell
        feedResult={makeFeedResult({ error: 'Err', feed: items })}
      />,
    );
    expect(screen.getByTestId('feed-error')).toBeInTheDocument();
    expect(screen.queryByTestId('feed-list')).not.toBeInTheDocument();
  });

  // ---- Feed items ----

  it('renders feed items when available', () => {
    const items = [
      makeFeedItem({ topic_id: 'item-1', title: 'First' }),
      makeFeedItem({ topic_id: 'item-2', title: 'Second' }),
    ];
    render(<FeedShell feedResult={makeFeedResult({ feed: items })} />);
    expect(screen.getByTestId('feed-list')).toBeInTheDocument();
    expect(screen.getByTestId('feed-item-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('feed-item-item-2')).toBeInTheDocument();
  });

  it('restores detail search state from the boot URL snapshot on direct load', async () => {
    (window as Window & { __VH_BOOT_SEARCH__?: string }).__VH_BOOT_SEARCH__ =
      '?detail=news%3Astory-1&feedFilter=NEWS&feedSort=HOTTEST';

    render(
      <React.StrictMode>
        <FeedShell
          feedResult={makeFeedResult({
            feed: [makeFeedItem({ topic_id: 'topic-direct-load', story_id: 'story-1' })],
          })}
        />
      </React.StrictMode>,
    );

    expect(window.location.search).toBe(
      '?detail=news%3Astory-1&feedFilter=NEWS&feedSort=HOTTEST',
    );
    expect(
      await screen.findByTestId('news-card-detail-topic-direct-load'),
    ).toBeInTheDocument();
  });

  it('keeps NEWS_STORY row identity stable across created_at churn when story_id is present', () => {
    const initial = makeFeedItem({
      story_id: 'story-stable',
      topic_id: 'news-stable',
      title: 'Stable identity story',
      created_at: NOW - 5_000,
      latest_activity_at: NOW - 2_000,
    });

    const { rerender } = render(
      <FeedShell feedResult={makeFeedResult({ feed: [initial] })} />,
    );

    const before = screen.getByTestId('feed-item-story-stable');

    const updated = makeFeedItem({
      story_id: 'story-stable',
      topic_id: 'news-stable',
      title: 'Stable identity story',
      created_at: NOW + 99_000,
      latest_activity_at: NOW + 120_000,
    });

    rerender(<FeedShell feedResult={makeFeedResult({ feed: [updated] })} />);

    const after = screen.getByTestId('feed-item-story-stable');
    expect(after).toBe(before);
  });

  it('routes each feed kind to the matching card component', () => {
    const items = [
      makeFeedItem({ topic_id: 'news', title: 'Hot news', kind: 'NEWS_STORY' }),
      makeFeedItem({ topic_id: 'topic', title: 'Community topic', kind: 'USER_TOPIC' }),
      makeFeedItem({
        topic_id: 'social',
        title: 'Linked social mention',
        kind: 'SOCIAL_NOTIFICATION',
      }),
    ];

    render(<FeedShell feedResult={makeFeedResult({ feed: items })} />);

    expect(screen.getByTestId('news-card-news')).toBeInTheDocument();
    expect(screen.getByTestId('topic-card-topic')).toBeInTheDocument();
    expect(screen.getByTestId('social-card-social')).toBeInTheDocument();

    const socialRow = screen.getByTestId('feed-item-social');
    expect(within(socialRow).getByText('Linked social mention')).toBeInTheDocument();
  });

  it('routes ARTICLE kind to ArticleFeedCard', () => {
    const items = [
      makeFeedItem({
        topic_id: 'article-1',
        title: 'My Published Article',
        kind: 'ARTICLE',
      }),
    ];

    render(<FeedShell feedResult={makeFeedResult({ feed: items })} />);

    expect(screen.getByTestId('article-card-article-1')).toBeInTheDocument();
    expect(screen.getByText('My Published Article')).toBeInTheDocument();
  });

  it('routes ACTION_RECEIPT kind to ReceiptFeedCard', () => {
    const items = [
      makeFeedItem({
        topic_id: 'receipt-1',
        title: 'Letter to Rep. Smith',
        kind: 'ACTION_RECEIPT',
      }),
    ];

    render(<FeedShell feedResult={makeFeedResult({ feed: items })} />);

    expect(screen.getByTestId('feed-receipt-receipt-1')).toBeInTheDocument();
    expect(screen.getByText('Letter to Rep. Smith')).toBeInTheDocument();
  });

  // ---- Filter and sort interaction ----

  it('passes active filter to FilterChips', () => {
    render(<FeedShell feedResult={makeFeedResult({ filter: 'TOPICS' })} />);
    expect(screen.getByTestId('filter-chip-TOPICS')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('passes active sortMode to SortControls', () => {
    render(
      <FeedShell feedResult={makeFeedResult({ sortMode: 'HOTTEST' })} />,
    );
    expect(screen.getByTestId('sort-mode-HOTTEST')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('calls setFilter when a filter chip is clicked', () => {
    const setFilter = vi.fn();
    render(<FeedShell feedResult={makeFeedResult({ setFilter })} />);

    fireEvent.click(screen.getByTestId('filter-chip-NEWS'));
    expect(setFilter).toHaveBeenCalledWith('NEWS');
  });

  it('calls setSortMode when a sort button is clicked', () => {
    const setSortMode = vi.fn();
    render(<FeedShell feedResult={makeFeedResult({ setSortMode })} />);

    fireEvent.click(screen.getByTestId('sort-mode-MY_ACTIVITY'));
    expect(setSortMode).toHaveBeenCalledWith('MY_ACTIVITY');
  });

  // ---- Multiple items render ----

  it('renders correct number of items', () => {
    const items = [
      makeFeedItem({ topic_id: 'a' }),
      makeFeedItem({ topic_id: 'b' }),
      makeFeedItem({ topic_id: 'c' }),
    ];
    render(<FeedShell feedResult={makeFeedResult({ feed: items })} />);
    const list = screen.getByTestId('feed-list');
    expect(list.querySelectorAll('li')).toHaveLength(3);
  });

  // ---- Removal filtering ----

  it('shows removal indicator instead of news card when story is removed', () => {
    mockUseStoryRemoval.mockReturnValue({
      isRemoved: true,
      removalReason: 'extraction-failed-permanently',
      removalEntry: null,
    });

    const items = [
      makeFeedItem({ topic_id: 'removed-1', kind: 'NEWS_STORY', title: 'Removed story' }),
    ];
    render(<FeedShell feedResult={makeFeedResult({ feed: items })} />);

    expect(screen.getByTestId('removal-indicator')).toBeInTheDocument();
    expect(screen.queryByTestId('news-card-removed-1')).not.toBeInTheDocument();
  });

  it('renders news card normally when feature flag is off (not removed)', () => {
    mockUseStoryRemoval.mockReturnValue({
      isRemoved: false,
      removalReason: null,
      removalEntry: null,
    });

    const items = [
      makeFeedItem({ topic_id: 'visible-1', kind: 'NEWS_STORY', title: 'Visible story' }),
    ];
    render(<FeedShell feedResult={makeFeedResult({ feed: items })} />);

    expect(screen.getByTestId('news-card-visible-1')).toBeInTheDocument();
    expect(screen.queryByTestId('removal-indicator')).not.toBeInTheDocument();
  });
});
