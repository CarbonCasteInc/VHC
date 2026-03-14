import { describe, expect, it } from 'vitest';
import { buildCandidateMatch, candidateEligible, clusterMergeScore } from './clusterScoring';
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
    doc_type: overrides.doc_type ?? 'wire',
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

  it('rejects broad Trump-affordability coverage from a Kennedy Center leadership cluster', () => {
    const cluster = makeCluster(makeWorkingDocument({
      source_id: 'nbc-politics',
      publisher: 'NBC News',
      title: 'Trump loyalist Ric Grenell stepping down as head of Kennedy Center',
      summary: 'Ric Grenell is stepping down as head of the Kennedy Center.',
      raw_text: 'Trump loyalist Ric Grenell stepping down as head of Kennedy Center.',
      normalized_text: 'trump loyalist ric grenell stepping down as head of kennedy center',
      translated_text: 'Trump loyalist Ric Grenell stepping down as head of Kennedy Center.',
      entities: ['grenell', 'kennedy_center', 'donald_trump'],
      linked_entities: ['ric_grenell', 'kennedy_center', 'donald_trump'],
      locations: ['united_states'],
      trigger: 'stepping_down',
      event_tuple: {
        description: 'Ric Grenell is stepping down as head of the Kennedy Center.',
        trigger: 'stepping_down',
        who: ['ric_grenell', 'donald_trump'],
        where: ['kennedy_center'],
        when_ms: 100,
        outcome: 'leadership change',
      },
      coarse_vector: [0.92, 0.08],
      full_vector: [0.9, 0.1],
    }));

    const candidate = buildCandidateMatch(makeWorkingDocument({
      source_id: 'guardian-us',
      publisher: 'The Guardian',
      title: 'Americans struggle with affordability despite Trump claims',
      summary: 'US workers are struggling with affordability despite Trump claims about the economy.',
      raw_text: 'US workers are struggling with affordability despite Trump claims about the economy.',
      normalized_text: 'us workers are struggling with affordability despite trump claims about the economy',
      translated_text: 'US workers are struggling with affordability despite Trump claims about the economy.',
      entities: ['affordability', 'economy', 'donald_trump'],
      linked_entities: ['us_workers', 'trump_administration', 'donald_trump'],
      locations: ['united_states'],
      trigger: 'struggling',
      event_tuple: {
        description: 'US workers are struggling with affordability.',
        trigger: 'struggling',
        who: ['us_workers'],
        where: ['united_states'],
        when_ms: 101,
        outcome: 'economic strain',
      },
      coarse_vector: [0.92, 0.08],
      full_vector: [0.9, 0.1],
    }), cluster);

    expect(candidate.adjudication).toBe('rejected');
    expect(candidate.reason).toBe('event-frame-conflict');
  });

  it('rejects Justice Department topical overlap for unrelated public-safety coverage', () => {
    const cluster = makeCluster(makeWorkingDocument({
      source_id: 'cnn-politics',
      publisher: 'CNN',
      title: 'Federal judge quashes Justice Department subpoenas of Fed Chair Jerome Powell',
      summary: 'Federal judge quashes Justice Department subpoenas of Jerome Powell.',
      raw_text: 'Federal judge quashes Justice Department subpoenas of Fed Chair Jerome Powell.',
      normalized_text: 'federal judge quashes justice department subpoenas of fed chair jerome powell',
      translated_text: 'Federal judge quashes Justice Department subpoenas of Fed Chair Jerome Powell.',
      entities: ['justice_department', 'jerome_powell', 'federal_judge'],
      linked_entities: ['justice_department', 'jerome_powell', 'federal_judge'],
      locations: [],
      trigger: 'quashes',
      event_tuple: {
        description: 'Federal judge quashes Justice Department subpoenas of Jerome Powell.',
        trigger: 'quashes',
        who: ['federal_judge', 'jerome_powell'],
        where: [],
        when_ms: 100,
        outcome: 'subpoenas quashed',
      },
      coarse_vector: [0.92, 0.08],
      full_vector: [0.9, 0.1],
    }));

    const candidate = buildCandidateMatch(makeWorkingDocument({
      source_id: 'ap-politics',
      publisher: 'AP',
      title: 'US faces elevated terrorism threats against backdrop of Iran war and cuts at FBI, Justice Department',
      summary: 'US faces elevated terrorism threats amid cuts at FBI and Justice Department.',
      raw_text: 'US faces elevated terrorism threats against backdrop of Iran war and cuts at FBI and Justice Department.',
      normalized_text: 'us faces elevated terrorism threats against backdrop of iran war and cuts at fbi and justice department',
      translated_text: 'US faces elevated terrorism threats against backdrop of Iran war and cuts at FBI and Justice Department.',
      entities: ['justice_department', 'terrorism', 'iran'],
      linked_entities: ['justice_department', 'united_states', 'iran'],
      locations: ['united_states'],
      trigger: 'faces',
      event_tuple: {
        description: 'US faces elevated terrorism threats.',
        trigger: 'faces',
        who: ['united_states'],
        where: ['united_states'],
        when_ms: 101,
        outcome: 'elevated terrorism threats',
      },
      coarse_vector: [0.92, 0.08],
      full_vector: [0.9, 0.1],
    }), cluster);

    expect(candidate.adjudication).toBe('rejected');
    expect(['event-frame-conflict', 'below-threshold']).toContain(candidate.reason);
  });

  it('falls back to published timestamps when event anchors are missing and rejects stale pairs', () => {
    const clusterDocument = makeWorkingDocument({
      published_at: 100,
      event_tuple: null,
    });
    clusterDocument.temporal_ms = null;
    const cluster = makeCluster(clusterDocument);

    const staleCandidate = makeWorkingDocument({
      published_at: 100 + 80 * 60 * 60 * 1000,
      event_tuple: null,
      trigger: 'attack',
      entities: ['generic'],
      linked_entities: ['generic'],
      locations: [],
      coarse_vector: [0.74, 0.26],
      full_vector: [0.62, 0.38],
    });
    staleCandidate.temporal_ms = null;
    const candidate = buildCandidateMatch(staleCandidate, cluster);

    expect(candidate.adjudication).toBe('rejected');
    expect(candidate.reason).toBe('below-threshold');
  });

  it('returns a secondary-asset conflict for video clips against broad roundup clusters', () => {
    const broadCluster = makeCluster(makeWorkingDocument({
      source_id: 'guardian-roundup',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the latest Iran conflict developments.',
      raw_text: 'Trump news at a glance: Iran latest. A broad roundup of the latest Iran conflict developments.',
      normalized_text: 'trump news at a glance iran latest broad roundup of the latest iran conflict developments',
      translated_text: 'Trump news at a glance: Iran latest. A broad roundup of the latest Iran conflict developments.',
      coverage_role: 'canonical',
      entities: ['iran', 'trump'],
      linked_entities: ['iran'],
      locations: ['washington'],
      trigger: 'talks',
      event_tuple: null,
      coarse_vector: [0.72, 0.28],
      full_vector: [0.69, 0.31],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    }));

    const videoDocument = makeWorkingDocument({
      source_id: 'cbs-video',
      publisher: 'CBS News',
      title: 'Armed Iranian opposition group says its camp was hit with drone strike',
      translated_title: 'Armed Iranian opposition group says its camp was hit with drone strike',
      summary: 'CBS video report on the drone strike.',
      raw_text: 'CBS video report on the drone strike.',
      normalized_text: 'cbs video report on the drone strike',
      translated_text: 'CBS video report on the drone strike.',
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

  it('returns zero merge score when broad related coverage meets a specific event cluster', () => {
    const broadCluster = makeCluster(makeWorkingDocument({
      source_id: 'guardian-roundup-merge',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the latest Iran conflict developments.',
      raw_text: 'Trump news at a glance: Iran latest. A broad roundup of the latest Iran conflict developments.',
      normalized_text: 'trump news at a glance iran latest broad roundup of the latest iran conflict developments',
      translated_text: 'Trump news at a glance: Iran latest. A broad roundup of the latest Iran conflict developments.',
      coverage_role: 'canonical',
      entities: ['iran', 'trump'],
      linked_entities: ['iran'],
      locations: ['washington'],
      trigger: 'talks',
      event_tuple: null,
      coarse_vector: [0.72, 0.28],
      full_vector: [0.69, 0.31],
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
    }));
    const specificCluster = makeCluster(makeWorkingDocument({
      source_id: 'ap-specific-merge',
      publisher: 'AP',
      title: 'Port authority confirms second overnight strike in Tehran',
      translated_title: 'Port authority confirms second overnight strike in Tehran',
      summary: 'Port authority confirms a second overnight strike in Tehran.',
      raw_text: 'Port authority confirms a second overnight strike in Tehran.',
      normalized_text: 'port authority confirms a second overnight strike in tehran',
      translated_text: 'Port authority confirms a second overnight strike in Tehran.',
      coverage_role: 'canonical',
      entities: ['port_authority', 'tehran_strike'],
      linked_entities: ['port_authority', 'tehran_strike'],
      locations: ['tehran'],
      trigger: 'strike',
      event_tuple: {
        description: 'Port authority confirms a second overnight strike in Tehran.',
        trigger: 'strike',
        who: ['Port authority'],
        where: ['Tehran'],
        when_ms: 216_000_500,
        outcome: 'Further damage reported.',
      },
      coarse_vector: [0.74, 0.26],
      full_vector: [0.72, 0.28],
      published_at: 216_000_500,
      temporal_ms: 216_000_500,
    }));

    expect(clusterMergeScore(broadCluster, specificCluster)).toBe(0);
  });
});
