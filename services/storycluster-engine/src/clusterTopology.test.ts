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

  it('limits hot-path reconciliation to changed clusters', () => {
    const topicState = makeTopicState('topic-bounded-hot-path');
    const stalePrimary = makeDocument('doc-stale-primary', 'Port attack expands');
    const staleSecondary = makeDocument('doc-stale-secondary', 'Metro blackout spreads', {
      source_id: 'wire-blackout',
      url_hash: 'hash-blackout',
      entities: ['metro_blackout'],
      linked_entities: ['metro_blackout'],
      trigger: 'blackout',
      coarse_vector: [0, 1],
      full_vector: [0, 1, 0],
    });
    const archivedParent = deriveClusterRecord(topicState, topicState.topic_id, [
      toStoredSource(stalePrimary, stalePrimary.source_variants[0]!),
      toStoredSource(staleSecondary, staleSecondary.source_variants[0]!),
    ], 'story-archived-parent');
    const touchedDoc = makeDocument('doc-touched', 'Court ruling expands', {
      entities: ['court_ruling'],
      linked_entities: ['court_ruling'],
      trigger: 'ruling',
      coarse_vector: [0.2, 0.8],
      full_vector: [0.2, 0.8, 0],
    });
    const touched = deriveClusterRecord(
      topicState,
      topicState.topic_id,
      [toStoredSource(touchedDoc, touchedDoc.source_variants[0]!)],
      'story-touched',
    );

    const clusters = new Map<string, StoredClusterRecord>([
      [archivedParent.story_id, archivedParent],
      [touched.story_id, touched],
    ]);
    const changed = new Set<string>(['story-touched']);

    reconcileClusterTopology(topicState, topicState.topic_id, clusters, changed);

    expect(clusters.get('story-archived-parent')?.source_documents).toHaveLength(2);
    expect([...clusters.values()].filter((cluster) => cluster.lineage.split_from === 'story-archived-parent')).toHaveLength(0);
  });

  it('splits a same-tournament singleton out of a persisted bundle without deleting it', () => {
    const topicState = makeTopicState('topic-pga-singleton');
    const raiGuardian = makeDocument('doc-rai-guardian', 'Aaron Rai keeps celebrations low-key after PGA Championship win', {
      source_id: 'guardian-us',
      url_hash: 'hash-rai-guardian',
      entities: ['pga_championship', 'aaron_rai'],
      linked_entities: ['pga_championship', 'aaron_rai'],
      locations: ['aronimink'],
      trigger: 'wins',
      event_tuple: {
        description: 'Aaron Rai wins the PGA Championship.',
        trigger: 'wins',
        who: ['aaron_rai'],
        where: ['aronimink'],
        when_ms: 260,
        outcome: 'Wins the tournament.',
      },
      coarse_vector: [1, 0],
      full_vector: [1, 0, 0],
      published_at: 260,
    });
    const raiWire = makeDocument('doc-rai-wire', 'Aaron Rai wins PGA Championship at Aronimink', {
      source_id: 'ap-sports',
      url_hash: 'hash-rai-wire',
      entities: ['pga_championship', 'aaron_rai'],
      linked_entities: ['pga_championship', 'aaron_rai'],
      locations: ['aronimink'],
      trigger: 'wins',
      event_tuple: {
        description: 'Aaron Rai wins the PGA Championship.',
        trigger: 'wins',
        who: ['aaron_rai'],
        where: ['aronimink'],
        when_ms: 261,
        outcome: 'Wins the tournament.',
      },
      coarse_vector: [1, 0],
      full_vector: [1, 0, 0],
      published_at: 261,
    });
    const schefflerLead = makeDocument('doc-scheffler', 'Scottie Scheffler part of 7-way tie for the lead at PGA Championship', {
      source_id: 'ap-topnews',
      url_hash: 'hash-scheffler',
      entities: ['pga_championship', 'scottie_scheffler'],
      linked_entities: ['pga_championship', 'scottie_scheffler'],
      locations: [],
      trigger: 'leads',
      event_tuple: {
        description: 'Scottie Scheffler is tied for the lead at the PGA Championship.',
        trigger: 'leads',
        who: ['scottie_scheffler'],
        where: ['pga_championship'],
        when_ms: 200,
        outcome: 'Tied for the lead.',
      },
      coarse_vector: [0.99, 0.01],
      full_vector: [0.99, 0.01, 0],
      published_at: 200,
    });
    const parent = deriveClusterRecord(topicState, topicState.topic_id, [
      toStoredSource(raiGuardian, raiGuardian.source_variants[0]!),
      toStoredSource(raiWire, raiWire.source_variants[0]!),
      toStoredSource(schefflerLead, schefflerLead.source_variants[0]!),
    ], 'story-pga-parent');

    const clusters = new Map<string, StoredClusterRecord>([
      [parent.story_id, parent],
    ]);
    const changed = new Set<string>();

    reconcileClusterTopology(topicState, topicState.topic_id, clusters, changed);

    const clusterSizes = [...clusters.values()].map((cluster) => cluster.source_documents.length).sort((left, right) => left - right);
    const singleton = [...clusters.values()].find((cluster) => cluster.source_documents.length === 1);
    expect(clusterSizes).toEqual([1, 2]);
    expect(singleton?.source_documents[0]?.source_key).toBe('ap-topnews:hash-scheffler');
    expect(singleton?.lineage.split_from).toBe('story-pga-parent');
    expect(changed.has(singleton!.story_id)).toBe(true);
  });
});
