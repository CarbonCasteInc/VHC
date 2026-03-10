import { describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import { HydrationBarrier } from './sync/barrier';
import { readNewsStory, writeNewsStory } from './newsAdapters';

const STORY_IDENTITY_TOPIC_ID = 'b4b56b018ff0cb135bc001bbd6387c4750716ea05a28bb93aaeea9917a42a99b';

interface FakeMesh {
  readonly root: any;
  setRead(path: string, value: unknown): void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(reads.get(path))),
      put: vi.fn((_value: unknown, cb?: (ack?: { err?: string }) => void) => cb?.({})),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
  };

  return {
    root: makeNode([]),
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
    gun: {} as VennClient['gun'],
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

async function makeStoryBundle(overrides: Partial<StoryBundle> = {}): Promise<StoryBundle> {
  const storyId = overrides.story_id ?? 'story-identity-test';
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: storyId,
    topic_id: overrides.topic_id ?? STORY_IDENTITY_TOPIC_ID,
    headline: 'Canonical story',
    summary_hint: 'Summary',
    cluster_window_start: 1,
    cluster_window_end: 2,
    sources: [
      {
        source_id: 'bbc-general',
        publisher: 'BBC News',
        url: 'https://example.com/news',
        url_hash: 'abc12345',
        published_at: 1,
        title: 'Canonical story',
      },
    ],
    cluster_features: {
      entity_keys: ['entity'],
      time_bucket: 'tb-1',
      semantic_signature: 'sig',
    },
    provenance_hash: 'provhash',
    created_at: 3,
    ...overrides,
  };
}

describe('news adapter story identity guard', () => {
  it('rejects non-canonical topic ids on write', async () => {
    const guard = { validateRead: vi.fn(), validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(createFakeMesh(), guard);

    await expect(
      writeNewsStory(client, await makeStoryBundle({ topic_id: 'topic-news' })),
    ).rejects.toThrow('story bundle topic_id must equal sha256("news:" + story_id)');
  });

  it('drops non-canonical topic ids on read', async () => {
    const mesh = createFakeMesh();
    const guard = { validateRead: vi.fn(), validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    mesh.setRead('news/stories/story-identity-test', await makeStoryBundle({ topic_id: 'topic-news' }));

    await expect(readNewsStory(client, 'story-identity-test')).resolves.toBeNull();
  });

  it('reads canonical bundles successfully', async () => {
    const mesh = createFakeMesh();
    const guard = { validateRead: vi.fn(), validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const story = await makeStoryBundle();
    mesh.setRead(`news/stories/${story.story_id}`, story);

    await expect(readNewsStory(client, story.story_id)).resolves.toEqual(story);
  });
});
