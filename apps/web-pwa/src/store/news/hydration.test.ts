import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import {
  LEGACY_LATEST_INDEX_EXPECTED_FIXTURE,
  LEGACY_LATEST_INDEX_PAYLOAD_FIXTURE,
  MIXED_LATEST_INDEX_PRECEDENCE_EXPECTED_FIXTURE,
  MIXED_LATEST_INDEX_PRECEDENCE_PAYLOAD_FIXTURE,
  TARGET_LATEST_INDEX_EXPECTED_FIXTURE,
  TARGET_LATEST_INDEX_PAYLOAD_FIXTURE,
} from '../../../../../packages/gun-client/src/__fixtures__/latestIndexMigrationFixtures';
import type { NewsState } from './index';

const gunMocks = vi.hoisted(() => ({
  getNewsStoriesChain: vi.fn(),
  getNewsStorylinesChain: vi.fn(),
  getNewsLatestIndexChain: vi.fn(),
  getNewsHotIndexChain: vi.fn(),
  hasForbiddenNewsPayloadFields: vi.fn<(payload: unknown) => boolean>(),
  parseNewsLatestIndexEntryRecord: vi.fn(),
  readNewsStory: vi.fn(),
}));

vi.mock('@vh/gun-client', () => ({
  getNewsStoriesChain: gunMocks.getNewsStoriesChain,
  getNewsStorylinesChain: gunMocks.getNewsStorylinesChain,
  getNewsLatestIndexChain: gunMocks.getNewsLatestIndexChain,
  getNewsHotIndexChain: gunMocks.getNewsHotIndexChain,
  hasForbiddenNewsPayloadFields: gunMocks.hasForbiddenNewsPayloadFields,
  parseNewsLatestIndexEntryRecord: gunMocks.parseNewsLatestIndexEntryRecord,
  readNewsStoryWithRelayRestFallback: gunMocks.readNewsStory,
}));

const CANONICAL_TOPIC_ID = 'a'.repeat(64);

function story(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: CANONICAL_TOPIC_ID,
    headline: 'Hydrated Story',
    summary_hint: 'Summary',
    cluster_window_start: 1,
    cluster_window_end: 2,
    sources: [
      {
        source_id: 's',
        publisher: 'Publisher',
        url: 'https://example.com/news',
        url_hash: 'aa11bb22',
        published_at: 1,
        title: 'Hydrated Story'
      }
    ],
    cluster_features: {
      entity_keys: ['entity'],
      time_bucket: 'tb-1',
      semantic_signature: 'sig'
    },
    provenance_hash: 'prov',
    created_at: 123,
    ...overrides
  };
}

interface SubscribableChain {
  chain: { map: ReturnType<typeof vi.fn> };
  emit: (data: unknown, key?: string) => void;
  onSpy: ReturnType<typeof vi.fn>;
}

function createSubscribableChain(): SubscribableChain {
  let callback: ((data: unknown, key?: string) => void) | undefined;
  const onSpy = vi.fn((cb: (data: unknown, key?: string) => void) => {
    callback = cb;
  });
  const mapped = { on: onSpy };
  const chain = {
    map: vi.fn(() => mapped)
  };

  return {
    chain,
    emit(data: unknown, key?: string) {
      callback?.(data, key);
    },
    onSpy
  };
}

function createStore(initialLatestIndex: Record<string, number> = {}) {
  const state: NewsState = {
    stories: [],
    latestIndex: { ...initialLatestIndex },
    hotIndex: {},
    storylinesById: {},
    hydrated: false,
    loading: false,
    error: null,
    setStories: vi.fn(),
    upsertStory: vi.fn(),
    removeStory: vi.fn((storyId: string) => {
      (state as unknown as { stories: StoryBundle[] }).stories = state.stories.filter((story) => story.story_id !== storyId);
      delete (state.latestIndex as Record<string, number>)[storyId];
      delete (state.hotIndex as Record<string, number>)[storyId];
    }),
    setLatestIndex: vi.fn(),
    upsertLatestIndex: vi.fn((storyId: string, latestActivityAt: number) => {
      (state.latestIndex as Record<string, number>)[storyId] = latestActivityAt;
    }),
    removeLatestIndex: vi.fn((storyId: string) => {
      delete (state.latestIndex as Record<string, number>)[storyId];
    }),
    setHotIndex: vi.fn(),
    upsertHotIndex: vi.fn((storyId: string, hotness: number) => {
      (state.hotIndex as Record<string, number>)[storyId] = hotness;
    }),
    removeHotIndex: vi.fn((storyId: string) => {
      delete (state.hotIndex as Record<string, number>)[storyId];
    }),
    setStorylines: vi.fn(),
    upsertStoryline: vi.fn((storyline) => {
      (state.storylinesById as Record<string, unknown>)[storyline.storyline_id] = storyline;
    }),
    removeStoryline: vi.fn((storylineId: string) => {
      delete (state.storylinesById as Record<string, unknown>)[storylineId];
    }),
    ensureStory: vi.fn(),
    refreshLatest: vi.fn(),
    startHydration: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    reset: vi.fn()
  };

  const store = {
    getState: () => state
  } as unknown as import('zustand').StoreApi<NewsState>;

  return { store, state };
}

