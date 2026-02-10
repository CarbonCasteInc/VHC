import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import type { NewsState } from './index';

const gunMocks = vi.hoisted(() => ({
  getNewsStoriesChain: vi.fn(),
  getNewsLatestIndexChain: vi.fn(),
  hasForbiddenNewsPayloadFields: vi.fn<(payload: unknown) => boolean>()
}));

vi.mock('@vh/gun-client', () => ({
  getNewsStoriesChain: gunMocks.getNewsStoriesChain,
  getNewsLatestIndexChain: gunMocks.getNewsLatestIndexChain,
  hasForbiddenNewsPayloadFields: gunMocks.hasForbiddenNewsPayloadFields
}));

function story(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'topic-1',
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
    hydrated: false,
    loading: false,
    error: null,
    setStories: vi.fn(),
    upsertStory: vi.fn(),
    setLatestIndex: vi.fn(),
    upsertLatestIndex: vi.fn((storyId: string, createdAt: number) => {
      (state.latestIndex as Record<string, number>)[storyId] = createdAt;
    }),
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
    gunMocks.getNewsLatestIndexChain.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReturnValue(false);
    vi.resetModules();
  });

  it('returns false when no client is available', async () => {
    const { hydrateNewsStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateNewsStore(() => null, store)).toBe(false);
  });

  it('returns false when subscriptions are unsupported', async () => {
    gunMocks.getNewsStoriesChain.mockReturnValue({ map: undefined });
    gunMocks.getNewsLatestIndexChain.mockReturnValue({ map: vi.fn(() => ({ on: vi.fn() })) });

    const { hydrateNewsStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateNewsStore(() => ({}) as never, store)).toBe(false);
  });

  it('attaches once per store (idempotent)', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateNewsStore(() => ({}) as never, store)).toBe(true);
    expect(hydrateNewsStore(() => ({}) as never, store)).toBe(true);

    expect(storyChain.onSpy).toHaveBeenCalledTimes(1);
    expect(latestChain.onSpy).toHaveBeenCalledTimes(1);
  });

  it('hydrates stories and backfills latest index when missing', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    storyChain.emit({ _: { '#': 'meta' }, ...story({ story_id: 's1', created_at: 321 }) }, 's1');

    expect(state.upsertStory).toHaveBeenCalledWith(expect.objectContaining({ story_id: 's1' }));
    expect(state.upsertLatestIndex).toHaveBeenCalledWith('s1', 321);

    storyChain.emit(story({ story_id: 's1', created_at: 999 }), 's1');
    expect(state.upsertLatestIndex).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid story payloads', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
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

  it('hydrates latest index and ignores invalid entries', async () => {
    const storyChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    latestChain.emit(100.9, 'a');
    latestChain.emit('200', 'b');
    latestChain.emit({ created_at: 300 }, 'c');
    latestChain.emit(-1, 'neg');
    latestChain.emit('bad', 'bad');
    latestChain.emit(10, undefined);

    expect(state.upsertLatestIndex).toHaveBeenCalledWith('a', 100);
    expect(state.upsertLatestIndex).toHaveBeenCalledWith('b', 200);
    expect(state.upsertLatestIndex).toHaveBeenCalledWith('c', 300);
    expect(state.upsertLatestIndex).toHaveBeenCalledTimes(3);
  });
});
