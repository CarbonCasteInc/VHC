import { describe, expect, it, vi } from 'vitest';
import type { TopicEngagementActorNode } from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  materializeTopicEngagementAggregate,
  readTopicEngagementActorNode,
  readTopicEngagementSummary,
  writeTopicEngagementActorNode,
} from './topicEngagementAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setMapEntries: (path: string, entries: Array<[string | undefined, unknown]>, options?: { offThrows?: boolean }) => void;
  setOnceHandler: (handler: ((path: string, cb?: (data: unknown) => void) => void) | null) => void;
  setPutHandler: (handler: ((path: string, value: unknown, cb?: (ack?: { err?: string }) => void) => void) | null) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const mapEntries = new Map<string, { entries: Array<[string | undefined, unknown]>; offThrows: boolean }>();
  const writes: Array<{ path: string; value: unknown }> = [];
  let onceHandler: ((path: string, cb?: (data: unknown) => void) => void) | null = null;
  let putHandler: ((path: string, value: unknown, cb?: (ack?: { err?: string }) => void) => void) | null = null;

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: Record<string, unknown> = {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (onceHandler) {
          onceHandler(path, cb);
          return;
        }
        cb?.(reads.get(path));
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        if (putHandler) {
          putHandler(path, value, cb);
          return;
        }
        writes.push({ path, value });
        cb?.({});
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };

    const mapped = mapEntries.get(path);
    if (mapped) {
      node.map = vi.fn(() => ({
        once: vi.fn((cb?: (value: unknown, key?: string) => void) => {
          for (const [key, value] of mapped.entries) {
            cb?.(value, key);
          }
        }),
        off: vi.fn(() => {
          if (mapped.offThrows) {
            throw new Error('off failed');
          }
        }),
      }));
    }

    return node;
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setMapEntries(path, entries, options = {}) {
      mapEntries.set(path, {
        entries,
        offThrows: options.offThrows ?? false,
      });
    },
    setOnceHandler(handler) {
      onceHandler = handler;
    },
    setPutHandler(handler) {
      putHandler = handler;
    },
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
    gun: { user: vi.fn() } as unknown as VennClient['gun'],
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    mesh: mesh.root,
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn(),
  };
}

const OTHER_ACTOR: TopicEngagementActorNode = {
  schema_version: 'topic-engagement-actor-v1',
  topic_id: 'topic-1',
  eye_weight: 1.285,
  lightbulb_weight: 0,
  updated_at: '2026-02-18T22:00:00.000Z',
};

