import type {
  FeedItem,
  SocialNotification,
  StoryBundle,
  TopicSynthesisV2,
} from '@vh/data-model';
import { FeedItemSchema } from '@vh/data-model';
import type { StoreApi } from 'zustand';

type BridgeFlag =
  | 'VITE_NEWS_BRIDGE_ENABLED'
  | 'VITE_SYNTHESIS_BRIDGE_ENABLED'
  | 'VITE_LINKED_SOCIAL_ENABLED';

interface NewsBridgeState {
  stories: ReadonlyArray<StoryBundle>;
  startHydration: () => void;
  refreshLatest: (limit?: number) => Promise<void>;
}

interface SynthesisTopicBridgeState {
  synthesis: TopicSynthesisV2 | null;
}

interface SynthesisBridgeState {
  topics: Readonly<Record<string, SynthesisTopicBridgeState>>;
}

interface DiscoveryBridgeState {
  mergeItems: (items: FeedItem[]) => void;
}

interface SocialFeedAdapterApi {
  getSocialFeedItems: () => ReadonlyArray<FeedItem>;
  notificationToFeedItem: (notification: SocialNotification) => FeedItem;
}

interface SocialAccountStoreApi {
  setNotificationIngestedHandler: ((
    handler: ((notification: SocialNotification) => void) | null,
  ) => void);
}

type NewsStoreApi = Pick<StoreApi<NewsBridgeState>, 'getState' | 'subscribe'>;
type SynthesisStoreApi = Pick<StoreApi<SynthesisBridgeState>, 'getState' | 'subscribe'>;
type DiscoveryStoreApi = Pick<StoreApi<DiscoveryBridgeState>, 'getState'>;

interface BridgeStores {
  newsStore: NewsStoreApi;
  synthesisStore: SynthesisStoreApi;
  discoveryStore: DiscoveryStoreApi;
}

interface SocialBridgeDependencies {
  socialFeedAdapter: SocialFeedAdapterApi;
  socialAccountStore: SocialAccountStoreApi;
}

let bridgeStoresPromise: Promise<BridgeStores> | null = null;
let socialBridgeDepsPromise: Promise<SocialBridgeDependencies> | null = null;
let newsBridgeActive = false;
let synthesisBridgeActive = false;
let socialBridgeActive = false;
let newsUnsubscribe: (() => void) | null = null;
let synthesisUnsubscribe: (() => void) | null = null;
let clearSocialBridgeHandler: (() => void) | null = null;

function toTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function validateFeedItems(items: ReadonlyArray<FeedItem>): FeedItem[] {
  const validated: FeedItem[] = [];
  for (const item of items) {
    const parsed = FeedItemSchema.safeParse(item);
    if (parsed.success) {
      validated.push(parsed.data);
    }
  }
  return validated;
}

function mergeIntoDiscovery(
  items: ReadonlyArray<FeedItem>,
  discoveryStore: DiscoveryStoreApi,
): void {
  const validated = validateFeedItems(items);
  if (validated.length === 0) {
    return;
  }

  discoveryStore.getState().mergeItems(validated);
}

function readBridgeFlag(flag: BridgeFlag): boolean {
  const nodeValue = typeof process !== 'undefined' ? process.env?.[flag] : undefined;
  const viteValue = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[flag];
  return (nodeValue ?? viteValue) === 'true';
}

async function resolveBridgeStores(): Promise<BridgeStores> {
  if (!bridgeStoresPromise) {
    bridgeStoresPromise = (async () => {
      /**
       * Keep these as standard Vite-resolved dynamic imports (no @vite-ignore):
       * this preserves module identity (same singleton stores) across HMR and
       * static imports elsewhere in the app.
       */
      const [
        newsModule,
        synthesisModule,
        discoveryModule,
      ] = await Promise.all([
        import('./news'),
        import('./synthesis'),
        import('./discovery'),
      ]);

      return {
        newsStore: newsModule.useNewsStore as NewsStoreApi,
        synthesisStore: synthesisModule.useSynthesisStore as SynthesisStoreApi,
        discoveryStore: discoveryModule.useDiscoveryStore as DiscoveryStoreApi,
      };
    })().catch((error) => {
      bridgeStoresPromise = null;
      throw error;
    });
  }

  return bridgeStoresPromise;
}

async function resolveSocialBridgeDependencies(): Promise<SocialBridgeDependencies> {
  if (!socialBridgeDepsPromise) {
    socialBridgeDepsPromise = (async () => {
      const [socialFeedModule, socialAccountModule] = await Promise.all([
        import('./linkedSocial/socialFeedAdapter'),
        import('./linkedSocial/accountStore'),
      ]);

      return {
        socialFeedAdapter: {
          getSocialFeedItems: socialFeedModule.getSocialFeedItems as SocialFeedAdapterApi['getSocialFeedItems'],
          notificationToFeedItem: socialFeedModule.notificationToFeedItem as SocialFeedAdapterApi['notificationToFeedItem'],
        },
        socialAccountStore: {
          setNotificationIngestedHandler:
            socialAccountModule.setNotificationIngestedHandler as SocialAccountStoreApi['setNotificationIngestedHandler'],
        },
      };
    })().catch((error) => {
      socialBridgeDepsPromise = null;
      throw error;
    });
  }

  return socialBridgeDepsPromise;
}

/**
 * Convert a StoryBundle to a discovery FeedItem (kind=NEWS_STORY).
 */
