import { describe, expect, it } from 'vitest';
import { assignClusters } from './clusterLifecycle';
import { MemoryClusterStore } from './clusterStore';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { STORYCLUSTER_REPLAY_SCENARIOS } from './benchmarkCorpusReplays';
import { coherenceAuditInternal } from './coherenceAudit';
import { coverageRoleForDocumentType } from './documentPolicy';
import { liveBenchmarkInternal } from './liveBenchmark';
import { runStoryClusterRemoteContract } from './remoteContract';
import type { PipelineState, StoredClusterRecord, StoredTopicState, WorkingDocument } from './stageState';

interface ReplaySnapshot {
  tickIndex: number;
  clusters: StoredClusterRecord[];
  storyByEvent: Map<string, string | null>;
}

function scenarioById(id: string) {
  const scenario = STORYCLUSTER_REPLAY_SCENARIOS.find((candidate) => candidate.scenario_id === id);
  expect(scenario, `missing replay scenario ${id}`).toBeDefined();
  return scenario!;
}

async function collectReplaySnapshots(scenarioId: string): Promise<ReplaySnapshot[]> {
  const scenario = scenarioById(scenarioId);
  const store = new MemoryClusterStore();
  const expectedByKey = new Map<string, string>();
  const snapshots: ReplaySnapshot[] = [];

  for (let tickIndex = 0; tickIndex < scenario.ticks.length; tickIndex += 1) {
    const tick = scenario.ticks[tickIndex]!;
    tick.forEach((item) => {
      expectedByKey.set(coherenceAuditInternal.itemEventKey(item), item.expected_event_id);
    });
    await runStoryClusterRemoteContract(
      { topic_id: scenario.topic_id, items: tick.map(({ expected_event_id: _omit, ...item }) => item) },
      { store, clock: () => 1_715_000_000_000 + tickIndex * 1_000 },
    );
    const clusters = store.loadTopic(scenario.topic_id).clusters;
    const bundles = clusters.map(liveBenchmarkInternal.bundleFromCluster);
    const storyByEvent = new Map<string, string | null>();
    for (const [eventId, storyIds] of liveBenchmarkInternal.eventStoryIdsFromBundles(bundles, expectedByKey)) {
      storyByEvent.set(eventId, liveBenchmarkInternal.singleStoryId(storyIds));
    }
    snapshots.push({ tickIndex, clusters, storyByEvent });
  }

  return snapshots;
}

function clusterForEvent(snapshot: ReplaySnapshot, eventId: string): StoredClusterRecord {
  const storyId = snapshot.storyByEvent.get(eventId);
  expect(storyId, `missing story id for ${eventId} at tick ${snapshot.tickIndex}`).toBeTruthy();
  const cluster = snapshot.clusters.find((candidate) => candidate.story_id === storyId);
  expect(cluster, `missing cluster for ${eventId} at tick ${snapshot.tickIndex}`).toBeDefined();
  return cluster!;
}

