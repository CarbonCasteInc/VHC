import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedSource, NewsRuntimeConfig, TopicMapping } from '@vh/ai-engine';
import type { NewsIngestionLease } from '@vh/gun-client';

const FEED_SOURCES: FeedSource[] = [
  {
    id: 'source-1',
    name: 'Source 1',
    rssUrl: 'https://example.com/feed.xml',
    enabled: true,
  },
];

const TOPIC_MAPPING: TopicMapping = {
  defaultTopicId: 'topic-news',
  sourceTopics: {},
};

function makeLease(overrides: Partial<NewsIngestionLease> = {}): NewsIngestionLease {
  const now = 1_700_000_000_000;
  return {
    holder_id: 'vh-news-daemon:test',
    lease_token: 'lease-token-1',
    acquired_at: now,
    heartbeat_at: now,
    expires_at: now + 60_000,
    ...overrides,
  };
}

async function loadSubject(options: {
  env: Record<string, string | null | undefined>;
  gunPeers: string[];
  pollIntervalMs: number | undefined;
  leaseTtlMs: number;
}) {
  vi.resetModules();

  const runtimeHandle = {
    stop: vi.fn(),
    isRunning: vi.fn(() => true),
    lastRun: vi.fn(() => null),
  };
  const startNewsRuntime = vi.fn(() => runtimeHandle);
  const createNodeMeshClient = vi.fn(() => ({
    shutdown: vi.fn().mockResolvedValue(undefined),
  }));
  const readNewsIngestionLease = vi.fn().mockResolvedValue(null);
  const writeNewsIngestionLease = vi.fn().mockResolvedValue(makeLease());
  const verifyStoryClusterHealth = vi.fn().mockResolvedValue(undefined);
  const createBundleSynthesisWorker = vi.fn(() => vi.fn());

  vi.doMock('@vh/ai-engine', async () => {
    const actual = await vi.importActual<typeof import('@vh/ai-engine')>('@vh/ai-engine');
    return {
      ...actual,
      startNewsRuntime,
    };
  });

  vi.doMock('@vh/gun-client', async () => {
    const actual = await vi.importActual<typeof import('@vh/gun-client')>('@vh/gun-client');
    return {
      ...actual,
      createNodeMeshClient,
      readNewsIngestionLease,
      writeNewsIngestionLease,
    };
  });

  vi.doMock('./daemonUtils', async () => {
    const actual = await vi.importActual<typeof import('./daemonUtils')>('./daemonUtils');
    return {
      ...actual,
      parseFeedSources: vi.fn(() => FEED_SOURCES),
      resolveFeedSourceConfig: vi.fn(() => ({
        feedSources: FEED_SOURCES,
        sourceHealth: {
          reportSource: null,
          reportPath: null,
          report: null,
          summary: null,
        },
      })),
      parseTopicMapping: vi.fn(() => TOPIC_MAPPING),
      parseOptionalPositiveInt: vi.fn(() => options.pollIntervalMs),
      parsePositiveInt: vi.fn(() => options.leaseTtlMs),
      parseStoryClusterRemoteConfig: vi.fn(() => ({
        endpointUrl: 'http://127.0.0.1:4310/cluster',
        healthUrl: 'http://127.0.0.1:4310/ready',
        timeoutMs: 12_000,
        maxItemsPerRequest: 8,
        headers: { authorization: 'Bearer test' },
      })),
      parseGunPeers: vi.fn(() => options.gunPeers),
      readEnvVar: vi.fn((key: string) => options.env[key] ?? null),
      verifyStoryClusterHealth,
    };
  });

  vi.doMock('./bundleSynthesisWorker', () => ({
    createBundleSynthesisWorker,
  }));

  vi.doMock('./bundleSynthesisRelay', () => ({
    getBundleSynthesisMaxTokens: vi.fn(() => 1200),
    getBundleSynthesisModel: vi.fn(() => 'gpt-4o-mini'),
    getBundleSynthesisTimeoutMs: vi.fn(() => 20_000),
    postBundleSynthesisCompletion: vi.fn(),
  }));

  const subject = await import('./daemon');
  return {
    subject,
    startNewsRuntime,
    createNodeMeshClient,
    createBundleSynthesisWorker,
    verifyStoryClusterHealth,
    runtimeHandle,
  };
}

