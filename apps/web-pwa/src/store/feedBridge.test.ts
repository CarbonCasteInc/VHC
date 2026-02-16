import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  FeedItemSchema,
  type StoryBundle,
  type TopicSynthesisV2,
} from '@vh/data-model';
import { useNewsStore } from './news';
import { useSynthesisStore } from './synthesis';
import { useDiscoveryStore } from './discovery';
import {
  _resetStoreForTesting as resetLinkedSocialStore,
  ingestNotification,
} from './linkedSocial/accountStore';
import { createMockNotification } from './linkedSocial/mockFactories';
import {
  bootstrapFeedBridges,
  startNewsBridge,
  startSocialBridge,
  startSynthesisBridge,
  stopBridges,
  storyBundleToFeedItem,
  synthesisToFeedItem,
} from './feedBridge';

function makeStoryBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'topic-1',
    headline: 'News headline',
    summary_hint: 'summary',
    cluster_window_start: 100,
    cluster_window_end: 200,
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Publisher',
        url: 'https://example.com/story-1',
        url_hash: 'hash-1',
        published_at: 100,
        title: 'Source title',
      },
    ],
    cluster_features: {
      entity_keys: ['entity'],
      time_bucket: 'bucket-1',
      semantic_signature: 'signature-1',
    },
    provenance_hash: 'prov-hash',
    created_at: 150,
    ...overrides,
  };
}

function makeSynthesis(overrides: Partial<TopicSynthesisV2> = {}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'topic-1',
    epoch: 1,
    synthesis_id: 'synth-1',
    inputs: {
      story_bundle_ids: ['story-1'],
      topic_digest_ids: ['digest-1'],
      topic_seed_id: 'seed-1',
    },
    quorum: {
      required: 3,
      received: 2,
      reached_at: 120,
      timed_out: false,
      selection_rule: 'deterministic',
    },
    facts_summary: 'A concise synthesis summary used for feed rendering.',
    frames: [{ frame: 'Frame', reframe: 'Reframe' }],
    warnings: [],
    divergence_metrics: {
      disagreement_score: 0.1,
      source_dispersion: 0.2,
      candidate_count: 2,
    },
    provenance: {
      candidate_ids: ['candidate-1', 'candidate-2'],
      provider_mix: [{ provider_id: 'provider-1', count: 2 }],
    },
    created_at: 300,
    ...overrides,
  };
}

function resetStores(): void {
  useNewsStore.getState().reset();
  useSynthesisStore.getState().reset();
  useDiscoveryStore.getState().reset();
  resetLinkedSocialStore();
}

beforeEach(() => {
  stopBridges();
  resetStores();
  vi.unstubAllEnvs();
});

