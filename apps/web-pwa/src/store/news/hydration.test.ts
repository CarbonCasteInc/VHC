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
  readNewsStory: vi.fn(),
}));

vi.mock('@vh/gun-client', () => ({
  getNewsStoriesChain: gunMocks.getNewsStoriesChain,
  getNewsStorylinesChain: gunMocks.getNewsStorylinesChain,
  getNewsLatestIndexChain: gunMocks.getNewsLatestIndexChain,
  getNewsHotIndexChain: gunMocks.getNewsHotIndexChain,
  hasForbiddenNewsPayloadFields: gunMocks.hasForbiddenNewsPayloadFields,
  readNewsStory: gunMocks.readNewsStory,
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

describe('hydrateNewsStore', () => {
  beforeEach(() => {
    gunMocks.getNewsStoriesChain.mockReset();
    gunMocks.getNewsStorylinesChain.mockReset();
    gunMocks.getNewsLatestIndexChain.mockReset();
    gunMocks.getNewsHotIndexChain.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReset();
    gunMocks.readNewsStory.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReturnValue(false);
    gunMocks.readNewsStory.mockResolvedValue(null);
    gunMocks.getNewsStorylinesChain.mockReturnValue({ map: vi.fn(() => ({ on: vi.fn() })) });
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.VITE_VH_NEWS_HYDRATION_INDEX_LIMIT;
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
