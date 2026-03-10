import { createHash } from 'node:crypto';
import type { StoryClusterTelemetryEnvelope } from './contracts';
import { getDefaultClusterStore } from './clusterStore';
import { runStoryClusterStagePipeline, type StoryClusterStageRunnerOptions } from './stageRunner';
import { tokenizeWords } from './textSignals';

export interface StoryClusterRemoteItem {
  sourceId: string;
  publisher: string;
  url: string;
  canonicalUrl: string;
  title: string;
  publishedAt?: number;
  summary?: string;
  url_hash: string;
  image_hash?: string;
  language?: string;
  translation_applied?: boolean;
  entity_keys: string[];
  cluster_text?: string;
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
  storyline_id?: string;
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
  primary_sources?: Array<{
    source_id: string;
    publisher: string;
    url: string;
    url_hash: string;
    published_at?: number;
    title: string;
  }>;
  secondary_assets?: Array<{
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

export interface StoryClusterRemoteStorylineGroup {
  schemaVersion: 'storyline-group-v0';
  storyline_id: string;
  topic_id: string;
  canonical_story_id: string;
  story_ids: string[];
  headline: string;
  summary_hint?: string;
  related_coverage: Array<{
    source_id: string;
    publisher: string;
    url: string;
    url_hash: string;
    published_at?: number;
    title: string;
  }>;
  entity_keys: string[];
  time_bucket: string;
  created_at: number;
  updated_at: number;
}

export interface StoryClusterRemoteResponse {
  bundles: StoryClusterRemoteBundle[];
  storylines: StoryClusterRemoteStorylineGroup[];
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
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readOptionalNumber(record: Record<string, unknown>, key: string, path: string): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path}.${key} must be a non-negative finite number when provided`);
  }
  return Math.floor(value);
}

function readEntityKeys(record: Record<string, unknown>, path: string): string[] {
  const value = record.entity_keys;
  if (!Array.isArray(value)) {
    throw new Error(`${path}.entity_keys must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`${path}.entity_keys[${index}] must be a string`);
    }
    return entry.trim().toLowerCase();
  }).filter(Boolean);
}

function normalizeRequest(payload: unknown, nowMs: number): StoryClusterRemoteRequest & { reference_now_ms: number } {
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
      publishedAt: readOptionalNumber(item, 'publishedAt', path),
      summary: readOptionalString(item, 'summary'),
      url_hash: readRequiredString(item, 'url_hash', path),
      image_hash: readOptionalString(item, 'image_hash'),
      language: readOptionalString(item, 'language'),
      translation_applied: item.translation_applied === true,
      entity_keys: readEntityKeys(item, path),
      cluster_text: readOptionalString(item, 'cluster_text'),
    };
  });

  const latestPublishedAt = items.reduce((max, item) => Math.max(max, item.publishedAt ?? 0), 0);
  const referenceNowMs = readOptionalNumber(record, 'reference_now_ms', 'payload') ??
    (latestPublishedAt || nowMs);

  return {
    topic_id: topicId,
    items,
    reference_now_ms: referenceNowMs,
  };
}

function buildDocId(item: StoryClusterRemoteItem, index: number): string {
  return `${item.sourceId}:${item.url_hash}:${index}`;
}

function buildTimeBucket(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 13);
}

function deriveEntityKeys(headline: string, existing: readonly string[]): string[] {
  if (existing.length > 0) {
    return [...existing].sort();
  }
  return [...new Set(tokenizeWords(headline, 4))].slice(0, 8);
}

function deriveNewsTopicId(storyId: string): string {
  return createHash('sha256').update(`news:${storyId}`).digest('hex');
}

function provenanceHash(bundle: StoryClusterRemoteBundle['sources']): string {
  return createHash('sha256')
    .update(bundle.map((source) => `${source.source_id}:${source.url_hash}`).sort().join('|'))
    .digest('hex');
}

