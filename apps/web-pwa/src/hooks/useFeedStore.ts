import { create } from 'zustand';
import type { FeedItem as DiscoveryFeedItem, FeedKind } from '@vh/data-model';
import { composeFeed, useDiscoveryStore } from '../store/discovery';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

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

interface FeedState {
  items: FeedItem[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  hydrate: () => void;
  loadMore: () => void;
  setItems: (items: FeedItem[]) => void;
}

const STORAGE_KEY = 'vh_feed_cache_v2'; // Bumped to clear corrupted caches

function isFeedV2Enabled(): boolean {
  const viteValue = (import.meta as unknown as { env?: { VITE_FEED_V2_ENABLED?: string } })
    .env?.VITE_FEED_V2_ENABLED;
  const nodeValue = typeof process !== 'undefined' ? process.env?.VITE_FEED_V2_ENABLED : undefined;
  return (nodeValue ?? viteValue) === 'true';
}

// Deduplicate items by ID (keep first occurrence)
function dedupeItems(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

const seedItems: FeedItem[] = [
  {
    id: 'seed-1',
    title: 'The Democratic Party Is Offering a False Choice Between Socialism and Technocracy',
    summary:
      'An illustration of Zohrah Mamdani, Grover Cleveland, and Abigail Spanberger. The article explores ideological divides and competing visions.',
    source: 'Reason',
    timestamp: Date.parse('2025-11-23T07:00:05Z'),
    imageUrl: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=400&q=60',
    engagementScore: 1.6,
    readCount: 12,
    perspectives: [
      { id: 'p1', frame: 'The party abandoned classical liberal roots.', reframe: 'The party is evolving to modern needs.' },
      { id: 'p2', frame: 'Technocracy erodes civic agency.', reframe: 'Technocratic tools can expand opportunity.' }
    ]
  },
  {
    id: 'seed-2',
    title: 'EV grant scheme boost worth £1.3bn expected in Budget',
    summary: 'Owners could also face new taxes; policy trade-offs remain uncertain.',
    source: 'BBC',
    timestamp: Date.parse('2025-11-23T05:28:02Z'),
    imageUrl: 'https://images.unsplash.com/photo-1493236296276-d17357e28807?auto=format&fit=crop&w=400&q=60',
    engagementScore: 0.8,
    readCount: 8,
    perspectives: [
      { id: 'p3', frame: 'Subsidies are necessary to accelerate adoption.', reframe: 'Market signals should drive EV uptake.' },
      { id: 'p4', frame: 'Budget pressures will undercut climate goals.', reframe: 'Balanced taxes can sustain investments.' }
    ]
  },
  {
    id: 'seed-3',
    title: 'Game Theory Explains How Algorithms Can Drive Up Prices',
    summary: 'Even simple pricing algorithms may increase costs for consumers.',
    source: 'Wired',
    timestamp: Date.parse('2025-11-23T07:00:00Z'),
    imageUrl: 'https://images.unsplash.com/photo-1556740749-887f6717d7e4?auto=format&fit=crop&w=400&q=60',
    engagementScore: 0.0,
    readCount: 3,
    perspectives: [
      { id: 'p5', frame: 'Algorithms collude implicitly.', reframe: 'Monitoring prevents systemic collusion.' },
      { id: 'p6', frame: 'Regulators lag behind innovation.', reframe: 'Light-touch rules preserve benefits.' }
    ]
  }
];

const DISCOVERY_SUMMARY_BY_KIND: Record<FeedKind, string> = {
  NEWS_STORY: 'Trending in discovery feed.',
  USER_TOPIC: 'Community topic update.',
  SOCIAL_NOTIFICATION: 'Social activity update.',
  ARTICLE: 'Published community article.'
};

const DISCOVERY_SOURCE_BY_KIND: Record<FeedKind, string> = {
  NEWS_STORY: 'Discovery · News',
  USER_TOPIC: 'Discovery · Topics',
  SOCIAL_NOTIFICATION: 'Discovery · Social',
  ARTICLE: 'Discovery · Articles'
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
    perspectives: []
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
    comments: 0
  };
}

function selectDiscoveryFeedItems(): FeedItem[] {
  const discovery = useDiscoveryStore.getState();
  const composed = composeFeed(
    discovery.items,
    discovery.filter,
    discovery.sortMode,
    discovery.rankingConfig,
    Date.now()
  );
  return composed.map(toLegacyFeedItem);
}

function loadCached(): { items: FeedItem[]; page: number } {
  try {
    const raw = safeGetItem(STORAGE_KEY);
    if (!raw) return { items: seedItems, page: 1 };
    const parsed = JSON.parse(raw) as FeedItem[];
    if (parsed.length === 0) return { items: seedItems, page: 1 };

    // Dedupe in case of corrupted cache
    const deduped = dedupeItems(parsed);

    // Derive page from cached item IDs (e.g., "seed-1-p3-0" → page 3)
    let maxPage = 1;
    for (const item of deduped) {
      const match = item.id.match(/-p(\d+)-/);
      const pageValue = match?.[1];
      if (pageValue) {
        maxPage = Math.max(maxPage, parseInt(pageValue, 10));
      }
    }
    return { items: deduped, page: maxPage };
  } catch {
    return { items: seedItems, page: 1 };
  }
}

function persist(items: FeedItem[]) {
  try {
    safeSetItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

export const useFeedStore = create<FeedState>((set, get) => ({
  items: [],
  page: 0,
  hasMore: true,
  loading: false,
  hydrate() {
    if (isFeedV2Enabled()) {
      const discoveryState = useDiscoveryStore.getState();
      set({
        items: selectDiscoveryFeedItems(),
        page: 1,
        hasMore: false,
        loading: discoveryState.loading
      });
      return;
    }

    const { items, page } = loadCached();
    set({ items, page, hasMore: page < 5 });
  },
  setItems(items) {
    if (isFeedV2Enabled()) {
      useDiscoveryStore.getState().setItems(items.map(toDiscoveryFeedItem));
      const discoveryState = useDiscoveryStore.getState();
      set({
        items: selectDiscoveryFeedItems(),
        page: 1,
        hasMore: false,
        loading: discoveryState.loading
      });
      return;
    }

    persist(items);
    set({ items });
  },
  loadMore() {
    if (isFeedV2Enabled()) {
      const discoveryState = useDiscoveryStore.getState();
      set({
        items: selectDiscoveryFeedItems(),
        hasMore: false,
        loading: discoveryState.loading
      });
      return;
    }

    if (get().loading || !get().hasMore) return;
    set({ loading: true });
    const nextPage = get().page + 1;
    const nextBatch = seedItems.map((item, idx) => ({
      ...item,
      id: `${item.id}-p${nextPage}-${idx}`
    }));
    // Dedupe to prevent any accidental duplicates
    const nextItems = dedupeItems([...get().items, ...nextBatch]);
    persist(nextItems);
    set({
      items: nextItems,
      page: nextPage,
      hasMore: nextPage < 5, // cap for demo
      loading: false
    });
  }
}));
