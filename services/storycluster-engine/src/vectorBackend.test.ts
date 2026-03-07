import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredClusterRecord } from './stageState';
import {
  createQdrantVectorBackendFromEnv,
  MemoryVectorBackend,
  resolveVectorBackend,
  vectorBackendInternal,
} from './vectorBackend';

function makeCluster(storyId: string, vector: number[]): StoredClusterRecord {
  return {
    story_id: storyId,
    topic_key: 'topic-a',
    created_at: 100,
    updated_at: 100,
    cluster_window_start: 100,
    cluster_window_end: 100,
    headline: `${storyId} headline`,
    summary_hint: `${storyId} summary`,
    primary_language: 'en',
    translation_applied: false,
    semantic_signature: `${storyId}-sig`,
    entity_scores: { port_attack: 1 },
    location_scores: {},
    trigger_scores: { attack: 1 },
    document_type_counts: {
      analysis: 0,
      breaking_update: 1,
      explainer_recap: 0,
      hard_news: 0,
      liveblog: 0,
      opinion: 0,
      wire_report: 0,
    },
    centroid_coarse: [...vector, ...Array.from({ length: 192 - vector.length }, () => 0)],
    centroid_full: [...vector, ...Array.from({ length: 384 - vector.length }, () => 0)],
    source_documents: [],
    lineage: { merged_from: [] },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe.sequential('vector backend', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('queries the in-memory backend by cosine similarity', async () => {
    const backend = new MemoryVectorBackend();
    await backend.replaceTopicClusters('topic-a', [
      makeCluster('story-a', [1, 0, 0]),
      makeCluster('story-b', [0, 1, 0]),
    ]);

    const hits = await backend.queryTopic(
      'topic-a',
      [{ doc_id: 'doc-1', vector: [0.9, 0.1, 0] }],
      4,
    );

    expect(hits.get('doc-1')?.map((hit) => hit.story_id)).toEqual(['story-a', 'story-b']);
    await expect(
      backend.queryTopic('topic-missing', [{ doc_id: 'doc-2', vector: [1, 0, 0] }], 1),
    ).resolves.toEqual(new Map([['doc-2', []]]));
    expect((await backend.readiness()).ok).toBe(true);
  });

  it('resolves memory backend outside production and fails closed in production without qdrant', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(resolveVectorBackend()).toBeInstanceOf(MemoryVectorBackend);
    vi.stubEnv('VH_STORYCLUSTER_VECTOR_BACKEND', 'bogus');
    expect(() => resolveVectorBackend()).toThrow('unsupported storycluster vector backend: bogus');

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VH_STORYCLUSTER_QDRANT_URL', '');
    vi.stubEnv('QDRANT_URL', '');
    vi.stubEnv('VH_STORYCLUSTER_VECTOR_BACKEND', '');
    expect(() => resolveVectorBackend()).toThrow(
      'storycluster production requires VH_STORYCLUSTER_QDRANT_URL or QDRANT_URL',
    );

    vi.stubEnv('VH_STORYCLUSTER_VECTOR_BACKEND', 'memory');
    expect(() => resolveVectorBackend()).toThrow(
      'storycluster production requires qdrant vector backend, received memory',
    );
  });

  it('normalizes qdrant env values and rejects invalid timeout values', () => {
    vi.stubEnv('VH_STORYCLUSTER_QDRANT_URL', 'http://qdrant.local:6333/');
    expect(vectorBackendInternal.qdrantBaseUrlFromEnv()).toBe('http://qdrant.local:6333');
    expect(vectorBackendInternal.qdrantCollectionFromEnv()).toBe('storycluster_coarse_vectors');
    expect(vectorBackendInternal.qdrantApiKeyFromEnv()).toBeUndefined();
    expect(vectorBackendInternal.qdrantTimeoutFromEnv()).toBe(5_000);

    vi.stubEnv('VH_STORYCLUSTER_QDRANT_COLLECTION', 'storycluster-custom');
    expect(vectorBackendInternal.qdrantCollectionFromEnv()).toBe('storycluster-custom');

    vi.stubEnv('VH_STORYCLUSTER_QDRANT_API_KEY', '');
    vi.stubEnv('QDRANT_API_KEY', 'fallback-key');
    expect(vectorBackendInternal.qdrantApiKeyFromEnv()).toBe('fallback-key');

    vi.stubEnv('VH_STORYCLUSTER_QDRANT_TIMEOUT_MS', '4321');
    expect(vectorBackendInternal.qdrantTimeoutFromEnv()).toBe(4_321);

    vi.stubEnv('VH_STORYCLUSTER_QDRANT_TIMEOUT_MS', 'bad');
    expect(() => vectorBackendInternal.qdrantTimeoutFromEnv()).toThrow(
      'invalid VH_STORYCLUSTER_QDRANT_TIMEOUT_MS: bad',
    );
  });

  it('creates the qdrant collection, syncs topic clusters, and searches by topic filter', async () => {
    vi.stubEnv('VH_STORYCLUSTER_QDRANT_URL', 'http://qdrant.local:6333');
    vi.stubEnv('VH_STORYCLUSTER_QDRANT_API_KEY', 'key-123');
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/collections/storycluster_coarse_vectors') && init?.method === 'GET') {
        return new Response('', { status: 404 });
      }
      if (url.endsWith('/collections/storycluster_coarse_vectors') && init?.method === 'PUT') {
        return jsonResponse({ result: true });
      }
      if (url.endsWith('/points/delete') && init?.method === 'POST') {
        return jsonResponse({ result: { status: 'acknowledged' } });
      }
      if (url.endsWith('/points') && init?.method === 'PUT') {
        return jsonResponse({ result: { status: 'acknowledged' } });
      }
      if (url.endsWith('/points/search') && init?.method === 'POST') {
        expect(new Headers(init?.headers).get('api-key')).toBe('key-123');
        return jsonResponse({
          result: [
            { score: 0.98, payload: { story_id: 'story-a' } },
            { score: 0.42, payload: { story_id: 'story-b' } },
            { payload: { story_id: 'story-c' } },
            { score: 0.2, payload: {} },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });

    const backend = createQdrantVectorBackendFromEnv(fetchFn);
    await expect(backend.readiness()).resolves.toEqual({
      ok: true,
      detail: 'qdrant:storycluster_coarse_vectors',
    });

    await backend.replaceTopicClusters('topic-a', [makeCluster('story-a', [1, 0, 0])]);
    const hits = await backend.queryTopic(
      'topic-a',
      [{ doc_id: 'doc-1', vector: [1, 0, 0] }],
      8,
    );

    expect(hits.get('doc-1')).toEqual([
      { story_id: 'story-a', score: 0.98 },
      { story_id: 'story-b', score: 0.42 },
      { story_id: 'story-c', score: 0 },
    ]);
    expect(fetchFn).toHaveBeenCalled();
  });

  it('supports qdrant resolution outside production when explicitly configured', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VH_STORYCLUSTER_VECTOR_BACKEND', 'qdrant');
    vi.stubEnv('VH_STORYCLUSTER_QDRANT_URL', 'http://qdrant.local:6333');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ result: true })));

    const backend = resolveVectorBackend();
    await expect(backend.readiness()).resolves.toEqual({
      ok: true,
      detail: 'qdrant:storycluster_coarse_vectors',
    });
  });

  it('surfaces qdrant readiness, delete, upsert, and search failures', async () => {
    vi.stubEnv('VH_STORYCLUSTER_QDRANT_URL', 'http://qdrant.local:6333');

    const readyBackend = createQdrantVectorBackendFromEnv(async () => new Response('', { status: 500 }));
    await expect(readyBackend.readiness()).resolves.toEqual({
      ok: false,
      detail: 'qdrant collection probe failed: 500',
    });

    const stringFailureBackend = createQdrantVectorBackendFromEnv(async () => {
      throw 'qdrant-string-failure';
    });
    await expect(stringFailureBackend.readiness()).resolves.toEqual({
      ok: false,
      detail: 'qdrant-string-failure',
    });

    const createFailBackend = createQdrantVectorBackendFromEnv(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/collections/storycluster_coarse_vectors') && init?.method === 'GET') {
        return new Response('', { status: 404 });
      }
      if (url.endsWith('/collections/storycluster_coarse_vectors') && init?.method === 'PUT') {
        return new Response('', { status: 500 });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    await expect(createFailBackend.readiness()).resolves.toEqual({
      ok: false,
      detail: 'qdrant collection create failed: 500',
    });

    const emptySyncBackend = createQdrantVectorBackendFromEnv(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/collections/storycluster_coarse_vectors') && init?.method === 'GET') {
        return jsonResponse({ result: true });
      }
      if (url.endsWith('/points/delete') && init?.method === 'POST') {
        return jsonResponse({ result: true });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    await expect(emptySyncBackend.replaceTopicClusters('topic-a', [])).resolves.toBeUndefined();

    const deleteBackend = createQdrantVectorBackendFromEnv(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/collections/storycluster_coarse_vectors') && init?.method === 'GET') {
        return jsonResponse({ result: true });
      }
      if (url.endsWith('/points/delete') && init?.method === 'POST') {
        return new Response('', { status: 500 });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    await expect(deleteBackend.replaceTopicClusters('topic-a', [])).rejects.toThrow('qdrant topic delete failed: 500');

    const upsertBackend = createQdrantVectorBackendFromEnv(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/collections/storycluster_coarse_vectors') && init?.method === 'GET') {
        return jsonResponse({ result: true });
      }
      if (url.endsWith('/points/delete') && init?.method === 'POST') {
        return jsonResponse({ result: true });
      }
      if (url.endsWith('/points') && init?.method === 'PUT') {
        return new Response('', { status: 500 });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    await expect(upsertBackend.replaceTopicClusters('topic-a', [makeCluster('story-a', [1, 0, 0])])).rejects.toThrow(
      'qdrant upsert failed: 500',
    );

    const searchBackend = createQdrantVectorBackendFromEnv(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/collections/storycluster_coarse_vectors') && init?.method === 'GET') {
        return jsonResponse({ result: true });
      }
      if (url.endsWith('/points/search') && init?.method === 'POST') {
        return new Response('', { status: 502 });
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    await expect(
      searchBackend.queryTopic('topic-a', [{ doc_id: 'doc-1', vector: [1, 0, 0] }], 4),
    ).rejects.toThrow('qdrant search failed: 502');

    const emptySearchBackend = createQdrantVectorBackendFromEnv(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/collections/storycluster_coarse_vectors') && init?.method === 'GET') {
        return jsonResponse({ result: true });
      }
      if (url.endsWith('/points/search') && init?.method === 'POST') {
        return jsonResponse({});
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
    });
    await expect(
      emptySearchBackend.queryTopic('topic-a', [{ doc_id: 'doc-2', vector: [1, 0, 0] }], 4),
    ).resolves.toEqual(new Map([['doc-2', []]]));
  });
});
