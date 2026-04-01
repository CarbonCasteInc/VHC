import { describe, expect, it } from 'vitest';
import { deriveClusterRecord, toStoredSource, upsertClusterRecord } from './clusterRecords';
import { assignClusters } from './clusterLifecycle';
import { coverageRoleForDocumentType } from './documentPolicy';
import { MemoryClusterStore } from './clusterStore';
import type { StoryClusterInputDocument } from './contracts';
import type { PipelineState, StoredTopicState, WorkingDocument } from './stageState';
import { runStoryClusterStagePipeline } from './stageRunner';

function makeClock(start = 1_713_500_000_000): () => number {
  let tick = start;
  return () => {
    tick += 5;
    return tick;
  };
}

function makeInput(docId: string, title: string, publishedAt: number, overrides: Partial<StoryClusterInputDocument> = {}): StoryClusterInputDocument {
  return {
    doc_id: docId,
    source_id: overrides.source_id ?? `wire-${docId}`,
    publisher: overrides.publisher,
    title,
    summary: overrides.summary ?? `${title} summary.`,
    published_at: publishedAt,
    url: overrides.url ?? `https://example.com/${docId}`,
    canonical_url: overrides.canonical_url,
    url_hash: overrides.url_hash,
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys ?? ['geneva_talks'],
    translation_applied: overrides.translation_applied,
  };
}

function makeReplayInput(
  docId: string,
  title: string,
  publishedAt: number,
  sourceId: string,
  urlHash: string,
  summary: string,
  overrides: Partial<StoryClusterInputDocument> = {},
): StoryClusterInputDocument {
  return makeInput(docId, title, publishedAt, {
    source_id: sourceId,
    publisher: sourceId,
    url: `https://example.com/${sourceId}/${urlHash}`,
    canonical_url: `https://example.com/${sourceId}/${urlHash}`,
    url_hash: urlHash,
    summary,
    ...overrides,
  });
}

function makeWorkingDocument(docId: string, title: string, entity: string, trigger: string | null, vector: [number, number], publishedAt: number): WorkingDocument {
  return {
    ...makeInput(docId, title, publishedAt, { entity_keys: [entity] }),
    publisher: `Publisher ${docId}`,
    canonical_url: `https://example.com/${docId}`,
    url_hash: `hash-${docId}`,
    image_hash: undefined,
    summary: `${title} summary.`,
    source_variants: [{
      doc_id: docId,
      source_id: `wire-${docId}`,
      publisher: `Publisher ${docId}`,
      url: `https://example.com/${docId}`,
      canonical_url: `https://example.com/${docId}`,
      url_hash: `hash-${docId}`,
      published_at: publishedAt,
      title,
      summary: `${title} summary.`,
      language: 'en',
      translation_applied: false,
      coverage_role: 'canonical',
    }],
    raw_text: `${title}. ${title} summary.`,
    normalized_text: `${title.toLowerCase()} summary`,
    language: 'en',
    translated_title: title,
    translated_text: `${title}. ${title} summary.`,
    translation_gate: false,
    doc_type: 'hard_news',
    coverage_role: coverageRoleForDocumentType('hard_news'),
    doc_weight: 1,
    minhash_signature: [1, 2, 3],
    coarse_vector: vector,
    full_vector: vector,
    semantic_signature: `sig-${docId}`,
    event_tuple: null,
    entities: [entity],
    linked_entities: [entity],
    locations: ['geneva'],
    temporal_ms: publishedAt,
    trigger,
    candidate_matches: [],
    candidate_score: 0,
    hybrid_score: 0,
    rerank_score: 0,
    adjudication: 'accepted',
    cluster_key: 'topic-news',
  };
}

function makeEmptyState(topicState: StoredTopicState): PipelineState {
  return {
    topicId: topicState.topic_id,
    referenceNowMs: 1_714_000_000_000,
    documents: [],
    clusters: [],
    bundles: [],
    topic_state: topicState,
    stage_metrics: {},
  };
}

