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

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef<HTMLAnchorElement, any>(({ children, to, ...rest }, ref) => (
    <a ref={ref} href={typeof to === 'string' ? to : '#'} {...rest}>
      {children}
    </a>
  )),
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