export async function runStoryClusterRemoteContract(
  payload: unknown,
  options: StoryClusterStageRunnerOptions = {},
): Promise<StoryClusterRemoteResponse> {
  const now = options.clock ?? Date.now;
  const normalized = normalizeRequest(payload, now());
  const documents = normalized.items.map((item, index) => ({
    doc_id: buildDocId(item, index),
    source_id: item.sourceId,
    publisher: item.publisher,
    title: item.title,
    summary: item.summary,
    body: item.cluster_text ?? item.summary,
    published_at: item.publishedAt ?? normalized.reference_now_ms,
    url: item.url,
    canonical_url: item.canonicalUrl,
    url_hash: item.url_hash,
    image_hash: item.image_hash,
    language_hint: item.language,
    entity_keys: item.entity_keys,
    translation_applied: item.translation_applied,
  }));

  const stageResult = await runStoryClusterStagePipeline(
    {
      topic_id: normalized.topic_id,
      documents,
      reference_now_ms: normalized.reference_now_ms,
    },
    { ...options, store: options.store ?? getDefaultClusterStore() },
  );
  const storylineIdByStoryId = new Map(
    (stageResult.storylines ?? []).map((storyline) => [storyline.canonical_story_id, storyline.storyline_id]),
  );

  const bundles = stageResult.bundles.map((bundle) => {
    const primarySources = bundle.primary_sources
      .map((source) => ({
        source_id: source.source_id,
        publisher: source.publisher,
        url: source.canonical_url,
        url_hash: source.url_hash,
        published_at: source.published_at,
        title: source.title,
      }))
      .sort((left, right) => `${left.source_id}:${left.url_hash}`.localeCompare(`${right.source_id}:${right.url_hash}`));
    const secondaryAssets = bundle.secondary_assets
      .map((source) => ({
        source_id: source.source_id,
        publisher: source.publisher,
        url: source.canonical_url,
        url_hash: source.url_hash,
        published_at: source.published_at,
        title: source.title,
      }))
      .sort((left, right) => `${left.source_id}:${left.url_hash}`.localeCompare(`${right.source_id}:${right.url_hash}`));

    return {
      schemaVersion: 'story-bundle-v0' as const,
      story_id: bundle.story_id,
      topic_id: deriveNewsTopicId(bundle.story_id),
      storyline_id: storylineIdByStoryId.get(bundle.story_id),
      headline: bundle.headline,
      summary_hint: bundle.summary_hint,
      cluster_window_start: bundle.cluster_window_start,
      cluster_window_end: bundle.cluster_window_end,
      sources: primarySources,
      primary_sources: primarySources,
      secondary_assets: secondaryAssets,
      cluster_features: {
        entity_keys: deriveEntityKeys(bundle.headline, bundle.entity_keys),
        time_bucket: bundle.time_bucket,
        semantic_signature: bundle.semantic_signature,
        coverage_score: bundle.coverage_score,
        velocity_score: bundle.velocity_score,
        confidence_score: bundle.confidence_score,
        primary_language: bundle.primary_language,
        translation_applied: bundle.translation_applied,
      },
      provenance_hash: provenanceHash(primarySources),
      created_at: bundle.created_at,
    };
  });

  return {
    bundles,
    storylines: (stageResult.storylines ?? []).map((storyline) => ({
      schemaVersion: storyline.schemaVersion,
      storyline_id: storyline.storyline_id,
      topic_id: storyline.topic_id,
      canonical_story_id: storyline.canonical_story_id,
      story_ids: storyline.story_ids,
      headline: storyline.headline,
      summary_hint: storyline.summary_hint,
      related_coverage: storyline.related_coverage.map((source) => ({
        source_id: source.source_id,
        publisher: source.publisher,
        url: source.canonical_url,
        url_hash: source.url_hash,
        published_at: source.published_at,
        title: source.title,
      })),
      entity_keys: storyline.entity_keys,
      time_bucket: storyline.time_bucket,
      created_at: storyline.created_at,
      updated_at: storyline.updated_at,
    })),
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
  readOptionalPublishedAt: (record: Record<string, unknown>, path: string) =>
    readOptionalNumber(record, 'publishedAt', path),
  readOptionalString,
  readRequiredString,
};
