import { createHash } from 'node:crypto';
import type { StoryClusterTelemetryEnvelope } from './contracts';
import {
  runStoryClusterStagePipeline,
  stageRunnerInternal,
} from './stageRunner';

export interface StoryClusterRemoteItem {
  sourceId: string;
  publisher: string;
  url: string;
  canonicalUrl: string;
  title: string;
  publishedAt?: number;
  summary?: string;
  url_hash: string;
  language?: string;
  translation_applied?: boolean;
  entity_keys: string[];
}

export interface StoryClusterRemoteRequest {
  topic_id: string;
  items: StoryClusterRemoteItem[];
  reference_now_ms?: number;
}

export interface StoryClusterRemoteBundle {
  schemaVersion: 'story-bundle-v0';
  story_id: string;
  topic_id: string;
  headline: string;
  summary_hint?: string;
  cluster_window_start: number;
  cluster_window_end: number;
  sources: Array<{
    source_id: string;
    publisher: string;
    url: string;
    url_hash: string;
    published_at?: number;
    title: string;
  }>;
  cluster_features: {
    entity_keys: string[];
    time_bucket: string;
    semantic_signature: string;
    coverage_score: number;
    velocity_score: number;
    confidence_score: number;
    primary_language?: string;
    translation_applied?: boolean;
  };
  provenance_hash: string;
  created_at: number;
}

