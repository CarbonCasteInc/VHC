import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AutoEngine,
  HeuristicClusterEngine,
  StoryClusterRemoteEngine,
  clusterEngineInternal,
  readStoryClusterRemoteEndpoint,
  runClusterBatch,
  runClusterBatchSync,
  type StoryClusterBatchInput,
} from '../clusterEngine';
import type { NormalizedItem, StoryBundle } from '../newsTypes';

const BASE_TIME = 1_700_000_000_000;

function sampleItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceId: 'source-1',
    publisher: 'Source 1',
    url: 'https://example.com/news-1',
    canonicalUrl: 'https://example.com/news-1',
    title: 'Climate Summit Update',
    publishedAt: BASE_TIME,
    summary: 'Summary',
    author: 'Reporter',
    url_hash: 'abcd1234',
    entity_keys: ['climate', 'summit'],
    ...overrides,
  };
}

function sampleBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1234abcd',
    topic_id: 'topic-climate',
    headline: 'Climate Summit Update',
    summary_hint: 'Summary',
    cluster_window_start: BASE_TIME,
    cluster_window_end: BASE_TIME,
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Source 1',
        url: 'https://example.com/news-1',
        url_hash: 'abcd1234',
        published_at: BASE_TIME,
        title: 'Climate Summit Update',
      },
    ],
    cluster_features: {
      entity_keys: ['climate'],
      time_bucket: '2023-11-14T22',
      semantic_signature: '1234abcd',
    },
    provenance_hash: 'abcd1234',
    created_at: BASE_TIME,
    ...overrides,
  };
}

