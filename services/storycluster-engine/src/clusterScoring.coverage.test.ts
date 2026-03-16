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

function makeClusterFromDocuments(documents: WorkingDocument[]) {
  const topicState: StoredTopicState = {
    schema_version: 'storycluster-state-v1',
    topic_id: 'topic-news',
    next_cluster_seq: 1,
    clusters: [],
  };
  return deriveClusterRecord(
    topicState,
    'topic-news',
    documents.map((document) => toStoredSource(document, document.source_variants[0]!)),
    'story-a',
  );
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

  it('keeps audited long-window ongoing-event matches eligible when strong canonical identity overlaps persist', () => {
    const cluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-fed-a',
      source_id: 'ap-fed-subpoena',
      title: 'Federal Reserve Chair Powell says DOJ has subpoenaed central bank, threatens criminal indictment',
      summary: 'Jerome Powell says the Justice Department subpoenaed the Federal Reserve over building renovations.',
      raw_text: 'Jerome Powell says the Justice Department subpoenaed the Federal Reserve over building renovations.',
      normalized_text: 'jerome powell says justice department subpoenaed federal reserve building renovations',
      translated_text: 'Jerome Powell says the Justice Department subpoenaed the Federal Reserve over building renovations.',
      published_at: 1_768_180_699_000,
      temporal_ms: 1_768_180_699_000,
      entities: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
      linked_entities: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
      locations: ['washington'],
      trigger: 'subpoenaed',
      coarse_vector: [0.92, 0.08],
      full_vector: [0.92, 0.08],
    }));

    const followup = makeWorkingDocument({
      doc_id: 'doc-fed-b',
      source_id: 'ap-fed-quash',
      title: "Judge quashes subpoenas in Justice Department's investigation of Fed chair Jerome Powell",
      summary: 'A judge quashed the same Justice Department subpoenas aimed at Jerome Powell and the Federal Reserve.',
      raw_text: 'A judge quashed the same Justice Department subpoenas aimed at Jerome Powell and the Federal Reserve building renovation probe.',
      normalized_text: 'judge quashed same justice department subpoenas jerome powell federal reserve building renovation probe',
      translated_text: 'A judge quashed the same Justice Department subpoenas aimed at Jerome Powell and the Federal Reserve building renovation probe.',
      published_at: 1_773_509_513_000,
      temporal_ms: 1_773_509_513_000,
      entities: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
      linked_entities: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
      locations: ['washington'],
      trigger: 'subpoenaed',
      coarse_vector: [0.9, 0.1],
      full_vector: [0.9, 0.1],
    });

    expect(candidateEligible(followup, cluster)).toBe(true);
    expect(buildCandidateMatch(followup, cluster)).toMatchObject({
      adjudication: 'accepted',
    });
  });

  it('does not let broad same-institution topical drift bypass the long-window gate without strong lexical continuity', () => {
    const cluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-kennedy-a',
      source_id: 'pbs-kennedy-closure',
      title: 'Kennedy Center to close for 2 years for renovations in July, Trump says, after wave of cancellations',
      summary: 'Trump says the Kennedy Center will close for renovations after cancellations.',
      raw_text: 'Trump says the Kennedy Center will close for renovations after cancellations.',
      normalized_text: 'trump says kennedy center close renovations cancellations',
      translated_text: 'Trump says the Kennedy Center will close for renovations after cancellations.',
      published_at: 1_770_531_360_000,
      temporal_ms: 1_770_531_360_000,
      entities: ['kennedy_center_takeover_episode', 'kennedy_center', 'renovation_closure', 'richard_grenell'],
      linked_entities: ['kennedy_center_takeover_episode', 'kennedy_center', 'renovation_closure', 'richard_grenell'],
      locations: ['washington'],
      trigger: 'closure',
      coarse_vector: [0.86, 0.14],
      full_vector: [0.86, 0.14],
    }));

    const distantButBroad = makeWorkingDocument({
      doc_id: 'doc-kennedy-b',
      source_id: 'pbs-kennedy-interview',
      title: 'We cannot have art institutions that lose money: Grenell defends Kennedy Center takeover',
      summary: 'Grenell defends the takeover in an interview about finances and mission.',
      raw_text: 'Grenell defends the takeover in an interview about finances and mission.',
      normalized_text: 'grenell defends takeover interview finances mission',
      translated_text: 'Grenell defends the takeover in an interview about finances and mission.',
      published_at: 1_767_701_380_000,
      temporal_ms: 1_767_701_380_000,
      entities: ['kennedy_center_takeover_commentary', 'kennedy_center', 'richard_grenell', 'trump_takeover'],
      linked_entities: ['kennedy_center_takeover_commentary', 'kennedy_center', 'richard_grenell', 'trump_takeover'],
      locations: ['washington'],
      trigger: null,
      coverage_role: 'related',
      coarse_vector: [0.42, 0.58],
      full_vector: [0.42, 0.58],
    });

    expect(candidateEligible(distantButBroad, cluster)).toBe(false);
  });

  it('treats candidates near a long-running cluster start as within the ongoing-event window', () => {
    const cluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-window-a',
      source_id: 'wire-window-a',
      title: 'Federal Reserve probe opens with subpoena threat',
      summary: 'The Justice Department opens the Powell subpoena episode.',
      raw_text: 'The Justice Department opens the Powell subpoena episode.',
      normalized_text: 'justice department opens powell subpoena episode',
      translated_text: 'The Justice Department opens the Powell subpoena episode.',
      published_at: 1_768_180_699_000,
      temporal_ms: 1_768_180_699_000,
      entities: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve'],
      linked_entities: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve'],
      locations: ['washington'],
      trigger: 'subpoenaed',
      coarse_vector: [0.9, 0.1],
      full_vector: [0.9, 0.1],
    }));
    cluster.cluster_window_start = 1_768_180_699_000;
    cluster.cluster_window_end = 1_789_180_699_000;

    const candidate = makeWorkingDocument({
      doc_id: 'doc-window-b',
      source_id: 'wire-window-b',
      title: 'Powell subpoenas draw judge scrutiny early in the probe',
      summary: 'Early scrutiny builds around the same Powell subpoena episode.',
      raw_text: 'Early scrutiny builds around the same Powell subpoena episode.',
      normalized_text: 'early scrutiny builds around same powell subpoena episode',
      translated_text: 'Early scrutiny builds around the same Powell subpoena episode.',
      published_at: 1_768_094_299_000,
      temporal_ms: 1_768_094_299_000,
      entities: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve'],
      linked_entities: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve'],
      locations: [],
      trigger: 'subpoenaed',
      event_tuple: {
        description: 'Early scrutiny builds around the same Powell subpoena episode.',
        trigger: 'subpoenaed',
        who: [],
        where: [],
        when_ms: null,
        outcome: 'Judge scrutiny begins.',
      },
      coarse_vector: [0.89, 0.11],
      full_vector: [0.89, 0.11],
    });

    expect(candidateEligible(candidate, cluster)).toBe(true);
  });

  it('keeps year-scale legal dismantling episodes eligible when the canonical entity spine remains strong', () => {
    const cluster = makeClusterFromDocuments([
      makeWorkingDocument({
        doc_id: 'doc-cfpb-a',
        source_id: 'ap-cfpb-chaos',
        title: 'Federal official recounts chaos inside consumer agency after Trump fired its director',
        summary: 'A federal official recounts chaos inside the CFPB after the administration fired its director.',
        raw_text: 'A federal official recounts chaos inside the CFPB after the administration fired its director.',
        normalized_text: 'federal official recounts chaos inside cfpb after administration fired its director',
        translated_text: 'A federal official recounts chaos inside the CFPB after the administration fired its director.',
        published_at: 1_741_638_801_000,
        temporal_ms: 1_741_638_801_000,
        entities: ['cfpb_dismantling_episode', 'consumer_financial_protection_bureau', 'russell_vought', 'amy_berman_jackson', 'cfpb_shutdown_push'],
        linked_entities: ['cfpb_dismantling_episode', 'consumer_financial_protection_bureau', 'russell_vought', 'amy_berman_jackson', 'cfpb_shutdown_push'],
        locations: ['washington'],
        trigger: 'fired',
        event_tuple: {
          description: 'A federal official recounts chaos inside the CFPB after the administration fired its director.',
          trigger: 'fired',
          who: ['consumer_financial_protection_bureau'],
          where: ['washington'],
          when_ms: 1_741_638_801_000,
          outcome: 'The agency faces operational chaos.',
        },
        coarse_vector: [0.91, 0.09],
        full_vector: [0.91, 0.09],
      }),
      makeWorkingDocument({
        doc_id: 'doc-cfpb-b',
        source_id: 'ap-cfpb-block',
        title: 'Federal judge blocks Trump from dismantling consumer watchdog CFPB',
        summary: 'A judge blocks the administration from dismantling the CFPB.',
        raw_text: 'A judge blocks the administration from dismantling the CFPB in the same shutdown-and-layoffs legal fight.',
        normalized_text: 'judge blocks administration dismantling cfpb same shutdown layoffs legal fight',
        translated_text: 'A judge blocks the administration from dismantling the CFPB in the same shutdown-and-layoffs legal fight.',
        published_at: 1_743_194_873_000,
        temporal_ms: 1_743_194_873_000,
        entities: ['cfpb_dismantling_episode', 'consumer_financial_protection_bureau', 'russell_vought', 'amy_berman_jackson', 'cfpb_shutdown_push'],
        linked_entities: ['cfpb_dismantling_episode', 'consumer_financial_protection_bureau', 'russell_vought', 'amy_berman_jackson', 'cfpb_shutdown_push'],
        locations: ['washington'],
        trigger: 'blocked',
        event_tuple: {
          description: 'A judge blocks the administration from dismantling the CFPB.',
          trigger: 'blocked',
          who: ['consumer_financial_protection_bureau'],
          where: ['washington'],
          when_ms: 1_743_194_873_000,
          outcome: 'The dismantling plan is blocked.',
        },
        coarse_vector: [0.9, 0.1],
        full_vector: [0.9, 0.1],
      }),
      makeWorkingDocument({
        doc_id: 'doc-cfpb-c',
        source_id: 'ap-cfpb-layoffs',
        title: 'Judge pauses mass layoffs at consumer protection agency CFPB',
        summary: 'The court pauses mass layoffs at the CFPB.',
        raw_text: 'The court pauses mass layoffs at the CFPB in the same dismantling case over whether the agency could be hollowed out.',
        normalized_text: 'court pauses mass layoffs cfpb same dismantling case agency hollowed out',
        translated_text: 'The court pauses mass layoffs at the CFPB in the same dismantling case over whether the agency could be hollowed out.',
        published_at: 1_744_992_255_000,
        temporal_ms: 1_744_992_255_000,
        entities: ['cfpb_dismantling_episode', 'consumer_financial_protection_bureau', 'russell_vought', 'amy_berman_jackson', 'cfpb_shutdown_push'],
        linked_entities: ['cfpb_dismantling_episode', 'consumer_financial_protection_bureau', 'russell_vought', 'amy_berman_jackson', 'cfpb_shutdown_push'],
        locations: ['washington'],
        trigger: 'paused',
        event_tuple: {
          description: 'The court pauses mass layoffs at the CFPB.',
          trigger: 'paused',
          who: ['consumer_financial_protection_bureau'],
          where: ['washington'],
          when_ms: 1_744_992_255_000,
          outcome: 'Mass layoffs are paused.',
        },
        coarse_vector: [0.9, 0.1],
        full_vector: [0.9, 0.1],
      }),
    ]);

    const followup = makeWorkingDocument({
      doc_id: 'doc-cfpb-b',
      source_id: 'ap-cfpb-defunding',
      title: 'Judge blocks Trump administration from effectively defunding consumer protection agency',
      summary: 'The judge blocks a move to effectively defund the CFPB.',
      raw_text: 'The judge blocks a move to effectively defund the CFPB in the same dismantling case over layoffs and shutdown.',
      normalized_text: 'judge blocks move effectively defund cfpb same dismantling case layoffs shutdown',
      translated_text: 'The judge blocks a move to effectively defund the CFPB in the same dismantling case over layoffs and shutdown.',
      published_at: 1_767_113_974_000,
      temporal_ms: 1_767_113_974_000,
      entities: ['cfpb_dismantling_episode', 'consumer_financial_protection_bureau', 'russell_vought', 'amy_berman_jackson', 'cfpb_shutdown_push'],
      linked_entities: ['cfpb_dismantling_episode', 'consumer_financial_protection_bureau', 'russell_vought', 'amy_berman_jackson', 'cfpb_shutdown_push'],
      locations: ['washington'],
      trigger: 'blocked',
      event_tuple: {
        description: 'The judge blocks a move to effectively defund the CFPB in the same dismantling case.',
        trigger: 'blocked',
        who: ['consumer_financial_protection_bureau'],
        where: ['washington'],
        when_ms: 1_767_113_974_000,
        outcome: 'The CFPB funding remains in place.',
      },
      coarse_vector: [0.9, 0.1],
      full_vector: [0.9, 0.1],
    });

    expect(candidateEligible(followup, cluster)).toBe(true);
    expect(buildCandidateMatch(followup, cluster).adjudication).toBe('accepted');
  });
});
