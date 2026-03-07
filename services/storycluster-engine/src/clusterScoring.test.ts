import { describe, expect, it } from 'vitest';
import { buildCandidateMatch, candidateEligible, clusterMergeScore, clusterScoringConfig, representativeDocuments, shouldMergeClusters, shouldSplitPair, splitPairScore } from './clusterScoring';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import type { StoredTopicState, WorkingDocument } from './stageState';

function makeWorkingDocument(overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    doc_id: overrides.doc_id ?? 'doc-1',
    source_id: overrides.source_id ?? 'wire-a',
    publisher: overrides.publisher ?? 'Reuters',
    title: overrides.title ?? 'Port attack expands overnight',
    summary: overrides.summary ?? 'Officials describe the port attack response.',
    body: overrides.body,
    published_at: overrides.published_at ?? 100,
    url: overrides.url ?? 'https://example.com/1',
    canonical_url: overrides.canonical_url ?? 'https://example.com/1',
    url_hash: overrides.url_hash ?? 'hash-1',
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys,
    translation_applied: overrides.translation_applied,
    source_variants: overrides.source_variants ?? [{
      doc_id: overrides.doc_id ?? 'doc-1',
      source_id: overrides.source_id ?? 'wire-a',
      publisher: overrides.publisher ?? 'Reuters',
      url: overrides.url ?? 'https://example.com/1',
      canonical_url: overrides.canonical_url ?? 'https://example.com/1',
      url_hash: overrides.url_hash ?? 'hash-1',
      published_at: overrides.published_at ?? 100,
      title: overrides.title ?? 'Port attack expands overnight',
      summary: overrides.summary ?? 'Officials describe the port attack response.',
      language: 'en',
      translation_applied: false,
    }],
    raw_text: overrides.raw_text ?? 'Port attack expands overnight. Officials describe the port attack response.',
    normalized_text: overrides.normalized_text ?? 'port attack expands overnight officials describe the port attack response',
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? overrides.title ?? 'Port attack expands overnight',
    translated_text: overrides.translated_text ?? 'Port attack expands overnight. Officials describe the port attack response.',
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'wire_report',
    doc_weight: overrides.doc_weight ?? 1.15,
    minhash_signature: overrides.minhash_signature ?? [1, 2, 3],
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0],
    semantic_signature: overrides.semantic_signature ?? 'sig-1',
    event_tuple: overrides.event_tuple ?? null,
    entities: overrides.entities ?? ['port_attack'],
    linked_entities: overrides.linked_entities ?? ['port_attack'],
    locations: overrides.locations ?? ['tehran'],
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

function makeCluster(title = 'Port attack expands overnight') {
  const topicState: StoredTopicState = {
    schema_version: 'storycluster-state-v1',
    topic_id: 'topic-news',
    next_cluster_seq: 1,
    clusters: [],
  };
  const document = makeWorkingDocument({ title });
  return deriveClusterRecord(topicState, 'topic-news', [toStoredSource(document, document.source_variants[0]!)]);
}

