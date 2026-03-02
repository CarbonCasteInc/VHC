import { create } from 'zustand';
import type { FeedItem as DiscoveryFeedItem, FeedKind } from '@vh/data-model';
import { composeFeed, useDiscoveryStore } from '../store/discovery';

export interface Perspective {
  id: string;
  frame: string;
  reframe: string;
}

export interface FeedItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  timestamp: number;
  imageUrl?: string;
  engagementScore: number;
  readCount: number;
  perspectives: Perspective[];
}

export const FEED_PAGE_SIZE = 15;
const LOAD_MORE_DELAY_MS = 80;

interface FeedState {
  items: FeedItem[];
  /** Visible paged discovery feed for FeedShell. */
  discoveryFeed: DiscoveryFeedItem[];
  /** Full discovery feed before pagination windowing. */
  allDiscoveryFeed: DiscoveryFeedItem[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  hydrate: () => void;
  loadMore: () => void;
  setItems: (items: FeedItem[]) => void;
  setDiscoveryFeed: (
    items: ReadonlyArray<DiscoveryFeedItem>,
    options?: { readonly resetPagination?: boolean },
  ) => void;
}

const DISCOVERY_SUMMARY_BY_KIND: Record<FeedKind, string> = {
  NEWS_STORY: 'Trending in discovery feed.',
  USER_TOPIC: 'Community topic update.',
  SOCIAL_NOTIFICATION: 'Social activity update.',
  ARTICLE: 'Published community article.',
  ACTION_RECEIPT: 'Civic action receipt.',
};

const DISCOVERY_SOURCE_BY_KIND: Record<FeedKind, string> = {
  NEWS_STORY: 'Discovery · News',
  USER_TOPIC: 'Discovery · Topics',
  SOCIAL_NOTIFICATION: 'Discovery · Social',
  ARTICLE: 'Discovery · Articles',
  ACTION_RECEIPT: 'Bridge · Actions',
};

function normalizeTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return Date.now();
  }
  return Math.floor(value);
}

function toLegacyFeedItem(item: DiscoveryFeedItem): FeedItem {
  return {
    id: item.topic_id,
    title: item.title,
    summary: DISCOVERY_SUMMARY_BY_KIND[item.kind],
    source: DISCOVERY_SOURCE_BY_KIND[item.kind],
    timestamp: normalizeTimestamp(item.latest_activity_at),
    engagementScore: Math.max(0, item.lightbulb),
    readCount: Math.max(0, item.eye),
    perspectives: [],
  };
}

function inferDiscoveryKind(item: FeedItem): FeedKind {
  const source = item.source.toLowerCase();
  if (source.includes('social')) {
    return 'SOCIAL_NOTIFICATION';
  }
  if (source.includes('topic')) {
    return 'USER_TOPIC';
  }
  return 'NEWS_STORY';
}

function toDiscoveryFeedItem(item: FeedItem): DiscoveryFeedItem {
  const timestamp = normalizeTimestamp(item.timestamp);
  return {
    topic_id: item.id,
    kind: inferDiscoveryKind(item),
    title: item.title,
    created_at: timestamp,
    latest_activity_at: timestamp,
    hotness: Math.max(0, item.engagementScore),
    eye: Math.max(0, Math.floor(item.readCount)),
    lightbulb: Math.max(0, Math.floor(item.engagementScore)),
    comments: 0,
  };
}

function selectDiscoveryFeedItems(): DiscoveryFeedItem[] {
  const discovery = useDiscoveryStore.getState();
  return composeFeed(
    discovery.items,
    discovery.filter,
    discovery.sortMode,
    discovery.rankingConfig,
    Date.now(),
  );
}

function buildPagedState(
  fullFeed: ReadonlyArray<DiscoveryFeedItem>,
  page: number,
  loading: boolean,
): Pick<
  FeedState,
  'allDiscoveryFeed' | 'discoveryFeed' | 'items' | 'page' | 'hasMore' | 'loading'
> {
  const maxPage =
    fullFeed.length === 0 ? 0 : Math.max(1, Math.ceil(fullFeed.length / FEED_PAGE_SIZE));
  const effectivePage = maxPage === 0 ? 0 : Math.min(Math.max(1, page), maxPage);
  const visibleFeed = fullFeed.slice(0, effectivePage * FEED_PAGE_SIZE);

  return {
    allDiscoveryFeed: [...fullFeed],
    discoveryFeed: visibleFeed,
    items: visibleFeed.map(toLegacyFeedItem),
    page: effectivePage,
    hasMore: fullFeed.length > visibleFeed.length,
    loading,
  };
}

/**
 * Feed store backed by discovery feed composition + pagination windowing.
 *
 * V2 discovery feed is now the permanent path. Legacy seed-data
 * and localStorage caching removed in Wave 3 flag retirement.
 */
export const useFeedStore = create<FeedState>((set, get) => ({
  items: [],
  discoveryFeed: [],
  allDiscoveryFeed: [],
  page: 0,
  hasMore: false,
  loading: false,

  hydrate() {
    const discoveryState = useDiscoveryStore.getState();
    const composed = selectDiscoveryFeedItems();
    set({
      ...buildPagedState(composed, 1, discoveryState.loading),
    });
  },

  setItems(items) {
    useDiscoveryStore.getState().setItems(items.map(toDiscoveryFeedItem));
    const discoveryState = useDiscoveryStore.getState();
    const composed = selectDiscoveryFeedItems();
    set({
      ...buildPagedState(composed, 1, discoveryState.loading),
    });
  },

  setDiscoveryFeed(items, options) {
    set((state) => ({
      ...state,
      ...buildPagedState(
        items,
        options?.resetPagination ? 1 : Math.max(1, state.page),
        state.loading,
      ),
    }));
  },

  loadMore() {
    const state = get();
    if (state.loading || !state.hasMore) return;

    set({ loading: true });

    setTimeout(() => {
      set((current) => ({
        ...current,
        ...buildPagedState(current.allDiscoveryFeed, current.page + 1, false),
      }));
    }, LOAD_MORE_DELAY_MS);
  },
}));
