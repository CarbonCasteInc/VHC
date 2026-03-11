import type {
  FeedItem,
  SocialNotification,
  StoryBundle,
  StorylineGroup,
  TopicSynthesisV2,
} from '@vh/data-model';
import type { StoreApi } from 'zustand';
import {
  mergeIntoDiscovery,
  storyBundleToFeedItem,
  synthesisToFeedItem,
} from './feedBridgeItems';
import { runRefreshLatestWithRetry } from './feedBridgeRefresh';

type BridgeFlag =
  | 'VITE_NEWS_BRIDGE_ENABLED'
  | 'VITE_SYNTHESIS_BRIDGE_ENABLED'
  | 'VITE_LINKED_SOCIAL_ENABLED';

interface NewsBridgeState {
  stories: ReadonlyArray<StoryBundle>;
  hotIndex: Readonly<Record<string, number>>;
  storylinesById: Readonly<Record<string, StorylineGroup>>;
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
    await runRefreshLatestWithRetry(newsState);
  } catch (error) {
    console.warn('[vh:feed-bridge] refreshLatest failed during bootstrap:', error);
  }

  const currentNewsState = newsStore.getState();
  if (currentNewsState.stories.length > 0) {
    mergeIntoDiscovery(
      currentNewsState.stories.map((story) =>
        storyBundleToFeedItem(story, currentNewsState.hotIndex, currentNewsState.storylinesById),
      ),
      discoveryStore,
    );
  }

  newsUnsubscribe = newsStore.subscribe((state, prevState) => {
    if (
      state.stories === prevState.stories &&
      state.hotIndex === prevState.hotIndex &&
      state.storylinesById === prevState.storylinesById
    ) {
      return;
    }

    if (state.stories.length === 0) {
      return;
    }

    mergeIntoDiscovery(
      state.stories.map((story) =>
        storyBundleToFeedItem(story, state.hotIndex, state.storylinesById),
      ),
      discoveryStore,
    );
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

export { storyBundleToFeedItem, synthesisToFeedItem } from './feedBridgeItems';
