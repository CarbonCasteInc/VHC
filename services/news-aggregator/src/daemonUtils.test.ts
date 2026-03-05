import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';
import {
  buildLeasePayload,
  createAsyncEnrichmentQueue,
  deriveStoryClusterHealthUrl,
  parseFeedSources,
  parseGunPeers,
  parseOptionalPositiveInt,
  parsePositiveInt,
  parseStoryClusterRemoteConfig,
  parseTopicMapping,
  resolveLeaseHolderId,
  verifyStoryClusterHealth,
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_TOPIC_MAPPING,
} from './daemonUtils';

const CANDIDATE = {
  story_id: 'story-1',
  provider: {
    provider_id: 'remote-analysis',
    model_id: 'gpt-5-nano',
    kind: 'remote',
  },
  request: {
    prompt: 'Summary',
    model: 'gpt-5-nano',
    max_tokens: 2048,
    temperature: 0.1,
  },
  work_items: [
    {
      story_id: 'story-1',
      topic_id: 'topic-news',
      work_type: 'full-analysis',
      summary_hint: 'Summary',
      requested_at: 1700000000000,
    },
  ],
} satisfies NewsRuntimeSynthesisCandidate;

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

describe('daemonUtils', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('handles queue drain edge-cases and worker failures', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const worker = vi.fn(async (candidate: NewsRuntimeSynthesisCandidate) => {
      if (candidate.story_id === 'story-throw') {
        throw new Error('worker failed');
      }
    });

    const queue = createAsyncEnrichmentQueue(worker, logger);

    queue.enqueue(undefined as unknown as NewsRuntimeSynthesisCandidate);
    queue.enqueue({ ...CANDIDATE, story_id: 'story-throw' });
    queue.enqueue({ ...CANDIDATE, story_id: 'story-2' });

    await flushMicrotasks();
    await flushMicrotasks();

    expect(worker).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] enrichment worker failed',
      expect.any(Error),
    );

    queue.stop();
    queue.enqueue({ ...CANDIDATE, story_id: 'story-after-stop' });
    await flushMicrotasks();

    expect(queue.size()).toBe(0);
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it('returns early when queue is stopped before scheduled drain executes', async () => {
    const worker = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const queue = createAsyncEnrichmentQueue(worker, logger);
    queue.enqueue(CANDIDATE);
    queue.stop();

    await flushMicrotasks();

    expect(worker).not.toHaveBeenCalled();
  });

  it('derives StoryCluster health URLs across pathname shapes', () => {
    expect(deriveStoryClusterHealthUrl('https://storycluster.example.com')).toBe(
      'https://storycluster.example.com/health',
    );

    expect(deriveStoryClusterHealthUrl('https://storycluster.example.com/cluster')).toBe(
      'https://storycluster.example.com/health',
    );

    expect(deriveStoryClusterHealthUrl('https://storycluster.example.com/api/v1/')).toBe(
      'https://storycluster.example.com/api/v1/health',
    );
  });

  it('parses StoryCluster config from env with fallback + overrides', () => {
    vi.stubEnv('VH_STORYCLUSTER_REMOTE_URL', '   ');
    vi.stubEnv('STORYCLUSTER_REMOTE_URL', 'https://storycluster.example.com/cluster');
    vi.stubEnv('STORYCLUSTER_REMOTE_AUTH_TOKEN', 'token-abc');
    vi.stubEnv('VH_STORYCLUSTER_REMOTE_AUTH_HEADER', 'x-auth');
    vi.stubEnv('VH_STORYCLUSTER_REMOTE_AUTH_SCHEME', 'Token');
    vi.stubEnv('VH_STORYCLUSTER_REMOTE_TIMEOUT_MS', '9300');
    vi.stubEnv('VH_STORYCLUSTER_REMOTE_HEALTH_URL', 'https://storycluster.example.com/status');

    const parsed = parseStoryClusterRemoteConfig();

    expect(parsed).toEqual({
      endpointUrl: 'https://storycluster.example.com/cluster',
      healthUrl: 'https://storycluster.example.com/status',
      timeoutMs: 9300,
      headers: {
        'x-auth': 'Token token-abc',
      },
    });
  });

  it('fails fast when endpoint/token env wiring is missing', () => {
    expect(() => parseStoryClusterRemoteConfig()).toThrow(
      'storycluster remote endpoint is required',
    );

    vi.stubEnv('VITE_STORYCLUSTER_REMOTE_URL', 'https://storycluster.example.com/cluster');
    expect(() => parseStoryClusterRemoteConfig()).toThrow('storycluster auth token is required');
  });

  it('verifies StoryCluster health across fetch branches', async () => {
    const successFetch = vi.fn(async () => new Response('ok', { status: 200 }));

    await expect(
      verifyStoryClusterHealth({
        healthUrl: 'https://storycluster.example.com/health',
        headers: { authorization: 'Bearer token' },
        timeoutMs: 100,
        fetchFn: successFetch,
      }),
    ).resolves.toBeUndefined();

    await expect(
      verifyStoryClusterHealth({
        healthUrl: 'https://storycluster.example.com/health',
        headers: { authorization: 'Bearer token' },
        timeoutMs: 100,
        fetchFn: vi.fn(async () => new Response('down', { status: 500 })),
      }),
    ).rejects.toThrow('storycluster health check failed: HTTP 500');

    const abortFetch = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
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
      verifyStoryClusterHealth({
        healthUrl: 'https://storycluster.example.com/health',
        headers: { authorization: 'Bearer token' },
        timeoutMs: 1,
        fetchFn: abortFetch,
      }),
    ).rejects.toThrow('storycluster health check timed out after 1ms');

    vi.stubGlobal('fetch', undefined as unknown as typeof fetch);
    await expect(
      verifyStoryClusterHealth({
        healthUrl: 'https://storycluster.example.com/health',
        headers: { authorization: 'Bearer token' },
        timeoutMs: 100,
      }),
    ).rejects.toThrow('fetch API is unavailable for storycluster health check');
  });

  it('parses positive integers with strict fallback semantics', () => {
    expect(parsePositiveInt(undefined, 15)).toBe(15);
    expect(parsePositiveInt('abc', 15)).toBe(15);
    expect(parsePositiveInt('0', 15)).toBe(15);
    expect(parsePositiveInt('-5', 15)).toBe(15);
    expect(parsePositiveInt('16.9', 15)).toBe(16);

    expect(parseOptionalPositiveInt(undefined)).toBeUndefined();
    expect(parseOptionalPositiveInt('abc')).toBeUndefined();
    expect(parseOptionalPositiveInt('-1')).toBeUndefined();
    expect(parseOptionalPositiveInt('0')).toBeUndefined();
    expect(parseOptionalPositiveInt('12.4')).toBe(12);
  });

  it('parses feeds/topic mapping/peers safely under malformed input', () => {
    expect(parseFeedSources(undefined).length).toBeGreaterThan(0);
    expect(parseFeedSources('oops').length).toBeGreaterThan(0);
    expect(parseFeedSources('{}').length).toBeGreaterThan(0);

    const parsedFeeds = parseFeedSources(
      JSON.stringify([
        {
          id: 'valid',
          name: 'Valid Source',
          rssUrl: 'https://example.com/rss.xml',
          enabled: true,
        },
        {
          id: '',
          name: 'Invalid Source',
          rssUrl: 'https://example.com/invalid.xml',
          enabled: true,
        },
      ]),
    );
    expect(parsedFeeds).toEqual([
      {
        id: 'valid',
        name: 'Valid Source',
        rssUrl: 'https://example.com/rss.xml',
        enabled: true,
      },
    ]);

    expect(parseTopicMapping(undefined)).toEqual(DEFAULT_TOPIC_MAPPING);
    expect(parseTopicMapping('not-json')).toEqual(DEFAULT_TOPIC_MAPPING);
    expect(parseTopicMapping('{"defaultTopicId":42}')).toEqual(DEFAULT_TOPIC_MAPPING);

    expect(parseGunPeers(undefined)).toEqual([]);
    expect(parseGunPeers('   ')).toEqual([]);
    expect(parseGunPeers('https://a.example/gun, https://b.example/gun')).toEqual([
      'https://a.example/gun',
      'https://b.example/gun',
    ]);
    expect(parseGunPeers('["https://json.example/gun"]')).toEqual(['https://json.example/gun']);
    expect(parseGunPeers('{"peer":"https://x.example/gun"}')).toEqual([
      '{"peer":"https://x.example/gun"}',
    ]);
    expect(parseGunPeers('[invalid-json')).toEqual([]);
  });

  it('resolves lease holder ids and lease payload transitions', () => {
    expect(resolveLeaseHolderId('  custom-holder  ')).toBe('custom-holder');

    vi.spyOn(os, 'hostname').mockReturnValue('host!@#name');
    expect(resolveLeaseHolderId(undefined)).toBe(`vh-news-daemon:host---name:${process.pid}`);

    vi.spyOn(os, 'hostname').mockReturnValue('');
    expect(resolveLeaseHolderId(undefined)).toBe(`vh-news-daemon:host:${process.pid}`);

    const existing = {
      holder_id: 'holder-1',
      lease_token: 'lease-1',
      acquired_at: 1000,
      heartbeat_at: 1000,
      expires_at: 1000 + DEFAULT_LEASE_TTL_MS,
    };

    expect(buildLeasePayload('holder-1', existing, 2000, DEFAULT_LEASE_TTL_MS, () => 0.5)).toEqual({
      ...existing,
      heartbeat_at: 2000,
      expires_at: 2000 + DEFAULT_LEASE_TTL_MS,
    });

    const fresh = buildLeasePayload('holder-2', existing, 3000, DEFAULT_LEASE_TTL_MS, () => 0.12345);
    expect(fresh.holder_id).toBe('holder-2');
    expect(fresh.lease_token.startsWith('holder-2:3000:')).toBe(true);
    expect(fresh.acquired_at).toBe(3000);
    expect(fresh.heartbeat_at).toBe(3000);
    expect(fresh.expires_at).toBe(3000 + DEFAULT_LEASE_TTL_MS);
  });
});
