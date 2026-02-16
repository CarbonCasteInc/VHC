import { describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import { HydrationBarrier } from './sync/barrier';
import {
  getNewsStoryChain,
  getNewsStoriesChain,
  hasForbiddenNewsPayloadFields,
  readLatestStoryIds,
  readNewsLatestIndex,
  readNewsStory,
  writeNewsBundle,
  writeNewsLatestIndexEntry,
  writeNewsStory
} from './newsAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setPutError: (path: string, err: string) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const putErrors = new Map<string, string>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: any = {
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(reads.get(path))),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        const err = putErrors.get(path);
        cb?.(err ? { err } : {});
      }),
      get: vi.fn((key: string) => makeNode([...segments, key]))
    };
    return node;
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    }
  };
}

function createClient(mesh: FakeMesh, guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: guard,
    gun: {} as VennClient['gun'],
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    mesh: mesh.root,
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn()
  };
}

const STORY: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-123',
  topic_id: 'topic-abc',
  headline: 'Major policy shift announced',
  summary_hint: 'Summary',
  cluster_window_start: 1_700_000_000_000,
  cluster_window_end: 1_700_000_010_000,
  sources: [
    {
      source_id: 'src-1',
      publisher: 'Daily Planet',
      url: 'https://example.com/story-1',
      url_hash: 'a1b2c3d4',
      published_at: 1_700_000_000_000,
      title: 'Major policy shift announced'
    }
  ],
  cluster_features: {
    entity_keys: ['policy', 'city'],
    time_bucket: 'tb-123',
    semantic_signature: 'deadbeef'
  },
  provenance_hash: 'beadfeed',
  created_at: 1_700_000_020_000
};

describe('newsAdapters', () => {
  it('builds stories root chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const storiesChain = getNewsStoriesChain(client);
    await storiesChain.get('story-xyz').put(STORY);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/stories/story-xyz/', STORY);
  });

  it('builds story chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const storyChain = getNewsStoryChain(client, 'story-123');
    await storyChain.put(STORY);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/stories/story-123/', STORY);
  });

  it('detects forbidden payload fields recursively', () => {
    expect(hasForbiddenNewsPayloadFields({ ok: true })).toBe(false);
    expect(hasForbiddenNewsPayloadFields({ access_token: 'x' })).toBe(true);
    expect(hasForbiddenNewsPayloadFields({ custom_token: 'x' })).toBe(true);
    expect(hasForbiddenNewsPayloadFields({ nested: { identity_session: 'x' } })).toBe(true);
    expect(hasForbiddenNewsPayloadFields({ list: [{ published: true }, { bearer: 'x' }] })).toBe(true);

    const cyclic: Record<string, unknown> = { safe: true };
    cyclic.self = cyclic;
    expect(hasForbiddenNewsPayloadFields(cyclic)).toBe(false);
  });

  it('writeNewsStory validates, sanitizes, and writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const result = await writeNewsStory(client, {
      ...STORY,
      extra_field: 'should_be_stripped'
    });

    expect(result).toEqual(STORY);
    expect(mesh.writes).toHaveLength(1);
    expect(mesh.writes[0].path).toBe('news/stories/story-123');
    expect(mesh.writes[0].value).toMatchObject({
      story_id: STORY.story_id,
      created_at: STORY.created_at,
      schemaVersion: STORY.schemaVersion
    });
    expect(typeof (mesh.writes[0].value as Record<string, unknown>).__story_bundle_json).toBe('string');
    expect(
      JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string)
    ).toEqual(STORY);
  });

  it('writeNewsStory rejects forbidden identity/token payloads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writeNewsStory(client, {
        ...STORY,
        refresh_token: 'secret'
      })
    ).rejects.toThrow('forbidden identity/token fields');
  });

  it('writeNewsStory surfaces put ack errors', async () => {
    const mesh = createFakeMesh();
    mesh.setPutError('news/stories/story-123', 'write failed');
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeNewsStory(client, STORY)).rejects.toThrow('write failed');
  });

  it('readNewsStory parses valid payload and strips Gun metadata', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-123', {
      _: { '#': 'meta' },
      ...STORY,
      unknown_extra: 'drop-me'
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const story = await readNewsStory(client, 'story-123');
    expect(story).toEqual(STORY);
  });

  it('readNewsStory parses encoded bundle payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-encoded', {
      __story_bundle_json: JSON.stringify(STORY),
      story_id: STORY.story_id,
      created_at: STORY.created_at
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const story = await readNewsStory(client, 'story-encoded');
    expect(story).toEqual(STORY);
  });

  it('readNewsStory returns null for malformed encoded bundle payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-bad-json', {
      __story_bundle_json: '{bad-json',
      story_id: 'story-bad-json',
      created_at: STORY.created_at
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsStory(client, 'story-bad-json')).resolves.toBeNull();
  });

  it('readNewsStory returns null for missing, invalid, or forbidden payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/missing', undefined);
    mesh.setRead('news/stories/non-object', 123);
    mesh.setRead('news/stories/invalid', { headline: 'missing fields' });
    mesh.setRead('news/stories/forbidden', {
      ...STORY,
      nested: { oauth_token: 'nope' }
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsStory(client, 'missing')).resolves.toBeNull();
    await expect(readNewsStory(client, 'non-object')).resolves.toBeNull();
    await expect(readNewsStory(client, 'invalid')).resolves.toBeNull();
    await expect(readNewsStory(client, 'forbidden')).resolves.toBeNull();
  });

  it('readNewsLatestIndex coerces values and drops invalid entries', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', {
      _: { '#': 'meta' },
      'story-a': 100,
      'story-b': '200',
      'story-c': { created_at: 300 },
      'story-negative': -1,
      'story-bad': 'not-a-number'
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual({
      'story-a': 100,
      'story-b': 200,
      'story-c': 300
    });
  });

  it('readNewsLatestIndex returns empty object for non-object payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', null);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual({});
  });

  it('writeNewsLatestIndexEntry validates id and normalizes timestamp', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await writeNewsLatestIndexEntry(client, ' story-a ', 123.9);
    expect(mesh.writes[0]).toEqual({ path: 'news/index/latest/story-a', value: 123 });

    await writeNewsLatestIndexEntry(client, 'story-b', -10);
    expect(mesh.writes[1]).toEqual({ path: 'news/index/latest/story-b', value: 0 });

    await expect(writeNewsLatestIndexEntry(client, '   ', 1)).rejects.toThrow('storyId is required');
  });

  it('writeNewsBundle writes story and latest index', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const result = await writeNewsBundle(client, STORY);

    expect(result.story_id).toBe('story-123');
    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[0].path).toBe('news/stories/story-123');
    expect(mesh.writes[0].value).toMatchObject({
      story_id: STORY.story_id,
      created_at: STORY.created_at,
      schemaVersion: STORY.schemaVersion
    });
    expect(
      JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string)
    ).toEqual(STORY);
    expect(mesh.writes[1]).toEqual({ path: 'news/index/latest/story-123', value: STORY.created_at });
  });

  it('readLatestStoryIds sorts newest-first, then by id; respects limit', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', {
      'story-z': 500,
      'story-a': 500,
      'story-m': 300
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readLatestStoryIds(client, 2)).resolves.toEqual(['story-a', 'story-z']);
    await expect(readLatestStoryIds(client, 0)).resolves.toEqual([]);
    await expect(readLatestStoryIds(client, Number.NaN)).resolves.toEqual([]);
  });
});
