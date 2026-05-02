import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle, StorylineGroup } from '@vh/data-model';
import type { NewsState } from './types';

const gunMocks = vi.hoisted(() => ({
  getNewsStoriesChain: vi.fn(),
  getNewsStorylinesChain: vi.fn(),
  getNewsLatestIndexChain: vi.fn(),
  getNewsHotIndexChain: vi.fn(),
  hasForbiddenNewsPayloadFields: vi.fn<(payload: unknown) => boolean>(),
  readNewsStory: vi.fn(),
  readNewsStoryline: vi.fn(),
}));

vi.mock('@vh/gun-client', () => ({
  getNewsStoriesChain: gunMocks.getNewsStoriesChain,
  getNewsStorylinesChain: gunMocks.getNewsStorylinesChain,
  getNewsLatestIndexChain: gunMocks.getNewsLatestIndexChain,
  getNewsHotIndexChain: gunMocks.getNewsHotIndexChain,
  hasForbiddenNewsPayloadFields: gunMocks.hasForbiddenNewsPayloadFields,
  readNewsStory: gunMocks.readNewsStory,
  readNewsStoryline: gunMocks.readNewsStoryline,
}));

function story(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'a'.repeat(64),
    storyline_id: 'storyline-1',
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
        title: 'Hydrated Story',
      },
    ],
    cluster_features: {
      entity_keys: ['entity'],
      time_bucket: 'tb-1',
      semantic_signature: 'sig',
    },
    provenance_hash: 'prov',
    created_at: 123,
    ...overrides,
  };
}

function storyline(overrides: Partial<StorylineGroup> = {}): StorylineGroup {
  return {
    schemaVersion: 'storyline-group-v0',
    storyline_id: 'storyline-1',
    topic_id: 'a'.repeat(64),
    canonical_story_id: 'story-1',
    story_ids: ['story-1'],
    headline: 'Storyline',
    related_coverage: [],
    entity_keys: ['entity'],
    time_bucket: 'tb-1',
    created_at: 100,
    updated_at: 200,
    ...overrides,
  };
}

interface SubscribableChain {
  chain: { map: ReturnType<typeof vi.fn> };
  emit: (data: unknown, key?: string) => void;
}

function createSubscribableChain(): SubscribableChain {
  let callback: ((data: unknown, key?: string) => void) | undefined;
  const chain = {
    map: vi.fn(() => ({
      on: vi.fn((cb: (data: unknown, key?: string) => void) => {
        callback = cb;
      }),
    })),
  };

  return {
    chain,
    emit(data: unknown, key?: string) {
      callback?.(data, key);
    },
  };
}

function createStore() {
  const state: NewsState = {
    stories: [],
    latestIndex: {},
    hotIndex: {},
    storylinesById: {},
    hydrated: false,
    loading: false,
    error: null,
    setStories: vi.fn(),
    upsertStory: vi.fn(),
    removeStory: vi.fn(),
    setLatestIndex: vi.fn(),
    upsertLatestIndex: vi.fn(),
    removeLatestIndex: vi.fn(),
    setHotIndex: vi.fn(),
    upsertHotIndex: vi.fn(),
    removeHotIndex: vi.fn(),
    setStorylines: vi.fn(),
    upsertStoryline: vi.fn(),
    removeStoryline: vi.fn(),
    ensureStory: vi.fn(),
    refreshLatest: vi.fn(),
    startHydration: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    reset: vi.fn(),
  };
  return { store: { getState: () => state } as unknown as import('zustand').StoreApi<NewsState>, state };
}

describe('hydrateNewsStore storylines', () => {
  beforeEach(() => {
    gunMocks.getNewsStoriesChain.mockReset();
    gunMocks.getNewsStorylinesChain.mockReset();
    gunMocks.getNewsLatestIndexChain.mockReset();
    gunMocks.getNewsHotIndexChain.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReset();
    gunMocks.readNewsStory.mockReset();
    gunMocks.readNewsStoryline.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReturnValue(false);
  });

  it('loads and upserts storylines when story updates arrive', async () => {
    const storyChain = createSubscribableChain();
    const storylineChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsStorylinesChain.mockReturnValue(storylineChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.readNewsStoryline.mockResolvedValue(storyline());

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);
    storyChain.emit(story(), 'story-1');
    expect(gunMocks.readNewsStoryline).toHaveBeenCalledWith(expect.anything(), 'storyline-1');
    await vi.waitFor(() => {
      expect(state.upsertStoryline).toHaveBeenCalledWith(storyline());
    });
  });

  it('upserts and removes storyline groups from storyline hydration updates', async () => {
    const storyChain = createSubscribableChain();
    const storylineChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsStorylinesChain.mockReturnValue(storylineChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.readNewsStoryline.mockResolvedValue(null);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    storylineChain.emit(
      {
        __storyline_group_json: JSON.stringify(storyline()),
      },
      'storyline-1',
    );
    storylineChain.emit(null, 'storyline-1');

    expect(state.upsertStoryline).toHaveBeenCalledWith(storyline());
    expect(state.removeStoryline).toHaveBeenCalledWith('storyline-1');
  });

  it('ignores null storyline removals without a usable key', async () => {
    const storyChain = createSubscribableChain();
    const storylineChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsStorylinesChain.mockReturnValue(storylineChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);
    storylineChain.emit(null);

    expect(state.removeStoryline).not.toHaveBeenCalled();
  });

  it('parses raw storyline payloads, ignores invalid payloads, and backfills storylines from latest index hydration', async () => {
    const storyChain = createSubscribableChain();
    const storylineChain = createSubscribableChain();
    const latestChain = createSubscribableChain();
    const hotChain = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(storyChain.chain);
    gunMocks.getNewsStorylinesChain.mockReturnValue(storylineChain.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latestChain.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hotChain.chain);
    gunMocks.readNewsStory.mockResolvedValue(story());
    gunMocks.readNewsStoryline.mockResolvedValue(storyline());

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateNewsStore(() => ({}) as never, store);

    storylineChain.emit(storyline(), 'storyline-1');
    storylineChain.emit({ __storyline_group_json: '{not json' }, 'storyline-1');
    latestChain.emit(55, 'story-1');

    await vi.waitFor(() => {
      expect(state.upsertStoryline).toHaveBeenCalledTimes(2);
    });
    expect(gunMocks.readNewsStory).toHaveBeenCalledWith(expect.anything(), 'story-1');
    expect(gunMocks.readNewsStoryline).toHaveBeenCalledWith(expect.anything(), 'storyline-1');
    expect(state.upsertStoryline).toHaveBeenNthCalledWith(1, storyline());
    expect(state.upsertStoryline).toHaveBeenNthCalledWith(2, storyline());
  });
});