describe('startNewsAggregatorDaemonFromEnv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('starts with explicit peers and primary lease ttl env', async () => {
    const {
      subject,
      startNewsRuntime,
      createNodeMeshClient,
      verifyStoryClusterHealth,
    } = await loadSubject({
      env: {
        VITE_NEWS_FEED_SOURCES: '[]',
        VITE_NEWS_TOPIC_MAPPING: '{}',
        VITE_NEWS_POLL_INTERVAL_MS: '5000',
        VH_NEWS_RUNTIME_LEASE_TTL_MS: '45000',
        VH_GUN_PEERS: 'http://127.0.0.1:7777/gun',
        VH_NEWS_DAEMON_HOLDER_ID: 'vh-news-daemon:test',
      },
      gunPeers: ['http://127.0.0.1:7777/gun'],
      pollIntervalMs: 5000,
      leaseTtlMs: 45_000,
    });

    const processHandle = await subject.startNewsAggregatorDaemonFromEnv();

    expect(verifyStoryClusterHealth).toHaveBeenCalledWith({
      healthUrl: 'http://127.0.0.1:4310/ready',
      headers: { authorization: 'Bearer test' },
      timeoutMs: 12_000,
    });
    expect(createNodeMeshClient).toHaveBeenCalledWith({
      peers: ['http://127.0.0.1:7777/gun'],
      requireSession: false,
    });
    expect(startNewsRuntime).toHaveBeenCalledWith(
      expect.objectContaining<Partial<NewsRuntimeConfig>>({
        enabled: true,
        feedSources: FEED_SOURCES,
        topicMapping: TOPIC_MAPPING,
        pollIntervalMs: 5000,
        orchestratorOptions: expect.objectContaining({
          productionMode: true,
          allowHeuristicFallback: false,
          remoteClusterEndpoint: 'http://127.0.0.1:4310/cluster',
          remoteClusterTimeoutMs: 12_000,
          remoteClusterMaxItemsPerRequest: 8,
        }),
      }),
    );

    await processHandle.stop();
  });

  it('starts with fallback lease ttl env and omits peers when none are configured', async () => {
    const {
      subject,
      startNewsRuntime,
      createNodeMeshClient,
    } = await loadSubject({
      env: {
        VITE_NEWS_FEED_SOURCES: '[]',
        VITE_NEWS_TOPIC_MAPPING: '{}',
        VITE_NEWS_POLL_INTERVAL_MS: null,
        VH_NEWS_RUNTIME_LEASE_TTL_MS: null,
        VITE_NEWS_RUNTIME_LEASE_TTL_MS: '60000',
        VH_GUN_PEERS: null,
        VITE_GUN_PEERS: null,
        VH_NEWS_DAEMON_HOLDER_ID: null,
      },
      gunPeers: [],
      pollIntervalMs: undefined,
      leaseTtlMs: 60_000,
    });

    const processHandle = await subject.startNewsAggregatorDaemonFromEnv();

    expect(createNodeMeshClient).toHaveBeenCalledWith({
      peers: undefined,
      requireSession: false,
    });
    expect(startNewsRuntime).toHaveBeenCalledWith(
      expect.objectContaining<Partial<NewsRuntimeConfig>>({
        pollIntervalMs: undefined,
      }),
    );

    await processHandle.stop();
  });

  it('wires bundle synthesis worker only when enabled and keyed', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const {
      subject,
      createBundleSynthesisWorker,
    } = await loadSubject({
      env: {
        VITE_NEWS_FEED_SOURCES: '[]',
        VITE_NEWS_TOPIC_MAPPING: '{}',
        VH_BUNDLE_SYNTHESIS_ENABLED: 'true',
        VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH: '32',
      },
      gunPeers: [],
      pollIntervalMs: undefined,
      leaseTtlMs: 60_000,
    });

    const processHandle = await subject.startNewsAggregatorDaemonFromEnv();

    expect(createBundleSynthesisWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'gpt-4o-mini',
        pipelineVersion: 'news-bundle-v1',
      }),
    );

    await processHandle.stop();
  });

  it('fails startup when bundle synthesis is enabled without an OpenAI key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const { subject, createBundleSynthesisWorker } = await loadSubject({
      env: {
        VITE_NEWS_FEED_SOURCES: '[]',
        VITE_NEWS_TOPIC_MAPPING: '{}',
        VH_BUNDLE_SYNTHESIS_ENABLED: 'true',
      },
      gunPeers: [],
      pollIntervalMs: undefined,
      leaseTtlMs: 60_000,
    });

    await expect(subject.startNewsAggregatorDaemonFromEnv()).rejects.toThrow(
      'OPENAI_API_KEY is required',
    );
    expect(createBundleSynthesisWorker).not.toHaveBeenCalled();
  });
});
