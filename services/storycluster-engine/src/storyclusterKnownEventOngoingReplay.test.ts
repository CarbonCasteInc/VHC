import { describe, expect, it } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import { runStoryClusterRemoteContract } from './remoteContract';
import { STORYCLUSTER_REPLAY_SCENARIOS } from './benchmarkCorpusReplays';
import { coherenceAuditInternal } from './coherenceAudit';
import { liveBenchmarkInternal } from './liveBenchmark';

interface ReplaySnapshot {
  storyByEvent: Map<string, string | null>;
  clusters: ReturnType<MemoryClusterStore['loadTopic']>['clusters'];
}

function scenarioById(id: string) {
  const scenario = STORYCLUSTER_REPLAY_SCENARIOS.find((candidate) => candidate.scenario_id === id);
  expect(scenario, `missing replay scenario ${id}`).toBeDefined();
  return scenario!;
}

async function runScenario(scenarioId: string): Promise<ReplaySnapshot[]> {
  const scenario = scenarioById(scenarioId);
  const store = new MemoryClusterStore();
  const expectedByKey = new Map<string, string>();
  const snapshots: ReplaySnapshot[] = [];

  for (let tickIndex = 0; tickIndex < scenario.ticks.length; tickIndex += 1) {
    const tick = scenario.ticks[tickIndex]!;
    tick.forEach((item) => {
      expectedByKey.set(coherenceAuditInternal.itemEventKey(item), item.expected_event_id);
    });
    const response = await runStoryClusterRemoteContract(
      { topic_id: scenario.topic_id, items: tick.map(({ expected_event_id: _omit, ...item }) => item) },
      { store, clock: () => 1_781_000_000_000 + tickIndex * 1_000 },
    );
    const storyByEvent = new Map<string, string | null>();
    for (const [eventId, storyIds] of liveBenchmarkInternal.eventStoryIdsFromBundles(response.bundles, expectedByKey)) {
      storyByEvent.set(eventId, liveBenchmarkInternal.singleStoryId(storyIds));
    }
    snapshots.push({
      storyByEvent,
      clusters: store.loadTopic(scenario.topic_id).clusters,
    });
  }

  return snapshots;
}

describe('StoryCluster known-event ongoing replay scenarios', () => {
  it('preserves the Kennedy Center story id across the audited takeover arc', async () => {
    const snapshots = await runScenario('replay-known-event-kennedy-center-ongoing-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('kennedy_center_takeover_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('restores the Fed/Powell story id after a long gap and later court ruling', async () => {
    const snapshots = await runScenario('replay-known-event-fed-powell-gap-return');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('fed_powell_subpoena_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBe(storyIds[0]);
    expect(storyIds[2]).toBeNull();
    expect(storyIds[3]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(3);
  });
});
