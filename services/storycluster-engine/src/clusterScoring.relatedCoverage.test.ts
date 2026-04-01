import { describe, expect, it } from 'vitest';
import { buildCandidateMatch, candidateEligible, clusterMergeScore, shouldMergeClusters } from './clusterScoring';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { applyDocumentAnalysis } from './stageDocumentHelpers';
import type { StoredTopicState, WorkingDocument } from './stageState';
import { createDeterministicTestModelProvider } from './testModelProvider';

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
    doc_type: overrides.doc_type ?? 'wire',
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

  it('keeps the Cuba diesel-embassy follow-up out of the tanker story canonical bundle', async () => {
    const provider = createDeterministicTestModelProvider();
    const tankerSeed = makeWorkingDocument({
      doc_id: 'doc-cuba-tanker',
      source_id: 'cbs-politics',
      publisher: 'CBS News',
      title: 'Trump says he has no problem with Russian tanker bringing oil to Cuba',
      translated_title: 'Trump says he has no problem with Russian tanker bringing oil to Cuba',
      summary: 'When asked if a New York Times report that the tanker would be allowed to reach Cuba was true, Mr. Trump said: "If a country wants to send some oil into Cuba right now, I have no problem whether it\'s Russia or not."',
      raw_text: 'Trump says he has no problem with Russian tanker bringing oil to Cuba. When asked if a New York Times report that the tanker would be allowed to reach Cuba was true, Mr. Trump said: "If a country wants to send some oil into Cuba right now, I have no problem whether it\'s Russia or not."',
      normalized_text: 'trump says he has no problem with russian tanker bringing oil to cuba when asked if a new york times report that the tanker would be allowed to reach cuba was true mr trump said if a country wants to send some oil into cuba right now i have no problem whether it is russia or not',
      translated_text: 'Trump says he has no problem with Russian tanker bringing oil to Cuba. When asked if a New York Times report that the tanker would be allowed to reach Cuba was true, Mr. Trump said: "If a country wants to send some oil into Cuba right now, I have no problem whether it\'s Russia or not."',
      url: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem/',
      canonical_url: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem',
      url_hash: '2a55210c',
      published_at: 1774866620000,
      temporal_ms: 1774866620000,
      source_variants: [{
        doc_id: 'doc-cuba-tanker',
        source_id: 'cbs-politics',
        publisher: 'CBS News',
        url: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem/',
        canonical_url: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem',
        url_hash: '2a55210c',
        published_at: 1774866620000,
        title: 'Trump says he has no problem with Russian tanker bringing oil to Cuba',
        summary: 'When asked if a New York Times report that the tanker would be allowed to reach Cuba was true, Mr. Trump said: "If a country wants to send some oil into Cuba right now, I have no problem whether it\'s Russia or not."',
        language: 'en',
        translation_applied: false,
        coverage_role: 'canonical',
      }],
    });
    const dieselFollowup = makeWorkingDocument({
      doc_id: 'doc-cuba-diesel',
      source_id: 'washington-post-politics',
      publisher: 'The Washington Post',
      title: 'Cuba refuses to let US Embassy in Havana import diesel for its generators',
      translated_title: 'Cuba refuses to let US Embassy in Havana import diesel for its generators',
      summary: 'The Cuban government refused a U.S. Embassy request to import diesel while the Trump administration kept a fuel blockade on the island and Russian oil shipments remained a live pressure point.',
      raw_text: 'Cuba refuses to let US Embassy in Havana import diesel for its generators. The Cuban government refused a U.S. Embassy request to import diesel while the Trump administration kept a fuel blockade on the island and Russian oil shipments remained a live pressure point.',
      normalized_text: 'cuba refuses to let us embassy in havana import diesel for its generators the cuban government refused a us embassy request to import diesel while the trump administration kept a fuel blockade on the island and russian oil shipments remained a live pressure point',
      translated_text: 'Cuba refuses to let US Embassy in Havana import diesel for its generators. The Cuban government refused a U.S. Embassy request to import diesel while the Trump administration kept a fuel blockade on the island and Russian oil shipments remained a live pressure point.',
      url: 'https://www.washingtonpost.com/politics/2026/03/20/cuba-fuel-embassy-trump-blockade/ee341b58-24c0-11f1-954a-6300919c9854_story.html/',
      canonical_url: 'https://www.washingtonpost.com/politics/2026/03/20/cuba-fuel-embassy-trump-blockade/ee341b58-24c0-11f1-954a-6300919c9854_story.html/',
      url_hash: 'cuba-wapo-001',
      published_at: 1774054620000,
      temporal_ms: 1774054620000,
      source_variants: [{
        doc_id: 'doc-cuba-diesel',
        source_id: 'washington-post-politics',
        publisher: 'The Washington Post',
        url: 'https://www.washingtonpost.com/politics/2026/03/20/cuba-fuel-embassy-trump-blockade/ee341b58-24c0-11f1-954a-6300919c9854_story.html/',
        canonical_url: 'https://www.washingtonpost.com/politics/2026/03/20/cuba-fuel-embassy-trump-blockade/ee341b58-24c0-11f1-954a-6300919c9854_story.html/',
        url_hash: 'cuba-wapo-001',
        published_at: 1774054620000,
        title: 'Cuba refuses to let US Embassy in Havana import diesel for its generators',
        summary: 'The Cuban government refused a U.S. Embassy request to import diesel while the Trump administration kept a fuel blockade on the island and Russian oil shipments remained a live pressure point.',
        language: 'en',
        translation_applied: false,
        coverage_role: 'canonical',
      }],
    });
    const analyses = await provider.analyzeDocuments([
      {
        doc_id: tankerSeed.doc_id,
        title: tankerSeed.title,
        summary: tankerSeed.summary,
        publisher: tankerSeed.publisher,
        text: `${tankerSeed.title}. ${tankerSeed.summary}`,
        entity_hints: [],
        published_at: tankerSeed.published_at,
      },
      {
        doc_id: dieselFollowup.doc_id,
        title: dieselFollowup.title,
        summary: dieselFollowup.summary,
        publisher: dieselFollowup.publisher,
        text: `${dieselFollowup.title}. ${dieselFollowup.summary}`,
        entity_hints: [],
        published_at: dieselFollowup.published_at,
      },
    ]);

    const tankerDocument = applyDocumentAnalysis(tankerSeed, analyses[0]!);
    const dieselDocument = applyDocumentAnalysis(dieselFollowup, analyses[1]!);
    const cluster = makeCluster(tankerDocument);
    const match = buildCandidateMatch(dieselDocument, cluster);

    expect(dieselDocument.coverage_role).toBe('related');
    expect(match.reason).toBe('related-coverage-conflict');
    expect(match.adjudication).toBe('rejected');
    expect(candidateEligible(dieselDocument, cluster)).toBe(false);
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

  it('rejects same-topic canonical coverage when lead actions diverge', () => {
    const troopCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-troops',
      source_id: 'nypost-politics',
      publisher: 'New York Post',
      title: "Trump doesn't rule out sending American troops to Iran",
      translated_title: "Trump doesn't rule out sending American troops to Iran",
      summary: 'Trump does not rule out sending American troops to Iran as tensions escalate.',
      doc_type: 'hard_news',
      coverage_role: 'canonical',
      event_tuple: {
        description: 'Trump does not rule out sending American troops to Iran as tensions escalate.',
        trigger: 'troops',
        who: ['Donald Trump'],
        where: ['Iran'],
        when_ms: 216_000_300,
        outcome: 'Potential deployment of American troops to Iran.',
      },
      trigger: 'troops',
      linked_entities: ['donald_trump', 'american_troops', 'iran'],
      entities: ['donald_trump', 'american_troops', 'iran'],
      locations: ['iran'],
      coarse_vector: [0.71, 0.29],
      full_vector: [0.7, 0.3],
      published_at: 216_000_300,
      temporal_ms: 216_000_300,
    }));
    const starmerDocument = makeWorkingDocument({
      doc_id: 'doc-starmer',
      source_id: 'guardian-us',
      publisher: 'Guardian',
      title: 'Trump tells Starmer help not needed even as US uses UK bases for Iran strikes',
      translated_title: 'Trump tells Starmer help not needed even as US uses UK bases for Iran strikes',
      summary: 'Trump tells Starmer British help is not needed even as the US uses UK bases for Iran strikes.',
      doc_type: 'hard_news',
      coverage_role: 'canonical',
      event_tuple: {
        description: 'Trump tells Starmer British help is not needed even as the US uses UK bases for Iran strikes.',
        trigger: 'tells',
        who: ['Donald Trump', 'Keir Starmer'],
        where: ['Iran', 'UK'],
        when_ms: 216_000_330,
        outcome: 'US continues to use UK bases for military actions.',
      },
      trigger: 'tells',
      linked_entities: ['donald_trump', 'keir_starmer', 'uk_bases', 'iran'],
      entities: ['donald_trump', 'keir_starmer', 'uk_bases', 'iran'],
      locations: ['iran', 'uk'],
      coarse_vector: [0.72, 0.28],
      full_vector: [0.7, 0.3],
      published_at: 216_000_330,
      temporal_ms: 216_000_330,
    });

    const match = buildCandidateMatch(starmerDocument, troopCluster);

    expect(match.reason).toBe('event-frame-conflict');
    expect(match.adjudication).toBe('rejected');
    expect(candidateEligible(starmerDocument, troopCluster)).toBe(false);
  });

  it('rejects broad roundup coverage against a specific event video cluster', () => {
    const videoCluster = makeCluster(makeWorkingDocument({
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
    }));
    const roundupDocument = makeWorkingDocument({
      doc_id: 'doc-roundup-video-conflict',
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

    const match = buildCandidateMatch(roundupDocument, videoCluster);

    expect(match.reason).toBe('related-coverage-conflict');
    expect(match.adjudication).toBe('rejected');
    expect(candidateEligible(roundupDocument, videoCluster)).toBe(false);
  });
});
