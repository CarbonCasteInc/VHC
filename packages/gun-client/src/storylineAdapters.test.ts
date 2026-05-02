import { describe, expect, it, vi } from 'vitest';
import type { StorylineGroup } from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  getNewsStorylineChain,
  getNewsStorylinesChain,
  readNewsStoryline,
  removeNewsStoryline,
  storylineAdaptersInternal,
  writeNewsStoryline,
} from './storylineAdapters';

interface FakeMeshOptions {
  readonly onceWithoutCallback?: boolean;
  readonly putAck?: { err?: string } | 'skip';
}

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead(path: string, value: unknown): void;
  triggerOnce(path: string, value: unknown): void;
  triggerAck(path: string, ack?: { err?: string }): void;
}

function createFakeMesh(options: FakeMeshOptions = {}): FakeMesh {
  const reads = new Map<string, unknown>();
  const writes: Array<{ path: string; value: unknown }> = [];
  const onceCallbacks = new Map<string, (data: unknown) => void>();
  const ackCallbacks = new Map<string, (ack?: { err?: string }) => void>();

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (options.onceWithoutCallback) {
          if (cb) {
            onceCallbacks.set(path, cb);
          }
          return;
        }
        cb?.(reads.get(path));
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        if (options.putAck === 'skip') {
          if (cb) {
            ackCallbacks.set(path, cb);
          }
          return;
        }
        cb?.(options.putAck ?? {});
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
    triggerOnce(path: string, value: unknown) {
      onceCallbacks.get(path)?.(value);
    },
    triggerAck(path: string, ack?: { err?: string }) {
      ackCallbacks.get(path)?.(ack);
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

const STORYLINE: StorylineGroup = {
  schemaVersion: 'storyline-group-v0',
  storyline_id: 'storyline-1',
  topic_id: 'a'.repeat(64),
  canonical_story_id: 'story-1',
  story_ids: ['story-1'],
  headline: 'Transit strike storyline',
  summary_hint: 'Related transit labor coverage.',
  related_coverage: [
    {
      source_id: 'src-related',
      publisher: 'Metro Daily',
      url: 'https://example.com/related',
      url_hash: 'related-hash',
      published_at: 123,
      title: 'Union signals more action',
    },
  ],
  entity_keys: ['transit', 'union'],
  time_bucket: '2026-03-10T12',
  created_at: 123,
  updated_at: 456,
};

describe('storylineAdapters', () => {
  it('builds storyline root and node chains with guarded paths', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await getNewsStorylinesChain(client).put({ storyline: true });
    await getNewsStorylineChain(client, 'storyline-1').put({ storyline: true });

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/storylines/', { storyline: true });
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/storylines/storyline-1/',
      { storyline: true },
    );
  });

  it('writes encoded storyline groups and decodes them on read', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await writeNewsStoryline(client, STORYLINE);

    expect(mesh.writes[0]).toEqual({
      path: 'news/storylines/storyline-1',
      value: expect.objectContaining({
        storyline_id: STORYLINE.storyline_id,
        canonical_story_id: STORYLINE.canonical_story_id,
        updated_at: STORYLINE.updated_at,
        schemaVersion: STORYLINE.schemaVersion,
      }),
    });

    mesh.setRead('news/storylines/storyline-1', mesh.writes[0]?.value);
    await expect(readNewsStoryline(client, STORYLINE.storyline_id)).resolves.toEqual(STORYLINE);
  });

  it('removes storyline root entry and node, and ignores invalid reads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsStoryline(client, 'storyline-missing')).resolves.toBeNull();
    mesh.setRead('news/storylines/storyline-1', { invalid: true });
    await expect(readNewsStoryline(client, 'storyline-1')).resolves.toBeNull();

    await removeNewsStoryline(client, 'storyline-1');

    expect(mesh.writes.slice(-2)).toEqual([
      { path: 'news/storylines', value: { 'storyline-1': null } },
      { path: 'news/storylines/storyline-1', value: null },
    ]);
  });

  it('exports internal payload codec helpers', () => {
    const encoded = storylineAdaptersInternal.encodeStorylineGroup(STORYLINE);
    expect(storylineAdaptersInternal.decodeStorylinePayload(encoded as Record<string, unknown>)).toEqual(STORYLINE);
    expect(storylineAdaptersInternal.decodeStorylinePayload({ storyline_id: 'raw' })).toEqual({ storyline_id: 'raw' });
    expect(
      storylineAdaptersInternal.decodeStorylinePayload({
        __storyline_group_json: '{broken-json',
      } as Record<string, unknown>),
    ).toBeNull();
    expect(storylineAdaptersInternal.parseStorylineGroup(null)).toBeNull();
    expect(storylineAdaptersInternal.parseStorylineGroup({ invalid: true })).toBeNull();
  });

  it('covers read timeout, ack timeout, ack error, and blank storyline removal guard', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const timedReadMesh = createFakeMesh({ onceWithoutCallback: true });
    const timedReadClient = createClient(
      timedReadMesh,
      { validateWrite: vi.fn() } as unknown as TopologyGuard,
    );
    const timedRead = readNewsStoryline(timedReadClient, 'storyline-1');
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(timedRead).resolves.toBeNull();
    timedReadMesh.triggerOnce('news/storylines/storyline-1', STORYLINE);

    const timeoutMesh = createFakeMesh({ putAck: 'skip' });
    timeoutMesh.setRead('news/storylines/storyline-1', STORYLINE);
    const timeoutClient = createClient(timeoutMesh, { validateWrite: vi.fn() } as unknown as TopologyGuard);
    const pendingWrite = writeNewsStoryline(timeoutClient, STORYLINE);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pendingWrite).resolves.toEqual(STORYLINE);
    expect(warnSpy).toHaveBeenCalledWith('[vh:storylines] put ack timed out, requiring readback confirmation');
    timeoutMesh.triggerAck('news/storylines/storyline-1', {});

    const errorClient = createClient(
      createFakeMesh({ putAck: { err: 'mesh failed' } }),
      { validateWrite: vi.fn() } as unknown as TopologyGuard,
    );
    await expect(writeNewsStoryline(errorClient, STORYLINE)).rejects.toThrow('mesh failed');
    await expect(removeNewsStoryline(errorClient, '   ')).rejects.toThrow('storylineId is required');

    warnSpy.mockRestore();
    vi.useRealTimers();
  });
});
