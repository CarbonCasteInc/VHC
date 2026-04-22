/* @vitest-environment jsdom */

import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { DEFAULT_FEED_PERSONALIZATION_CONFIG, type FeedItem } from '@vh/data-model';
import { FEED_PAGE_SIZE, useFeedStore } from '../../hooks/useFeedStore';
import { useDiscoveryFeed } from '../../hooks/useDiscoveryFeed';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import { useDiscoveryStore } from '../../store/discovery';
import { useNewsStore } from '../../store/news';
import {
  bootstrapNewsSnapshotIfConfigured,
  startNewsSnapshotRefreshIfConfigured,
  stopNewsSnapshotRefresh,
} from '../../store/newsSnapshotBootstrap';
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
  sanitizePublicationNeutralSummary: (summary: string) => summary,
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
    personalization: { ...DEFAULT_FEED_PERSONALIZATION_CONFIG },
    loading: false,
    error: null,
    setPersonalization: vi.fn(),
    setFilter: vi.fn(),
    focusStoryline: vi.fn(),
    clearStorylineFocus: vi.fn(),
    setSortMode: vi.fn(),
  };
}

function LiveFeedHarness(): React.JSX.Element {
  return <FeedShell feedResult={useDiscoveryFeed()} />;
}

function makeSnapshotStory(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const storyId = `story-${index}`;
  const topicId = `${index}`.repeat(64).slice(0, 64);
  const publishedAt = NOW - index * HOUR_MS;

  return {
    schemaVersion: 'story-bundle-v0',
    story_id: storyId,
    topic_id: topicId,
    headline: `Bundled headline ${index}`,
    summary_hint: `Summary hint ${index}`,
    cluster_window_start: publishedAt - 600_000,
    cluster_window_end: publishedAt,
    sources: [
      {
        source_id: `source-${index}`,
        publisher: `Publisher ${index}`,
        url: `https://example.com/story-${index}`,
        url_hash: `hash-${index}`,
        published_at: publishedAt,
        title: `Source title ${index}`,
      },
    ],
    cluster_features: {
      entity_keys: [`entity-${index}`],
      time_bucket: `bucket-${index}`,
      semantic_signature: `signature-${index}`,
    },
    provenance_hash: `prov-${index}`,
    created_at: publishedAt,
    ...overrides,
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
    useNewsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    stopNewsSnapshotRefresh();

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
    vi.unstubAllEnvs();
    stopNewsSnapshotRefresh();
    useNewsStore.getState().reset();
    useDiscoveryStore.getState().reset();
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

  it('projects rolling bundler snapshots into a fresh reload stream with lazy older-page reveal', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS', '5000');

    const aggregateStory = makeSnapshotStory(9, {
      story_id: 'story-aggregate',
      topic_id: 'a'.repeat(64),
      headline: 'Aggregate story from bundled sources',
      sources: [
        {
          source_id: 'fox-news',
          publisher: 'Fox News',
          url: 'https://example.com/fox',
          url_hash: 'fox-hash',
          published_at: NOW - 10_000,
          title: 'Fox report',
        },
        {
          source_id: 'cnn-top',
          publisher: 'CNN',
          url: 'https://example.com/cnn',
          url_hash: 'cnn-hash',
          published_at: NOW - 9_000,
          title: 'CNN report',
        },
      ],
      cluster_window_end: NOW + 100,
      created_at: NOW - 10_000,
      provenance_hash: 'prov-aggregate',
    });
    const singletonStory = makeSnapshotStory(8, {
      story_id: 'story-singleton',
      topic_id: 'b'.repeat(64),
      headline: 'Singleton story from one admitted source',
      cluster_window_end: NOW + 50,
      created_at: NOW - 12_000,
      provenance_hash: 'prov-singleton',
    });
    const olderStories = Array.from({ length: FEED_PAGE_SIZE }, (_, index) =>
      makeSnapshotStory(index + 1, {
        story_id: `story-older-${index}`,
        topic_id: `${(index + 1).toString(16)}`.repeat(64).slice(0, 64),
        headline: `Older bundled story ${index}`,
        cluster_window_end: NOW - (index + 1) * HOUR_MS,
      }),
    );
    const firstStories = [aggregateStory, singletonStory, ...olderStories];
    const freshStory = makeSnapshotStory(7, {
      story_id: 'story-fresh',
      topic_id: 'c'.repeat(64),
      headline: 'Fresh automation cluster after reload',
      cluster_window_end: NOW + 500,
      created_at: NOW + 400,
      provenance_hash: 'prov-fresh',
    });
    const latestIndex = Object.fromEntries(
      firstStories.map((story) => [story.story_id, story.cluster_window_end]),
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: 'daemon-feed-validated-rolling-snapshot-v1',
          generatedAt: '2026-04-16T08:00:00.000Z',
          runId: 'article-automation-bundler-run-1',
          stories: firstStories,
          storylines: [],
          latestIndex,
          hotIndex: { 'story-aggregate': 0.91 },
          rollingWindow: { source: 'publisher-canary', artifactCount: 1 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: 'daemon-feed-validated-rolling-snapshot-v1',
          generatedAt: '2026-04-16T08:05:00.000Z',
          runId: 'article-automation-bundler-run-2',
          stories: [freshStory, ...firstStories],
          storylines: [],
          latestIndex: {
            'story-fresh': freshStory.cluster_window_end,
            ...latestIndex,
          },
          hotIndex: { 'story-fresh': 0.95, 'story-aggregate': 0.91 },
          rollingWindow: { source: 'publisher-canary', artifactCount: 2 },
        }),
      });

    await act(async () => {
      await bootstrapNewsSnapshotIfConfigured(useNewsStore, { fetchImpl: fetchImpl as any });
    });

    render(<LiveFeedHarness />);

    expect(screen.getByTestId('feed-item-story-aggregate')).toBeInTheDocument();
    expect(screen.getByText('2 sources')).toBeInTheDocument();
    expect(screen.getByTestId('feed-item-story-singleton')).toBeInTheDocument();
    expect(screen.getAllByTestId(/feed-item-story-/)).toHaveLength(FEED_PAGE_SIZE);
    expect(screen.queryByTestId('feed-item-story-older-14')).not.toBeInTheDocument();

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    act(() => {
      vi.advanceTimersByTime(220);
    });

    expect(screen.getByTestId('feed-item-story-older-14')).toBeInTheDocument();

    expect(startNewsSnapshotRefreshIfConfigured(useNewsStore, { fetchImpl: fetchImpl as any })).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByTestId('feed-item-story-fresh')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
