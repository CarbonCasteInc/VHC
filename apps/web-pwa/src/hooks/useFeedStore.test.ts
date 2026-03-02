import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEED_PAGE_SIZE, useFeedStore } from './useFeedStore';
import { useDiscoveryStore } from '../store/discovery';

const now = Date.now();

function makeDiscoveryItem(id: string) {
  return {
    topic_id: id,
    kind: 'NEWS_STORY' as const,
    title: `Discovery Item ${id}`,
    created_at: now,
    latest_activity_at: now,
    hotness: 1,
    eye: 5,
    lightbulb: 3,
    comments: 0,
  };
}

describe('useFeedStore', () => {
  beforeEach(() => {
    useFeedStore.setState({
      items: [],
      discoveryFeed: [],
      allDiscoveryFeed: [],
      page: 0,
      hasMore: false,
      loading: false,
    });
    useDiscoveryStore.getState().setItems([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hydrates from discovery store and pages the first window', () => {
    useDiscoveryStore.getState().setItems([makeDiscoveryItem('disc-1')]);

    useFeedStore.getState().hydrate();

    const state = useFeedStore.getState();
    expect(state.discoveryFeed).toHaveLength(1);
    expect(state.discoveryFeed[0].topic_id).toBe('disc-1');
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe('disc-1');
    expect(state.page).toBe(1);
    expect(state.hasMore).toBe(false);
  });

  it('hydrates to an empty state when discovery store has no items', () => {
    useFeedStore.getState().hydrate();

    const state = useFeedStore.getState();
    expect(state.discoveryFeed).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.page).toBe(0);
    expect(state.hasMore).toBe(false);
  });

  it('sets hasMore true when discovery feed exceeds the first page', () => {
    const items = Array.from({ length: FEED_PAGE_SIZE + 3 }, (_, index) =>
      makeDiscoveryItem(`disc-${index}`),
    );
    useDiscoveryStore.getState().setItems(items);

    useFeedStore.getState().hydrate();

    const state = useFeedStore.getState();
    expect(state.discoveryFeed).toHaveLength(FEED_PAGE_SIZE);
    expect(state.items).toHaveLength(FEED_PAGE_SIZE);
    expect(state.hasMore).toBe(true);
    expect(state.page).toBe(1);
  });

  it('setDiscoveryFeed preserves pagination by default', () => {
    vi.useFakeTimers();
    const fullFeed = Array.from({ length: FEED_PAGE_SIZE + 2 }, (_, index) =>
      makeDiscoveryItem(`full-${index}`),
    );

    useFeedStore.getState().setDiscoveryFeed(fullFeed);
    useFeedStore.getState().loadMore();
    vi.advanceTimersByTime(120);

    expect(useFeedStore.getState().page).toBe(2);
    expect(useFeedStore.getState().discoveryFeed).toHaveLength(FEED_PAGE_SIZE + 2);
    expect(useFeedStore.getState().hasMore).toBe(false);

    const filteredFeed = [makeDiscoveryItem('filtered-1'), makeDiscoveryItem('filtered-2')];
    useFeedStore.getState().setDiscoveryFeed(filteredFeed);

    const state = useFeedStore.getState();
    expect(state.discoveryFeed).toHaveLength(2);
    expect(state.page).toBe(1);
    expect(state.hasMore).toBe(false);
  });

  it('setDiscoveryFeed can reset pagination to the first page explicitly', () => {
    const fullFeed = Array.from({ length: FEED_PAGE_SIZE + 3 }, (_, index) =>
      makeDiscoveryItem(`full-reset-${index}`),
    );

    vi.useFakeTimers();
    useFeedStore.getState().setDiscoveryFeed(fullFeed);
    useFeedStore.getState().loadMore();
    vi.advanceTimersByTime(120);
    expect(useFeedStore.getState().page).toBe(2);

    useFeedStore
      .getState()
      .setDiscoveryFeed(fullFeed, { resetPagination: true });

    const state = useFeedStore.getState();
    expect(state.page).toBe(1);
    expect(state.discoveryFeed).toHaveLength(FEED_PAGE_SIZE);
    expect(state.hasMore).toBe(true);
  });

  it('loadMore appends the next page and clears hasMore at the end', () => {
    vi.useFakeTimers();
    const total = FEED_PAGE_SIZE + 2;
    const items = Array.from({ length: total }, (_, index) =>
      makeDiscoveryItem(`disc-${index}`),
    );

    useFeedStore.getState().setDiscoveryFeed(items);
    useFeedStore.getState().loadMore();

    expect(useFeedStore.getState().loading).toBe(true);

    vi.advanceTimersByTime(120);

    const state = useFeedStore.getState();
    expect(state.discoveryFeed).toHaveLength(total);
    expect(state.items).toHaveLength(total);
    expect(state.page).toBe(2);
    expect(state.hasMore).toBe(false);
    expect(state.loading).toBe(false);
  });

  it('loadMore no-ops when loading or hasMore guard fails', () => {
    useFeedStore.setState({ hasMore: false, loading: false });
    useFeedStore.getState().loadMore();
    expect(useFeedStore.getState().loading).toBe(false);

    useFeedStore.setState({ hasMore: true, loading: true });
    useFeedStore.getState().loadMore();
    expect(useFeedStore.getState().loading).toBe(true);
  });

  it('setItems routes through discovery store and keeps NEWS_STORY default mapping', () => {
    useFeedStore.getState().setItems([
      {
        id: 'legacy-1',
        title: 'Legacy Item',
        summary: 'Test',
        source: 'Discovery · News',
        timestamp: now,
        engagementScore: 1,
        readCount: 5,
        perspectives: [],
      },
    ]);

    const disc = useDiscoveryStore.getState().items;
    expect(disc).toHaveLength(1);
    expect(disc[0].topic_id).toBe('legacy-1');
    expect(disc[0].kind).toBe('NEWS_STORY');
    expect(useFeedStore.getState().discoveryFeed[0]?.topic_id).toBe('legacy-1');
  });

  it('infers SOCIAL_NOTIFICATION kind and normalizes invalid timestamp', () => {
    const before = Date.now();

    useFeedStore.getState().setItems([
      {
        id: 'social-1',
        title: 'Social Item',
        summary: 'Test',
        source: 'Discovery · Social',
        timestamp: -42,
        engagementScore: 2,
        readCount: 1,
        perspectives: [],
      },
    ]);

    const disc = useDiscoveryStore.getState().items[0];
    expect(disc.kind).toBe('SOCIAL_NOTIFICATION');
    expect(disc.created_at).toBeGreaterThanOrEqual(before);
  });

  it('infers USER_TOPIC kind from source label', () => {
    useFeedStore.getState().setItems([
      {
        id: 'topic-1',
        title: 'Topic Item',
        summary: 'Test',
        source: 'Discovery · Topics',
        timestamp: now,
        engagementScore: 2,
        readCount: 1,
        perspectives: [],
      },
    ]);

    const disc = useDiscoveryStore.getState().items[0];
    expect(disc.kind).toBe('USER_TOPIC');
  });
});
