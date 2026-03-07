import { createHash } from 'node:crypto';
import type { StoredClusterRecord } from './stageState';
import { cosineSimilarity } from './textSignals';

const DEFAULT_COLLECTION = 'storycluster_coarse_vectors';
const DEFAULT_DIMENSION = 192;
const DEFAULT_TIMEOUT_MS = 5_000;

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

interface MemoryPoint {
  story_id: string;
  vector: number[];
}

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

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (this.options.apiKey) headers.set('api-key', this.options.apiKey);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return (this.options.fetchFn ?? fetch)(`${this.options.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
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
    const results = await Promise.all(queries.map(async (query) => {
      const response = await this.request(`/collections/${this.options.collection}/points/search`, {
        method: 'POST',
        body: JSON.stringify({
          vector: cloneVector(query.vector, this.options.dimension),
          limit,
          with_payload: true,
          with_vector: false,
          filter: {
            must: [{ key: 'topic_id', match: { value: topicId } }],
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`qdrant search failed: ${response.status}`);
      }
      const payload = await response.json() as {
        result?: Array<{ score?: number; payload?: { story_id?: string } }>;
      };
      return [
        query.doc_id,
        (payload.result ?? [])
          .map((item) => ({
            story_id: item.payload?.story_id ?? '',
            score: Number((item.score ?? 0).toFixed(6)),
          }))
          .filter((item) => item.story_id),
      ] as const;
    }));
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

  async replaceTopicClusters(topicId: string, clusters: readonly StoredClusterRecord[]): Promise<void> {
    await this.ensureCollection();
    const deleted = await this.request(`/collections/${this.options.collection}/points/delete`, {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          must: [{ key: 'topic_id', match: { value: topicId } }],
        },
      }),
    });
    if (!deleted.ok) {
      throw new Error(`qdrant topic delete failed: ${deleted.status}`);
    }
    if (clusters.length === 0) return;
    const upserted = await this.request(`/collections/${this.options.collection}/points`, {
      method: 'PUT',
      body: JSON.stringify({
        points: clusters.map((cluster) => ({
          id: qdrantPointId(topicId, cluster.story_id),
          vector: cloneVector(cluster.centroid_coarse, this.options.dimension),
          payload: {
            story_id: cluster.story_id,
            topic_id: topicId,
          },
        })),
      }),
    });
    if (!upserted.ok) {
      throw new Error(`qdrant upsert failed: ${upserted.status}`);
    }
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
