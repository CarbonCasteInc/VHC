import { describe, expect, it } from 'vitest';
import { buildCandidateMatch, clusterMergeScore } from './clusterScoring';
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
    coverage_role: overrides.coverage_role ?? 'canonical',
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
    assigned_story_id: overrides.assigned_story_id,
  };
}

function makeCluster(document: WorkingDocument) {
  const topicState: StoredTopicState = {
    schema_version: 'storycluster-state-v1',
    topic_id: 'topic-news',
    next_cluster_seq: 1,
    clusters: [],
  };
  return deriveClusterRecord(topicState, 'topic-news', [toStoredSource(document, document.source_variants[0]!)], 'story-a');
}

describe('clusterScoring coverage', () => {
  it('marks category-conflict candidates as event conflicts when they lack canonical entity support', () => {
    const cluster = makeCluster(makeWorkingDocument({
      title: 'Port attack expands overnight',
      summary: 'Officials in Tehran say the port attack damaged terminals.',
      raw_text: 'Port attack expands overnight. Officials in Tehran say the port attack damaged terminals.',
      normalized_text: 'port attack expands overnight officials in tehran say the port attack damaged terminals',
      entities: ['terminals'],
      linked_entities: [],
      locations: ['tehran'],
      trigger: 'attack',
      event_tuple: {
        description: 'Officials in Tehran say the port attack damaged terminals.',
        trigger: 'attack',
        who: ['port_authority'],
        where: ['tehran'],
        when_ms: 100,
        outcome: 'Terminal operations are disrupted.',
      },
    }));

    const candidate = buildCandidateMatch(makeWorkingDocument({
      title: 'Parliament schedules a vote after the emergency session',
      summary: 'Officials in Tehran plan a vote after the emergency session.',
      raw_text: 'Parliament schedules a vote after the emergency session. Officials in Tehran plan a vote after the emergency session.',
      normalized_text: 'parliament schedules a vote after the emergency session officials in tehran plan a vote after the emergency session',
      entities: ['parliament'],
      linked_entities: [],
      locations: ['tehran'],
      trigger: 'vote',
      event_tuple: {
        description: 'Officials in Tehran plan a vote after the emergency session.',
        trigger: 'vote',
        who: ['port_authority'],
        where: ['tehran'],
        when_ms: 101,
        outcome: 'The vote is scheduled.',
      },
      coarse_vector: [0.92, 0.08],
      full_vector: [0.88, 0.12],
    }), cluster);

    expect(candidate.adjudication).toBe('rejected');
    expect(candidate.reason).toBe('event-conflict');
  });

  it('hard-rejects low-signal category conflicts with no actor, location, or lexical support', () => {
    const cluster = makeCluster(makeWorkingDocument({
      title: 'Port attack expands overnight',
      summary: 'Officials in Tehran say the port attack damaged terminals.',
      raw_text: 'Port attack expands overnight. Officials in Tehran say the port attack damaged terminals.',
      normalized_text: 'port attack expands overnight officials in tehran say the port attack damaged terminals',
      entities: ['terminals'],
      linked_entities: [],
      locations: ['tehran'],
      trigger: 'attack',
      event_tuple: {
        description: 'Officials in Tehran say the port attack damaged terminals.',
        trigger: 'attack',
        who: ['port_authority'],
        where: ['tehran'],
        when_ms: 100,
        outcome: 'Terminal operations are disrupted.',
      },
    }));

    const candidate = buildCandidateMatch(makeWorkingDocument({
      title: 'Parliament plans a budget session',
      summary: 'Lawmakers prepare for a budget session.',
      raw_text: 'Parliament plans a budget session. Lawmakers prepare for a budget session.',
      normalized_text: 'parliament plans a budget session lawmakers prepare for a budget session',
      translated_text: 'Parliament plans a budget session. Lawmakers prepare for a budget session.',
      entities: ['budget'],
      linked_entities: [],
      locations: [],
      temporal_ms: 60 * 60 * 1000 * 30,
      published_at: 60 * 60 * 1000 * 30,
      trigger: 'vote',
      event_tuple: {
        description: 'Lawmakers prepare for a budget session.',
        trigger: 'vote',
        who: [],
        where: [],
        when_ms: 60 * 60 * 1000 * 30,
        outcome: 'The session is prepared.',
      },
      coarse_vector: [0.92, 0.08],
      full_vector: [0.88, 0.12],
    }), cluster);

    expect(candidate.adjudication).toBe('rejected');
    expect(candidate.reason).toBe('event-frame-conflict');
  });

  it('allows conflicting-trigger cluster merges when specific canonical, location, and time support are strong', () => {
    const left = makeCluster(makeWorkingDocument({
      doc_id: 'doc-left',
      source_id: 'wire-left',
      title: 'Port authority confirms attack response',
      summary: 'The port authority confirms the attack response in Tehran.',
      raw_text: 'Port authority confirms the attack response in Tehran.',
      normalized_text: 'port authority confirms the attack response in tehran',
      entities: ['port_authority'],
      linked_entities: ['port_authority'],
      locations: ['tehran'],
      trigger: 'attack',
      event_tuple: {
        description: 'The port authority confirms the attack response in Tehran.',
        trigger: 'attack',
        who: ['port_authority'],
        where: ['tehran'],
        when_ms: 100,
        outcome: 'The response continues.',
      },
    }));
    const right = makeCluster(makeWorkingDocument({
      doc_id: 'doc-right',
      source_id: 'wire-right',
      title: 'Port authority schedules emergency vote in Tehran',
      summary: 'The port authority schedules an emergency vote in Tehran.',
      raw_text: 'Port authority schedules an emergency vote in Tehran.',
      normalized_text: 'port authority schedules an emergency vote in tehran',
      entities: ['port_authority'],
      linked_entities: ['port_authority'],
      locations: ['tehran'],
      trigger: 'vote',
      event_tuple: {
        description: 'The port authority schedules an emergency vote in Tehran.',
        trigger: 'vote',
        who: ['port_authority'],
        where: ['tehran'],
        when_ms: 101,
        outcome: 'The vote is scheduled.',
      },
    }));

    expect(clusterMergeScore(left, right)).toBeGreaterThan(0);
  });
});
