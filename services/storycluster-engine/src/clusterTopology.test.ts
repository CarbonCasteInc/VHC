import { describe, expect, it } from 'vitest';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { reconcileClusterTopology } from './clusterTopology';
import type { StoredClusterRecord, StoredTopicState, WorkingDocument } from './stageState';

function makeDocument(docId: string, title: string, overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    doc_id: docId,
    source_id: overrides.source_id ?? `wire-${docId}`,
    publisher: overrides.publisher ?? 'Wire',
    title,
    summary: overrides.summary ?? `${title} summary.`,
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
      title,
      summary: overrides.summary ?? `${title} summary.`,
      language: 'en',
      translation_applied: false,
      coverage_role: 'canonical',
    }],
    raw_text: overrides.raw_text ?? `${title}. ${title} summary.`,
    normalized_text: overrides.normalized_text ?? `${title.toLowerCase()} summary`,
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? title,
    translated_text: overrides.translated_text ?? `${title}. ${title} summary.`,
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

function makeTopicState(topicId: string): StoredTopicState {
  return {
    schema_version: 'storycluster-state-v1',
    topic_id: topicId,
    next_cluster_seq: 1,
    clusters: [],
  };
}

describe('clusterTopology', () => {
  it('creates a new split child when no reusable secondary component exists', () => {
    const topicState = makeTopicState('topic-new-child');
    const primaryA = makeDocument('doc-primary-a', 'Port attack expands');
    const primaryB = makeDocument('doc-primary-b', 'Port response grows');
    const secondaryA = makeDocument('doc-secondary-a', 'Metro blackout spreads', {
      source_id: 'wire-blackout-a',
      url_hash: 'hash-blackout-a',
      entities: ['metro_blackout'],
      linked_entities: ['metro_blackout'],
      trigger: 'blackout',
      coarse_vector: [0, 1],
      full_vector: [0, 1, 0],
    });
    const secondaryB = makeDocument('doc-secondary-b', 'Power outage continues downtown', {
      source_id: 'wire-blackout-b',
      url_hash: 'hash-blackout-b',
      entities: ['metro_blackout'],
      linked_entities: ['metro_blackout'],
      trigger: 'outage',
      coarse_vector: [0, 1],
      full_vector: [0, 1, 0],
    });
    const parent = deriveClusterRecord(topicState, topicState.topic_id, [
      toStoredSource(primaryA, primaryA.source_variants[0]!),
      toStoredSource(primaryB, primaryB.source_variants[0]!),
      toStoredSource(secondaryA, secondaryA.source_variants[0]!),
      toStoredSource(secondaryB, secondaryB.source_variants[0]!),
    ], 'story-parent');

    const clusters = new Map<string, StoredClusterRecord>([
      [parent.story_id, parent],
    ]);
    const changed = new Set<string>();

    reconcileClusterTopology(topicState, topicState.topic_id, clusters, changed);

    const children = [...clusters.values()].filter((cluster) => cluster.story_id !== 'story-parent');
    expect(children).toHaveLength(1);
    expect(children[0]?.lineage.split_from).toBe('story-parent');
    expect(children[0]?.source_documents).toHaveLength(2);
    expect(changed.has(children[0]!.story_id)).toBe(true);
  });

  it('reuses an existing split child when a matching secondary component reappears', () => {
    const topicState = makeTopicState('topic-topology');
    const primaryA = makeDocument('doc-primary-a', 'Port attack expands');
    const primaryB = makeDocument('doc-primary-b', 'Port attack response grows');
    const secondaryA = makeDocument('doc-secondary-a', 'Market slump deepens', {
      source_id: 'wire-market-a',
      url_hash: 'hash-market-a',
      entities: ['market_slump'],
      linked_entities: ['market_slump'],
      trigger: 'inflation',
      coarse_vector: [0, 1],
      full_vector: [0, 1, 0],
    });
    const secondaryB = makeDocument('doc-secondary-b', 'Market slump widens', {
      source_id: 'wire-market-b',
      url_hash: 'hash-market-b',
      entities: ['market_slump'],
      linked_entities: ['market_slump'],
      trigger: 'inflation',
      coarse_vector: [0, 1],
      full_vector: [0, 1, 0],
    });

    const parent = deriveClusterRecord(topicState, topicState.topic_id, [
      toStoredSource(primaryA, primaryA.source_variants[0]!),
      toStoredSource(primaryB, primaryB.source_variants[0]!),
      toStoredSource(secondaryA, secondaryA.source_variants[0]!),
      toStoredSource(secondaryB, secondaryB.source_variants[0]!),
    ], 'story-parent');
    const existingChild = deriveClusterRecord(topicState, topicState.topic_id, [
      toStoredSource(secondaryA, secondaryA.source_variants[0]!),
    ], 'story-child');
    existingChild.lineage = { merged_from: [], split_from: parent.story_id };

    const clusters = new Map<string, StoredClusterRecord>([
      [parent.story_id, parent],
      [existingChild.story_id, existingChild],
    ]);
    const changed = new Set<string>();

    reconcileClusterTopology(topicState, topicState.topic_id, clusters, changed);

    const survivor = clusters.get('story-child');
    expect(clusters.size).toBe(2);
    expect(changed.has('story-child')).toBe(true);
    expect(survivor?.source_documents).toHaveLength(2);
    expect(survivor?.source_documents.map((document) => document.source_key)).toEqual([
      'wire-market-a:hash-market-a',
      'wire-market-b:hash-market-b',
    ]);
  });
});
