import { describe, expect, it, vi } from 'vitest';
import type { TopicEngagementActorNode } from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  materializeTopicEngagementAggregate,
  readTopicEngagementSummary,
  writeTopicEngagementActorNode,
} from './topicEngagementAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => {
        cb?.(reads.get(path));
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        cb?.({});
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
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

  it('writes an actor node then updates the topic engagement summary', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', {
      _: { '#': 'metadata' },
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
  });
});
