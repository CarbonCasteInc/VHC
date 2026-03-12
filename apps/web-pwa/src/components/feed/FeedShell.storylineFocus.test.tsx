/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { FeedItem, StorylineGroup } from '@vh/data-model';
import { FeedShell } from './FeedShell';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import { useNewsStore } from '../../store/news';
import { useDiscoveryStore } from '../../store/discovery';

const mockNavigate = vi.fn();
let mockSearch: Record<string, unknown> = {};

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef<HTMLAnchorElement, any>(({ children, to, ...rest }, ref) => (
    <a ref={ref} href={typeof to === 'string' ? to : '#'} {...rest}>
      {children}
    </a>
  )),
  useRouter: () => ({ navigate: mockNavigate }),
  useRouterState: () => ({
    location: {
      pathname: '/',
      search: mockSearch,
    },
  }),
}));

vi.mock('./useStoryRemoval', () => ({
  useStoryRemoval: () => ({
    isRemoved: false,
    removalReason: null,
    removalEntry: null,
  }),
}));

vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
}));

const NOW = 1_700_000_000_000;

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-1',
    story_id: 'story-1',
    storyline_id: 'storyline-1',
    kind: 'NEWS_STORY',
    title: 'Transit budget vote',
    created_at: NOW - 1_000,
    latest_activity_at: NOW,
    hotness: 4,
    eye: 10,
    lightbulb: 5,
    comments: 1,
    ...overrides,
  };
}

function makeFeedResult(
  overrides: Partial<UseDiscoveryFeedResult> = {},
): UseDiscoveryFeedResult {
  return {
    feed: [makeFeedItem()],
    selectedStorylineId: 'storyline-1',
    filter: 'ALL',
    sortMode: 'LATEST',
    loading: false,
    error: null,
    setFilter: vi.fn(),
    focusStoryline: vi.fn(),
    clearStorylineFocus: vi.fn(),
    setSortMode: vi.fn(),
    ...overrides,
  };
}

function makeStoryline(): StorylineGroup {
  return {
    schemaVersion: 'storyline-group-v0',
    storyline_id: 'storyline-1',
    topic_id: 'a'.repeat(64),
    canonical_story_id: 'story-1',
    story_ids: ['story-1', 'story-2'],
    headline: 'Transit budget storyline',
    related_coverage: [
      {
        source_id: 'related-1',
        publisher: 'Metro Daily',
        title: 'Mayor pushes for the transit package',
        url: 'https://example.com/metro',
        url_hash: 'hash-metro',
      },
    ],
    entity_keys: ['transit', 'city-council'],
    time_bucket: '2026-03-11T10',
    created_at: NOW - 2_000,
    updated_at: NOW,
  };
}

