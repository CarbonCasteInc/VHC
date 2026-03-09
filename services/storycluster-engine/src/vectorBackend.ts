import { createHash } from 'node:crypto';
import type { StoredClusterRecord } from './stageState';
import { cosineSimilarity } from './textSignals';

const DEFAULT_COLLECTION = 'storycluster_coarse_vectors';
const DEFAULT_DIMENSION = 192;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_SCROLL_LIMIT = 1_024;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const REQUEST_RETRY_DELAYS_MS = [150, 400];

export interface ClusterVectorHit {
  story_id: string;
  score: number;
}

export interface ClusterVectorQuery {
  doc_id: string;
  vector: number[];
}

export interface ClusterVectorBackend {
  queryTopic(
    topicId: string,
    queries: readonly ClusterVectorQuery[],
    limit: number,
  ): Promise<Map<string, ClusterVectorHit[]>>;
  readiness(): Promise<{ ok: boolean; detail: string }>;
  replaceTopicClusters(topicId: string, clusters: readonly StoredClusterRecord[]): Promise<void>;
}

type FetchFn = typeof fetch;

interface MemoryPoint { story_id: string; vector: number[]; }

interface QdrantVectorBackendOptions {
  apiKey?: string;
  baseUrl: string;
  collection: string;
  dimension: number;
  fetchFn?: FetchFn;
  timeoutMs: number;
}

function cloneVector(vector: readonly number[], dimension = vector.length): number[] {
  return vector.slice(0, dimension).map((value) => Number(value));
}

function backendKindFromEnv(): 'memory' | 'qdrant' | undefined {
  const raw = process.env.VH_STORYCLUSTER_VECTOR_BACKEND?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === 'memory' || raw === 'qdrant') return raw;
  throw new Error(`unsupported storycluster vector backend: ${raw}`);
}

function qdrantBaseUrlFromEnv(): string {
  const value = process.env.VH_STORYCLUSTER_QDRANT_URL?.trim() || process.env.QDRANT_URL?.trim();
  if (!value) {
    throw new Error('storycluster production requires VH_STORYCLUSTER_QDRANT_URL or QDRANT_URL');
  }
  return value.replace(/\/+$/, '');
}

function qdrantApiKeyFromEnv(): string | undefined {
  return process.env.VH_STORYCLUSTER_QDRANT_API_KEY?.trim() || process.env.QDRANT_API_KEY?.trim() || undefined;
}

function qdrantCollectionFromEnv(): string {
  return process.env.VH_STORYCLUSTER_QDRANT_COLLECTION?.trim() || DEFAULT_COLLECTION;
}

