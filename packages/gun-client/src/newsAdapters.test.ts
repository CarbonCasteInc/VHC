import { describe, expect, it, vi } from 'vitest';
import * as dataModel from '@vh/data-model';
import type { StoryBundle } from '@vh/data-model';
import {
  LEGACY_LATEST_INDEX_EXPECTED_FIXTURE,
  LEGACY_LATEST_INDEX_PAYLOAD_FIXTURE,
  MIXED_LATEST_INDEX_PRECEDENCE_EXPECTED_FIXTURE,
  MIXED_LATEST_INDEX_PRECEDENCE_PAYLOAD_FIXTURE,
  TARGET_LATEST_INDEX_EXPECTED_FIXTURE,
  TARGET_LATEST_INDEX_PAYLOAD_FIXTURE,
} from './__fixtures__/latestIndexMigrationFixtures';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import { HydrationBarrier } from './sync/barrier';
import {
  DEFAULT_NEWS_HOTNESS_CONFIG,
  computeStoryHotness,
  getNewsHotIndexChain,
  getNewsIngestionLeaseChain,
  getNewsStoryChain,
  getNewsStoriesChain,
  getNewsRemovalChain,
  hasForbiddenNewsPayloadFields,
  parseRemovalEntry,
  readLatestStoryIds,
  readNewsHotIndex,
  readNewsIngestionLease,
  readNewsLatestIndex,
  readNewsRemoval,
  readNewsStory,
  writeNewsBundle,
  writeNewsHotIndexEntry,
  writeNewsIngestionLease,
  writeNewsLatestIndexEntry,
  writeNewsStory
} from './newsAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setReadHang: (path: string) => void;
  setReadDelay: (path: string, delayMs: number) => void;
  setPutError: (path: string, err: string) => void;
  setPutHang: (path: string) => void;
  setPutDoubleAck: (path: string) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const readHangs = new Set<string>();
  const readDelays = new Map<string, number>();
  const putErrors = new Map<string, string>();
  const putHangs = new Set<string>();
  const putDoubleAcks = new Set<string>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: any = {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (readHangs.has(path)) {
          return;
        }
        const readDelayMs = readDelays.get(path);
        if (typeof readDelayMs === 'number' && readDelayMs > 0) {
          setTimeout(() => {
            cb?.(reads.get(path));
          }, readDelayMs);
          return;
        }
        cb?.(reads.get(path));
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        if (putHangs.has(path)) {
          return;
        }
        const err = putErrors.get(path);
        cb?.(err ? { err } : {});
        if (putDoubleAcks.has(path)) {
          cb?.({});
        }
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
    setReadHang(path: string) {
      readHangs.add(path);
    },
    setReadDelay(path: string, delayMs: number) {
      readDelays.set(path, delayMs);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    },
    setPutHang(path: string) {
      putHangs.add(path);
    },
    setPutDoubleAck(path: string) {
      putDoubleAcks.add(path);
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
  topic_id: '3db5ddabd0febe73154dec0a3d8fd767ba246c543c8bd857fdfcab932fc7aa2a',
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

  it('builds hot index chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const hotIndexChain = getNewsHotIndexChain(client);
    await hotIndexChain.get('story-xyz').put(0.625);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/index/hot/story-xyz/', 0.625);
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

  it('writeNewsStory preserves created_at immutability expectation at adapter boundary', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const frozenCreatedAt = 1_700_000_020_123;

    const result = await writeNewsStory(client, {
      ...STORY,
      created_at: frozenCreatedAt,
      cluster_window_end: frozenCreatedAt + 5000,
    });

    expect(result.created_at).toBe(frozenCreatedAt);
    expect(
      JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string),
    ).toMatchObject({
      story_id: STORY.story_id,
      created_at: frozenCreatedAt,
      cluster_window_end: frozenCreatedAt + 5000,
    });
  });

  it('writeNewsStory enforces first-write-wins created_at on re-ingest', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-123', {
      __story_bundle_json: JSON.stringify({
        ...STORY,
        created_at: 1_700_000_010_000,
      }),
      story_id: 'story-123',
      created_at: 1_700_000_010_000,
      schemaVersion: STORY.schemaVersion,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const result = await writeNewsStory(client, {
      ...STORY,
      created_at: 1_700_000_999_000,
    });

    expect(result.created_at).toBe(1_700_000_010_000);
    expect(mesh.writes).toHaveLength(1);
    expect(
      JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string),
    ).toMatchObject({
      story_id: 'story-123',
      created_at: 1_700_000_010_000,
    });
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

  it('writeNewsStory resolves when put ack times out', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const identityGuard = vi.spyOn(dataModel, 'assertCanonicalNewsTopicId').mockResolvedValue();

    try {
      const mesh = createFakeMesh();
      mesh.setPutHang('news/stories/story-123');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const writePromise = writeNewsStory(client, STORY);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(writePromise).resolves.toEqual(STORY);
      expect(warning).toHaveBeenCalledWith('[vh:news] put ack timed out, proceeding without ack');
    } finally {
      identityGuard.mockRestore();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it('suppresses repeated timeout warnings within interval and reports suppressed count later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2100-01-01T00:00:00.000Z'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const identityGuard = vi.spyOn(dataModel, 'assertCanonicalNewsTopicId').mockResolvedValue();

    try {
      const mesh = createFakeMesh();
      mesh.setPutHang('news/stories/story-timeout-1');
      mesh.setPutHang('news/stories/story-timeout-2');
      mesh.setPutHang('news/stories/story-timeout-3');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const storyOne: StoryBundle = {
        ...STORY,
        story_id: 'story-timeout-1',
        topic_id: 'bee15dc887ea2c232fdf4a970583f91a4c42c67543e522f815d6c3fe4aad420a',
      };
      const storyTwo: StoryBundle = {
        ...STORY,
        story_id: 'story-timeout-2',
        topic_id: 'd347b837a7aa169d530aa193f0cdeb0c7fab3bba7ff019ead32592c0a99afb4b',
      };
      const storyThree: StoryBundle = {
        ...STORY,
        story_id: 'story-timeout-3',
        topic_id: '59512f69ced0a62872ec237f8f7ddbe3c33b407fca881e92b0829d9493ae79ff',
      };

      const firstWrite = writeNewsStory(client, storyOne);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(firstWrite).resolves.toEqual(storyOne);
      const warningsAfterFirstWrite = warning.mock.calls.length;

      const secondWrite = writeNewsStory(client, storyTwo);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(secondWrite).resolves.toEqual(storyTwo);
      expect(warning.mock.calls.length).toBe(warningsAfterFirstWrite);

      await vi.advanceTimersByTimeAsync(15_000);

      const thirdWrite = writeNewsStory(client, storyThree);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(thirdWrite).resolves.toEqual(storyThree);
      expect(warning).toHaveBeenLastCalledWith(
        '[vh:news] put ack timed out, proceeding without ack (suppressed 1 repeats)',
      );
    } finally {
      identityGuard.mockRestore();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it('ignores duplicate ack callbacks and late timeout ticks after settlement', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);

    try {
      const mesh = createFakeMesh();
      mesh.setPutDoubleAck('news/stories/story-123');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      await expect(writeNewsStory(client, STORY)).resolves.toEqual(STORY);

      await vi.advanceTimersByTimeAsync(1000);
      expect(warning).not.toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      warning.mockRestore();
      vi.useRealTimers();
    }
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

  it('readNewsStory returns null when read never resolves', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setReadHang('news/stories/hanging-story');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const readPromise = readNewsStory(client, 'hanging-story');
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(readPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('readNewsStory ignores late once callback after timeout settlement', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setRead('news/stories/late-story', STORY);
      mesh.setReadDelay('news/stories/late-story', 3_000);
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const readPromise = readNewsStory(client, 'late-story');
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(readPromise).resolves.toBeNull();

      // Trigger delayed once callback after readOnce has already resolved.
      await vi.advanceTimersByTimeAsync(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('readNewsStory tolerates a timeout callback after early once settlement', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);

    try {
      const mesh = createFakeMesh();
      mesh.setRead('news/stories/settled-story', STORY);
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      await expect(readNewsStory(client, 'settled-story')).resolves.toEqual(STORY);

      // With clearTimeout disabled, timeout callback still runs and must short-circuit.
      await vi.advanceTimersByTimeAsync(2_500);
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('readNewsLatestIndex supports legacy migration fixtures', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', LEGACY_LATEST_INDEX_PAYLOAD_FIXTURE);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual(
      LEGACY_LATEST_INDEX_EXPECTED_FIXTURE,
    );
  });

  it('readNewsLatestIndex supports target migration fixtures', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', TARGET_LATEST_INDEX_PAYLOAD_FIXTURE);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual(
      TARGET_LATEST_INDEX_EXPECTED_FIXTURE,
    );
  });

  it('readNewsLatestIndex prefers target activity keys over legacy keys in mixed payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', MIXED_LATEST_INDEX_PRECEDENCE_PAYLOAD_FIXTURE);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual(
      MIXED_LATEST_INDEX_PRECEDENCE_EXPECTED_FIXTURE,
    );
  });

  it('readNewsLatestIndex returns empty object for non-object payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', null);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual({});
  });

  it('readNewsHotIndex parses numeric/string/object payloads and drops invalid entries', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/hot', {
      'story-a': 0.912345678,
      'story-b': '0.75',
      'story-c': { hotness: 0.5 },
      'story-d': { hotness: '0.33' },
      'story-invalid': { hotness: -1 },
      'story-bad': 'not-a-number',
      _: { '#': 'meta' },
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsHotIndex(client)).resolves.toEqual({
      'story-a': 0.912346,
      'story-b': 0.75,
      'story-c': 0.5,
      'story-d': 0.33,
    });
  });

  it('readNewsHotIndex returns empty object for non-object payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/hot', null);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsHotIndex(client)).resolves.toEqual({});
  });

  it('computeStoryHotness is deterministic for fixed inputs', () => {
    const fixedNow = STORY.cluster_window_end + 2 * 60 * 60 * 1000;
    const a = computeStoryHotness(STORY, fixedNow);
    const b = computeStoryHotness(STORY, fixedNow);

    expect(a).toBe(b);
  });

  it('computeStoryHotness favors breaking velocity and decays over time', () => {
    const now = STORY.cluster_window_end + 60 * 60 * 1000;
    const breaking = computeStoryHotness(
      {
        ...STORY,
        cluster_features: {
          ...STORY.cluster_features,
          coverage_score: 0.85,
          velocity_score: 0.95,
          confidence_score: 0.7,
        },
      },
      now,
      DEFAULT_NEWS_HOTNESS_CONFIG,
    );

    const stale = computeStoryHotness(
      {
        ...STORY,
        cluster_features: {
          ...STORY.cluster_features,
          coverage_score: 0.85,
          velocity_score: 0.95,
          confidence_score: 0.7,
        },
      },
      now + 24 * 60 * 60 * 1000,
      DEFAULT_NEWS_HOTNESS_CONFIG,
    );

    expect(breaking).toBeGreaterThan(stale);
  });

  it('computeStoryHotness clamps invalid config and sparse feature vectors', () => {
    const sparse = {
      ...STORY,
      sources: [],
      cluster_features: {
        ...STORY.cluster_features,
        coverage_score: undefined,
        velocity_score: undefined,
        confidence_score: undefined,
      },
    } as StoryBundle;

    const customConfig = {
      ...DEFAULT_NEWS_HOTNESS_CONFIG,
      decayHalfLifeHours: 0,
      breakingWindowHours: -5,
      breakingVelocityBoost: -1,
    };

    const score = computeStoryHotness(sparse, Number.NaN, customConfig);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('computeStoryHotness clamps non-finite and out-of-range feature inputs', () => {
    const outOfRange = {
      ...STORY,
      cluster_features: {
        ...STORY.cluster_features,
        coverage_score: Number.NaN,
        velocity_score: -0.2,
        confidence_score: 1.8,
      },
    } as StoryBundle;

    const score = computeStoryHotness(outOfRange, STORY.cluster_window_end + 15 * 60 * 1000);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(2);
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

  it('writeNewsHotIndexEntry validates id and normalizes score', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeNewsHotIndexEntry(client, ' story-a ', 0.912345678)).resolves.toBe(0.912346);
    expect(mesh.writes[0]).toEqual({ path: 'news/index/hot/story-a', value: 0.912346 });

    await expect(writeNewsHotIndexEntry(client, 'story-b', Number.NaN)).resolves.toBe(0);
    expect(mesh.writes[1]).toEqual({ path: 'news/index/hot/story-b', value: 0 });

    await expect(writeNewsHotIndexEntry(client, 'story-c', -1)).resolves.toBe(0);
    expect(mesh.writes[2]).toEqual({ path: 'news/index/hot/story-c', value: 0 });

    await expect(writeNewsHotIndexEntry(client, '   ', 0.1)).rejects.toThrow('storyId is required');
  });

  it('writeNewsBundle writes story, latest index, and deterministic hot index', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(STORY.cluster_window_end + 30 * 60 * 1000));

    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const result = await writeNewsBundle(client, STORY);

      expect(result.story_id).toBe('story-123');
      expect(mesh.writes).toHaveLength(3);
      expect(mesh.writes[0].path).toBe('news/stories/story-123');
      expect(mesh.writes[0].value).toMatchObject({
        story_id: STORY.story_id,
        created_at: STORY.created_at,
        schemaVersion: STORY.schemaVersion
      });
      expect(
        JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string)
      ).toEqual(STORY);
      expect(mesh.writes[1]).toEqual({ path: 'news/index/latest/story-123', value: STORY.cluster_window_end });
      expect(mesh.writes[2]).toEqual({
        path: 'news/index/hot/story-123',
        value: computeStoryHotness(STORY, Date.now()),
      });
    } finally {
      vi.useRealTimers();
    }
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

  it('builds ingestion lease chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const lease = {
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 1,
      heartbeat_at: 2,
      expires_at: 3,
    };

    const chain = getNewsIngestionLeaseChain(client);
    await chain.put(lease);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/runtime/lease/ingester/', lease);
  });

  it('reads and writes ingestion lease records', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/runtime/lease/ingester', {
      _: { '#': 'meta' },
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 10,
      heartbeat_at: 15,
      expires_at: 25,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsIngestionLease(client)).resolves.toEqual({
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 10,
      heartbeat_at: 15,
      expires_at: 25,
    });

    await expect(
      writeNewsIngestionLease(client, {
        holder_id: 'holder-2',
        lease_token: 'token-2',
        acquired_at: 20,
        heartbeat_at: 21,
        expires_at: 40,
      }),
    ).resolves.toEqual({
      holder_id: 'holder-2',
      lease_token: 'token-2',
      acquired_at: 20,
      heartbeat_at: 21,
      expires_at: 40,
    });

    expect(mesh.writes.at(-1)).toEqual({
      path: 'news/runtime/lease/ingester',
      value: {
        holder_id: 'holder-2',
        lease_token: 'token-2',
        acquired_at: 20,
        heartbeat_at: 21,
        expires_at: 40,
      },
    });
  });

  it('rejects malformed ingestion lease writes and ignores malformed reads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/runtime/lease/ingester', {
      holder_id: 'holder-1',
      lease_token: '',
      acquired_at: 1,
      heartbeat_at: 2,
      expires_at: 3,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsIngestionLease(client)).resolves.toBeNull();
    await expect(
      writeNewsIngestionLease(client, {
        holder_id: 'holder-1',
        lease_token: ' ',
        acquired_at: 1,
        heartbeat_at: 2,
        expires_at: 3,
      }),
    ).rejects.toThrow('lease_token is required');
  });

  it('readNewsIngestionLease returns null when lease node is missing or non-object', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsIngestionLease(client)).resolves.toBeNull();

    mesh.setRead('news/runtime/lease/ingester', 42);
    await expect(readNewsIngestionLease(client)).resolves.toBeNull();
  });

  it('writeNewsIngestionLease validates object, string ids, and timestamps', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeNewsIngestionLease(client, null as unknown as any)).rejects.toThrow(
      'lease payload must be an object',
    );

    await expect(
      writeNewsIngestionLease(client, {
        holder_id: 99,
        lease_token: 'token-1',
        acquired_at: 1,
        heartbeat_at: 2,
        expires_at: 3,
      } as unknown as any),
    ).rejects.toThrow('holder_id must be a string');

    await expect(
      writeNewsIngestionLease(client, {
        holder_id: 'holder-1',
        lease_token: 'token-1',
        acquired_at: Number.NaN,
        heartbeat_at: 2,
        expires_at: 3,
      } as unknown as any),
    ).rejects.toThrow('acquired_at must be a non-negative finite number');
  });

  // ---- Removal ledger adapters ----

  it('getNewsRemovalChain builds correct path and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const chain = getNewsRemovalChain(client, 'abc123');
    await chain.put({ urlHash: 'abc123' } as any);
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/removed/abc123/',
      { urlHash: 'abc123' }
    );
  });

  it('parseRemovalEntry parses valid entries', () => {
    const entry = {
      urlHash: 'h1',
      canonicalUrl: 'https://example.com',
      removedAt: 1_700_000_000_000,
      reason: 'extraction-failed-permanently',
      removedBy: 'system',
      note: 'retry exhausted',
    };
    expect(parseRemovalEntry(entry)).toEqual(entry);
  });

  it('parseRemovalEntry strips Gun metadata', () => {
    const entry = {
      _: { '#': 'gun-meta' },
      urlHash: 'h1',
      canonicalUrl: 'https://example.com',
      removedAt: 1_700_000_000_000,
      reason: 'test',
    };
    const result = parseRemovalEntry(entry);
    expect(result).not.toBeNull();
    expect(result!.urlHash).toBe('h1');
    expect(result!.removedBy).toBeNull();
    expect(result!.note).toBeNull();
  });

  it('parseRemovalEntry returns null for invalid data', () => {
    expect(parseRemovalEntry(null)).toBeNull();
    expect(parseRemovalEntry(undefined)).toBeNull();
    expect(parseRemovalEntry(42)).toBeNull();
    expect(parseRemovalEntry('string')).toBeNull();
    expect(parseRemovalEntry({ urlHash: 123 })).toBeNull();
    expect(parseRemovalEntry({ urlHash: 'h', canonicalUrl: 'u' })).toBeNull();
    expect(parseRemovalEntry({
      urlHash: 'h', canonicalUrl: 'u', removedAt: NaN, reason: 'r'
    })).toBeNull();
    expect(parseRemovalEntry({
      urlHash: 'h', canonicalUrl: 'u', removedAt: 1, reason: 123
    })).toBeNull();
  });

  it('readNewsRemoval reads and parses from mesh', async () => {
    const mesh = createFakeMesh();
    const entry = {
      urlHash: 'h1',
      canonicalUrl: 'https://example.com',
      removedAt: 1_700_000_000_000,
      reason: 'extraction-failed-permanently',
    };
    mesh.setRead('news/removed/h1', entry);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const result = await readNewsRemoval(client, 'h1');
    expect(result).toEqual({ ...entry, removedBy: null, note: null });
  });

  it('readNewsRemoval returns null for missing entry', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsRemoval(client, 'nonexistent')).resolves.toBeNull();
  });
});