export function storyBundleToFeedItem(bundle: StoryBundle): FeedItem {
  return {
    topic_id: bundle.topic_id,
    kind: 'NEWS_STORY',
    title: bundle.headline,
    created_at: toTimestamp(bundle.created_at),
    latest_activity_at: toTimestamp(bundle.cluster_window_end),
    hotness: 0,
    eye: 0,
    lightbulb: bundle.sources.length,
    comments: 0,
  };
}

/**
 * Convert a TopicSynthesisV2 to a discovery FeedItem (kind=USER_TOPIC).
 */
export function synthesisToFeedItem(synthesis: TopicSynthesisV2): FeedItem {
  return {
    topic_id: synthesis.topic_id,
    kind: 'USER_TOPIC',
    title: synthesis.facts_summary.slice(0, 120),
    created_at: toTimestamp(synthesis.created_at),
    latest_activity_at: toTimestamp(synthesis.created_at),
    hotness: 0,
    eye: 0,
    lightbulb: synthesis.quorum.received,
    comments: 0,
  };
}

/**
 * Start the news→discovery bridge.
 * Performs initial sync and subscribes to new stories.
 */
export async function startNewsBridge(): Promise<void> {
  if (newsBridgeActive) {
    return;
  }

  const { newsStore, discoveryStore } = await resolveBridgeStores();
  newsBridgeActive = true;

  const newsState = newsStore.getState();
  newsState.startHydration();
  try {
    await newsState.refreshLatest();
  } catch (error) {
    console.warn('[vh:feed-bridge] refreshLatest failed during bootstrap:', error);
  }

  const currentStories = newsStore.getState().stories;
  if (currentStories.length > 0) {
    mergeIntoDiscovery(currentStories.map(storyBundleToFeedItem), discoveryStore);
  }

  newsUnsubscribe = newsStore.subscribe((state, prevState) => {
    if (state.stories === prevState.stories) {
      return;
    }

    const previousIds = new Set(prevState.stories.map((story) => story.story_id));
    const newStories = state.stories.filter((story) => !previousIds.has(story.story_id));
    if (newStories.length === 0) {
      return;
    }

    mergeIntoDiscovery(newStories.map(storyBundleToFeedItem), discoveryStore);
  });
}

/**
 * Start the synthesis→discovery bridge.
 * Performs initial sync and subscribes to synthesis updates.
 */
export async function startSynthesisBridge(): Promise<void> {
  if (synthesisBridgeActive) {
    return;
  }

  const { synthesisStore, discoveryStore } = await resolveBridgeStores();
  synthesisBridgeActive = true;

  const initialItems: FeedItem[] = [];
  for (const topicState of Object.values(synthesisStore.getState().topics)) {
    if (topicState.synthesis) {
      initialItems.push(synthesisToFeedItem(topicState.synthesis));
    }
  }
  if (initialItems.length > 0) {
    mergeIntoDiscovery(initialItems, discoveryStore);
  }

  synthesisUnsubscribe = synthesisStore.subscribe((state, prevState) => {
    if (state.topics === prevState.topics) {
      return;
    }

    const newItems: FeedItem[] = [];
    for (const [topicId, topicState] of Object.entries(state.topics)) {
      const current = topicState.synthesis;
      const previous = prevState.topics[topicId]?.synthesis;
      if (current && current !== previous) {
        newItems.push(synthesisToFeedItem(current));
      }
    }

    if (newItems.length === 0) {
      return;
    }

    mergeIntoDiscovery(newItems, discoveryStore);
  });
}

/**
 * Start the linked-social notification → discovery bridge.
 * Performs initial sync and registers an ingest callback for new notifications.
 */
export async function startSocialBridge(): Promise<void> {
  if (socialBridgeActive) {
    return;
  }

  const { discoveryStore } = await resolveBridgeStores();
  const {
    socialFeedAdapter,
    socialAccountStore,
  } = await resolveSocialBridgeDependencies();
  socialBridgeActive = true;

  const currentItems = socialFeedAdapter.getSocialFeedItems();
  if (currentItems.length > 0) {
    mergeIntoDiscovery(currentItems, discoveryStore);
  }

  socialAccountStore.setNotificationIngestedHandler((notification) => {
    mergeIntoDiscovery([
      socialFeedAdapter.notificationToFeedItem(notification),
    ], discoveryStore);
  });

  clearSocialBridgeHandler = () => {
    socialAccountStore.setNotificationIngestedHandler(null);
  };
}

/**
 * Stop all feed bridges.
 */
export function stopBridges(): void {
  newsUnsubscribe?.();
  synthesisUnsubscribe?.();
  clearSocialBridgeHandler?.();

  newsBridgeActive = false;
  synthesisBridgeActive = false;
  socialBridgeActive = false;
  newsUnsubscribe = null;
  synthesisUnsubscribe = null;
  clearSocialBridgeHandler = null;
}

/**
 * Bootstrap feed bridges behind feature flags.
 */
export async function bootstrapFeedBridges(): Promise<void> {
  if (readBridgeFlag('VITE_NEWS_BRIDGE_ENABLED')) {
    await startNewsBridge();
    console.info('[vh:feed-bridge] News bridge started');
  }

  if (readBridgeFlag('VITE_SYNTHESIS_BRIDGE_ENABLED')) {
    await startSynthesisBridge();
    console.info('[vh:feed-bridge] Synthesis bridge started');
  }

  if (readBridgeFlag('VITE_LINKED_SOCIAL_ENABLED')) {
    await startSocialBridge();
    console.info('[vh:feed-bridge] Social bridge started');
  }
}
