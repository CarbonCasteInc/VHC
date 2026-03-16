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

  it('restores the flag-burning crackdown story id across policy launch and case-dismissal fallout', async () => {
    const snapshots = await runScenario('replay-known-event-flag-burn-order-gap-return');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('white_house_flag_burning_episode') ?? null);
    const finalCluster = snapshots[2]?.clusters.find((cluster) => cluster.story_id === storyIds[2]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBeNull();
    expect(storyIds[2]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
  });

  it('restores the teacher-prank death story id across charge and later charge-drop fallout', async () => {
    const snapshots = await runScenario('replay-known-event-teacher-prank-charge-drop');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('teacher_prank_death_episode') ?? null);
    const finalCluster = snapshots[2]?.clusters.find((cluster) => cluster.story_id === storyIds[2]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBeNull();
    expect(storyIds[2]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
  });

  it('preserves the Fani Willis post-dismissal story id across legal, legislative, and Wade-hearing fallout', async () => {
    const snapshots = await runScenario('replay-known-event-fani-willis-postdismissal-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('fani_willis_postdismissal_episode') ?? null);
    const finalCluster = snapshots[2]?.clusters.find((cluster) => cluster.story_id === storyIds[2]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(3);
  });

  it('preserves the Eric Adams dismissal story id across DOJ motion, court review, and dismissal', async () => {
    const snapshots = await runScenario('replay-known-event-eric-adams-dismissal-arc');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('eric_adams_corruption_dismissal_episode') ?? null,
    );
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBe(storyIds[0]);
    expect(storyIds[2]).toBeNull();
    expect(storyIds[3]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(3);
  });

  it('restores the Mahmoud Khalil story id across deportation ruling and later detention venue challenge', async () => {
    const snapshots = await runScenario('replay-known-event-mahmoud-khalil-gap-return');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('mahmoud_khalil_detention_episode') ?? null);
    const finalCluster = snapshots[2]?.clusters.find((cluster) => cluster.story_id === storyIds[2]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBeNull();
    expect(storyIds[2]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
  });

  it('restores the Abrego Garcia story id across deportation lawsuit and later pretrial detention ruling', async () => {
    const snapshots = await runScenario('replay-known-event-abrego-garcia-gap-return');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('abrego_garcia_wrongful_deportation_episode') ?? null,
    );
    const finalCluster = snapshots[2]?.clusters.find((cluster) => cluster.story_id === storyIds[2]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBeNull();
    expect(storyIds[2]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
  });
});