function input(topicId = 'topic-climate'): StoryClusterBatchInput {
  return {
    topicId,
    items: [sampleItem()],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('clusterEngine', () => {
  it('runClusterBatch supports sync and async engines', async () => {
    const syncEngine = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      () => [sampleBundle()],
      'sync-engine',
    );
    const asyncEngine = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      async () => [sampleBundle({ story_id: 'story-async' })],
      'async-engine',
    );

    expect(await runClusterBatch(syncEngine, input())).toHaveLength(1);
    expect(await runClusterBatch(asyncEngine, input())).toEqual([
      sampleBundle({ story_id: 'story-async' }),
    ]);
  });

  it('runClusterBatchSync rejects async engines', () => {
    const asyncEngine = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      async () => [sampleBundle()],
      'async-engine',
    );

    expect(() => runClusterBatchSync(asyncEngine, input())).toThrow(
      'cannot be used in a sync path',
    );
  });

  it('runClusterBatchSync returns sync-engine results', () => {
    const syncEngine = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      () => [sampleBundle({ story_id: 'story-sync-return' })],
      'sync-engine',
    );

    expect(runClusterBatchSync(syncEngine, input())).toEqual([
      sampleBundle({ story_id: 'story-sync-return' }),
    ]);
  });

  it('StoryClusterRemoteEngine posts topic_id/items and parses array payloads', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify([sampleBundle({ story_id: 'story-remote' })]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const engine = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
      fetchFn,
      headers: { authorization: 'Bearer token' },
      timeoutMs: 5000,
    });

    const result = await runClusterBatch(engine, input());

    expect(result).toEqual([sampleBundle({ story_id: 'story-remote' })]);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://storycluster.example.com/cluster');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer token',
    });

    const body = JSON.parse(init?.body as string);
    expect(body.topic_id).toBe('topic-climate');
    expect(body.items).toHaveLength(1);
  });

  it('StoryClusterRemoteEngine parses object payloads with bundles[]', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ bundles: [sampleBundle({ story_id: 'story-remote-object' })] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const engine = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
      fetchFn,
    });

    const result = await runClusterBatch(engine, input());
    expect(result[0]?.story_id).toBe('story-remote-object');
  });

  it('StoryClusterRemoteEngine uses global fetch when fetchFn is not provided', async () => {
    const globalFetch = vi.fn(async () =>
      new Response(JSON.stringify({ bundles: [sampleBundle({ story_id: 'story-global-fetch' })] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    vi.stubGlobal('fetch', globalFetch);

    const engine = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
    });

    const result = await runClusterBatch(engine, input());
    expect(result[0]?.story_id).toBe('story-global-fetch');
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it('StoryClusterRemoteEngine rejects construction when no fetch implementation exists', () => {
    vi.stubGlobal('fetch', undefined as unknown as typeof fetch);

    expect(
      () =>
        new StoryClusterRemoteEngine({
          endpointUrl: 'https://storycluster.example.com/cluster',
        }),
    ).toThrow('fetch API is unavailable; provide fetchFn');
  });

  it('StoryClusterRemoteEngine throws on non-2xx and invalid payloads', async () => {
    const http500 = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
      fetchFn: vi.fn(async () => new Response('nope', { status: 500 })),
    });

    await expect(runClusterBatch(http500, input())).rejects.toThrow('HTTP 500 - nope');

    const http400 = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
      fetchFn: vi.fn(async () =>
        new Response(JSON.stringify({ error: 'invalid normalized item' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })),
    });

    await expect(runClusterBatch(http400, input())).rejects.toThrow(
      'HTTP 400 - {"error":"invalid normalized item"}',
    );

    const badPayload = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
      fetchFn: vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    });

    await expect(runClusterBatch(badPayload, input())).rejects.toThrow(
      'must be an array or an object with bundles[]',
    );

    const nonErrorThrow = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
      fetchFn: vi.fn(async () => {
        throw 'boom';
      }),
    });

    await expect(runClusterBatch(nonErrorThrow, input())).rejects.toBe('boom');
  });

  it('StoryClusterRemoteEngine normalizes timeout-driven abort errors and validates topic input', async () => {
    const fetchFn = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      }),
    );

    const timeoutEngine = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
      fetchFn,
      timeoutMs: 1,
    });

    await expect(runClusterBatch(timeoutEngine, input())).rejects.toThrow('timed out after 1ms');

    await expect(runClusterBatch(timeoutEngine, input('   '))).rejects.toThrow('topicId must be non-empty');
  });

  it('StoryClusterRemoteEngine emits remote request trace logs when VH_STORYCLUSTER_TRACE is enabled', async () => {
    vi.stubEnv('VH_STORYCLUSTER_TRACE', '1');
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const engine = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
      fetchFn: vi.fn(async () =>
        new Response(JSON.stringify({ bundles: [sampleBundle({ story_id: 'story-traced' })], storylines: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
    });

    const result = await runClusterBatch(engine, input('topic-trace'));

    expect(result[0]?.story_id).toBe('story-traced');
    expect(consoleInfo).toHaveBeenCalledWith(
      '[vh:storycluster-remote] request_started',
      expect.objectContaining({
        topic_id: 'topic-trace',
        item_count: 1,
      }),
    );
    expect(consoleInfo).toHaveBeenCalledWith(
      '[vh:storycluster-remote] request_completed',
      expect.objectContaining({
        topic_id: 'topic-trace',
        item_count: 1,
        bundle_count: 1,
      }),
    );
  });

  it('AutoEngine uses heuristic when remote is absent or disabled', async () => {
    const heuristic = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      () => [sampleBundle({ story_id: 'story-heuristic' })],
      'heuristic',
    );

    const noRemote = new AutoEngine({ heuristic });
    const localOnly = new AutoEngine({ heuristic, preferRemote: false, remote: heuristic });

    expect(await runClusterBatch(noRemote, input())).toEqual([
      sampleBundle({ story_id: 'story-heuristic' }),
    ]);
    expect(await runClusterBatch(localOnly, input())).toEqual([
      sampleBundle({ story_id: 'story-heuristic' }),
    ]);
  });

  it('AutoEngine returns remote sync results without invoking heuristic fallback', async () => {
    const heuristic = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      () => [sampleBundle({ story_id: 'story-heuristic-unused' })],
      'heuristic',
    );

    const remote = {
      engineId: 'remote-sync',
      clusterBatch: vi.fn(() => [sampleBundle({ story_id: 'story-remote-sync' })]),
    };

    const engine = new AutoEngine<StoryClusterBatchInput, StoryBundle>({
      heuristic,
      remote,
    });

    const result = await runClusterBatch(engine, input());
    expect(result[0]?.story_id).toBe('story-remote-sync');
    expect(remote.clusterBatch).toHaveBeenCalledTimes(1);
  });

  it('AutoEngine prefers remote and falls back deterministically on async failures', async () => {
    const fallbackSpy = vi.fn();
    const heuristic = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      () => [sampleBundle({ story_id: 'story-fallback' })],
      'heuristic',
    );
    const remote = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      async () => {
        throw new Error('remote down');
      },
      'remote',
    );

    const engine = new AutoEngine({
      heuristic,
      remote,
      onRemoteFailure: fallbackSpy,
    });

    const first = await runClusterBatch(engine, input());
    const second = await runClusterBatch(engine, input());

    expect(first).toEqual(second);
    expect(first[0]?.story_id).toBe('story-fallback');
    expect(fallbackSpy).toHaveBeenCalledTimes(2);
  });

  it('AutoEngine falls back when remote throws synchronously', async () => {
    const heuristic = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      () => [sampleBundle({ story_id: 'story-sync-fallback' })],
      'heuristic',
    );

    const syncThrowRemote = {
      engineId: 'remote-sync-throw',
      clusterBatch() {
        throw new Error('boom');
      },
    };

    const engine = new AutoEngine<StoryClusterBatchInput, StoryBundle>({
      heuristic,
      remote: syncThrowRemote,
    });

    const result = await runClusterBatch(engine, input());
    expect(result[0]?.story_id).toBe('story-sync-fallback');
  });

  it('readStoryClusterRemoteEndpoint resolves known env vars', () => {
    expect(readStoryClusterRemoteEndpoint()).toBeUndefined();

    vi.stubEnv('VH_STORYCLUSTER_REMOTE_URL', 'https://vh.example.com');
    expect(readStoryClusterRemoteEndpoint()).toBe('https://vh.example.com');

    vi.stubEnv('VH_STORYCLUSTER_REMOTE_URL', '');
    vi.stubEnv('STORYCLUSTER_REMOTE_URL', 'https://story.example.com');
    expect(readStoryClusterRemoteEndpoint()).toBe('https://story.example.com');

    vi.stubGlobal('process', undefined as unknown as NodeJS.Process);
    expect(readStoryClusterRemoteEndpoint()).toBeUndefined();
  });

  it('internal guards validate timeout and payload helpers', () => {
    expect(clusterEngineInternal.normalizeRemoteTimeoutMs(undefined)).toBe(90000);
    expect(clusterEngineInternal.normalizeRemoteTimeoutMs(1500.9)).toBe(1500);
    expect(() => clusterEngineInternal.normalizeRemoteTimeoutMs(0)).toThrow(
      'timeoutMs must be a positive finite number',
    );

    expect(
      clusterEngineInternal.parseRemoteBundles([sampleBundle({ story_id: 'story-array-parse' })]),
    ).toHaveLength(1);

    expect(() => clusterEngineInternal.parseRemoteBundles({ nope: true })).toThrow(
      'must be an array or an object with bundles[]',
    );

    expect(
      clusterEngineInternal.normalizeStoryClusterInput({ topicId: ' topic ', items: [sampleItem()] })
        .topicId,
    ).toBe('topic');
  });

  it('describeRemoteFailure truncates oversized response bodies', async () => {
    const body = 'x'.repeat(520);
    const response = new Response(body, { status: 502 });
    await expect(clusterEngineInternal.describeRemoteFailure(response)).resolves.toBe(
      `remote cluster request failed: HTTP 502 - ${'x'.repeat(500)}...`,
    );
  });

  it('describeRemoteFailure falls back to status-only output for empty bodies', async () => {
    const response = new Response('', { status: 503 });
    await expect(clusterEngineInternal.describeRemoteFailure(response)).resolves.toBe(
      'remote cluster request failed: HTTP 503',
    );
  });

  it('remote engine constructor validates required inputs', () => {
    expect(
      () =>
        new StoryClusterRemoteEngine({
          endpointUrl: '   ',
          fetchFn: vi.fn(),
        }),
    ).toThrow('endpointUrl must be non-empty');
  });
});
