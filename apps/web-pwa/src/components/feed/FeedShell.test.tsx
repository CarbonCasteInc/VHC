/* @vitest-environment jsdom */

import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { FeedShell } from './FeedShell';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import type { FeedItem } from '@vh/data-model';

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
    filter: 'ALL',
    sortMode: 'LATEST',
    loading: false,
    error: null,
    setFilter: vi.fn(),
    setSortMode: vi.fn(),
    ...overrides,
  };
}

describe('FeedShell', () => {
  afterEach(() => cleanup());

  // ---- Rendering structure ----

  it('renders the shell container', () => {
    render(<FeedShell feedResult={makeFeedResult()} />);
    expect(screen.getByTestId('feed-shell')).toBeInTheDocument();
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
});
