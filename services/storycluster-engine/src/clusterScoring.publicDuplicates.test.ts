import { describe, expect, it } from 'vitest';
import { buildCandidateMatch, candidateEligible } from './clusterScoring';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import type { StoredTopicState, WorkingDocument } from './stageState';

function makeWorkingDocument(overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    doc_id: overrides.doc_id ?? 'doc-1',
    source_id: overrides.source_id ?? 'source-a',
    publisher: overrides.publisher ?? 'Reuters',
    title: overrides.title ?? 'Headline',
    summary: overrides.summary ?? 'Summary.',
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
      source_id: overrides.source_id ?? 'source-a',
      publisher: overrides.publisher ?? 'Reuters',
      url: overrides.url ?? 'https://example.com/1',
      canonical_url: overrides.canonical_url ?? 'https://example.com/1',
      url_hash: overrides.url_hash ?? 'hash-1',
      published_at: overrides.published_at ?? 100,
      title: overrides.title ?? 'Headline',
      summary: overrides.summary ?? 'Summary.',
      language: 'en',
      translation_applied: false,
      coverage_role: overrides.coverage_role ?? 'canonical',
    }],
    raw_text: overrides.raw_text ?? `${overrides.title ?? 'Headline'}. ${overrides.summary ?? 'Summary.'}`,
    normalized_text: overrides.normalized_text ?? 'headline summary',
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? overrides.title ?? 'Headline',
    translated_text: overrides.translated_text ?? `${overrides.title ?? 'Headline'}. ${overrides.summary ?? 'Summary.'}`,
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'hard_news',
    coverage_role: overrides.coverage_role ?? 'canonical',
    doc_weight: overrides.doc_weight ?? 1,
    minhash_signature: overrides.minhash_signature ?? [1, 2, 3],
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0],
    semantic_signature: overrides.semantic_signature ?? 'sig-1',
    event_tuple: overrides.event_tuple ?? null,
    entities: overrides.entities ?? [],
    linked_entities: overrides.linked_entities ?? [],
    locations: overrides.locations ?? [],
    temporal_ms: overrides.temporal_ms ?? overrides.published_at ?? 100,
    trigger: overrides.trigger ?? null,
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

