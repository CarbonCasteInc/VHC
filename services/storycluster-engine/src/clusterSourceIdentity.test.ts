import { describe, expect, it } from 'vitest';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { clustersShareExactSourceKey, findExactSourceCluster } from './clusterSourceIdentity';
import type { StoredTopicState, WorkingDocument } from './stageState';

function makeDocument(docId: string, storySuffix: string, overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    doc_id: docId,
    source_id: overrides.source_id ?? `wire-${docId}`,
    publisher: overrides.publisher ?? 'Wire',
    title: overrides.title ?? `Story ${storySuffix}`,
    summary: overrides.summary ?? `Summary ${storySuffix}`,
    body: overrides.body,
    published_at: overrides.published_at ?? 100,
    url: overrides.url ?? `https://example.com/${docId}`,
    canonical_url: overrides.canonical_url ?? `https://example.com/${docId}`,
    url_hash: overrides.url_hash ?? `hash-${docId}`,
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys ?? ['entity'],
    translation_applied: overrides.translation_applied ?? false,
    source_variants: overrides.source_variants ?? [{
      doc_id: docId,
      source_id: overrides.source_id ?? `wire-${docId}`,
      publisher: overrides.publisher ?? 'Wire',
      url: overrides.url ?? `https://example.com/${docId}`,
      canonical_url: overrides.canonical_url ?? `https://example.com/${docId}`,
      url_hash: overrides.url_hash ?? `hash-${docId}`,
      published_at: overrides.published_at ?? 100,
      title: overrides.title ?? `Story ${storySuffix}`,
      summary: overrides.summary ?? `Summary ${storySuffix}`,
      language: 'en',
      translation_applied: false,
      coverage_role: 'canonical',
    }],
    raw_text: overrides.raw_text ?? `Story ${storySuffix}. Summary ${storySuffix}`,
    normalized_text: overrides.normalized_text ?? `story ${storySuffix.toLowerCase()} summary`,
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? overrides.title ?? `Story ${storySuffix}`,
    translated_text: overrides.translated_text ?? `Story ${storySuffix}. Summary ${storySuffix}`,
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'hard_news',
    coverage_role: overrides.coverage_role ?? 'canonical',
    doc_weight: overrides.doc_weight ?? 1,
    minhash_signature: overrides.minhash_signature ?? [1, 2, 3],
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0, 0],
    semantic_signature: overrides.semantic_signature ?? `sig-${docId}`,
    event_tuple: overrides.event_tuple ?? null,
    entities: overrides.entities ?? ['entity'],
    linked_entities: overrides.linked_entities ?? ['entity'],
    locations: overrides.locations ?? [],
    temporal_ms: overrides.temporal_ms ?? 100,
    trigger: overrides.trigger ?? 'attack',
    candidate_matches: overrides.candidate_matches ?? [],
    candidate_score: overrides.candidate_score ?? 0,
    hybrid_score: overrides.hybrid_score ?? 0,
    rerank_score: overrides.rerank_score ?? 0,
    adjudication: overrides.adjudication ?? 'rejected',
    cluster_key: overrides.cluster_key ?? 'topic-news',
  };
}

function makeTopicState(): StoredTopicState {
  return {
    schema_version: 'storycluster-state-v1',
    topic_id: 'topic-news',
    next_cluster_seq: 1,
    clusters: [],
  };
}

describe('clusterSourceIdentity', () => {
  it('chooses the oldest richest exact-source cluster deterministically', () => {
    const topicState = makeTopicState();
    const shared = makeDocument('doc-shared', 'Shared');
    const matchingSource = toStoredSource(shared, shared.source_variants[0]!);
    const older = deriveClusterRecord(topicState, topicState.topic_id, [
      matchingSource,
      toStoredSource(makeDocument('doc-extra', 'Extra'), makeDocument('doc-extra', 'Extra').source_variants[0]!),
    ], 'story-older');
    const newer = deriveClusterRecord(topicState, topicState.topic_id, [matchingSource], 'story-newer');
    newer.created_at = older.created_at;

    const match = findExactSourceCluster([newer, older], shared);
    expect(match?.story_id).toBe('story-older');
  });

  it('breaks exact-source ties by story id when age and richness match', () => {
    const topicState = makeTopicState();
    const shared = makeDocument('doc-shared', 'Shared');
    const overlap = toStoredSource(shared, shared.source_variants[0]!);
    const left = deriveClusterRecord(topicState, topicState.topic_id, [overlap], 'story-b');
    const right = deriveClusterRecord(topicState, topicState.topic_id, [overlap], 'story-a');
    left.created_at = right.created_at;

    const match = findExactSourceCluster([left, right], shared);
    expect(match?.story_id).toBe('story-a');
  });

  it('detects exact source-key overlap between clusters', () => {
    const topicState = makeTopicState();
    const shared = makeDocument('doc-shared', 'Shared');
    const overlap = toStoredSource(shared, shared.source_variants[0]!);
    const left = deriveClusterRecord(topicState, topicState.topic_id, [overlap], 'story-left');
    const right = deriveClusterRecord(topicState, topicState.topic_id, [
      overlap,
      toStoredSource(makeDocument('doc-right', 'Right'), makeDocument('doc-right', 'Right').source_variants[0]!),
    ], 'story-right');

    expect(clustersShareExactSourceKey(left, right)).toBe(true);
  });
});
