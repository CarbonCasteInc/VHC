import { describe, expect, it } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import { StoryClusterStageError, STORYCLUSTER_STAGE_SEQUENCE, type StoryClusterInputDocument } from './contracts';
import { runStoryClusterStagePipeline } from './stageRunner';
import type { ClusterVectorBackend } from './vectorBackend';
import { createDeterministicTestModelProvider } from './testModelProvider';

function makeDoc(docId: string, title: string, publishedAt: number, overrides: Partial<StoryClusterInputDocument> = {}): StoryClusterInputDocument {
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
    entity_keys: overrides.entity_keys,
    translation_applied: overrides.translation_applied,
  };
}

function makeClock(start = 1_709_001_000_000): () => number {
  let tick = start;
  return () => {
    tick += 5;
    return tick;
  };
}

describe('runStoryClusterStagePipeline', () => {
  it('runs all mandatory stages with real summaries and stage telemetry', async () => {
    const store = new MemoryClusterStore();
    const response = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-security',
        documents: [
          makeDoc('doc-1', 'Breaking: Port attack disrupts terminals overnight', 1_709_000_000_000, { entity_keys: ['port_attack'] }),
          makeDoc('doc-2', 'Breaking: Port attack disrupts terminals overnight', 1_709_000_000_500, { source_id: 'wire-b', entity_keys: ['port_attack'] }),
          makeDoc('doc-3', 'Officials say recovery talks begin Friday after port attack', 1_709_000_010_000, { entity_keys: ['port_attack'] }),
          makeDoc('doc-4', 'El gobierno confirmó nuevas sanciones tras el ataque al puerto', 1_709_000_020_000, { language_hint: 'es', entity_keys: ['port_attack'] }),
          makeDoc('doc-5', 'Analysis: how insurers are pricing the market fallout', 1_709_000_030_000, { entity_keys: ['market_reaction'] }),
        ],
        reference_now_ms: 1_709_000_050_000,
      },
      { clock: makeClock(), store },
    );
    const followup = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-security',
        documents: [
          makeDoc('doc-6', 'New shipping delays follow the port attack response', 1_709_000_060_000, { entity_keys: ['port_attack'] }),
        ],
        reference_now_ms: 1_709_000_070_000,
      },
      { clock: makeClock(1_709_000_060_000), store },
    );

    expect(response.telemetry.stage_count).toBe(STORYCLUSTER_STAGE_SEQUENCE.length);
    expect(response.telemetry.stages.map((stage) => stage.stage_id)).toEqual(STORYCLUSTER_STAGE_SEQUENCE);
    expect(response.telemetry.stages.every((stage) => stage.status === 'ok')).toBe(true);
    expect(response.telemetry.stages.find((stage) => stage.stage_id === 'near_duplicate_collapse')?.gate_pass_rate).toBe(0.8);
    expect(followup.telemetry.stages.find((stage) => stage.stage_id === 'qdrant_candidate_retrieval')?.artifact_counts.candidates_considered).toBeGreaterThan(0);
    expect(followup.telemetry.stages.find((stage) => stage.stage_id === 'llm_adjudication')?.artifact_counts.adjudication_accepts).toBeGreaterThanOrEqual(1);
    expect(response.bundles.length).toBeGreaterThan(0);
    expect(response.bundles[0]?.summary_hint).not.toMatch(/\d+ docs/);
    expect(response.bundles[0]?.stage_version).toBe('storycluster-stage-runner-v2');
  });

  it('is deterministic for fixed inputs regardless of input order', async () => {
    const docs = [
      makeDoc('doc-1', 'Port attack disrupts terminals overnight', 100, { entity_keys: ['port_attack'] }),
      makeDoc('doc-2', 'Officials say recovery talks begin Friday after port attack', 110, { entity_keys: ['port_attack'] }),
      makeDoc('doc-3', 'Separate market slump follows the regional crisis', 120, { entity_keys: ['market_slump'] }),
    ];

    const forward = await runStoryClusterStagePipeline({ topic_id: 'topic-det', documents: docs }, { clock: makeClock(1_000), store: new MemoryClusterStore() });
    const reversed = await runStoryClusterStagePipeline({ topic_id: 'topic-det', documents: [...docs].reverse() }, { clock: makeClock(2_000), store: new MemoryClusterStore() });

    expect(reversed.bundles).toEqual(forward.bundles);
  });

  it('preserves story identity while source coverage expands across ticks', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-persist',
        documents: [
          makeDoc('doc-1', 'Port attack disrupts terminals overnight', 100, { entity_keys: ['port_attack'] }),
          makeDoc('doc-2', 'Officials say recovery talks begin Friday after port attack', 110, { entity_keys: ['port_attack'] }),
        ],
      },
      { clock: makeClock(5_000), store },
    );

    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-persist',
        documents: [
          makeDoc('doc-3', 'Insurers warn delays will continue after port attack', 130, { entity_keys: ['port_attack'] }),
        ],
      },
      { clock: makeClock(6_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.cluster_window_end).toBeGreaterThan(first.bundles[0]!.cluster_window_end);
  });

  it('separates same-topic different-event coverage instead of false-merging', async () => {
    const store = new MemoryClusterStore();
    await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-separation',
        documents: [
          makeDoc('doc-1', 'Stocks slide after Tehran strike rattles insurers', 100, { entity_keys: ['market_slump'] }),
        ],
      },
      { clock: makeClock(7_000), store },
    );

    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-separation',
        documents: [
          makeDoc('doc-2', 'Opinion: how to think about the widening Iran conflict', 130, { entity_keys: ['iran_conflict'], source_id: 'desk-opinion', publisher: 'Opinion Desk' }),
        ],
      },
      { clock: makeClock(8_000), store },
    );

    expect(store.loadTopic('topic-separation').clusters).toHaveLength(1);
    expect(second.bundles).toEqual([]);
    expect(
      second.telemetry.stages.find((stage) => stage.stage_id === 'dynamic_cluster_assignment')
        ?.artifact_counts.related_docs_deferred,
    ).toBe(1);
  });

  it('fails closed on store readiness and stage errors', async () => {
    await expect(
      runStoryClusterStagePipeline(
        { topic_id: 'topic-bad', documents: [] },
        { store: { loadTopic: () => { throw new Error('nope'); }, saveTopic: () => undefined, readiness: () => ({ ok: false, detail: 'offline' }) } },
      ),
    ).rejects.toThrow('storycluster store is not ready: offline');

    await expect(
      runStoryClusterStagePipeline(
        { topic_id: 'topic-fail', documents: [makeDoc('doc-1', 'Port attack', 100)] },
        { store: new MemoryClusterStore(), stageOverrides: { hybrid_scoring: () => { throw new Error('boom'); } } },
      ),
    ).rejects.toThrow(StoryClusterStageError);

    await expect(
      runStoryClusterStagePipeline(
        { topic_id: 'topic-fail-string', documents: [makeDoc('doc-1', 'Port attack', 100)] },
        { store: new MemoryClusterStore(), stageOverrides: { hybrid_scoring: () => { throw 'boom-string'; } } as any },
      ),
    ).rejects.toThrow('boom-string');

    const brokenVectorBackend: ClusterVectorBackend = {
      async queryTopic() {
        return new Map();
      },
      async readiness() {
        return { ok: false, detail: 'vector-offline' };
      },
      async replaceTopicClusters() {},
    };

    await expect(
      runStoryClusterStagePipeline(
        { topic_id: 'topic-vector-fail', documents: [makeDoc('doc-1', 'Port attack', 100)] },
        { store: new MemoryClusterStore(), vectorBackend: brokenVectorBackend },
      ),
    ).rejects.toThrow('storycluster vector backend is not ready: vector-offline');
  });

  it('uses the default store path when no store override is supplied', async () => {
    const response = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-default-store',
        documents: [makeDoc('doc-1', 'Port attack disrupts terminals overnight', 100, { entity_keys: ['port_attack'] })],
      },
      { clock: makeClock(9_000), modelProvider: createDeterministicTestModelProvider() },
    );

    expect(response.bundles).toHaveLength(1);
  });
});