export interface StoryClusterRemoteResponse {
  bundles: StoryClusterRemoteBundle[];
  telemetry: StoryClusterTelemetryEnvelope;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }

  return value.trim();
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalPublishedAt(record: Record<string, unknown>, path: string): number | undefined {
  const value = record.publishedAt;
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path}.publishedAt must be a non-negative finite number when provided`);
  }

  return Math.floor(value);
}

function readEntityKeys(record: Record<string, unknown>, path: string): string[] {
  const value = record.entity_keys;
  if (!Array.isArray(value)) {
    throw new Error(`${path}.entity_keys must be an array`);
  }

  const normalized: string[] = [];
  for (const [entryIndex, entry] of value.entries()) {
    if (typeof entry !== 'string') {
      throw new Error(`${path}.entity_keys[${entryIndex}] must be a string`);
    }

    const token = entry.trim().toLowerCase();
    if (token) {
      normalized.push(token);
    }
  }

  return normalized;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeRequest(
  payload: unknown,
  nowMs: number,
): StoryClusterRemoteRequest & { reference_now_ms: number } {
  const record = asRecord(payload, 'storycluster remote payload must be an object');
  const topicId = readRequiredString(record, 'topic_id', 'payload');
  const rawItems = record.items;

  if (!Array.isArray(rawItems)) {
    throw new Error('payload.items must be an array');
  }

  const items = rawItems.map((rawItem, index) => {
    const path = `payload.items[${index}]`;
    const item = asRecord(rawItem, `${path} must be an object`);
    const url = readRequiredString(item, 'url', path);

    return {
      sourceId: readRequiredString(item, 'sourceId', path),
      publisher: readRequiredString(item, 'publisher', path),
      url,
      canonicalUrl: readOptionalString(item, 'canonicalUrl') ?? url,
      title: readRequiredString(item, 'title', path),
      publishedAt: readOptionalPublishedAt(item, path),
      summary: readOptionalString(item, 'summary'),
      url_hash: readRequiredString(item, 'url_hash', path),
      language: readOptionalString(item, 'language'),
      translation_applied: readBoolean(item, 'translation_applied'),
      entity_keys: readEntityKeys(item, path),
    };
  });

  const rawReferenceNow = record.reference_now_ms;
  const referenceNowMs =
    typeof rawReferenceNow === 'number' && Number.isFinite(rawReferenceNow) && rawReferenceNow > 0
      ? Math.floor(rawReferenceNow)
      : items.reduce((max, item) => Math.max(max, item.publishedAt ?? 0), Math.floor(nowMs));

  return {
    topic_id: topicId,
    items,
    reference_now_ms: referenceNowMs,
  };
}

function buildDocId(item: StoryClusterRemoteItem, index: number): string {
  return `${item.sourceId}:${item.url_hash}:${index}`;
}

function buildTimeBucket(clusterWindowEnd: number): string {
  return new Date(clusterWindowEnd).toISOString().slice(0, 13);
}

function deriveNewsTopicId(storyId: string): string {
  return createHash('sha256').update(`news:${storyId}`).digest('hex');
}

function deriveEntityKeys(bundle: StoryClusterRemoteBundle, sourceItems: StoryClusterRemoteItem[]): string[] {
  const keys = new Set<string>();

  for (const item of sourceItems) {
    for (const entity of item.entity_keys) {
      keys.add(entity);
    }
  }

  if (keys.size === 0) {
    for (const token of stageRunnerInternal.normalizeToken(bundle.headline).split(' ')) {
      if (token.length >= 4) {
        keys.add(token);
      }
    }
  }

  if (keys.size === 0) {
    keys.add('general');
  }

  return [...keys].sort().slice(0, 8);
}

function toSourceProjection(item: StoryClusterRemoteItem, clusterWindowStart: number) {
  return {
    source_id: item.sourceId,
    publisher: item.publisher,
    url: item.canonicalUrl,
    url_hash: item.url_hash,
    published_at: item.publishedAt ?? clusterWindowStart,
    title: item.title,
  };
}

export function runStoryClusterRemoteContract(
  payload: unknown,
  options: {
    now?: () => number;
  } = {},
): StoryClusterRemoteResponse {
  const now = options.now ?? Date.now;
  const normalized = normalizeRequest(payload, now());

  const docToItem = new Map<string, StoryClusterRemoteItem>();
  const documents = normalized.items.map((item, index) => {
    const docId = buildDocId(item, index);
    docToItem.set(docId, item);

    return {
      doc_id: docId,
      source_id: item.sourceId,
      title: item.title,
      body: item.summary,
      published_at: item.publishedAt ?? normalized.reference_now_ms,
      url: item.canonicalUrl,
      language_hint: item.language,
    };
  });

  const stageResult = runStoryClusterStagePipeline({
    topic_id: normalized.topic_id,
    documents,
    reference_now_ms: normalized.reference_now_ms,
  });

  const bundles: StoryClusterRemoteBundle[] = stageResult.bundles.map((bundle) => {
    const sourceItems = bundle.source_doc_ids
      .map((docId) => docToItem.get(docId))
      .filter((item): item is StoryClusterRemoteItem => Boolean(item));

    const sourceHashes = sourceItems.map((item) => item.url_hash).sort();
    const coverageScore = stageRunnerInternal.clamp01(sourceItems.length / 6);
    const velocitySpan = Math.max(0, bundle.cluster_window_end - bundle.cluster_window_start);
    const velocityScore = stageRunnerInternal.clamp01(velocitySpan / (6 * 60 * 60 * 1000));
    const confidenceScore = stageRunnerInternal.clamp01(0.45 + coverageScore * 0.35 + velocityScore * 0.2);

    const projected: StoryClusterRemoteBundle = {
      schemaVersion: 'story-bundle-v0',
      story_id: bundle.story_id,
      topic_id: deriveNewsTopicId(bundle.story_id),
      headline: bundle.headline,
      summary_hint: bundle.summary_hint,
      cluster_window_start: bundle.cluster_window_start,
      cluster_window_end: bundle.cluster_window_end,
      sources: sourceItems.map((item) => toSourceProjection(item, bundle.cluster_window_start)),
      cluster_features: {
        entity_keys: ['general'],
        time_bucket: buildTimeBucket(bundle.cluster_window_end),
        semantic_signature: stageRunnerInternal.hashToHex(`${bundle.story_id}:${sourceHashes.join(',')}`),
        coverage_score: coverageScore,
        velocity_score: velocityScore,
        confidence_score: confidenceScore,
        primary_language: sourceItems.find((item) => item.language)?.language,
        translation_applied: sourceItems.some((item) => item.translation_applied),
      },
      provenance_hash: stageRunnerInternal.hashToHex(
        `${bundle.story_id}:${bundle.topic_id}:${sourceHashes.join('|')}`,
      ),
      created_at: bundle.cluster_window_start,
    };

    projected.cluster_features.entity_keys = deriveEntityKeys(projected, sourceItems);
    return projected;
  });

  return {
    bundles,
    telemetry: stageResult.telemetry,
  };
}

export const remoteContractInternal = {
  asRecord,
  buildDocId,
  buildTimeBucket,
  deriveEntityKeys,
  deriveNewsTopicId,
  normalizeRequest,
  readEntityKeys,
  readOptionalPublishedAt,
  readOptionalString,
  readRequiredString,
};
