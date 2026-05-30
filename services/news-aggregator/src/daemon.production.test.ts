import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startNewsRuntime: vi.fn(),
  createNodeMeshClient: vi.fn(),
  readNewsIngestionLease: vi.fn(),
  readNewsSynthesisLifecycleStatus: vi.fn(),
  removeNewsBundle: vi.fn(),
  writeNewsBundle: vi.fn(),
  writeNewsIngestionLease: vi.fn(),
  writeNewsSynthesisLifecycleStatus: vi.fn(),
}));

vi.mock('@vh/ai-engine', async () => {
  const actual = await vi.importActual<typeof import('@vh/ai-engine')>('@vh/ai-engine');
  return {
    ...actual,
    startNewsRuntime: mocks.startNewsRuntime,
  };
});

vi.mock('@vh/gun-client', async () => {
  const actual = await vi.importActual<typeof import('@vh/gun-client')>('@vh/gun-client');
  return {
    ...actual,
    readNewsIngestionLease: mocks.readNewsIngestionLease,
    readNewsSynthesisLifecycleStatus: mocks.readNewsSynthesisLifecycleStatus,
    removeNewsBundle: mocks.removeNewsBundle,
    writeNewsBundle: mocks.writeNewsBundle,
    writeNewsIngestionLease: mocks.writeNewsIngestionLease,
    writeNewsSynthesisLifecycleStatus: mocks.writeNewsSynthesisLifecycleStatus,
  };
});

vi.mock('@vh/gun-client/node', () => ({
  createNodeMeshClient: mocks.createNodeMeshClient,
}));

import {
  __internal,
  startNewsAggregatorDaemonFromEnv,
} from './daemon';

function primeHealthyEnv(): void {
  vi.stubEnv('VH_STORYCLUSTER_REMOTE_URL', 'https://storycluster.example.com/cluster');
  vi.stubEnv('VH_STORYCLUSTER_REMOTE_AUTH_TOKEN', 'token-123');
}