function qdrantTimeoutFromEnv(): number {
  const raw = process.env.VH_STORYCLUSTER_QDRANT_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid VH_STORYCLUSTER_QDRANT_TIMEOUT_MS: ${raw}`);
  }
  return Math.floor(parsed);
}

function qdrantPointId(topicId: string, storyId: string): string {
  const hex = createHash('sha256').update(`${topicId}:${storyId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class MemoryVectorBackend implements ClusterVectorBackend {
  private readonly topics = new Map<string, MemoryPoint[]>();

  async queryTopic(
    topicId: string,
    queries: readonly ClusterVectorQuery[],
    limit: number,
  ): Promise<Map<string, ClusterVectorHit[]>> {
    const points = this.topics.get(topicId) ?? [];
    return new Map(
      queries.map((query) => [
        query.doc_id,
        points
          .map((point) => ({
            story_id: point.story_id,
            score: Number(cosineSimilarity(query.vector, point.vector).toFixed(6)),
          }))
          .sort((left, right) => right.score - left.score || left.story_id.localeCompare(right.story_id))
          .slice(0, limit),
      ]),
    );
  }

  async readiness(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'memory-vector-backend' };
  }

  async replaceTopicClusters(topicId: string, clusters: readonly StoredClusterRecord[]): Promise<void> {
    this.topics.set(
      topicId,
      clusters.map((cluster) => ({
        story_id: cluster.story_id,
        vector: cloneVector(cluster.centroid_coarse, DEFAULT_DIMENSION),
      })),
    );
  }
}

class QdrantVectorBackend implements ClusterVectorBackend {
  private collectionEnsured = false;

  constructor(private readonly options: QdrantVectorBackendOptions) {}

  private async pause(delayMs: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (this.options.apiKey) headers.set('api-key', this.options.apiKey);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    let attempt = 0;
    while (true) {
      try {
        const response = await (this.options.fetchFn ?? fetch)(`${this.options.baseUrl}${path}`, {
          ...init,
          headers,
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        if (
          RETRYABLE_STATUS_CODES.has(response.status) &&
          attempt < REQUEST_RETRY_DELAYS_MS.length
        ) {
          await this.pause(REQUEST_RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        return response;
      } catch (error) {
        if (attempt >= REQUEST_RETRY_DELAYS_MS.length) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`qdrant request failed for ${path}: ${detail}`);
        }
        await this.pause(REQUEST_RETRY_DELAYS_MS[attempt]!);
        attempt += 1;
      }
    }
  }

  private async ensureCollection(): Promise<void> {
    if (this.collectionEnsured) return;
    const existing = await this.request(`/collections/${this.options.collection}`, { method: 'GET' });
    if (existing.status === 200) {
      this.collectionEnsured = true;
      return;
    }
    if (existing.status !== 404) {
      throw new Error(`qdrant collection probe failed: ${existing.status}`);
    }
    const created = await this.request(`/collections/${this.options.collection}`, {
      method: 'PUT',
      body: JSON.stringify({
        vectors: {
          size: this.options.dimension,
          distance: 'Cosine',
        },
      }),
    });
    if (!created.ok) {
      throw new Error(`qdrant collection create failed: ${created.status}`);
    }
    this.collectionEnsured = true;
  }

  async queryTopic(
    topicId: string,
    queries: readonly ClusterVectorQuery[],
    limit: number,
  ): Promise<Map<string, ClusterVectorHit[]>> {
    await this.ensureCollection();
    if (queries.length === 0) {
      return new Map();
    }
    const response = await this.request(`/collections/${this.options.collection}/points/search/batch`, {
      method: 'POST',
      body: JSON.stringify({
        searches: queries.map((query) => ({
          vector: cloneVector(query.vector, this.options.dimension),
          limit,
          with_payload: true,
          with_vector: false,
          filter: {
            must: [{ key: 'topic_id', match: { value: topicId } }],
          },
        })),
      }),
    });
    if (!response.ok) {
      throw new Error(`qdrant search batch failed: ${response.status}`);
    }
    const payload = await response.json() as {
      result?: Array<Array<{ score?: number; payload?: { story_id?: string } }>>;
    };
    const results = queries.map((query, index) => [
      query.doc_id,
      (payload.result?.[index] ?? [])
        .map((item) => ({
          story_id: item.payload?.story_id ?? '',
          score: Number((item.score ?? 0).toFixed(6)),
        }))
        .filter((item) => item.story_id),
    ] as const);
    return new Map(results);
  }

  async readiness(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.ensureCollection();
      return { ok: true, detail: `qdrant:${this.options.collection}` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private buildTopicPoints(topicId: string, clusters: readonly StoredClusterRecord[]) {
    return clusters.map((cluster) => ({
      id: qdrantPointId(topicId, cluster.story_id),
      vector: cloneVector(cluster.centroid_coarse, this.options.dimension),
      payload: { story_id: cluster.story_id, topic_id: topicId },
    }));
  }

  private async scrollTopicPointIds(topicId: string): Promise<string[]> {
    const ids: string[] = [];
    let offset: string | number | null | undefined = null;
    do {
      const response = await this.request(`/collections/${this.options.collection}/points/scroll`, {
        method: 'POST',
        body: JSON.stringify({
          limit: DEFAULT_SCROLL_LIMIT,
          with_payload: false,
          with_vector: false,
          filter: {
            must: [{ key: 'topic_id', match: { value: topicId } }],
          },
          offset,
        }),
      });
      if (!response.ok) {
        throw new Error(`qdrant topic scroll failed: ${response.status}`);
      }
      const payload = await response.json() as { result?: { points?: Array<{ id?: number | string }>; next_page_offset?: number | string | null } };
      for (const point of payload.result?.points ?? []) {
        if (point.id !== undefined && point.id !== null) {
          ids.push(String(point.id));
        }
      }
      offset = payload.result?.next_page_offset ?? null;
    } while (offset !== null && offset !== undefined);
    return ids;
  }

  private async deletePointIds(pointIds: readonly string[]): Promise<void> {
    if (pointIds.length === 0) return;
    const response = await this.request(`/collections/${this.options.collection}/points/delete`, {
      method: 'POST',
      body: JSON.stringify({ points: pointIds }),
    });
    if (!response.ok) {
      throw new Error(`qdrant topic delete failed: ${response.status}`);
    }
  }

  private async upsertPoints(points: readonly ReturnType<QdrantVectorBackend['buildTopicPoints']>[number][]): Promise<void> {
    if (points.length === 0) return;
    const response = await this.request(`/collections/${this.options.collection}/points`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
    });
    if (!response.ok) {
      throw new Error(`qdrant upsert failed: ${response.status}`);
    }
  }

  async replaceTopicClusters(topicId: string, clusters: readonly StoredClusterRecord[]): Promise<void> {
    await this.ensureCollection();
    const points = this.buildTopicPoints(topicId, clusters);
    await this.upsertPoints(points);
    const desiredPointIds = new Set(points.map((point) => String(point.id)));
    const stalePointIds = (await this.scrollTopicPointIds(topicId)).filter((pointId) => !desiredPointIds.has(pointId));
    await this.deletePointIds(stalePointIds);
  }
}

export function createQdrantVectorBackendFromEnv(fetchFn?: FetchFn): ClusterVectorBackend {
  return new QdrantVectorBackend({
    apiKey: qdrantApiKeyFromEnv(),
    baseUrl: qdrantBaseUrlFromEnv(),
    collection: qdrantCollectionFromEnv(),
    dimension: DEFAULT_DIMENSION,
    fetchFn,
    timeoutMs: qdrantTimeoutFromEnv(),
  });
}

export function resolveVectorBackend(backend?: ClusterVectorBackend): ClusterVectorBackend {
  if (backend) return backend;
  const kind = backendKindFromEnv();
  if (process.env.NODE_ENV === 'production') {
    if (kind && kind !== 'qdrant') {
      throw new Error(`storycluster production requires qdrant vector backend, received ${kind}`);
    }
    return createQdrantVectorBackendFromEnv();
  }
  if (!kind || kind === 'memory') {
    return new MemoryVectorBackend();
  }
  return createQdrantVectorBackendFromEnv();
}

export const vectorBackendInternal = {
  backendKindFromEnv,
  qdrantApiKeyFromEnv,
  qdrantBaseUrlFromEnv,
  qdrantCollectionFromEnv,
  qdrantPointId,
  qdrantTimeoutFromEnv,
};
