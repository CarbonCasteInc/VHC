import { describe, expect, it } from 'vitest';
import { buildCandidateMatch, candidateEligible, clusterMergeScore, shouldMergeClusters } from './clusterScoring';
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
      coverage_role: overrides.coverage_role ?? 'canonical',
    }],
    raw_text: overrides.raw_text ?? 'Port attack expands overnight. Officials describe the port attack response.',
    normalized_text: overrides.normalized_text ?? 'port attack expands overnight officials describe the port attack response',
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? overrides.title ?? 'Port attack expands overnight',
    translated_text: overrides.translated_text ?? 'Port attack expands overnight. Officials describe the port attack response.',
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'wire_report',
    coverage_role: overrides.coverage_role ?? 'canonical',
    doc_weight: overrides.doc_weight ?? 1.15,
    minhash_signature: overrides.minhash_signature ?? [1, 2, 3],
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0],
    semantic_signature: overrides.semantic_signature ?? 'sig-1',
    event_tuple: overrides.event_tuple ?? {
      description: 'Port attack expands overnight',
      trigger: 'attack',
      who: ['Port officials'],
      where: ['Tehran'],
      when_ms: overrides.published_at ?? 100,
      outcome: 'Response underway.',
    },
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

function makeCluster(document: WorkingDocument) {
  const topicState: StoredTopicState = {
    schema_version: 'storycluster-state-v1',
    topic_id: 'topic-news',
    next_cluster_seq: 1,
    clusters: [],
  };
  return deriveClusterRecord(topicState, 'topic-news', [toStoredSource(document, document.source_variants[0]!)]);
}

describe('clusterScoring related coverage guardrails', () => {
  it('rejects roundup coverage against a specific incident cluster', () => {
    const specificCluster = makeCluster(makeWorkingDocument());
    const roundupDocument = makeWorkingDocument({
      doc_id: 'doc-roundup',
      source_id: 'guardian-roundup',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the Iran conflict and White House messaging.',
      coverage_role: 'canonical',
      event_tuple: null,
      trigger: 'talks',
      linked_entities: ['iran'],
      entities: ['iran', 'trump'],
      locations: ['washington'],
      coarse_vector: [0.72, 0.28],
      full_vector: [0.69, 0.31],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    });

    const match = buildCandidateMatch(roundupDocument, specificCluster);

    expect(match.reason).toBe('related-coverage-conflict');
    expect(match.adjudication).toBe('rejected');
    expect(candidateEligible(roundupDocument, specificCluster)).toBe(false);
  });

  it('blocks merging a roundup cluster into a discrete incident cluster', () => {
    const specificCluster = makeCluster(makeWorkingDocument());
    const roundupCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-roundup',
      source_id: 'guardian-roundup',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the Iran conflict and White House messaging.',
      coverage_role: 'canonical',
      event_tuple: null,
      trigger: 'talks',
      linked_entities: ['iran'],
      entities: ['iran', 'trump'],
      locations: ['washington'],
      coarse_vector: [0.72, 0.28],
      full_vector: [0.69, 0.31],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    }));

    expect(clusterMergeScore(roundupCluster, specificCluster)).toBe(0);
    expect(shouldMergeClusters(roundupCluster, specificCluster)).toBe(false);
  });

  it('rejects a specific incident document against a broad roundup cluster', () => {
    const roundupCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-roundup',
      source_id: 'guardian-roundup',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the Iran conflict and White House messaging.',
      doc_type: 'breaking_update',
      coverage_role: 'canonical',
      event_tuple: null,
      trigger: 'talks',
      linked_entities: ['iran'],
      entities: ['iran', 'trump'],
      locations: ['washington'],
      coarse_vector: [0.72, 0.28],
      full_vector: [0.69, 0.31],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    }));
    const specificDocument = makeWorkingDocument({
      doc_id: 'doc-drone',
      source_id: 'cbs-video',
      publisher: 'CBS News',
      title: 'Armed Iranian opposition group says its camp was hit with drone strike',
      translated_title: 'Armed Iranian opposition group says its camp was hit with drone strike',
      summary: 'A CBS report about a specific drone strike on an opposition group camp.',
      doc_type: 'hard_news',
      coverage_role: 'canonical',
      event_tuple: {
        description: 'Drone strike hits opposition camp',
        trigger: 'strike',
        who: ['Iranian opposition group'],
        where: ['Northern Iraq'],
        when_ms: 216_000_300,
        outcome: 'Camp was hit in the strike.',
      },
      trigger: 'strike',
      linked_entities: ['iranian_opposition_group'],
      entities: ['iranian_opposition_group', 'drone', 'strike'],
      locations: ['northern_iraq'],
      coarse_vector: [0.68, 0.32],
      full_vector: [0.66, 0.34],
      published_at: 216_000_300,
      temporal_ms: 216_000_300,
    });

    const match = buildCandidateMatch(specificDocument, roundupCluster);

    expect(match.reason).toBe('related-coverage-conflict');
    expect(match.adjudication).toBe('rejected');
    expect(candidateEligible(specificDocument, roundupCluster)).toBe(false);
  });

  it('rejects video clips against clusters that lack a specific canonical incident anchor', () => {
    const broadCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-roundup',
      source_id: 'guardian-roundup',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the Iran conflict and White House messaging.',
      doc_type: 'breaking_update',
      coverage_role: 'canonical',
      event_tuple: null,
      trigger: 'talks',
      linked_entities: ['iran'],
      entities: ['iran', 'trump'],
      locations: ['washington'],
      coarse_vector: [0.72, 0.28],
      full_vector: [0.69, 0.31],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    }));
    const videoDocument = makeWorkingDocument({
      doc_id: 'doc-video',
      source_id: 'cbs-video',
      publisher: 'CBS News',
      title: 'Armed Iranian opposition group says its camp was hit with drone strike',
      translated_title: 'Armed Iranian opposition group says its camp was hit with drone strike',
      summary: 'CBS video report on the drone strike.',
      url: 'https://www.cbsnews.com/video/armed-iranian-opposition-group-says-camp-hit-drone-strike/',
      canonical_url: 'https://www.cbsnews.com/video/armed-iranian-opposition-group-says-camp-hit-drone-strike/',
      doc_type: 'video_clip',
      coverage_role: 'related',
      event_tuple: {
        description: 'Drone strike hits opposition camp',
        trigger: 'strike',
        who: ['Iranian opposition group'],
        where: ['Northern Iraq'],
        when_ms: 216_000_300,
        outcome: 'Camp was hit in the strike.',
      },
      trigger: 'strike',
      linked_entities: ['iranian_opposition_group'],
      entities: ['iranian_opposition_group', 'drone', 'strike'],
      locations: ['northern_iraq'],
      coarse_vector: [0.68, 0.32],
      full_vector: [0.66, 0.34],
      published_at: 216_000_300,
      temporal_ms: 216_000_300,
    });

    const match = buildCandidateMatch(videoDocument, broadCluster);

    expect(match.reason).toBe('secondary-asset-conflict');
    expect(match.adjudication).toBe('rejected');
    expect(candidateEligible(videoDocument, broadCluster)).toBe(false);
  });
});