describe('clusterScoring public duplicate families', () => {
  it('matches the White House flag-burning duplicate pair as the same canonical event', () => {
    const cluster = makeCluster(makeWorkingDocument({
      source_id: 'cbs-politics',
      title: 'DOJ moves to drop charges against man who burned American flag outside White House',
      summary: 'Federal prosecutors are moving to drop the Jan Carey flag-burning case outside the White House.',
      entities: ['flag', 'white_house', 'jan_carey'],
      linked_entities: ['white_house_flag_burning_case', 'jan_carey', 'white_house'],
      locations: ['white_house'],
      trigger: 'drops',
      event_tuple: {
        description: 'DOJ moves to drop charges in the Jan Carey flag-burning case.',
        trigger: 'drops',
        who: ['jan_carey'],
        where: ['white_house'],
        when_ms: 100,
        outcome: 'charges dropped',
      },
    }));

    const candidate = buildCandidateMatch(makeWorkingDocument({
      doc_id: 'doc-flag-nbc',
      source_id: 'nbc-politics',
      title: 'DOJ drops case against veteran arrested after burning U.S. flag near White House',
      summary: 'The Jan Carey flag-burning case near the White House is being dropped.',
      entities: ['flag', 'white_house', 'jan_carey'],
      linked_entities: ['white_house_flag_burning_case', 'jan_carey', 'white_house'],
      locations: ['white_house'],
      trigger: 'drops',
      event_tuple: {
        description: 'DOJ drops the Jan Carey flag-burning case near the White House.',
        trigger: 'drops',
        who: ['jan_carey'],
        where: ['white_house'],
        when_ms: 101,
        outcome: 'charges dropped',
      },
    }), cluster);

    expect(candidateEligible(makeWorkingDocument({
      doc_id: 'doc-flag-nbc',
      source_id: 'nbc-politics',
      title: 'DOJ drops case against veteran arrested after burning U.S. flag near White House',
      summary: 'The Jan Carey flag-burning case near the White House is being dropped.',
      entities: ['flag', 'white_house', 'jan_carey'],
      linked_entities: ['white_house_flag_burning_case', 'jan_carey', 'white_house'],
      locations: ['white_house'],
      trigger: 'drops',
      event_tuple: {
        description: 'DOJ drops the Jan Carey flag-burning case near the White House.',
        trigger: 'drops',
        who: ['jan_carey'],
        where: ['white_house'],
        when_ms: 101,
        outcome: 'charges dropped',
      },
    }), cluster)).toBe(true);
    expect(candidate.adjudication).toBe('accepted');
  });

  it('matches the Powell subpoena/probe variants without promoting related video coverage', () => {
    const cluster = makeCluster(makeWorkingDocument({
      source_id: 'cnn-politics',
      title: 'Federal judge quashes Justice Department subpoenas of Fed Chair Jerome Powell',
      summary: 'A federal judge quashed subpoenas targeting Jerome Powell.',
      entities: ['federal_judge', 'jerome_powell'],
      linked_entities: ['jerome_powell_subpoena_case', 'federal_judge', 'jerome_powell'],
      trigger: 'quashes',
      event_tuple: {
        description: 'A federal judge quashes Justice Department subpoenas of Jerome Powell.',
        trigger: 'quashes',
        who: ['federal_judge'],
        where: [],
        when_ms: 100,
        outcome: 'subpoenas quashed',
      },
    }));

    const candidate = buildCandidateMatch(makeWorkingDocument({
      doc_id: 'doc-powell-bbc',
      source_id: 'bbc-us-canada',
      title: "Judge says 'no evidence' to justify Federal Reserve probe",
      summary: 'The judge said the Justice Department subpoenas targeting Jerome Powell lacked evidence.',
      entities: ['federal_judge', 'jerome_powell', 'federal_reserve'],
      linked_entities: ['jerome_powell_subpoena_case', 'federal_judge', 'jerome_powell'],
      trigger: 'probe',
      event_tuple: {
        description: 'The judge said the Justice Department probe of Jerome Powell lacked evidence.',
        trigger: 'probe',
        who: ['federal_judge'],
        where: [],
        when_ms: 101,
        outcome: 'probe lacked evidence',
      },
    }), cluster);

    expect(candidateEligible(makeWorkingDocument({
      doc_id: 'doc-powell-bbc',
      source_id: 'bbc-us-canada',
      title: "Judge says 'no evidence' to justify Federal Reserve probe",
      summary: 'The judge said the Justice Department subpoenas targeting Jerome Powell lacked evidence.',
      entities: ['federal_judge', 'jerome_powell', 'federal_reserve'],
      linked_entities: ['jerome_powell_subpoena_case', 'federal_judge', 'jerome_powell'],
      trigger: 'probe',
      event_tuple: {
        description: 'The judge said the Justice Department probe of Jerome Powell lacked evidence.',
        trigger: 'probe',
        who: ['federal_judge'],
        where: [],
        when_ms: 101,
        outcome: 'probe lacked evidence',
      },
    }), cluster)).toBe(true);
    expect(candidate.adjudication).toBe('accepted');
  });

  it('matches the Old Dominion weapon-case variants as one attack narrative', () => {
    const cluster = makeCluster(makeWorkingDocument({
      source_id: 'cnn-politics',
      title: 'Case against man prosecutors say sold gun to Old Dominion shooter provides new details on the attack',
      summary: 'Prosecutors detailed the weapon-sale case tied to the Old Dominion attack.',
      entities: ['old_dominion_shooter', 'weapon', 'attack'],
      linked_entities: ['old_dominion_attack_weapon_case', 'old_dominion_shooter'],
      locations: ['virginia'],
      trigger: 'provides',
      event_tuple: {
        description: 'Prosecutors detailed the weapon-sale case tied to the Old Dominion attack.',
        trigger: 'provides',
        who: ['old_dominion_attack_weapon_case'],
        where: ['virginia'],
        when_ms: 100,
        outcome: 'new details on the attack',
      },
    }));

    const candidate = buildCandidateMatch(makeWorkingDocument({
      doc_id: 'doc-old-dominion-bbc',
      source_id: 'bbc-us-canada',
      title: 'Man charged for allegedly selling weapon to gunman in Virginia university attack',
      summary: 'A man was charged in the weapon-sale case connected to the Old Dominion attack.',
      entities: ['gunman', 'weapon', 'attack'],
      linked_entities: ['old_dominion_attack_weapon_case', 'old_dominion_shooter'],
      locations: ['virginia'],
      trigger: 'charged',
      event_tuple: {
        description: 'A man was charged in the weapon-sale case connected to the Old Dominion attack.',
        trigger: 'charged',
        who: ['old_dominion_attack_weapon_case'],
        where: ['virginia'],
        when_ms: 101,
        outcome: 'weapon-sale charge filed',
      },
    }), cluster);

    expect(candidateEligible(makeWorkingDocument({
      doc_id: 'doc-old-dominion-bbc',
      source_id: 'bbc-us-canada',
      title: 'Man charged for allegedly selling weapon to gunman in Virginia university attack',
      summary: 'A man was charged in the weapon-sale case connected to the Old Dominion attack.',
      entities: ['gunman', 'weapon', 'attack'],
      linked_entities: ['old_dominion_attack_weapon_case', 'old_dominion_shooter'],
      locations: ['virginia'],
      trigger: 'charged',
      event_tuple: {
        description: 'A man was charged in the weapon-sale case connected to the Old Dominion attack.',
        trigger: 'charged',
        who: ['old_dominion_attack_weapon_case'],
        where: ['virginia'],
        when_ms: 101,
        outcome: 'weapon-sale charge filed',
      },
    }), cluster)).toBe(true);
    expect(candidate.adjudication).toBe('accepted');
  });

  it('matches the prank-death variants as one canonical incident', () => {
    const cluster = makeCluster(makeWorkingDocument({
      source_id: 'bbc-us-canada',
      title: 'Charges dropped against Georgia teens whose teacher died during toilet paper prank',
      summary: 'Charges were dropped after a teacher died during a prank in Georgia.',
      entities: ['teacher', 'prank', 'georgia_teens'],
      linked_entities: ['teacher_prank_death_case', 'georgia_teens'],
      locations: ['georgia'],
      trigger: 'dropped',
      event_tuple: {
        description: 'Charges were dropped after a teacher died during a prank in Georgia.',
        trigger: 'dropped',
        who: ['teacher_prank_death_case'],
        where: ['georgia'],
        when_ms: 100,
        outcome: 'charges dropped',
      },
    }));

    const candidate = buildCandidateMatch(makeWorkingDocument({
      doc_id: 'doc-prank-huffpost',
      source_id: 'huffpost-us',
      title: 'Prosecutor Drops Criminal Charge Against Teen After Teacher Dies In Prank Mishap',
      summary: 'A prosecutor dropped the charge after a teacher died in the prank case.',
      entities: ['teacher', 'prank', 'teen'],
      linked_entities: ['teacher_prank_death_case', 'georgia_teens'],
      locations: ['georgia'],
      trigger: 'drops',
      event_tuple: {
        description: 'A prosecutor dropped the charge after a teacher died in the prank case.',
        trigger: 'drops',
        who: ['teacher_prank_death_case'],
        where: ['georgia'],
        when_ms: 101,
        outcome: 'charge dropped',
      },
    }), cluster);

    expect(candidate.adjudication).toBe('accepted');
  });

  it('matches the pardon-lobbyist extortion variants as one canonical incident', () => {
    const cluster = makeCluster(makeWorkingDocument({
      source_id: 'cnn-politics',
      title: 'Lobbyist tied to pardon from Trump charged with attempted extortion',
      summary: 'A lobbyist connected to a pardon effort was charged with attempted extortion.',
      entities: ['lobbyist', 'donald_trump', 'extortion'],
      linked_entities: ['pardon_lobbyist_extortion_case', 'lobbyist', 'donald_trump'],
      locations: ['new_york'],
      trigger: 'charged',
      event_tuple: {
        description: 'A lobbyist tied to a pardon effort was charged with attempted extortion.',
        trigger: 'charged',
        who: ['pardon_lobbyist_extortion_case'],
        where: ['new_york'],
        when_ms: 100,
        outcome: 'attempted extortion charge filed',
      },
    }));

    const candidate = buildCandidateMatch(makeWorkingDocument({
      doc_id: 'doc-extortion-ap',
      source_id: 'ap-politics',
      title: 'A pardon lobbyist, $500,000 demand and alleged enforcer lead to extortion charge in New York',
      summary: 'New York prosecutors filed an extortion case tied to a pardon lobbyist and alleged enforcer.',
      entities: ['lobbyist', 'extortion', 'new_york'],
      linked_entities: ['pardon_lobbyist_extortion_case', 'lobbyist'],
      locations: ['new_york'],
      trigger: 'lead',
      event_tuple: {
        description: 'Prosecutors filed an extortion case tied to a pardon lobbyist in New York.',
        trigger: 'charged',
        who: ['pardon_lobbyist_extortion_case'],
        where: ['new_york'],
        when_ms: 101,
        outcome: 'extortion charge filed',
      },
    }), cluster);

    expect(candidateEligible(makeWorkingDocument({
      doc_id: 'doc-extortion-ap',
      source_id: 'ap-politics',
      title: 'A pardon lobbyist, $500,000 demand and alleged enforcer lead to extortion charge in New York',
      summary: 'New York prosecutors filed an extortion case tied to a pardon lobbyist and alleged enforcer.',
      entities: ['lobbyist', 'extortion', 'new_york'],
      linked_entities: ['pardon_lobbyist_extortion_case', 'lobbyist'],
      locations: ['new_york'],
      trigger: 'lead',
      event_tuple: {
        description: 'Prosecutors filed an extortion case tied to a pardon lobbyist in New York.',
        trigger: 'charged',
        who: ['pardon_lobbyist_extortion_case'],
        where: ['new_york'],
        when_ms: 101,
        outcome: 'extortion charge filed',
      },
    }), cluster)).toBe(true);
    expect(candidate.adjudication).toBe('accepted');
  });

  it('matches live prank-death variants even when the duplicate alias falls below the cluster top-k entity surface', () => {
    const cluster = makeCluster(makeWorkingDocument({
      source_id: 'huffpost-us',
      publisher: 'huffpost-us',
      title: 'Prosecutor Drops Criminal Charge Against Teen After Teacher Dies In Prank Mishap',
      summary: 'The 40-year-old teacher slipped and fell on a wet surface and was struck by a vehicle during the course of a lighthearted prank.',
      entities: [
        'charge',
        'course',
        'criminal',
        'dies',
        'drops',
        'during',
        'fell',
        'lighthearted',
        'mishap',
        'prank',
        'prosecutor',
        'slipped',
        'struck',
        'surface',
        'teacher',
        'teen',
        'vehicle',
        'year',
      ],
      linked_entities: [
        'charge',
        'course',
        'criminal',
        'dies',
        'drops',
        'during',
        'fell',
        'lighthearted',
        'mishap',
        'prank',
        'prosecutor',
        'slipped',
        'struck',
        'surface',
        'teacher',
        'teacher_prank_death_case',
        'teen',
        'vehicle',
        'year',
      ],
      trigger: 'drops',
      published_at: 216_000_100,
      temporal_ms: 216_000_100,
      event_tuple: {
        description: 'Criminal charge against a teen was dropped after a teacher died in a prank mishap.',
        trigger: 'drops',
        who: ['prosecutor'],
        where: [],
        when_ms: 216_000_100,
        outcome: 'charge dropped',
      },
    }));

    const candidateDocument = makeWorkingDocument({
      doc_id: 'doc-prank-bbc-live',
      source_id: 'bbc-us-canada',
      publisher: 'bbc-us-canada',
      title: 'Charges dropped against teens whose teacher died during toilet paper prank',
      summary: "The teacher's family had asked for charges to be dropped to prevent the students' lives being ruined.",
      entities: [
        'asked',
        'charges',
        'died',
        'dropped',
        'during',
        'family',
        'lives',
        'paper',
        'prank',
        'prevent',
        'ruined',
        'students',
        'teacher',
        'teens',
        'toilet',
        'whose',
      ],
      linked_entities: [
        'asked',
        'charges',
        'died',
        'dropped',
        'during',
        'family',
        'lives',
        'paper',
        'prank',
        'prevent',
        'ruined',
        'students',
        'teacher',
        'teacher_prank_death_case',
        'teens',
        'toilet',
        'whose',
      ],
      trigger: 'dropped',
      published_at: 216_000_200,
      temporal_ms: 216_000_200,
      event_tuple: {
        description: "Charges against teens dropped after teacher's family request.",
        trigger: 'charges dropped',
        who: ['teacher_s_family', 'teens'],
        where: [],
        when_ms: 216_000_200,
        outcome: 'charges dropped',
      },
    });

    expect(candidateEligible(candidateDocument, cluster)).toBe(true);
    expect(buildCandidateMatch(candidateDocument, cluster).adjudication).toBe('accepted');
  });

  it('rejects State Department topical overlap when the specific incident aliases differ', () => {
    const cluster = makeCluster(makeWorkingDocument({
      source_id: 'yahoo-world',
      title: "U.S. offers $10 million, chance to relocate for info on Iran's leaders",
      summary: 'The State Department is offering money and relocation for information on Iran leaders.',
      entities: ['iran', 'state_department', 'leaders'],
      linked_entities: ['iran_leadership_bounty', 'state_department'],
      locations: ['iran'],
      trigger: 'offers',
      event_tuple: {
        description: 'The State Department offers money for information on Iran leaders.',
        trigger: 'offers',
        who: ['state_department'],
        where: ['iran'],
        when_ms: 100,
        outcome: 'reward offered',
      },
      coarse_vector: [0.95, 0.05],
      full_vector: [0.94, 0.06],
    }));

    const candidateDocument = makeWorkingDocument({
      doc_id: 'doc-citizenship',
      source_id: 'huffpost-us',
      title: 'The State Department Just Made It A Lot Cheaper For Americans To Give Up Citizenship',
      summary: 'The State Department sharply reduced the fee to renounce citizenship.',
      entities: ['citizenship', 'state_department', 'americans'],
      linked_entities: ['citizenship_renunciation_fee_cut', 'state_department'],
      trigger: 'made',
      event_tuple: {
        description: 'The State Department reduced the fee to renounce citizenship.',
        trigger: 'made',
        who: ['state_department'],
        where: [],
        when_ms: 101,
        outcome: 'fee reduced',
      },
      coarse_vector: [0.91, 0.09],
      full_vector: [0.9, 0.1],
    });

    const candidate = buildCandidateMatch(candidateDocument, cluster);

    expect(candidateEligible(candidateDocument, cluster)).toBe(false);
    expect(candidate.adjudication).toBe('rejected');
  });
});
