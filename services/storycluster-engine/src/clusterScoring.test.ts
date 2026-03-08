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

  it('does not merge topic-adjacent clusters without event support', () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const shipDelaysDoc = makeWorkingDocument({
      doc_id: 'doc-ship',
      source_id: 'wire-ship',
      title: 'Shipping delays deepen after the overnight strike',
      summary: 'Carriers warn delays will continue after the strike.',
      raw_text: 'Shipping delays deepen after the overnight strike. Carriers warn delays will continue after the strike.',
      normalized_text: 'shipping delays deepen after the overnight strike carriers warn delays will continue after the strike',
      entities: ['ship_delays', 'shipping', 'strike'],
      linked_entities: ['ship_delays', 'shipping', 'strike'],
      trigger: 'strike',
      coarse_vector: [1, 0],
      full_vector: [1, 0],
    });
    const fuelSpikeDoc = makeWorkingDocument({
      doc_id: 'doc-fuel',
      source_id: 'wire-fuel',
      title: 'Energy desks raise price forecasts after the overnight strike',
      summary: 'Fuel prices jump as traders price in the conflict risk.',
      raw_text: 'Energy desks raise price forecasts after the overnight strike. Fuel prices jump as traders price in the conflict risk.',
      normalized_text: 'energy desks raise price forecasts after the overnight strike fuel prices jump as traders price in the conflict risk',
      entities: ['fuel_spike', 'energy', 'price', 'strike'],
      linked_entities: ['fuel_spike', 'energy', 'price', 'strike'],
      trigger: 'strike',
      coarse_vector: [0.98, 0.02],
      full_vector: [0.98, 0.02],
    });
    const shipCluster = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(shipDelaysDoc, shipDelaysDoc.source_variants[0]!)]);
    const fuelCluster = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(fuelSpikeDoc, fuelSpikeDoc.source_variants[0]!)]);

    expect(clusterMergeScore(shipCluster, fuelCluster)).toBe(0);
    expect(shouldMergeClusters(shipCluster, fuelCluster)).toBe(false);
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
      entities: ['port_attack'],
      linked_entities: ['other'],
      trigger: 'attack',
      coarse_vector: [0.74, 0.26],
      full_vector: [0.62, 0.38],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    }), cluster);
    expect(abstain.adjudication).toBe('abstain');

    const eventConflict = buildCandidateMatch(makeWorkingDocument({
      title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the Iran conflict and White House messaging.',
      raw_text: 'Trump news at a glance: Iran latest. A broad roundup of the Iran conflict and White House messaging.',
      normalized_text: 'trump news at a glance iran latest broad roundup of the iran conflict and white house messaging',
      entities: ['iran', 'trump'],
      linked_entities: ['iran'],
      locations: ['washington'],
      trigger: 'talks',
      coarse_vector: [0.72, 0.28],
      full_vector: [0.69, 0.31],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    }), cluster);
    expect(eventConflict.reason).toBe('event-conflict');
    expect(eventConflict.adjudication).toBe('rejected');

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

    const hardRejectDoc = makeWorkingDocument({
      title: 'Diplomatic talks resume after sanctions dispute',
      summary: 'Diplomatic talks resume after sanctions dispute.',
      raw_text: 'Diplomatic talks resume after sanctions dispute.',
      normalized_text: 'diplomatic talks resume after sanctions dispute',
      translated_title: 'Diplomatic talks resume after sanctions dispute',
      translated_text: 'Diplomatic talks resume after sanctions dispute.',
      entities: ['sanctions'],
      linked_entities: ['sanctions'],
      locations: ['brussels'],
      trigger: 'talks',
      event_tuple: {
        description: 'Diplomatic talks resume after sanctions dispute',
        trigger: 'talks',
        who: [],
        where: ['Brussels'],
        when_ms: 216_000_100,
        outcome: 'Talks resume.',
      },
      coarse_vector: [1, 0],
      full_vector: [1, 0],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    });
    expect(buildCandidateMatch(hardRejectDoc, cluster).reason).toBe('event-frame-conflict');
    expect(candidateEligible(hardRejectDoc, cluster)).toBe(false);

    const signalLessDoc = makeWorkingDocument({
      title: 'Generic bulletin',
      summary: 'Generic bulletin.',
      raw_text: 'Generic bulletin.',
      normalized_text: 'generic bulletin',
      translated_title: 'Generic bulletin',
      translated_text: 'Generic bulletin.',
      entities: ['generic'],
      linked_entities: ['generic'],
      trigger: null,
      locations: [],
      event_tuple: null,
      coarse_vector: [0, 1],
      full_vector: [0, 1],
      published_at: 216_000_100,
      temporal_ms: null,
    });
    expect(buildCandidateMatch(signalLessDoc, cluster).reason).not.toBe('event-frame-conflict');

    const temporalSignalDoc = makeWorkingDocument({
      title: 'Generic bulletin',
      summary: 'Generic bulletin.',
      raw_text: 'Generic bulletin.',
      normalized_text: 'generic bulletin',
      translated_title: 'Generic bulletin',
      translated_text: 'Generic bulletin.',
      entities: ['generic'],
      linked_entities: ['generic'],
      trigger: null,
      locations: [],
      event_tuple: {
        description: 'Generic bulletin',
        trigger: null,
        who: [],
        where: [],
        when_ms: 216_000_100,
        outcome: null,
      },
      coarse_vector: [0, 1],
      full_vector: [0, 1],
      published_at: 216_000_100,
      temporal_ms: null,
    });
    expect(buildCandidateMatch(temporalSignalDoc, cluster).reason).toBe('below-threshold');
  });

  it('returns zero merge score for category-conflicting clusters without support', () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const conflictDoc = makeWorkingDocument({
      doc_id: 'doc-conflict',
      source_id: 'wire-conflict',
      title: 'Port attack expands overnight',
      entities: ['port_attack'],
      linked_entities: ['port_attack'],
      trigger: 'attack',
      published_at: 100,
      temporal_ms: 100,
    });
    const diplomacyDoc = makeWorkingDocument({
      doc_id: 'doc-diplomacy',
      source_id: 'wire-diplomacy',
      title: 'Diplomatic talks resume after sanctions dispute',
      summary: 'Summit aides prepare another round of sanctions talks.',
      raw_text: 'Diplomatic talks resume after sanctions dispute. Summit aides prepare another round of sanctions talks.',
      normalized_text: 'diplomatic talks resume after sanctions dispute summit aides prepare another round of sanctions talks',
      entities: ['sanctions'],
      linked_entities: ['sanctions'],
      trigger: 'talks',
      locations: ['brussels'],
      published_at: 400_000_000,
      temporal_ms: 400_000_000,
      coarse_vector: [1, 0],
      full_vector: [1, 0],
    });
    const conflictCluster = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(conflictDoc, conflictDoc.source_variants[0]!)]);
    const diplomacyCluster = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(diplomacyDoc, diplomacyDoc.source_variants[0]!)]);

    expect(clusterMergeScore(conflictCluster, diplomacyCluster)).toBe(0);
  });

  it('allows merge support from shared event location when trigger overlap is weak', () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const leftDoc = makeWorkingDocument({
      doc_id: 'doc-left-location',
      source_id: 'wire-left-location',
      title: 'Emergency crews reopen roads around the capital',
      entities: ['road_closure', 'capital', 'roads'],
      linked_entities: ['road_closure', 'capital', 'roads'],
      trigger: null,
      locations: ['capital'],
      published_at: 100,
      temporal_ms: 100,
    });
    const rightDoc = makeWorkingDocument({
      doc_id: 'doc-right-location',
      source_id: 'wire-right-location',
      title: 'Officials keep capital checkpoints open overnight',
      entities: ['checkpoint_updates', 'capital', 'roads'],
      linked_entities: ['checkpoint_updates', 'capital', 'roads'],
      trigger: null,
      locations: ['capital'],
      published_at: 120,
      temporal_ms: 120,
      coarse_vector: [0.98, 0.02],
      full_vector: [0.98, 0.02],
    });
    const leftCluster = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(leftDoc, leftDoc.source_variants[0]!)]);
    const rightCluster = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(rightDoc, rightDoc.source_variants[0]!)]);

    expect(clusterMergeScore(leftCluster, rightCluster)).toBeGreaterThan(0);
  });

  it('allows merge support from shared trigger family when location overlap is absent', () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const leftDoc = makeWorkingDocument({
      doc_id: 'doc-left-trigger',
      source_id: 'wire-left-trigger',
      title: 'Shipping insurers extend losses after the overnight strike',
      entities: ['shipping', 'insurers', 'market_aftershock'],
      linked_entities: ['shipping', 'insurers', 'market_aftershock'],
      trigger: 'strike',
      locations: [],
      published_at: 100,
      temporal_ms: 100,
    });
    const rightDoc = makeWorkingDocument({
      doc_id: 'doc-right-trigger',
      source_id: 'wire-right-trigger',
      title: 'Shipping markets absorb the strike as insurers revise forecasts',
      entities: ['shipping', 'insurers', 'forecasts'],
      linked_entities: ['shipping', 'insurers', 'forecasts'],
      trigger: 'strike',
      locations: [],
      published_at: 120,
      temporal_ms: 120,
      coarse_vector: [0.98, 0.02],
      full_vector: [0.98, 0.02],
    });
    const leftCluster = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(leftDoc, leftDoc.source_variants[0]!)]);
    const rightCluster = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(rightDoc, rightDoc.source_variants[0]!)]);

    expect(clusterMergeScore(leftCluster, rightCluster)).toBeGreaterThan(0);
  });
});
