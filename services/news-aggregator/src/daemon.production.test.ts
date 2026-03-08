import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startNewsRuntime: vi.fn(),
  createNodeMeshClient: vi.fn(),
  readNewsIngestionLease: vi.fn(),
  removeNewsBundle: vi.fn(),
  writeNewsIngestionLease: vi.fn(),
  writeStoryBundle: vi.fn(),
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
    createNodeMeshClient: mocks.createNodeMeshClient,
    readNewsIngestionLease: mocks.readNewsIngestionLease,
    removeNewsBundle: mocks.removeNewsBundle,
    writeNewsIngestionLease: mocks.writeNewsIngestionLease,
    writeStoryBundle: mocks.writeStoryBundle,
  };
});

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
    mocks.removeNewsBundle.mockResolvedValue(undefined);
    mocks.writeNewsIngestionLease.mockImplementation(async (_client: unknown, lease: unknown) => lease);
    mocks.writeStoryBundle.mockResolvedValue(undefined);
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

  it('passes configured Gun peers to client factory', async () => {
    primeHealthyEnv();
    vi.stubEnv('VH_GUN_PEERS', 'https://peer-a.example/gun, https://peer-b.example/gun');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      expect(mocks.createNodeMeshClient).toHaveBeenCalledWith({
        peers: ['https://peer-a.example/gun', 'https://peer-b.example/gun'],
        requireSession: false,
      });
    } finally {
      await handle.stop();
    }
  });
});