afterEach(() => {
  stopBridges();
  resetStores();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('storyBundleToFeedItem', () => {
  it('converts StoryBundle to FeedItem with kind=NEWS_STORY', () => {
    const item = storyBundleToFeedItem(
      makeStoryBundle({
        topic_id: 'topic-news',
        headline: 'Breaking update',
        created_at: 100.9,
        cluster_window_end: 222.4,
        sources: [
          {
            source_id: 'source-a',
            publisher: 'A',
            url: 'https://example.com/a',
            url_hash: 'a-hash',
            title: 'A title',
          },
          {
            source_id: 'source-b',
            publisher: 'B',
            url: 'https://example.com/b',
            url_hash: 'b-hash',
            title: 'B title',
          },
        ],
      }),
    );

    expect(item).toEqual({
      topic_id: 'topic-news',
      kind: 'NEWS_STORY',
      title: 'Breaking update',
      created_at: 100,
      latest_activity_at: 222,
      hotness: 0,
      eye: 0,
      lightbulb: 2,
      comments: 0,
    });
  });

  it('output validates against FeedItemSchema', () => {
    const item = storyBundleToFeedItem(
      makeStoryBundle({
        created_at: -1,
        cluster_window_end: Number.POSITIVE_INFINITY,
      }),
    );

    expect(FeedItemSchema.safeParse(item).success).toBe(true);
    expect(item.created_at).toBe(0);
    expect(item.latest_activity_at).toBe(0);
  });
});

describe('synthesisToFeedItem', () => {
  it('converts TopicSynthesisV2 to FeedItem with kind=USER_TOPIC', () => {
    const longSummary = 'x'.repeat(160);
    const item = synthesisToFeedItem(
      makeSynthesis({
        topic_id: 'topic-synth',
        facts_summary: longSummary,
        quorum: {
          required: 4,
          received: 3,
          reached_at: 999,
          timed_out: false,
          selection_rule: 'deterministic',
        },
        created_at: 401,
      }),
    );

    expect(item.kind).toBe('USER_TOPIC');
    expect(item.topic_id).toBe('topic-synth');
    expect(item.title).toBe(longSummary.slice(0, 120));
    expect(item.created_at).toBe(401);
    expect(item.latest_activity_at).toBe(401);
    expect(item.lightbulb).toBe(3);
  });

  it('output validates against FeedItemSchema', () => {
    const item = synthesisToFeedItem(
      makeSynthesis({
        created_at: Number.NaN as number,
      }),
    );

    expect(FeedItemSchema.safeParse(item).success).toBe(true);
    expect(item.created_at).toBe(0);
    expect(item.latest_activity_at).toBe(0);
  });
});

describe('startNewsBridge', () => {
  it('boots news hydration and refresh on startup', async () => {
    const newsState = useNewsStore.getState();
    const startHydrationSpy = vi.spyOn(newsState, 'startHydration');
    const refreshLatestSpy = vi
      .spyOn(newsState, 'refreshLatest')
      .mockResolvedValue(undefined);

    await startNewsBridge();

    expect(startHydrationSpy).toHaveBeenCalledTimes(1);
    expect(refreshLatestSpy).toHaveBeenCalledTimes(1);
  });

  it('logs refresh failures during bootstrap and continues', async () => {
    const warning = new Error('refresh failed');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const newsState = useNewsStore.getState();
    vi.spyOn(newsState, 'refreshLatest').mockRejectedValue(warning);

    await expect(startNewsBridge()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:feed-bridge] refreshLatest failed during bootstrap:',
      warning,
    );
  });

  it('initial sync pushes existing stories to discovery store', async () => {
    const valid = makeStoryBundle({ story_id: 'story-valid', topic_id: 'topic-valid' });
    const invalid = makeStoryBundle({
      story_id: 'story-invalid',
      topic_id: 'topic-invalid',
      headline: '',
    }) as StoryBundle;

    const newsState = useNewsStore.getState();
    vi.spyOn(newsState, 'refreshLatest').mockResolvedValue(undefined);

    useNewsStore.setState({ stories: [valid, invalid] as StoryBundle[] });

    await startNewsBridge();

    const discoveryItems = useDiscoveryStore.getState().items;
    expect(discoveryItems).toHaveLength(1);
    expect(discoveryItems[0]?.topic_id).toBe('topic-valid');
    expect(discoveryItems[0]?.kind).toBe('NEWS_STORY');
  });

  it('new stories appearing in news store flow to discovery', async () => {
    await startNewsBridge();
    await startNewsBridge(); // idempotent guard

    const s1 = makeStoryBundle({ story_id: 'story-1', topic_id: 'topic-1' });
    const s2 = makeStoryBundle({ story_id: 'story-2', topic_id: 'topic-2' });

    useNewsStore.getState().setStories([s1]);
    expect(useDiscoveryStore.getState().items).toHaveLength(1);

    // stories ref is unchanged -> no-op branch
    useNewsStore.getState().setLoading(true);

    // same IDs -> no new feed items
    useNewsStore.getState().setStories([s1]);
    expect(useDiscoveryStore.getState().items).toHaveLength(1);

    useNewsStore.getState().setStories([s1, s2]);
    const topics = useDiscoveryStore.getState().items.map((item) => item.topic_id).sort();
    expect(topics).toEqual(['topic-1', 'topic-2']);
  });

  it('preserves multiple story headlines even when topic_id is shared', async () => {
    await startNewsBridge();

    const first = makeStoryBundle({
      story_id: 'story-a',
      topic_id: 'topic-dup',
      headline: 'first headline',
      created_at: 100,
    });
    const second = makeStoryBundle({
      story_id: 'story-b',
      topic_id: 'topic-dup',
      headline: 'second headline',
      created_at: 200,
    });

    useNewsStore.getState().setStories([first]);
    useNewsStore.getState().setStories([first, second]);

    const discoveryItems = useDiscoveryStore.getState().items;
    expect(discoveryItems).toHaveLength(2);
    expect(discoveryItems.map((item) => item.title).sort()).toEqual([
      'first headline',
      'second headline',
    ]);
  });
});

describe('startSynthesisBridge', () => {
  it('synthesis updates flow to discovery as USER_TOPIC items', async () => {
    const invalidSynthesis = makeSynthesis({ facts_summary: '' }) as TopicSynthesisV2;
    useSynthesisStore.setState({
      topics: {
        topicInvalid: {
          topicId: 'topicInvalid',
          epoch: 1,
          synthesis: invalidSynthesis,
          hydrated: false,
          loading: false,
          error: null,
        },
      },
    });

    await startSynthesisBridge();
    await startSynthesisBridge(); // idempotent guard

    // initial invalid synthesis is dropped by FeedItemSchema validation
    expect(useDiscoveryStore.getState().items).toHaveLength(0);

    // topics ref unchanged -> no-op branch
    useSynthesisStore.setState({ enabled: useSynthesisStore.getState().enabled });

    // topics changed, but no synthesis change -> no new items branch
    useSynthesisStore.getState().setTopicLoading('topicInvalid', true);
    expect(useDiscoveryStore.getState().items).toHaveLength(0);

    useSynthesisStore.getState().setTopicSynthesis('topic-1', makeSynthesis({ topic_id: 'topic-1' }));

    const discoveryItems = useDiscoveryStore.getState().items;
    expect(discoveryItems).toHaveLength(1);
    expect(discoveryItems[0]?.kind).toBe('USER_TOPIC');
    expect(discoveryItems[0]?.topic_id).toBe('topic-1');
  });
});

describe('startSocialBridge', () => {
  it('initial social feed items are merged into discovery on startup', async () => {
    vi.stubEnv('VITE_LINKED_SOCIAL_ENABLED', 'true');

    const seeded = ingestNotification(createMockNotification({
      id: 'social-seeded',
      topic_id: 'topic-social-seeded',
      title: 'Seeded before bridge start',
      createdAt: 5,
    }));
    expect(seeded).not.toBeNull();
    expect(useDiscoveryStore.getState().items).toEqual([]);

    await startSocialBridge();

    const discoveryItems = useDiscoveryStore.getState().items;
    expect(discoveryItems).toHaveLength(1);
    expect(discoveryItems[0]?.kind).toBe('SOCIAL_NOTIFICATION');
    expect(discoveryItems[0]?.topic_id).toBe('topic-social-seeded');
    expect(discoveryItems[0]?.title).toBe('Seeded before bridge start');
  });

  it('ingested notifications flow to discovery as SOCIAL_NOTIFICATION items', async () => {
    await startSocialBridge();
    await startSocialBridge(); // idempotent guard

    const notif = createMockNotification({
      id: 'social-1',
      topic_id: 'topic-social-1',
      title: 'Mentioned on X',
      createdAt: 10,
    });

    const ingested = ingestNotification(notif);
    expect(ingested).not.toBeNull();

    const discoveryItems = useDiscoveryStore.getState().items;
    expect(discoveryItems).toHaveLength(1);
    expect(discoveryItems[0]?.kind).toBe('SOCIAL_NOTIFICATION');
    expect(discoveryItems[0]?.topic_id).toBe('topic-social-1');
    expect(discoveryItems[0]?.title).toBe('Mentioned on X');
  });

  it('surfaces dependency-load errors and clears cached social deps promise', async () => {
    stopBridges();
    vi.resetModules();

    const dependencyError = new Error('social deps unavailable');
    vi.doMock('./linkedSocial/socialFeedAdapter', () => ({
      get getSocialFeedItems() {
        throw dependencyError;
      },
      notificationToFeedItem: vi.fn(),
    }));

    try {
      const bridgeModule = await import('./feedBridge');
      await expect(bridgeModule.startSocialBridge()).rejects.toThrow('social deps unavailable');
    } finally {
      vi.doUnmock('./linkedSocial/socialFeedAdapter');
      vi.resetModules();
    }
  });
});

describe('stopBridges', () => {
  it('cleanup prevents further propagation', async () => {
    await startNewsBridge();
    await startSynthesisBridge();
    await startSocialBridge();

    stopBridges();

    useNewsStore.getState().setStories([
      makeStoryBundle({ story_id: 'story-after-stop', topic_id: 'topic-after-stop' }),
    ]);
    useSynthesisStore.getState().setTopicSynthesis(
      'topic-after-stop',
      makeSynthesis({ topic_id: 'topic-after-stop' }),
    );
    ingestNotification(createMockNotification({
      id: 'social-after-stop',
      topic_id: 'topic-social-after-stop',
    }));

    expect(useDiscoveryStore.getState().items).toEqual([]);
  });
});

describe('bootstrapFeedBridges', () => {
  it("reads env flags, only starts bridges when flag is 'true'", async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    vi.stubEnv('VITE_NEWS_BRIDGE_ENABLED', 'true');
    vi.stubEnv('VITE_SYNTHESIS_BRIDGE_ENABLED', 'false');
    vi.stubEnv('VITE_LINKED_SOCIAL_ENABLED', 'false');

    useNewsStore.getState().setStories([
      makeStoryBundle({ story_id: 'story-news-only', topic_id: 'topic-news-only' }),
    ]);
    useSynthesisStore.getState().setTopicSynthesis(
      'topic-synth-only',
      makeSynthesis({ topic_id: 'topic-synth-only' }),
    );

    await bootstrapFeedBridges();

    expect(useDiscoveryStore.getState().items).toHaveLength(1);
    expect(useDiscoveryStore.getState().items[0]?.kind).toBe('NEWS_STORY');
    expect(infoSpy).toHaveBeenCalledWith('[vh:feed-bridge] News bridge started');

    stopBridges();
    resetStores();

    vi.stubEnv('VITE_NEWS_BRIDGE_ENABLED', 'false');
    vi.stubEnv('VITE_SYNTHESIS_BRIDGE_ENABLED', 'true');
    vi.stubEnv('VITE_LINKED_SOCIAL_ENABLED', 'false');

    useNewsStore.getState().setStories([
      makeStoryBundle({ story_id: 'story-news-2', topic_id: 'topic-news-2' }),
    ]);
    useSynthesisStore.getState().setTopicSynthesis(
      'topic-synth-2',
      makeSynthesis({ topic_id: 'topic-synth-2' }),
    );

    await bootstrapFeedBridges();

    expect(useDiscoveryStore.getState().items).toHaveLength(1);
    expect(useDiscoveryStore.getState().items[0]?.kind).toBe('USER_TOPIC');
    expect(infoSpy).toHaveBeenCalledWith('[vh:feed-bridge] Synthesis bridge started');

    stopBridges();
    resetStores();

    vi.stubEnv('VITE_NEWS_BRIDGE_ENABLED', 'false');
    vi.stubEnv('VITE_SYNTHESIS_BRIDGE_ENABLED', 'false');
    vi.stubEnv('VITE_LINKED_SOCIAL_ENABLED', 'true');

    await bootstrapFeedBridges();
    ingestNotification(createMockNotification({ topic_id: 'topic-social-flagged' }));

    expect(useDiscoveryStore.getState().items).toHaveLength(1);
    expect(useDiscoveryStore.getState().items[0]?.kind).toBe('SOCIAL_NOTIFICATION');
    expect(infoSpy).toHaveBeenCalledWith('[vh:feed-bridge] Social bridge started');
  });

  it('does not start bridges when flags are absent/false', async () => {
    vi.stubEnv('VITE_NEWS_BRIDGE_ENABLED', 'false');
    vi.stubEnv('VITE_SYNTHESIS_BRIDGE_ENABLED', 'false');
    vi.stubEnv('VITE_LINKED_SOCIAL_ENABLED', 'false');

    useNewsStore.getState().setStories([
      makeStoryBundle({ story_id: 'false-story', topic_id: 'false-topic' }),
    ]);
    useSynthesisStore.getState().setTopicSynthesis(
      'false-topic',
      makeSynthesis({ topic_id: 'false-topic' }),
    );

    await bootstrapFeedBridges();

    useNewsStore.getState().setStories([
      makeStoryBundle({ story_id: 'false-story-2', topic_id: 'false-topic-2' }),
    ]);
    useSynthesisStore.getState().setTopicSynthesis(
      'false-topic-2',
      makeSynthesis({ topic_id: 'false-topic-2' }),
    );
    ingestNotification(createMockNotification({ topic_id: 'topic-social-false' }));

    expect(useDiscoveryStore.getState().items).toEqual([]);

    stopBridges();
    resetStores();
    vi.unstubAllEnvs();

    const originalProcess = globalThis.process;
    vi.stubGlobal('process', undefined);

    useNewsStore.getState().setStories([
      makeStoryBundle({ story_id: 'absent-story', topic_id: 'absent-topic' }),
    ]);
    useSynthesisStore.getState().setTopicSynthesis(
      'absent-topic',
      makeSynthesis({ topic_id: 'absent-topic' }),
    );
    ingestNotification(createMockNotification({ topic_id: 'topic-social-absent' }));

    await bootstrapFeedBridges();

    expect(useDiscoveryStore.getState().items).toEqual([]);

    vi.stubGlobal('process', originalProcess);
  });
});