describe('clusterScoring', () => {
  it('builds accepted and rejected candidate matches', () => {
    const document = makeWorkingDocument();
    const cluster = makeCluster();
    const accepted = buildCandidateMatch(document, cluster);
    expect(accepted.adjudication).toBe('accepted');
    expect(candidateEligible(document, cluster)).toBe(true);

    const rejectedDoc = makeWorkingDocument({
      entities: ['market'],
      linked_entities: ['market'],
      trigger: 'inflation',
      coarse_vector: [0, 1],
      full_vector: [0, 1],
      published_at: 999999999,
    });
    const rejected = buildCandidateMatch(rejectedDoc, cluster);
    expect(rejected.adjudication).not.toBe('accepted');
    expect(candidateEligible(rejectedDoc, cluster)).toBe(false);
    expect(representativeDocuments(cluster)).toHaveLength(1);
  });

  it('computes merge and split scores', () => {
    const left = makeCluster();
    const right = makeCluster();
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const separateDocument = makeWorkingDocument({
      doc_id: 'doc-market',
      source_id: 'wire-market',
      title: 'Separate market slump update',
      summary: 'Insurers react to the market slump.',
      raw_text: 'Separate market slump update. Insurers react to the market slump.',
      normalized_text: 'separate market slump update insurers react to the market slump',
      entities: ['market'],
      linked_entities: ['market'],
      trigger: 'inflation',
      coarse_vector: [0, 1],
      full_vector: [0, 1],
    });
    const separate = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(separateDocument, separateDocument.source_variants[0]!)]);

    expect(clusterMergeScore(left, right)).toBeGreaterThan(clusterScoringConfig.mergeThreshold);
    expect(shouldMergeClusters(left, right)).toBe(true);
    expect(shouldMergeClusters(left, separate)).toBe(false);
    expect(splitPairScore(left.source_documents[0]!, right.source_documents[0]!)).toBeGreaterThan(0.5);
    expect(shouldSplitPair(left.source_documents[0]!, separate.source_documents[0]!)).toBe(false);
  });

  it('covers canonical-entity, abstain, and eligibility branches', () => {
    const cluster = makeCluster();

    const highConfidenceLanguageAccepted = buildCandidateMatch(makeWorkingDocument({
      title: 'Generic bulletin',
      summary: 'Generic bulletin.',
      raw_text: 'Generic bulletin.',
      normalized_text: 'generic bulletin',
      translated_title: 'Generic bulletin',
      translated_text: 'Generic bulletin.',
      entities: ['port_attack'],
      linked_entities: ['port_attack'],
      trigger: null,
      language: 'es',
      coarse_vector: [1, 0],
      full_vector: [1, 0],
      published_at: 110,
    }), cluster);
    expect(highConfidenceLanguageAccepted.adjudication).toBe('accepted');

    const triggerAccepted = buildCandidateMatch(makeWorkingDocument({
      title: 'Generic bulletin',
      summary: 'Generic bulletin.',
      raw_text: 'Generic bulletin.',
      normalized_text: 'generic bulletin',
      translated_title: 'Generic bulletin',
      translated_text: 'Generic bulletin.',
      entities: ['other'],
      linked_entities: ['port_attack'],
      trigger: 'assault',
      language: 'en',
      coarse_vector: [1, 0],
      full_vector: [0.32, 0.68],
      published_at: 110,
    }), cluster);
    expect(triggerAccepted.adjudication).toBe('accepted');
    expect(triggerAccepted.reason).toBe('canonical-entity-match');

    const lexicalCanonicalAccepted = buildCandidateMatch(makeWorkingDocument({
      title: 'Port attack bulletin',
      summary: 'Port attack bulletin.',
      raw_text: 'Port attack bulletin.',
      normalized_text: 'port attack bulletin',
      translated_title: 'Port attack bulletin',
      translated_text: 'Port attack bulletin.',
      entities: ['port_attack'],
      linked_entities: ['port_attack'],
      trigger: 'inflation',
      language: 'en',
      coarse_vector: [0, 1],
      full_vector: [0, 1],
      published_at: 110,
    }), cluster);
    expect(lexicalCanonicalAccepted.adjudication).toBe('accepted');
    expect(lexicalCanonicalAccepted.reason).toBe('canonical-entity-match');

    const languageCanonicalAccepted = buildCandidateMatch(makeWorkingDocument({
      title: 'Generic bulletin',
      summary: 'Generic bulletin.',
      raw_text: 'Generic bulletin.',
      normalized_text: 'generic bulletin',
      translated_title: 'Generic bulletin',
      translated_text: 'Generic bulletin.',
      entities: ['other'],
      linked_entities: ['port_attack'],
      trigger: 'inflation',
      language: 'es',
      coarse_vector: [0, 1],
      full_vector: [0, 1],
      published_at: 110,
    }), cluster);
    expect(languageCanonicalAccepted.adjudication).toBe('accepted');
    expect(languageCanonicalAccepted.reason).toBe('canonical-entity-match');

    const lexicalAccepted = buildCandidateMatch(makeWorkingDocument({
      entities: ['attack', 'overnight', 'port_attack'],
      linked_entities: ['port_attack'],
      trigger: null,
      language: 'en',
      coarse_vector: [1, 0],
      full_vector: [1, 0],
      published_at: 110,
    }), cluster);
    expect(lexicalAccepted.adjudication).toBe('accepted');

    const abstain = buildCandidateMatch(makeWorkingDocument({
      title: 'Generic bulletin',
      summary: 'Generic bulletin.',
      raw_text: 'Generic bulletin.',
      normalized_text: 'generic bulletin',
      translated_title: 'Generic bulletin',
      translated_text: 'Generic bulletin.',
      entities: ['other'],
      linked_entities: ['port_attack'],
      trigger: 'attack',
      coarse_vector: [1, 0],
      full_vector: [1, 0],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    }), cluster);
    expect(abstain.adjudication).toBe('abstain');

    expect(candidateEligible(makeWorkingDocument({
      entities: ['port_attack'],
      linked_entities: ['other'],
      coarse_vector: [0, 0],
      full_vector: [0, 0],
      published_at: 110,
    }), cluster)).toBe(true);
    expect(candidateEligible(makeWorkingDocument({
      entities: ['other'],
      linked_entities: ['port_attack'],
      coarse_vector: [0, 0],
      full_vector: [0, 0],
      published_at: 110,
    }), cluster)).toBe(true);
  });
});