describe('FeedShell storyline focus', () => {
  beforeEach(() => {
    mockSearch = {};
    mockNavigate.mockReset();
    useNewsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useNewsStore.getState().setStorylines([makeStoryline()]);
    useDiscoveryStore.getState().setItems([
      makeFeedItem(),
      makeFeedItem({
        topic_id: 'topic-2',
        story_id: 'story-2',
        title: 'Transit route revision advances',
      }),
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useNewsStore.getState().reset();
    useDiscoveryStore.getState().reset();
  });

  it('renders a storyline focus panel with grouped related coverage', () => {
    render(<FeedShell feedResult={makeFeedResult()} />);

    expect(screen.getByTestId('storyline-focus-panel-storyline-1')).toBeInTheDocument();
    expect(screen.getByTestId('storyline-focus-count-storyline-1')).toHaveTextContent(
      'Showing 2 stories from this storyline in the feed.',
    );
    expect(screen.getByText('Metro Daily:')).toBeInTheDocument();
    expect(screen.getByText('Mayor pushes for the transit package')).toBeInTheDocument();
  });

  it('clears storyline focus from the panel action', () => {
    const clearStorylineFocus = vi.fn();
    render(<FeedShell feedResult={makeFeedResult({ clearStorylineFocus })} />);

    fireEvent.click(screen.getByTestId('storyline-focus-clear-storyline-1'));
    expect(clearStorylineFocus).toHaveBeenCalledTimes(1);
  });

  it('hydrates storyline focus from the current search param', () => {
    mockSearch = { storyline: 'storyline-1' };
    const focusStoryline = vi.fn();

    render(
      <FeedShell
        feedResult={makeFeedResult({
          selectedStorylineId: null,
          focusStoryline,
        })}
      />,
    );

    expect(focusStoryline).toHaveBeenCalledWith('storyline-1');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('opens storyline focus into search params while preserving unrelated query state', () => {
    mockSearch = { view: 'grid' };

    render(<FeedShell feedResult={makeFeedResult()} />);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/',
      search: { view: 'grid', storyline: 'storyline-1' },
      replace: false,
    });
  });

  it('removes the storyline search param when focus is cleared', () => {
    mockSearch = { storyline: 'storyline-1', view: 'grid' };
    const { rerender } = render(<FeedShell feedResult={makeFeedResult()} />);

    mockNavigate.mockClear();
    rerender(
      <FeedShell
        feedResult={makeFeedResult({
          selectedStorylineId: null,
        })}
      />,
    );

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/',
      search: { view: 'grid' },
      replace: true,
    });
  });

  it('opens an archive child into the route search and preserves existing storyline focus', () => {
    mockSearch = { view: 'grid', storyline: 'storyline-1' };

    render(<FeedShell feedResult={makeFeedResult()} />);

    fireEvent.click(screen.getByTestId('storyline-archive-jump-story-2'));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/',
      search: { view: 'grid', storyline: 'storyline-1', story: 'story-2' },
      replace: false,
    });
  });

  it('hydrates and focuses the selected archive child from the current search params', () => {
    mockSearch = { storyline: 'storyline-1', story: 'story-2' };
    const target = document.createElement('article');
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    target.setAttribute('data-story-id', 'story-2');
    Object.defineProperty(target, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(target, 'focus', {
      configurable: true,
      value: focus,
    });
    document.body.appendChild(target);

    render(<FeedShell feedResult={makeFeedResult()} />);

    expect(screen.getByTestId('storyline-archive-selected-story-2')).toHaveTextContent(
      'Focused in feed',
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('goes back to the prior route state from the panel back action after a local open', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { rerender } = render(<FeedShell feedResult={makeFeedResult()} />);

    mockSearch = { storyline: 'storyline-1' };
    rerender(<FeedShell feedResult={makeFeedResult()} />);

    fireEvent.click(screen.getByTestId('storyline-focus-back-storyline-1'));
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('does not navigate back over route-driven storyline changes', () => {
    mockSearch = { storyline: 'storyline-2' };
    const focusStoryline = vi.fn();

    render(
      <FeedShell
        feedResult={makeFeedResult({
          selectedStorylineId: 'storyline-1',
          focusStoryline,
        })}
      />,
    );

    expect(focusStoryline).toHaveBeenCalledWith('storyline-2');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps only the clear action for route-driven storyline state', () => {
    mockSearch = { storyline: 'storyline-1' };

    render(<FeedShell feedResult={makeFeedResult()} />);

    expect(screen.queryByTestId('storyline-focus-back-storyline-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('storyline-focus-clear-storyline-1')).toBeInTheDocument();
  });

  it('omits the related coverage list and formats singular counts when coverage is absent', () => {
    useNewsStore.getState().setStorylines([
      {
        ...makeStoryline(),
        story_ids: ['story-1'],
        related_coverage: [],
      },
    ]);
    useDiscoveryStore.getState().setItems([
      makeFeedItem(),
      makeFeedItem({
        topic_id: 'topic-2',
        story_id: 'story-2',
        storyline_id: 'storyline-other',
        title: 'Separate storyline item',
      }),
    ]);

    render(<FeedShell feedResult={makeFeedResult()} />);

    expect(screen.getByTestId('storyline-focus-count-storyline-1')).toHaveTextContent(
      'Showing 1 story from this storyline in the feed.',
    );
    expect(screen.queryByText('Related coverage')).not.toBeInTheDocument();
  });
});