function makeWorkingDocument(docId: string, title: string, entity: string, trigger: string | null, vector: [number, number]): WorkingDocument {
  return {
    doc_id: docId,
    source_id: `source-${docId}`,
    publisher: `Publisher ${docId}`,
    title,
    summary: `${title} summary.`,
    body: undefined,
    published_at: 100 + Number(docId.at(-1) ?? '0'),
    url: `https://example.com/${docId}`,
    canonical_url: `https://example.com/${docId}`,
    url_hash: `hash-${docId}`,
    image_hash: undefined,
    language_hint: undefined,
    entity_keys: [entity],
    translation_applied: false,
    source_variants: [{
      doc_id: docId,
      source_id: `source-${docId}`,
      publisher: `Publisher ${docId}`,
      url: `https://example.com/${docId}`,
      canonical_url: `https://example.com/${docId}`,
      url_hash: `hash-${docId}`,
      published_at: 100 + Number(docId.at(-1) ?? '0'),
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
    locations: [],
    temporal_ms: 100,
    trigger,
    candidate_matches: [],
    candidate_score: 0,
    hybrid_score: 0,
    rerank_score: 0,
    adjudication: 'accepted',
    cluster_key: 'topic-replay-evidence',
  };
}

describe('StoryCluster replay evidence', () => {
  it('preserves story ids while source coverage grows and multilingual restatements arrive', async () => {
    const snapshots = await collectReplaySnapshots('replay-capital-blackout-source-growth');
    const storyIds = snapshots.map((snapshot) => clusterForEvent(snapshot, 'capital_blackout').story_id);
    const sourceCounts = snapshots.map((snapshot) => clusterForEvent(snapshot, 'capital_blackout').source_documents.length);
    const finalLanguages = new Set(clusterForEvent(snapshots[snapshots.length - 1]!, 'capital_blackout').source_documents.map((document) => document.language));

    expect(new Set(storyIds).size).toBe(1);
    expect(sourceCounts).toEqual([1, 2, 3, 4]);
    expect([...finalLanguages].sort()).toEqual(['en', 'es']);
    expect(clusterForEvent(snapshots[snapshots.length - 1]!, 'capital_blackout').source_documents.some((document) => document.translation_applied)).toBe(true);
  });

  it('keeps the same story id even when the dominant headline drifts across ticks', async () => {
    const snapshots = await collectReplaySnapshots('replay-harbor-fire-headline-drift');
    const storyIds = snapshots.map((snapshot) => clusterForEvent(snapshot, 'harbor_fire').story_id);
    const headlines = snapshots.map((snapshot) => clusterForEvent(snapshot, 'harbor_fire').headline);

    expect(new Set(storyIds).size).toBe(1);
    expect(headlines[0]).not.toBe(headlines[headlines.length - 1]);
    expect(headlines).toEqual([
      'Chemical fire at harbor terminal triggers midnight evacuations',
      'Residents told to shelter away from smoke near the harbor',
      'Inspectors enter burned warehouse after harbor blaze is contained',
    ]);
  });

  it('drops an event from emitted bundles during a gap tick and restores the same story id on return', async () => {
    const scenario = scenarioById('replay-harbor-fire-gap-return');
    const store = new MemoryClusterStore();
    const emittedStoryIds: string[][] = [];
    const storedStoryIds: string[][] = [];

    for (let tickIndex = 0; tickIndex < scenario.ticks.length; tickIndex += 1) {
      const tick = scenario.ticks[tickIndex]!;
      const response = await runStoryClusterRemoteContract(
        { topic_id: scenario.topic_id, items: tick.map(({ expected_event_id: _omit, ...item }) => item) },
        { store, clock: () => 1_715_100_000_000 + tickIndex * 1_000 },
      );
      emittedStoryIds.push(response.bundles.map((bundle) => bundle.story_id));
      storedStoryIds.push(store.loadTopic(scenario.topic_id).clusters.map((cluster) => cluster.story_id));
    }

    const stableStoryId = emittedStoryIds[0]?.[0];
    expect(stableStoryId).toBeTruthy();
    expect(emittedStoryIds).toEqual([[stableStoryId!], [], [stableStoryId!]]);
    expect(storedStoryIds[1]).toContain(stableStoryId);
    expect(store.loadTopic(scenario.topic_id).clusters[0]?.source_documents.map((document) => document.source_id)).toEqual([
      'replay-gap-a',
      'replay-gap-b',
    ]);
  });

  it('records deterministic merge and split lineage when replayed states reconcile', async () => {
    const mergeTopicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-merge-lineage',
      next_cluster_seq: 1,
      clusters: [],
    };
    const older = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    const newer = makeWorkingDocument('doc-2', 'Port attack expands again', 'port_attack', 'attack', [1, 0]);
    newer.published_at = older.published_at;
    newer.source_variants[0]!.published_at = older.source_variants[0]!.published_at;
    mergeTopicState.clusters = [
      deriveClusterRecord(mergeTopicState, mergeTopicState.topic_id, [toStoredSource(older, older.source_variants[0]!)], 'story-a'),
      deriveClusterRecord(mergeTopicState, mergeTopicState.topic_id, [toStoredSource(newer, newer.source_variants[0]!)], 'story-b'),
    ];
    const merged = await assignClusters({
      topicId: mergeTopicState.topic_id,
      referenceNowMs: 1_000,
      documents: [],
      clusters: [],
      bundles: [],
      topic_state: mergeTopicState,
      stage_metrics: {},
    }, undefined);

    expect(merged.topic_state.clusters).toHaveLength(1);
    expect(merged.topic_state.clusters[0]?.story_id).toBe('story-a');
    expect(merged.topic_state.clusters[0]?.lineage.merged_from).toEqual(['story-b']);
  });
});