describe('StoryCluster identity replay hardening', () => {
  it('preserves story_id for repeated exact-source Cuba escalation coverage', async () => {
    const store = new MemoryClusterStore();
    const title = "Cuba's deputy foreign minister says it is preparing for possible U.S. 'military aggression'";
    const summary = 'Cuba says it is preparing for possible U.S. military aggression after Trump remarks escalated tensions.';

    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-cuba-escalation',
        documents: [
          makeReplayInput('cuba-1', title, 100, 'nbc-politics', '07f8408a', summary),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-cuba-escalation',
        documents: [
          makeReplayInput('cuba-2', title, 200, 'nbc-politics', '07f8408a', summary),
        ],
      },
      { clock: makeClock(1_713_500_010_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.primary_sources).toHaveLength(1);
    expect(second.bundles[0]?.headline).toContain("military aggression");
  });

  it('preserves story_id while the ICE/TSA airport episode grows around a persistent source', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-airport-ice',
        documents: [
          makeReplayInput(
            'airport-1',
            'Trump says ICE agents will assist TSA at airports as delays worsen',
            100,
            'cbs-politics',
            'bc734304',
            'Trump says ICE agents will assist TSA at airports as delays worsen while staffing shortages and shutdown delays mount.',
          ),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-airport-ice',
        documents: [
          makeReplayInput(
            'airport-2',
            'Trump says ICE agents will assist TSA at airports as delays worsen',
            110,
            'cbs-politics',
            'bc734304',
            'Trump says ICE agents will assist TSA at airports as delays worsen while staffing shortages and shutdown delays mount.',
          ),
          makeReplayInput(
            'airport-3',
            'ICE agents will be deployed to US airports on Monday to ease long lines',
            120,
            'guardian-us',
            '86a83b99',
            'ICE agents will be deployed to airports on Monday to ease long lines during the TSA staffing crunch.',
          ),
          makeReplayInput(
            'airport-4',
            'Trump says ICE agents will assist airport security as DHS shutdown continues',
            130,
            'bbc-us-canada',
            '56d52d4c',
            'Trump says ICE agents will assist airport security as the DHS shutdown continues and delays worsen.',
          ),
          makeReplayInput(
            'airport-5',
            'ICE officers set to deploy to airports as delays mount, border czar Homan confirms',
            140,
            'npr-politics',
            'dee86065',
            'ICE officers are set to deploy to airports as delays mount, Homan confirms.',
          ),
        ],
      },
      { clock: makeClock(1_713_500_020_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.primary_sources.map((source) => source.source_id).sort()).toEqual([
      'bbc-us-canada',
      'cbs-politics',
      'guardian-us',
      'npr-politics',
    ]);
  });

  it('merges Kharg Island live coverage when Axios restates the same Trump seizure angle', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-kharg-island',
        documents: [
          makeReplayInput(
            'kharg-1',
            "Trump says he wants Iran's oil and could seize Kharg Island",
            1774842195000,
            'nbc-politics',
            '74945b7c',
            'President Donald Trump said Sunday that he would like to "take the oil in Iran" and is considering seizing the export hub of Kharg Island, which is responsible for more than 90% of Iran\'s oil exports',
          ),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-kharg-island',
        documents: [
          makeReplayInput(
            'kharg-2',
            "Trump says he wants Iran's oil and could seize Kharg Island",
            1774842195000,
            'nbc-politics',
            '74945b7c',
            'President Donald Trump said Sunday that he would like to "take the oil in Iran" and is considering seizing the export hub of Kharg Island, which is responsible for more than 90% of Iran\'s oil exports',
          ),
          makeReplayInput(
            'kharg-3',
            'Iran war: How Kharg Island, Red Sea are shaping U.S. conflict in the Gulf',
            1773921600000,
            'axios-world',
            'kharg-axios-001',
            'Axios reported that Trump had long considered attacking or seizing Kharg Island because it could be an economic knockout to Iran, directly matching the island-seizure angle in the NBC story.',
          ),
        ],
      },
      { clock: makeClock(1_713_500_040_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.primary_sources.map((source) => source.source_id).sort()).toEqual([
      'axios-world',
      'nbc-politics',
    ]);
  });

  it('merges Dezi Freeman manhunt coverage across DW and Guardian without resetting identity', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-dezi-freeman',
        documents: [
          makeReplayInput(
            'dezi-1',
            'Australia police shoot dead man wanted for killing 2 officers',
            1774866620000,
            'dw-top',
            '76837f24',
            'After a seven-month manhunt involving hundreds of officers, Australian police finally caught up with Desmond Freeman, one of the country\'s most-wanted criminals.',
          ),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-dezi-freeman',
        documents: [
          makeReplayInput(
            'dezi-2',
            'Australia police shoot dead man wanted for killing 2 officers',
            1774866620000,
            'dw-top',
            '76837f24',
            'After a seven-month manhunt involving hundreds of officers, Australian police finally caught up with Desmond Freeman, one of the country\'s most-wanted criminals.',
          ),
          makeReplayInput(
            'dezi-3',
            'Dezi Freeman shot dead by police after seven-month manhunt',
            1774843800000,
            'guardian-australia',
            'dezi-guardian-001',
            'Fugitive Dezi Freeman, accused of killing two officers at Porepunkah, was fatally shot by police after a seven-month manhunt in rural Victoria.',
          ),
        ],
      },
      { clock: makeClock(1_713_500_050_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.primary_sources.map((source) => source.source_id).sort()).toEqual([
      'dw-top',
      'guardian-australia',
    ]);
  });

  it('merges the DHS airport-disruption episode when WaPo adds the ICE-lines follow-up framing', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-dhs-shutdown-exact',
        documents: [
          makeReplayInput(
            'shutdown-1',
            'TSA pay may be coming, but airport delays could persist and ICE agents may not leave soon',
            1774829322000,
            'abc-politics',
            'b84dea4f',
            'Heading into the weekend, President Donald Trump signed an executive order to pay the tens of thousands of TSA officers who have been working without pay for over a month during a partial government shutdown',
          ),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-dhs-shutdown-exact',
        documents: [
          makeReplayInput(
            'shutdown-2',
            'TSA pay may be coming, but airport delays could persist and ICE agents may not leave soon',
            1774829322000,
            'abc-politics',
            'b84dea4f',
            'Heading into the weekend, President Donald Trump signed an executive order to pay the tens of thousands of TSA officers who have been working without pay for over a month during a partial government shutdown',
          ),
          makeReplayInput(
            'shutdown-3',
            'Long lines persist at some U.S. airports despite arrival of ICE officers',
            1774270800000,
            'washington-post-immigration',
            'shutdown-wapo-001',
            'ICE officers were dispatched amid TSA staffing shortages caused by a congressional impasse over Department of Homeland Security funding, but long airport security lines persisted.',
          ),
        ],
      },
      { clock: makeClock(1_713_500_060_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.primary_sources.map((source) => source.source_id).sort()).toEqual([
      'abc-politics',
      'washington-post-immigration',
    ]);
  });

  it('merges the DHS airport-disruption episode when ABC Australia restates the same ICE checkpoint story', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-dhs-shutdown-abc-au',
        documents: [
          makeReplayInput(
            'shutdown-abc-au-1',
            'TSA pay may be coming, but airport delays could persist and ICE agents may not leave soon',
            1774829322000,
            'abc-politics',
            'b84dea4f',
            'Heading into the weekend, President Donald Trump signed an executive order to pay the tens of thousands of TSA officers who have been working without pay for over a month during a partial government shutdown',
          ),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-dhs-shutdown-abc-au',
        documents: [
          makeReplayInput(
            'shutdown-abc-au-2',
            'TSA pay may be coming, but airport delays could persist and ICE agents may not leave soon',
            1774829322000,
            'abc-politics',
            'b84dea4f',
            'Heading into the weekend, President Donald Trump signed an executive order to pay the tens of thousands of TSA officers who have been working without pay for over a month during a partial government shutdown',
          ),
          makeReplayInput(
            'shutdown-abc-au-3',
            'Donald Trump orders ICE agents to man US airport security checkpoints',
            1774308300000,
            'abc-au-world-politics',
            'tsa-ice-abc-au-001',
            'A fight over funding for the Department of Homeland Security has led to lengthy queues at US airports, with staff from the Transport Security Administration working without pay.',
          ),
        ],
      },
      { clock: makeClock(1_713_500_070_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.primary_sources.map((source) => source.source_id).sort()).toEqual([
      'abc-au-world-politics',
      'abc-politics',
    ]);
  });

  it('merges the Prop. 50 election-fraud probe across CBS and the LA Times ballots follow-up', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-bianco-prop-50',
        documents: [
          makeReplayInput(
            'bianco-1',
            'California sheriff says election fraud probe delayed by suits and court filings',
            1774852440000,
            'cbs-politics',
            'd49f48b3',
            'Riverside County Sheriff Chad Bianco says his election fraud probe of the Proposition 50 Special Election last fall has come to a halt due to "politically motivated lawsuits and court filings."',
          ),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-bianco-prop-50',
        documents: [
          makeReplayInput(
            'bianco-2',
            'California sheriff says election fraud probe delayed by suits and court filings',
            1774852440000,
            'cbs-politics',
            'd49f48b3',
            'Riverside County Sheriff Chad Bianco says his election fraud probe of the Proposition 50 Special Election last fall has come to a halt due to "politically motivated lawsuits and court filings."',
          ),
          makeReplayInput(
            'bianco-3',
            'More than half a million ballots seized by top GOP candidate in California governor’s race',
            1774076400000,
            'latimes-california',
            'bianco-lat-001',
            'Riverside County Sheriff Chad Bianco seized more than 650,000 Proposition 50 ballots, drawing a sharp rebuke from California Attorney General Rob Bonta and escalating the same election-fraud probe CBS described.',
          ),
        ],
      },
      { clock: makeClock(1_713_500_080_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.primary_sources.map((source) => source.source_id).sort()).toEqual([
      'cbs-politics',
      'latimes-california',
    ]);
  });

  it('keeps the Cuba tanker story from widening its canonical source set with the WaPo diesel-embassy follow-up', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-cuba-embassy-diesel',
        documents: [
          makeReplayInput(
            'cuba-separation-1',
            'Trump says he has "no problem" with Russian tanker bringing oil to Cuba',
            1774866620000,
            'cbs-politics',
            '2a55210c',
            'When asked if a New York Times report that the tanker would be allowed to reach Cuba was true, Mr. Trump said: "If a country wants to send some oil into Cuba right now, I have no problem whether it\'s Russia or not."',
          ),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-cuba-embassy-diesel',
        documents: [
          makeReplayInput(
            'cuba-separation-2',
            'Trump says he has "no problem" with Russian tanker bringing oil to Cuba',
            1774866620000,
            'cbs-politics',
            '2a55210c',
            'When asked if a New York Times report that the tanker would be allowed to reach Cuba was true, Mr. Trump said: "If a country wants to send some oil into Cuba right now, I have no problem whether it\'s Russia or not."',
          ),
          makeReplayInput(
            'cuba-separation-3',
            'Cuba refuses to let US Embassy in Havana import diesel for its generators',
            1774054620000,
            'washington-post-politics',
            'cuba-wapo-001',
            'The Cuban government refused a U.S. Embassy request to import diesel while the Trump administration kept a fuel blockade on the island and Russian oil shipments remained a live pressure point.',
          ),
        ],
      },
      { clock: makeClock(1_713_500_090_000), store },
    );

    const firstStoryId = first.bundles[0]?.story_id;
    expect(firstStoryId).toBeTruthy();
    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(firstStoryId);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.primary_sources.map((source) => source.source_id)).toEqual(['cbs-politics']);
    expect(second.bundles[0]?.sources.map((source) => source.source_id)).toEqual(['cbs-politics']);
  });

  it('preserves story_id while Mueller obituary coverage adds a second canonical source', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-mueller-obit',
        documents: [
          makeReplayInput(
            'mueller-1',
            'Robert Mueller, ex-FBI chief who led Trump-Russia investigation, dies at 81',
            100,
            'bbc-us-canada',
            '6ef5fdc8',
            'Robert Mueller, former FBI director and special counsel in the Trump-Russia investigation, has died at 81.',
          ),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-mueller-obit',
        documents: [
          makeReplayInput(
            'mueller-2',
            'Robert Mueller, ex-FBI chief who led Trump-Russia investigation, dies at 81',
            110,
            'bbc-us-canada',
            '6ef5fdc8',
            'Robert Mueller, former FBI director and special counsel in the Trump-Russia investigation, has died at 81.',
          ),
          makeReplayInput(
            'mueller-3',
            'Robert Mueller, former FBI Director who investigated Russia-Trump campaign ties, dies at 81',
            120,
            'pbs-politics',
            'a6fc02ae',
            'Robert Mueller, former FBI director who investigated Russia-Trump campaign ties, has died at 81.',
          ),
        ],
      },
      { clock: makeClock(1_713_500_030_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.primary_sources.map((source) => source.source_id).sort()).toEqual([
      'bbc-us-canada',
      'pbs-politics',
    ]);
  });

  it('preserves story_id and created_at across headline drift and multilingual restatements', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-geneva',
        documents: [
          makeInput('doc-1', 'Emergency Geneva talks begin after overnight missile strike hits fuel depots', 100),
          makeInput('doc-2', 'Mediators convene in Geneva after overnight strike damages fuel depots', 110),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-geneva',
        documents: [
          makeInput(
            'doc-3',
            'Gobiernos europeos reanudan las conversaciones de Ginebra tras el ataque nocturno',
            120,
            { language_hint: 'es' },
          ),
        ],
      },
      { clock: makeClock(1_713_500_010_000), store },
    );
    const third = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-geneva',
        documents: [
          makeInput('doc-4', 'Diplomats race to keep Geneva ceasefire talks alive after depot strike', 130),
        ],
      },
      { clock: makeClock(1_713_500_020_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(third.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(third.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(third.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.cluster_window_end).toBeGreaterThan(first.bundles[0]!.cluster_window_end);
    expect(third.bundles[0]?.cluster_window_end).toBeGreaterThan(second.bundles[0]!.cluster_window_end);
  });

  it('keeps the oldest survivor created_at during merges and records lineage', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-merge',
      next_cluster_seq: 1,
      clusters: [],
    };
    const older = makeWorkingDocument('doc-1', 'Port attack disrupts terminals overnight', 'port_attack', 'attack', [1, 0], 100);
    const newer = makeWorkingDocument('doc-2', 'Port attack disrupts terminals again', 'port_attack', 'attack', [1, 0], 120);
    topicState.clusters = [
      deriveClusterRecord(topicState, topicState.topic_id, [toStoredSource(older, older.source_variants[0]!)], 'story-old'),
      deriveClusterRecord(topicState, topicState.topic_id, [toStoredSource(newer, newer.source_variants[0]!)], 'story-new'),
    ];

    const next = await assignClusters(makeEmptyState(topicState));
    expect(next.topic_state.clusters).toHaveLength(1);
    expect(next.topic_state.clusters[0]?.story_id).toBe('story-old');
    expect(next.topic_state.clusters[0]?.created_at).toBe(100);
    expect(next.topic_state.clusters[0]?.lineage.merged_from).toEqual(['story-new']);
  });

  it('retains story identity through merge-split-merge pressure without leaking split window_end', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-merge-split-pressure',
      next_cluster_seq: 1,
      clusters: [],
    };
    const portA = makeWorkingDocument('doc-3', 'Port attack expands', 'port_attack', 'attack', [1, 0], 100);
    const portB = makeWorkingDocument('doc-4', 'Port attack response grows', 'port_attack', 'attack', [1, 0], 110);
    const portC = makeWorkingDocument('doc-5', 'Port attack recovery stalls', 'port_attack', 'attack', [1, 0], 120);
    const pipelineA = makeWorkingDocument('doc-6', 'Pipeline blast disrupts refineries', 'pipeline_attack', 'bombing', [0, 1], 130);
    const pipelineB = makeWorkingDocument('doc-7', 'Fuel shipments slow after pipeline blast', 'pipeline_attack', 'bombing', [0, 1], 140);
    const portShadow = makeWorkingDocument('doc-8', 'Insurers brace for prolonged port attack disruption', 'port_attack', 'attack', [1, 0], 150);
    topicState.clusters = [
      deriveClusterRecord(
        topicState,
        topicState.topic_id,
        [portA, portB].flatMap((document) => document.source_variants.map((variant) => toStoredSource(document, variant))),
        'story-stable',
      ),
      deriveClusterRecord(topicState, topicState.topic_id, [toStoredSource(portC, portC.source_variants[0]!)], 'story-shadow'),
    ];

    const merged = await assignClusters(makeEmptyState(topicState));
    const mergedSurvivor = merged.topic_state.clusters[0]!;
    expect(merged.topic_state.clusters).toHaveLength(1);
    expect(mergedSurvivor.story_id).toBe('story-stable');
    expect(mergedSurvivor.cluster_window_end).toBe(120);
    expect(mergedSurvivor.lineage.merged_from).toEqual(['story-shadow']);

    topicState.clusters = [
      upsertClusterRecord(mergedSurvivor, [
        toStoredSource(pipelineA, pipelineA.source_variants[0]!),
        toStoredSource(pipelineB, pipelineB.source_variants[0]!),
      ]),
    ];
    const split = await assignClusters(makeEmptyState(topicState));
    const splitSurvivor = split.topic_state.clusters.find((cluster) => cluster.story_id === 'story-stable');
    const splitChild = split.topic_state.clusters.find((cluster) => cluster.lineage.split_from === 'story-stable');

    expect(split.topic_state.clusters).toHaveLength(2);
    expect(splitSurvivor?.source_documents.map((document) => document.source_id)).toEqual(['wire-doc-3', 'wire-doc-4', 'wire-doc-5']);
    expect(splitSurvivor?.cluster_window_end).toBe(120);
    expect(splitChild?.source_documents.map((document) => document.source_id)).toEqual(['wire-doc-6', 'wire-doc-7']);
    expect(splitChild?.cluster_window_end).toBe(140);

    split.topic_state.clusters.push(
      deriveClusterRecord(split.topic_state, split.topicId, [toStoredSource(portShadow, portShadow.source_variants[0]!)], 'story-shadow-2'),
    );
    const remixed = await assignClusters(makeEmptyState(split.topic_state));
    const remixedSurvivor = remixed.topic_state.clusters.find((cluster) => cluster.story_id === 'story-stable');
    const remixedSplitChild = remixed.topic_state.clusters.find((cluster) => cluster.lineage.split_from === 'story-stable');

    expect(remixedSurvivor?.story_id).toBe('story-stable');
    expect(remixedSurvivor?.cluster_window_end).toBe(150);
    expect(remixedSurvivor?.lineage.merged_from).toEqual(['story-shadow', 'story-shadow-2']);
    expect(remixedSplitChild?.story_id).toBe(splitChild?.story_id);
    expect(remixedSplitChild?.cluster_window_end).toBe(140);
  });

  it('records split lineage and keeps the surviving cluster window monotonic', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-split',
      next_cluster_seq: 1,
      clusters: [],
    };
    const strikeA = makeWorkingDocument('doc-3', 'Port attack expands', 'port_attack', 'attack', [1, 0], 100);
    const strikeB = makeWorkingDocument('doc-4', 'Port attack response grows', 'port_attack', 'attack', [1, 0], 110);
    const marketA = makeWorkingDocument('doc-5', 'Market slump widens', 'market_slump', 'inflation', [0, 1], 120);
    const marketB = makeWorkingDocument('doc-6', 'Market slump deepens', 'market_slump', 'inflation', [0, 1], 130);
    topicState.clusters = [
      deriveClusterRecord(
        topicState,
        topicState.topic_id,
        [strikeA, strikeB, marketA, marketB].flatMap((document) => document.source_variants.map((variant) => toStoredSource(document, variant))),
        'story-stable',
      ),
    ];

    const next = await assignClusters(makeEmptyState(topicState));
    expect(next.topic_state.clusters).toHaveLength(2);

    const survivor = next.topic_state.clusters.find((cluster) => cluster.story_id === 'story-stable');
    const split = next.topic_state.clusters.find((cluster) => cluster.lineage.split_from === 'story-stable');

    expect(survivor).toBeDefined();
    expect(split).toBeDefined();
    expect(split?.created_at).toBeGreaterThanOrEqual(survivor!.created_at);
    expect(survivor?.cluster_window_end).toBeGreaterThanOrEqual(survivor!.cluster_window_start);
  });

  it('preserves split-child story identity when both survivor and child receive later follow-up coverage', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-split-follow-up',
      next_cluster_seq: 1,
      clusters: [],
    };
    const strikeA = makeWorkingDocument('doc-9', 'Port attack expands', 'port_attack', 'attack', [1, 0], 100);
    const strikeB = makeWorkingDocument('doc-10', 'Port attack response grows', 'port_attack', 'attack', [1, 0], 110);
    const marketA = makeWorkingDocument('doc-11', 'Market slump widens', 'market_slump', 'inflation', [0, 1], 120);
    const marketB = makeWorkingDocument('doc-12', 'Market slump deepens', 'market_slump', 'inflation', [0, 1], 130);
    const strikeC = makeWorkingDocument('doc-13', 'Port attack recovery slows', 'port_attack', 'attack', [1, 0], 140);
    const marketC = makeWorkingDocument('doc-14', 'Market slump drags into late trading', 'market_slump', 'inflation', [0, 1], 150);
    topicState.clusters = [
      deriveClusterRecord(
        topicState,
        topicState.topic_id,
        [strikeA, strikeB, marketA, marketB].flatMap((document) => document.source_variants.map((variant) => toStoredSource(document, variant))),
        'story-anchor',
      ),
    ];

    const split = await assignClusters(makeEmptyState(topicState));
    const survivor = split.topic_state.clusters.find((cluster) => cluster.story_id === 'story-anchor');
    const splitChild = split.topic_state.clusters.find((cluster) => cluster.lineage.split_from === 'story-anchor');
    expect(survivor).toBeDefined();
    expect(splitChild).toBeDefined();

    split.topic_state.clusters = [
      upsertClusterRecord(survivor!, [toStoredSource(strikeC, strikeC.source_variants[0]!)]),
      upsertClusterRecord(splitChild!, [toStoredSource(marketC, marketC.source_variants[0]!)]),
    ];
    const next = await assignClusters(makeEmptyState(split.topic_state));
    const nextSurvivor = next.topic_state.clusters.find((cluster) => cluster.story_id === 'story-anchor');
    const nextSplitChild = next.topic_state.clusters.find((cluster) => cluster.story_id === splitChild?.story_id);

    expect(next.topic_state.clusters).toHaveLength(2);
    expect(nextSurvivor?.story_id).toBe('story-anchor');
    expect(nextSurvivor?.cluster_window_end).toBe(140);
    expect(nextSplitChild?.story_id).toBe(splitChild?.story_id);
    expect(nextSplitChild?.lineage.split_from).toBe('story-anchor');
    expect(nextSplitChild?.cluster_window_end).toBe(150);
  });

  it('reuses the existing split-child story id when contamination recurs across a longer window', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-recurring-contamination',
      next_cluster_seq: 1,
      clusters: [],
    };
    const strikeA = makeWorkingDocument('doc-15', 'Port attack expands', 'port_attack', 'attack', [1, 0], 100);
    const strikeB = makeWorkingDocument('doc-16', 'Port attack response grows', 'port_attack', 'attack', [1, 0], 110);
    const marketA = makeWorkingDocument('doc-17', 'Market slump widens', 'market_slump', 'inflation', [0, 1], 120);
    const marketB = makeWorkingDocument('doc-18', 'Market slump deepens', 'market_slump', 'inflation', [0, 1], 130);
    const strikeC = makeWorkingDocument('doc-19', 'Port attack recovery slows', 'port_attack', 'attack', [1, 0], 140);
    const marketC = makeWorkingDocument('doc-20', 'Late-session market selloff accelerates', 'market_slump', 'inflation', [0, 1], 150);
    const marketD = makeWorkingDocument('doc-21', 'Analysts warn the market slump will spread', 'market_slump', 'inflation', [0, 1], 160);
    topicState.clusters = [
      deriveClusterRecord(
        topicState,
        topicState.topic_id,
        [strikeA, strikeB, marketA, marketB].flatMap((document) => document.source_variants.map((variant) => toStoredSource(document, variant))),
        'story-anchor',
      ),
    ];

    const split = await assignClusters(makeEmptyState(topicState));
    const survivor = split.topic_state.clusters.find((cluster) => cluster.story_id === 'story-anchor');
    const splitChild = split.topic_state.clusters.find((cluster) => cluster.lineage.split_from === 'story-anchor');

    expect(survivor).toBeDefined();
    expect(splitChild).toBeDefined();

    split.topic_state.clusters = [
      upsertClusterRecord(survivor!, [
        toStoredSource(strikeC, strikeC.source_variants[0]!),
        toStoredSource(marketC, marketC.source_variants[0]!),
        toStoredSource(marketD, marketD.source_variants[0]!),
      ]),
      splitChild!,
    ];
    const corrected = await assignClusters(makeEmptyState(split.topic_state));
    const correctedSurvivor = corrected.topic_state.clusters.find((cluster) => cluster.story_id === 'story-anchor');
    const correctedSplitChildren = corrected.topic_state.clusters.filter((cluster) => cluster.lineage.split_from === 'story-anchor');

    expect(correctedSurvivor?.cluster_window_end).toBe(140);
    expect(correctedSplitChildren).toHaveLength(1);
    expect(correctedSplitChildren[0]?.story_id).toBe(splitChild?.story_id);
    expect(correctedSplitChildren[0]?.cluster_window_end).toBe(160);
  });
});
