/* @vitest-environment jsdom */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import type { FeedItem, StoryBundle } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { NewsCardWithRemoval } from './NewsCardWithRemoval';

// Mock useStoryRemoval hook
const mockUseStoryRemoval = vi.fn().mockReturnValue({
  isRemoved: false,
  removalReason: null,
  removalEntry: null,
});

vi.mock('./useStoryRemoval', () => ({
  useStoryRemoval: (...args: unknown[]) => mockUseStoryRemoval(...args),
}));

// Mock NewsCard to avoid deep rendering
vi.mock('./NewsCard', () => ({
  NewsCard: ({ item }: { item: FeedItem }) => (
    <div data-testid={`news-card-${item.topic_id}`}>NewsCard Mock</div>
  ),
}));

// Mock newsCardAnalysis to prevent import side effects
vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
}));

const NOW = 1_700_000_000_000;

function makeNewsItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'news-1',
    kind: 'NEWS_STORY',
    title: 'Test headline',
    created_at: NOW - 3_600_000,
    latest_activity_at: NOW,
    hotness: 5.0,
    eye: 10,
    lightbulb: 5,
    comments: 3,
    ...overrides,
  };
}

function makeStoryBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'news-1',
    headline: 'Test headline',
    summary_hint: 'Summary hint.',
    cluster_window_start: NOW - 7_200_000,
    cluster_window_end: NOW,
    sources: [
      {
        source_id: 'src-1',
        publisher: 'Pub A',
        url: 'https://example.com/a',
        url_hash: 'hash-abc',
        published_at: NOW - 3_600_000,
        title: 'Test headline',
      },
    ],
    cluster_features: {
      entity_keys: ['test'],
      time_bucket: '2026-02-16T10',
      semantic_signature: 'sig-1',
    },
    provenance_hash: 'prov-1',
    created_at: NOW - 3_600_000,
    ...overrides,
  };
}

describe('NewsCardWithRemoval', () => {
  beforeEach(() => {
    useNewsStore.getState().reset();
    mockUseStoryRemoval.mockReturnValue({
      isRemoved: false,
      removalReason: null,
      removalEntry: null,
    });
  });

  afterEach(() => {
    cleanup();
    useNewsStore.getState().reset();
  });

  it('renders NewsCard when not removed', () => {
    render(<NewsCardWithRemoval item={makeNewsItem()} />);
    expect(screen.getByTestId('news-card-news-1')).toBeInTheDocument();
    expect(screen.queryByTestId('removal-indicator')).not.toBeInTheDocument();
  });

  it('renders RemovalIndicator when story is removed', () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    mockUseStoryRemoval.mockReturnValue({
      isRemoved: true,
      removalReason: 'extraction-failed-permanently',
      removalEntry: null,
    });

    render(<NewsCardWithRemoval item={makeNewsItem()} />);
    expect(screen.getByTestId('removal-indicator')).toBeInTheDocument();
    expect(screen.queryByTestId('news-card-news-1')).not.toBeInTheDocument();
  });

  it('hides completely after dismissing removal indicator', () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    mockUseStoryRemoval.mockReturnValue({
      isRemoved: true,
      removalReason: 'extraction-failed-permanently',
      removalEntry: null,
    });

    render(<NewsCardWithRemoval item={makeNewsItem()} />);
    expect(screen.getByTestId('removal-indicator')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('removal-indicator-dismiss'));
    expect(screen.queryByTestId('removal-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('news-card-news-1')).not.toBeInTheDocument();
  });

  it('passes first source url_hash to useStoryRemoval hook', () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCardWithRemoval item={makeNewsItem()} />);
    expect(mockUseStoryRemoval).toHaveBeenCalledWith('hash-abc', undefined);
  });

  it('passes undefined when no story found', () => {
    render(<NewsCardWithRemoval item={makeNewsItem()} />);
    expect(mockUseStoryRemoval).toHaveBeenCalledWith(undefined, undefined);
  });

  it('passes undefined when story has no sources', () => {
    useNewsStore.getState().setStories([
      makeStoryBundle({ sources: [] }),
    ]);
    render(<NewsCardWithRemoval item={makeNewsItem()} />);
    expect(mockUseStoryRemoval).toHaveBeenCalledWith(undefined, undefined);
  });

  it('passes removalOptions to the hook', () => {
    const opts = { resolveClient: () => null, isEnabled: () => false };
    render(<NewsCardWithRemoval item={makeNewsItem()} removalOptions={opts} />);
    expect(mockUseStoryRemoval).toHaveBeenCalledWith(undefined, opts);
  });

  it('uses fallback reason when removalReason is null', () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    mockUseStoryRemoval.mockReturnValue({
      isRemoved: true,
      removalReason: null,
      removalEntry: null,
    });

    render(<NewsCardWithRemoval item={makeNewsItem()} />);
    expect(screen.getByTestId('removal-indicator')).toBeInTheDocument();
  });
});