async function flushHydrationQueue(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await Promise.resolve();
  }
}

describe('hydrateNewsStore', () => {
  beforeEach(() => {
    gunMocks.getNewsStoriesChain.mockReset();
    gunMocks.getNewsStorylinesChain.mockReset();
    gunMocks.getNewsLatestIndexChain.mockReset();
    gunMocks.getNewsHotIndexChain.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReset();
    gunMocks.parseNewsLatestIndexEntryRecord.mockReset();
    gunMocks.readNewsStory.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReturnValue(false);
    gunMocks.parseNewsLatestIndexEntryRecord.mockResolvedValue(null);
    gunMocks.readNewsStory.mockResolvedValue(null);
    gunMocks.getNewsStorylinesChain.mockReturnValue({ map: vi.fn(() => ({ on: vi.fn() })) });
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.VITE_VH_NEWS_HYDRATION_INDEX_LIMIT;
    delete process.env.VITE_VH_NEWS_HYDRATION_STORY_READ_CONCURRENCY;
    delete process.env.VITE_VH_NEWS_HYDRATION_SUBSCRIBE_LATEST_INDEX;
    delete process.env.VITE_VH_NEWS_HYDRATION_SUBSCRIBE_HOT_INDEX;
  });

  it('returns false when no client is available', async () => {
    const { hydrateNewsStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateNewsStore(() => null, store)).toBe(false);
  });

  it('returns false when subscriptions are unsupported', async () => {
    gunMocks.getNewsStoriesChain.mockReturnValue({ map: vi.fn(() => ({ on: vi.fn() })) });
    gunMocks.getNewsStorylinesChain.mockReturnValue({ map: vi.fn(() => ({ on: vi.fn() })) });
    gunMocks.getNewsLatestIndexChain.mockReturnValue({ map: undefined });
    gunMocks.getNewsHotIndexChain.mockReturnValue({ map: vi.fn(() => ({ on: vi.fn() })) });

    const { hydrateNewsStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateNewsStore(() => ({}) as never, store)).toBe(false);
  });

  it('attaches once per store (idempotent)', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    const storylineChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsStorylinesChain.mockReturnValue(storylineChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateNewsStore(() => ({}) as never, store)).toBe(true);
    expect(hydrateNewsStore(() => ({}) as never, store)).toBe(true);

    expect(storyChain.onSpy).not.toHaveBeenCalled();
    expect(storylineChain.onSpy).not.toHaveBeenCalled();
    expect(latestChain.onSpy).toHaveBeenCalledTimes(1);
    expect(hotChain.onSpy).toHaveBeenCalledTimes(1);
  });

  it('can skip hot-index live subscription while retaining latest-index hydration', async () => {
    process.env.VITE_VH_NEWS_HYDRATION_SUBSCRIBE_HOT_INDEX = 'false';
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.readNewsStory.mockResolvedValue(story({ story_id: 's1', created_at: 321, cluster_window_end: 654 }));

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    expect(hydrateNewsStore(() => ({}) as never, store)).toBe(true);
    latestChain.emit(654, 's1');
    hotChain.emit(0.9, 's1');
    await Promise.resolve();

    expect(gunMocks.getNewsHotIndexChain).not.toHaveBeenCalled();
    expect(hotChain.onSpy).not.toHaveBeenCalled();
    expect(state.upsertStory).toHaveBeenCalledWith(expect.objectContaining({ story_id: 's1' }));
    expect(state.upsertLatestIndex).toHaveBeenCalledWith('s1', 654);
    expect(state.upsertHotIndex).not.toHaveBeenCalled();
  });

  it('can skip all live index subscriptions while retaining explicit refresh support', async () => {
    process.env.VITE_VH_NEWS_HYDRATION_SUBSCRIBE_LATEST_INDEX = 'false';
    process.env.VITE_VH_NEWS_HYDRATION_SUBSCRIBE_HOT_INDEX = 'false';
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    expect(hydrateNewsStore(() => ({}) as never, store)).toBe(true);
    latestChain.emit(654, 's1');
    hotChain.emit(0.9, 's1');
    await Promise.resolve();

    expect(gunMocks.getNewsLatestIndexChain).not.toHaveBeenCalled();
    expect(gunMocks.getNewsHotIndexChain).not.toHaveBeenCalled();
    expect(latestChain.onSpy).not.toHaveBeenCalled();
    expect(hotChain.onSpy).not.toHaveBeenCalled();
    expect(state.upsertLatestIndex).not.toHaveBeenCalled();
    expect(state.upsertHotIndex).not.toHaveBeenCalled();
  });

  it('hydrates stories from latest-index entries without synthesizing extra index writes', async () => {
    const client = { id: 'client-latest-story' };
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    gunMocks.readNewsStory.mockResolvedValue(story({ story_id: 's1', created_at: 321, cluster_window_end: 654 }));

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => client as never, store);

    latestChain.emit(654, 's1');
    await Promise.resolve();

    expect(state.upsertStory).toHaveBeenCalledWith(expect.objectContaining({ story_id: 's1' }));
    expect(state.upsertLatestIndex).toHaveBeenCalledWith('s1', 654);

    storyChain.emit(story({ story_id: 's1', created_at: 999, cluster_window_end: 888 }), 's1');
    expect(state.upsertStory).toHaveBeenCalledTimes(1);
  });

  it('drops story updates excluded by an authoritative latest index', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore({ 'keep-story': 500 });

    hydrateNewsStore(() => ({}) as never, store);

    storyChain.emit(story({ story_id: 'drop-story' }), 'drop-story');

    expect(state.upsertStory).not.toHaveBeenCalled();
  });

  it('removes stories when Gun clears the story node', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore({ s1: 100 });

    hydrateNewsStore(() => ({}) as never, store);

    latestChain.emit(null, 's1');

    expect(state.removeStory).toHaveBeenCalledWith('s1');
  });

  it('removes cleared latest/hot index entries', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore({ s1: 100 });
    (state.hotIndex as Record<string, number>).s1 = 0.9;

    hydrateNewsStore(() => ({}) as never, store);

    latestChain.emit(null, 's1');
    hotChain.emit(null, 's1');

    expect(state.removeLatestIndex).toHaveBeenCalledWith('s1');
    expect(state.removeHotIndex).toHaveBeenCalledWith('s1');
  });

  it('prunes stale latest-index stories beyond the bounded hydration window', async () => {
    process.env.VITE_VH_NEWS_HYDRATION_INDEX_LIMIT = '2';
    vi.resetModules();
    const client = { id: 'bounded-client' };
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.readNewsStory.mockResolvedValue(null);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => client as never, store);

    latestChain.emit(100, 'story-old');
    latestChain.emit(300, 'story-newest');
    latestChain.emit(200, 'story-middle');

    expect(state.removeLatestIndex).toHaveBeenCalledWith('story-old');
    expect(state.removeHotIndex).toHaveBeenCalledWith('story-old');
    expect(state.removeStory).toHaveBeenCalledWith('story-old');
  });

  it('skips fetching stories already present and hydrates missing stories from latest-index updates', async () => {
    const client = { id: 'client-latest-fetch' };
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.readNewsStory.mockResolvedValue(story({ story_id: 'story-missing' }));

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();
    (state as unknown as { stories: StoryBundle[] }).stories = [story({ story_id: 'story-present' })];

    hydrateNewsStore(() => client as never, store);

    latestChain.emit(123, 'story-present');
    expect(gunMocks.readNewsStory).toHaveBeenCalledWith(client, 'story-present');
    gunMocks.readNewsStory.mockClear();

    latestChain.emit(456, 'story-missing');
    await Promise.resolve();

    expect(gunMocks.readNewsStory).toHaveBeenCalledWith(client, 'story-missing');
    expect(state.upsertStory).toHaveBeenCalledWith(expect.objectContaining({ story_id: 'story-missing' }));
  });

  it('hydrates signed latest-index subscription records through the relay-capable story reader', async () => {
    const client = { id: 'client-signed-index-fetch' };
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.parseNewsLatestIndexEntryRecord.mockResolvedValue(789);
    gunMocks.readNewsStory.mockResolvedValue(story({ story_id: 'story-signed' }));

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => client as never, store);

    latestChain.emit({
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'system',
      _systemWriterId: 'writer-1',
      _systemSignature: 'signature',
      story_id: 'story-signed',
      latest_activity_at: 789,
    }, 'story-signed');
    await flushHydrationQueue();

    expect(gunMocks.parseNewsLatestIndexEntryRecord).toHaveBeenCalledWith(
      client,
      'story-signed',
      expect.objectContaining({
        _writerKind: 'system',
        story_id: 'story-signed',
      }),
    );
    expect(state.upsertLatestIndex).toHaveBeenCalledWith('story-signed', 789);
    expect(gunMocks.readNewsStory).toHaveBeenCalledWith(client, 'story-signed');
    expect(state.upsertStory).toHaveBeenCalledWith(expect.objectContaining({ story_id: 'story-signed' }));
  });

  it('rejects unpinned protocol-shaped latest-index live rows before story hydration', async () => {
    const client = { id: 'client-unpinned-index' };
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.parseNewsLatestIndexEntryRecord.mockResolvedValue(null);
    gunMocks.readNewsStory.mockResolvedValue(story({ story_id: 'story-stale' }));

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => client as never, store);

    latestChain.emit({
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'system',
      _systemWriterId: 'relay-c-legacy-writer',
      _systemSignature: 'invalid-signature',
      story_id: 'story-stale',
      latest_activity_at: 999,
    }, 'story-stale');
    await flushHydrationQueue();

    expect(gunMocks.parseNewsLatestIndexEntryRecord).toHaveBeenCalledWith(
      client,
      'story-stale',
      expect.objectContaining({
        _systemWriterId: 'relay-c-legacy-writer',
      }),
    );
    expect(state.upsertLatestIndex).not.toHaveBeenCalledWith('story-stale', 999);
    expect(gunMocks.readNewsStory).not.toHaveBeenCalledWith(client, 'story-stale');
    expect(state.upsertStory).not.toHaveBeenCalledWith(expect.objectContaining({ story_id: 'story-stale' }));
  });

  it('deduplicates in-flight and already-fetched latest-index story reads', async () => {
    process.env.VITE_VH_NEWS_HYDRATION_INDEX_LIMIT = 'not-a-number';
    vi.resetModules();
    const client = { id: 'client-dedupe-fetch' };
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    let resolveRead: ((value: StoryBundle) => void) | undefined;
    gunMocks.readNewsStory.mockReturnValue(
      new Promise<StoryBundle>((resolve) => {
        resolveRead = resolve;
      }),
    );

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => client as never, store);

    latestChain.emit(456, 'story-dedupe');
    latestChain.emit(456, 'story-dedupe');
    expect(gunMocks.readNewsStory).toHaveBeenCalledTimes(1);

    resolveRead?.(story({ story_id: 'story-dedupe' }));
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    gunMocks.readNewsStory.mockClear();

    latestChain.emit(456, 'story-dedupe');

    expect(gunMocks.readNewsStory).not.toHaveBeenCalled();
    expect(state.upsertStory).toHaveBeenCalledWith(expect.objectContaining({ story_id: 'story-dedupe' }));
  });

  it('bounds live latest-index story reads while hydrating large indexes', async () => {
    process.env.VITE_VH_NEWS_HYDRATION_STORY_READ_CONCURRENCY = '2';
    vi.resetModules();

    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    let activeReads = 0;
    let maxActiveReads = 0;
    gunMocks.readNewsStory.mockImplementation(async (_client: unknown, storyId: string) => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeReads -= 1;
      return story({ story_id: storyId });
    });

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    for (let index = 1; index <= 5; index += 1) {
      latestChain.emit(100 + index, `story-${index}`);
    }

    for (let attempt = 0; attempt < 20 && gunMocks.readNewsStory.mock.calls.length < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    for (let attempt = 0; attempt < 20 && activeReads > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(gunMocks.readNewsStory).toHaveBeenCalledTimes(5);
    expect(maxActiveReads).toBeLessThanOrEqual(2);
    expect(state.upsertStory).toHaveBeenCalledTimes(5);
  });

  it('skips queued story reads when the authoritative latest-index timestamp changes before the read starts', async () => {
    process.env.VITE_VH_NEWS_HYDRATION_STORY_READ_CONCURRENCY = '1';
    vi.resetModules();

    const client = { id: 'client-stale-queued-read' };
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    let resolveActiveRead: ((value: StoryBundle) => void) | undefined;
    gunMocks.readNewsStory.mockImplementation((_client: unknown, storyId: string) => {
      if (storyId === 'story-active') {
        return new Promise<StoryBundle>((resolve) => {
          resolveActiveRead = resolve;
        });
      }
      return Promise.resolve(story({ story_id: storyId }));
    });

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => client as never, store);

    latestChain.emit(100, 'story-active');
    latestChain.emit(200, 'story-stale');
    latestChain.emit(201, 'story-stale');

    expect(gunMocks.readNewsStory).toHaveBeenCalledTimes(1);
    expect(gunMocks.readNewsStory).toHaveBeenCalledWith(client, 'story-active');

    resolveActiveRead?.(story({ story_id: 'story-active' }));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
    }

    expect(gunMocks.readNewsStory).toHaveBeenCalledTimes(1);
    expect(state.upsertStory).toHaveBeenCalledWith(expect.objectContaining({ story_id: 'story-active' }));
    expect(state.upsertStory).not.toHaveBeenCalledWith(expect.objectContaining({ story_id: 'story-stale' }));
  });

  it('clears failed live story reads so a later latest-index update can retry', async () => {
    const client = { id: 'client-read-retry' };
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.readNewsStory
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(story({ story_id: 'story-retry' }));

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => client as never, store);

    latestChain.emit(100, 'story-retry');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await Promise.resolve();
    }
    expect(state.upsertStory).not.toHaveBeenCalled();

    latestChain.emit(101, 'story-retry');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await Promise.resolve();
    }

    expect(gunMocks.readNewsStory).toHaveBeenCalledTimes(2);
    expect(state.upsertStory).toHaveBeenCalledWith(expect.objectContaining({ story_id: 'story-retry' }));
  });

  it('ignores direct root-story updates so the latest index stays authoritative', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    storyChain.emit(story({ story_id: 'canonical-story', cluster_window_end: 901 }), 'legacy-map-key');

    expect(state.upsertStory).not.toHaveBeenCalled();
    expect(state.upsertLatestIndex).not.toHaveBeenCalled();
  });

  it('ignores blank-id root-story updates', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    storyChain.emit(story({ story_id: '   ', cluster_window_end: 902 }), 'fallback-key');

    expect(state.upsertStory).not.toHaveBeenCalled();
    expect(state.upsertLatestIndex).not.toHaveBeenCalled();
  });

  it('ignores payload-only root-story updates until a latest-index entry references them', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    storyChain.emit(story({ story_id: 'payload-only-id', cluster_window_end: 902 }));

    expect(state.upsertStory).not.toHaveBeenCalled();
    expect(state.upsertLatestIndex).not.toHaveBeenCalled();
  });

  it('drops story updates when both payload story_id and map key are blank', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    storyChain.emit(story({ story_id: '   ', cluster_window_end: 903 }), '   ');

    expect(state.upsertStory).not.toHaveBeenCalled();
    expect(state.upsertLatestIndex).not.toHaveBeenCalled();
  });

  it('ignores encoded root-story payloads because hydration is latest-index bounded', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    const s = story({ story_id: 'encoded-1', created_at: 444, cluster_window_end: 777 });
    storyChain.emit({ __story_bundle_json: JSON.stringify(s), story_id: s.story_id }, s.story_id);

    expect(state.upsertStory).not.toHaveBeenCalled();
    expect(state.upsertLatestIndex).not.toHaveBeenCalled();
  });

  it('drops encoded story payloads with invalid JSON', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    storyChain.emit({ __story_bundle_json: '{bad-json', story_id: 'broken' }, 'broken');

    expect(state.upsertStory).not.toHaveBeenCalled();
    expect(state.upsertLatestIndex).not.toHaveBeenCalled();
  });

  it('ignores invalid story payloads', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.hasForbiddenNewsPayloadFields.mockImplementation((payload: unknown) => {
      return typeof payload === 'object' && payload !== null && 'token' in payload;
    });

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    storyChain.emit(null, 's1');
    storyChain.emit({ headline: 'missing required fields' }, 's2');
    storyChain.emit({ ...story(), token: 'x' }, 's3');

    expect(state.upsertStory).not.toHaveBeenCalled();
    expect(state.upsertLatestIndex).not.toHaveBeenCalled();
  });

  it('hydrates legacy latest-index migration fixture entries', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    for (const [key, value] of Object.entries(LEGACY_LATEST_INDEX_PAYLOAD_FIXTURE)) {
      latestChain.emit(value, key);
    }
    latestChain.emit(10, undefined);

    for (const [key, expected] of Object.entries(LEGACY_LATEST_INDEX_EXPECTED_FIXTURE)) {
      expect(state.upsertLatestIndex).toHaveBeenCalledWith(key, expected);
    }
    expect(state.upsertLatestIndex).toHaveBeenCalledTimes(
      Object.keys(LEGACY_LATEST_INDEX_EXPECTED_FIXTURE).length,
    );
  });

  it('hydrates target latest-index migration fixture entries', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    for (const [key, value] of Object.entries(TARGET_LATEST_INDEX_PAYLOAD_FIXTURE)) {
      latestChain.emit(value, key);
    }
    latestChain.emit(10, undefined);

    for (const [key, expected] of Object.entries(TARGET_LATEST_INDEX_EXPECTED_FIXTURE)) {
      expect(state.upsertLatestIndex).toHaveBeenCalledWith(key, expected);
    }
    expect(state.upsertLatestIndex).toHaveBeenCalledTimes(
      Object.keys(TARGET_LATEST_INDEX_EXPECTED_FIXTURE).length,
    );
  });

  it('prefers cluster_window_end over fallback keys in mixed latest-index payloads', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    for (const [key, value] of Object.entries(MIXED_LATEST_INDEX_PRECEDENCE_PAYLOAD_FIXTURE)) {
      latestChain.emit(value, key);
    }

    for (const [key, expected] of Object.entries(MIXED_LATEST_INDEX_PRECEDENCE_EXPECTED_FIXTURE)) {
      expect(state.upsertLatestIndex).toHaveBeenCalledWith(key, expected);
    }
    expect(state.upsertLatestIndex).toHaveBeenCalledTimes(
      Object.keys(MIXED_LATEST_INDEX_PRECEDENCE_EXPECTED_FIXTURE).length,
    );
  });

  it('ignores protocol-shaped live latest and hot index records until signed reads validate them', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    latestChain.emit(
      {
        _protocolVersion: 'news-system-write-v1',
        _writerKind: 'system',
        _systemWriterId: 'stale-writer',
        _systemSignature: 'signature',
        latest_activity_at: 999,
      },
      'story-stale',
    );
    hotChain.emit(
      {
        signedWriteEnvelope: { payload: { hotness: 0.91 } },
        hotness: 0.91,
      },
      'story-stale',
    );

    latestChain.emit(123, 'story-current');
    hotChain.emit(0.42, 'story-current');

    expect(state.upsertLatestIndex).toHaveBeenCalledTimes(1);
    expect(state.upsertLatestIndex).toHaveBeenCalledWith('story-current', 123);
    expect(state.upsertHotIndex).toHaveBeenCalledTimes(1);
    expect(state.upsertHotIndex).toHaveBeenCalledWith('story-current', 0.42);
    expect(gunMocks.readNewsStory).not.toHaveBeenCalledWith(expect.anything(), 'story-stale');
  });

  it('hydrates hot-index entries and ignores malformed scores', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    hotChain.emit(0.912345678, 'story-a');
    hotChain.emit('0.72', 'story-b');
    hotChain.emit({ hotness: '0.61' }, 'story-c');
    hotChain.emit('bad', 'story-d');
    hotChain.emit(-1, 'story-e');
    hotChain.emit(0.5, undefined);

    expect(state.upsertHotIndex).toHaveBeenCalledWith('story-a', 0.912346);
    expect(state.upsertHotIndex).toHaveBeenCalledWith('story-b', 0.72);
    expect(state.upsertHotIndex).toHaveBeenCalledWith('story-c', 0.61);
    expect(state.upsertHotIndex).toHaveBeenCalledTimes(3);
  });
});