describe('topicEngagementAdapters', () => {
  it('materializes public aggregate weights from topic-scoped actor nodes', () => {
    const aggregate = materializeTopicEngagementAggregate({
      topicId: 'topic-1',
      computedAtMs: 1_700_000_010_000,
      actorNodes: [
        OTHER_ACTOR,
        {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'topic-1',
          eye_weight: 1,
          lightbulb_weight: 1.4845,
          updated_at: '2026-02-18T22:00:01.000Z',
        },
        {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'other-topic',
          eye_weight: 1.95,
          lightbulb_weight: 1.95,
          updated_at: '2026-02-18T22:00:02.000Z',
        },
      ],
    });

    expect(aggregate).toMatchObject({
      schema_version: 'topic-engagement-aggregate-v1',
      topic_id: 'topic-1',
      eye_weight: 2.285,
      lightbulb_weight: 1.4845,
      readers: 2,
      engagers: 1,
      computed_at: 1_700_000_010_000,
    });
  });

  it('normalizes aggregate inputs without allowing impossible actor weights through', () => {
    const aggregate = materializeTopicEngagementAggregate({
      topicId: 'topic-1',
      computedAtMs: -10,
      actorNodes: [
        {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'topic-1',
          eye_weight: Number.NaN,
          lightbulb_weight: -4,
          updated_at: 'not-a-date',
        } as never,
        {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'topic-1',
          eye_weight: 9,
          lightbulb_weight: 9,
          updated_at: 'also-not-a-date',
        } as never,
      ],
    });

    expect(aggregate).toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 1.95,
      lightbulb_weight: 1.95,
      readers: 1,
      engagers: 1,
      version: 0,
      computed_at: 0,
    });
  });

  it('rejects blank required topic and actor identifiers', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    expect(() =>
      materializeTopicEngagementAggregate({
        topicId: '   ',
        actorNodes: [],
      }),
    ).toThrow('topicId is required');
    await expect(readTopicEngagementActorNode(client, 'topic-1', '   ')).rejects.toThrow('actorId is required');
  });

  it('writes an actor node then updates the topic engagement summary', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', {
      _: { '#': 'metadata' },
      '   ': OTHER_ACTOR,
      'actor-other': OTHER_ACTOR,
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const aggregate = await writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
      eyeWeight: 1,
      lightbulbWeight: 1.285,
      updatedAt: '2026-02-18T22:01:00.000Z',
    });

    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[0]).toEqual({
      path: 'aggregates/topics/topic-1/engagement/actors/actor-me',
      value: {
        schema_version: 'topic-engagement-actor-v1',
        topic_id: 'topic-1',
        eye_weight: 1,
        lightbulb_weight: 1.285,
        updated_at: '2026-02-18T22:01:00.000Z',
      },
    });
    expect(mesh.writes[1]).toEqual({
      path: 'aggregates/topics/topic-1/engagement/summary',
      value: expect.objectContaining({
        schema_version: 'topic-engagement-aggregate-v1',
        topic_id: 'topic-1',
        eye_weight: 2.285,
        lightbulb_weight: 1.285,
        readers: 2,
        engagers: 1,
      }),
    });
    expect(aggregate.eye_weight).toBe(2.285);
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/aggregates/topics/topic-1/engagement/actors/actor-me/',
      expect.objectContaining({ topic_id: 'topic-1' }),
    );
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/aggregates/topics/topic-1/engagement/summary/',
      expect.objectContaining({ topic_id: 'topic-1' }),
    );
  });

  it('handles non-record actor roots by materializing only the just-written actor', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', null);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const aggregate = await writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
      eyeWeight: 1,
      lightbulbWeight: 0,
      updatedAt: '2026-02-18T23:02:00.000Z',
    });

    expect(aggregate).toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 1,
      lightbulb_weight: 0,
      readers: 1,
      engagers: 0,
    });
  });

  it('reads valid topic engagement summaries and ignores invalid payloads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    mesh.setRead('aggregates/topics/topic-1/engagement/summary', {
      _: { '#': 'metadata' },
      schema_version: 'topic-engagement-aggregate-v1',
      topic_id: 'topic-1',
      eye_weight: 1,
      lightbulb_weight: 1.285,
      readers: 1,
      engagers: 1,
      version: 1,
      computed_at: 1,
    });
    await expect(readTopicEngagementSummary(client, 'topic-1')).resolves.toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 1,
      lightbulb_weight: 1.285,
    });

    mesh.setRead('aggregates/topics/topic-2/engagement/summary', { invalid: true });
    await expect(readTopicEngagementSummary(client, 'topic-2')).resolves.toBeNull();

    mesh.setRead('aggregates/topics/topic-3/engagement/summary', null);
    await expect(readTopicEngagementSummary(client, 'topic-3')).resolves.toBeNull();
  });

  it('reads individual actor nodes and ignores invalid actor payloads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    mesh.setRead('aggregates/topics/topic-1/engagement/actors/actor-1', {
      _: { '#': 'metadata' },
      ...OTHER_ACTOR,
    });
    await expect(readTopicEngagementActorNode(client, 'topic-1', 'actor-1')).resolves.toEqual(OTHER_ACTOR);

    mesh.setRead('aggregates/topics/topic-1/engagement/actors/actor-2', { invalid: true });
    await expect(readTopicEngagementActorNode(client, 'topic-1', 'actor-2')).resolves.toBeNull();
  });

  it('uses map fallback when actor collection cannot be read as a record', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', {});
    mesh.setMapEntries(
      'aggregates/topics/topic-1/engagement/actors',
      [
        ['_', OTHER_ACTOR],
        ['   ', OTHER_ACTOR],
        [undefined, OTHER_ACTOR],
        ['actor-invalid', { invalid: true }],
        ['actor-other', OTHER_ACTOR],
        ['actor-me', {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'topic-1',
          eye_weight: 1,
          lightbulb_weight: 1,
          updated_at: '2026-02-18T23:00:00.000Z',
        }],
      ],
      { offThrows: true },
    );
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const aggregatePromise = writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
      eyeWeight: 1,
      lightbulbWeight: 1,
      updatedAt: '2026-02-18T23:00:00.000Z',
    });
    await vi.advanceTimersByTimeAsync(250);

    await expect(aggregatePromise).resolves.toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 2.285,
      lightbulb_weight: 1,
      readers: 2,
      engagers: 1,
    });

    vi.useRealTimers();
  });

  it('falls back to the just-written actor when no actor map API is available', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', {});
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const aggregate = await writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
      eyeWeight: 1,
      lightbulbWeight: 1,
    });

    expect(aggregate).toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 1,
      lightbulb_weight: 1,
      readers: 1,
      engagers: 1,
    });
    expect(mesh.writes[0]?.value).toMatchObject({
      updated_at: expect.any(String),
    });
  });

  it('rejects actor writes when Gun returns an ack error', async () => {
    const mesh = createFakeMesh();
    mesh.setPutHandler((_path, value, cb) => {
      mesh.writes.push({ path: _path, value });
      cb?.({ err: 'boom' });
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
        eyeWeight: 1,
        lightbulbWeight: 1,
      }),
    ).rejects.toThrow('boom');
  });

  it('treats missing put acknowledgements as timeout telemetry but keeps materializing', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', {
      'actor-other': OTHER_ACTOR,
    });
    mesh.setPutHandler((path, value, cb) => {
      mesh.writes.push({ path, value });
      mesh.setRead(path, value);
      setTimeout(() => cb?.({}), 1_100);
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const aggregatePromise = writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
      eyeWeight: 1,
      lightbulbWeight: 1,
      updatedAt: '2026-02-18T23:01:00.000Z',
    });

    await vi.advanceTimersByTimeAsync(1_100);
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(aggregatePromise).resolves.toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 2.285,
      lightbulb_weight: 1,
    });

    vi.useRealTimers();
  });

  it('times out reads and ignores late read callbacks', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setOnceHandler((_path, cb) => {
      setTimeout(() => cb?.({
        schema_version: 'topic-engagement-aggregate-v1',
        topic_id: 'topic-late',
        eye_weight: 1,
        lightbulb_weight: 1,
        readers: 1,
        engagers: 1,
        version: 1,
        computed_at: 1,
      }), 2_600);
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const summaryPromise = readTopicEngagementSummary(client, 'topic-late');
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(summaryPromise).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(100);

    vi.useRealTimers();
  });
});
