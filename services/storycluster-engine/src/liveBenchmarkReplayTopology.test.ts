import { describe, expect, it } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import {
  createReplayTopologyCycleTracker,
  observeReplayTopologyTick,
  replaceReplayTopicWithSeedClusters,
  summarizeReplayTopologyCycles,
} from './liveBenchmarkReplayTopology';

describe('StoryCluster replay topology seeding', () => {
  it('creates stored sources without event tuples when a trigger is absent', () => {
    const store = new MemoryClusterStore();
    replaceReplayTopicWithSeedClusters(store, 'topic-null-trigger', [{
      story_id: 'story-anchor',
      sources: [{
        source_id: 'seed-null',
        url_hash: 'seed-null',
        published_at: 10,
        title: 'Harbor crews inspect damaged cranes',
        summary: 'Harbor crews inspect damaged cranes after the overnight disruption.',
        entities: ['harbor_crews', 'damaged_cranes'],
      }],
    }], 7);

    const topic = store.loadTopic('topic-null-trigger');
    const source = topic.clusters[0]?.source_documents[0];

    expect(topic.next_cluster_seq).toBe(7);
    expect(source?.publisher).toBe('SEED-NULL');
    expect(source?.trigger).toBeNull();
    expect(source?.event_tuple).toBeNull();
  });

  it('preserves explicit topology source overrides when seeding clusters', () => {
    const store = new MemoryClusterStore();
    replaceReplayTopicWithSeedClusters(store, 'topic-explicit-trigger', [{
      story_id: 'story-anchor',
      sources: [{
        source_id: 'seed-explicit',
        publisher: 'WIRE-ES',
        url_hash: 'seed-explicit',
        published_at: 20,
        title: 'Puerto atacado obliga a cerrar la terminal oriental',
        summary: 'Las autoridades cierran la terminal oriental tras el ataque.',
        entities: ['port_attack', 'eastern_terminal', 'harbor_authority'],
        locations: ['harbor'],
        trigger: 'attack',
        language: 'es',
        translation_applied: true,
        coverage_role: 'related',
      }],
    }], 9);

    const topic = store.loadTopic('topic-explicit-trigger');
    const source = topic.clusters[0]?.source_documents[0];

    expect(topic.next_cluster_seq).toBe(9);
    expect(source?.publisher).toBe('WIRE-ES');
    expect(source?.language).toBe('es');
    expect(source?.translation_applied).toBe(true);
    expect(source?.coverage_role).toBe('related');
    expect(source?.event_tuple?.trigger).toBe('attack');
    expect(source?.event_tuple?.where).toEqual(['harbor']);
  });

  it('falls back to title and empty locations when a trigger is present without summary metadata', () => {
    const store = new MemoryClusterStore();
    replaceReplayTopicWithSeedClusters(store, 'topic-trigger-fallback', [{
      story_id: 'story-anchor',
      sources: [{
        source_id: 'seed-trigger-only',
        url_hash: 'seed-trigger-only',
        published_at: 30,
        title: 'Harbor attack closes one berth',
        entities: ['port_attack', 'eastern_terminal'],
        trigger: 'attack',
        text: 'Harbor attack closes one berth after midnight.',
      }],
    }], 11);

    const source = store.loadTopic('topic-trigger-fallback').clusters[0]?.source_documents[0];

    expect(source?.event_tuple?.description).toBe('Harbor attack closes one berth.');
    expect(source?.event_tuple?.where).toEqual([]);
  });

  it('falls back to the title when both text and summary are absent', () => {
    const store = new MemoryClusterStore();
    replaceReplayTopicWithSeedClusters(store, 'topic-title-fallback', [{
      story_id: 'story-anchor',
      sources: [{
        source_id: 'seed-title-only',
        url_hash: 'seed-title-only',
        published_at: 40,
        title: 'Markets slide after the overnight strike',
        entities: ['market_slump', 'shipping_losses'],
      }],
    }], 13);

    const source = store.loadTopic('topic-title-fallback').clusters[0]?.source_documents[0];

    expect(source?.text).toBe('Markets slide after the overnight strike. Markets slide after the overnight strike');
  });

  it('tracks repeated split-child reuse cycles without double-counting unchanged active pairs', () => {
    const tracker = createReplayTopologyCycleTracker();
    const clusters = [
      { story_id: 'story-anchor', lineage: { merged_from: [] } },
      { story_id: 'story-market-child', lineage: { split_from: 'story-anchor', merged_from: [] } },
    ] as const;

    observeReplayTopologyTick(tracker, clusters as never);
    observeReplayTopologyTick(tracker, clusters as never);
    observeReplayTopologyTick(tracker, [] as never);
    observeReplayTopologyTick(tracker, clusters as never);

    expect(summarizeReplayTopologyCycles(tracker)).toEqual({
      correction_cycle_count: 2,
      split_child_reuse_cycle_count: 1,
    });
  });
});