describe('news daemon production wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();

    mocks.startNewsRuntime.mockReturnValue({
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    });

    mocks.readNewsIngestionLease.mockResolvedValue(null);
    mocks.readNewsSynthesisLifecycleStatus.mockResolvedValue(null);
    mocks.removeNewsBundle.mockResolvedValue(undefined);
    mocks.writeNewsIngestionLease.mockImplementation(async (_client: unknown, lease: unknown) => lease);
    mocks.writeNewsBundle.mockImplementation(async (_client: unknown, bundle: unknown) => bundle);
    mocks.writeNewsSynthesisLifecycleStatus.mockImplementation(async (_client: unknown, record: unknown) => record);
    mocks.createNodeMeshClient.mockReturnValue({
      id: 'mock-client',
      shutdown: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('requires production StoryCluster endpoint + auth token', () => {
    expect(() => __internal.parseStoryClusterRemoteConfig()).toThrow(
      'storycluster remote endpoint is required',
    );

    vi.stubEnv('VH_STORYCLUSTER_REMOTE_URL', 'https://storycluster.example.com/cluster');
    expect(() => __internal.parseStoryClusterRemoteConfig()).toThrow(
      'storycluster auth token is required',
    );
  });

  it('derives StoryCluster health URL and auth headers', () => {
    primeHealthyEnv();

    const config = __internal.parseStoryClusterRemoteConfig();

    expect(config.endpointUrl).toBe('https://storycluster.example.com/cluster');
    expect(config.healthUrl).toBe('https://storycluster.example.com/health');
    expect(config.headers).toEqual({
      authorization: 'Bearer token-123',
    });
    expect(config.timeoutMs).toBe(90000);
  });

  it('verifies StoryCluster health and normalizes timeout failures', async () => {
    await expect(
      __internal.verifyStoryClusterHealth({
        healthUrl: 'https://storycluster.example.com/health',
        headers: { authorization: 'Bearer token-123' },
        timeoutMs: 100,
        fetchFn: vi.fn(async () => new Response('down', { status: 503 })),
      }),
    ).rejects.toThrow('storycluster health check failed: HTTP 503');

    const timeoutFetch = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      }),
    );

    await expect(
      __internal.verifyStoryClusterHealth({
        healthUrl: 'https://storycluster.example.com/health',
        headers: { authorization: 'Bearer token-123' },
        timeoutMs: 1,
        fetchFn: timeoutFetch,
      }),
    ).rejects.toThrow('storycluster health check timed out after 1ms');
  });

  it('fails closed before daemon startup when StoryCluster health is red', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));

    await expect(startNewsAggregatorDaemonFromEnv()).rejects.toThrow(
      'storycluster health check failed: HTTP 503',
    );

    expect(mocks.createNodeMeshClient).not.toHaveBeenCalled();
    expect(mocks.startNewsRuntime).not.toHaveBeenCalled();
  });

  it('wires production no-fallback orchestrator settings on daemon startup', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      expect(mocks.createNodeMeshClient).toHaveBeenCalledTimes(1);
      expect(mocks.startNewsRuntime).toHaveBeenCalledTimes(1);

      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        orchestratorOptions?: Record<string, unknown>;
      };

      expect(runtimeConfig.orchestratorOptions).toMatchObject({
        productionMode: true,
        allowHeuristicFallback: false,
        remoteClusterEndpoint: 'https://storycluster.example.com/cluster',
        remoteClusterTimeoutMs: 90000,
        remoteClusterHeaders: {
          authorization: 'Bearer token-123',
        },
      });
    } finally {
      await handle.stop();
    }
  });

  it('publishes raw stories to product indexes before synthesis readiness and records pending lifecycle', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        writeStoryBundle?: (client: unknown, bundle: unknown) => Promise<unknown>;
      };
      const bundle = {
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-raw',
        topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
        headline: 'Raw story',
        cluster_window_start: 100,
        cluster_window_end: 123,
        sources: [{
          source_id: 'src-1',
          publisher: 'Publisher',
          url: 'https://example.com/raw',
          url_hash: 'hash-raw',
          title: 'Raw story',
        }],
        cluster_features: {
          entity_keys: ['raw'],
          time_bucket: '2026-05-30T12',
          semantic_signature: 'sig-raw',
        },
        provenance_hash: 'prov-raw',
        created_at: 100,
      };

      await expect(runtimeConfig.writeStoryBundle?.({ id: 'mock-client' }, bundle)).resolves.toEqual(bundle);

      expect(mocks.writeNewsBundle).toHaveBeenCalledWith({ id: 'mock-client' }, bundle);
      expect(mocks.readNewsSynthesisLifecycleStatus).toHaveBeenCalledWith({ id: 'mock-client' }, 'story-raw');
      expect(mocks.writeNewsSynthesisLifecycleStatus).toHaveBeenCalledWith(
        { id: 'mock-client' },
        expect.objectContaining({
          schemaVersion: 'vh-news-synthesis-lifecycle-v1',
          story_id: 'story-raw',
          source_set_revision: 'prov-raw',
          status: 'pending',
          frame_table_state: 'frame_table_pending',
        }),
      );
    } finally {
      await handle.stop();
    }
  });

  it('does not downgrade accepted synthesis lifecycle when republishing an unchanged source set', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    mocks.readNewsSynthesisLifecycleStatus.mockResolvedValue({
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: 'story-accepted',
      topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
      source_set_revision: 'prov-accepted',
      source_count: 1,
      canonical_source_count: 1,
      status: 'accepted_available',
      retryable: false,
      synthesis_id: 'synthesis-accepted',
      epoch: 3,
      frame_table_state: 'frame_table_ready',
      updated_at: 456,
    });

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        writeStoryBundle?: (client: unknown, bundle: unknown) => Promise<unknown>;
      };
      const bundle = {
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-accepted',
        topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
        headline: 'Accepted story',
        cluster_window_start: 100,
        cluster_window_end: 123,
        sources: [{
          source_id: 'src-1',
          publisher: 'Publisher',
          url: 'https://example.com/accepted',
          url_hash: 'hash-accepted',
          title: 'Accepted story',
        }],
        cluster_features: {
          entity_keys: ['accepted'],
          time_bucket: '2026-05-30T12',
          semantic_signature: 'sig-accepted',
        },
        provenance_hash: 'prov-accepted',
        created_at: 100,
      };

      await expect(runtimeConfig.writeStoryBundle?.({ id: 'mock-client' }, bundle)).resolves.toEqual(bundle);

      expect(mocks.writeNewsBundle).toHaveBeenCalledWith({ id: 'mock-client' }, bundle);
      expect(mocks.writeNewsSynthesisLifecycleStatus).not.toHaveBeenCalled();
    } finally {
      await handle.stop();
    }
  });

  it('resets lifecycle to pending when the story source-set revision changes', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    mocks.readNewsSynthesisLifecycleStatus.mockResolvedValue({
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: 'story-grown',
      topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
      source_set_revision: 'prov-old',
      source_count: 1,
      canonical_source_count: 1,
      status: 'accepted_available',
      retryable: false,
      synthesis_id: 'synthesis-old',
      epoch: 1,
      frame_table_state: 'frame_table_ready',
      updated_at: 456,
    });

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        writeStoryBundle?: (client: unknown, bundle: unknown) => Promise<unknown>;
      };
      const bundle = {
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-grown',
        topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
        headline: 'Grown story',
        cluster_window_start: 100,
        cluster_window_end: 200,
        sources: [
          {
            source_id: 'src-1',
            publisher: 'Publisher One',
            url: 'https://example.com/grown-a',
            url_hash: 'hash-grown-a',
            title: 'Grown story',
          },
          {
            source_id: 'src-2',
            publisher: 'Publisher Two',
            url: 'https://example.org/grown-b',
            url_hash: 'hash-grown-b',
            title: 'Grown story',
          },
        ],
        cluster_features: {
          entity_keys: ['grown'],
          time_bucket: '2026-05-30T12',
          semantic_signature: 'sig-grown',
        },
        provenance_hash: 'prov-new',
        created_at: 100,
      };

      await expect(runtimeConfig.writeStoryBundle?.({ id: 'mock-client' }, bundle)).resolves.toEqual(bundle);

      expect(mocks.writeNewsSynthesisLifecycleStatus).toHaveBeenCalledWith(
        { id: 'mock-client' },
        expect.objectContaining({
          story_id: 'story-grown',
          source_set_revision: 'prov-new',
          source_count: 2,
          status: 'pending',
          frame_table_state: 'frame_table_pending',
        }),
      );
    } finally {
      await handle.stop();
    }
  });

  it('passes configured Gun peers to client factory', async () => {
    primeHealthyEnv();
    vi.stubEnv('VH_GUN_PEERS', 'https://peer-a.example/gun, https://peer-b.example/gun');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      expect(mocks.createNodeMeshClient).toHaveBeenCalledWith({
        peers: ['https://peer-a.example/gun', 'https://peer-b.example/gun'],
        requireSession: false,
        gunRadisk: true,
        gunFile: expect.any(String),
      });
    } finally {
      await handle.stop();
    }
  });
});
