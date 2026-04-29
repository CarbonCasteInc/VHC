import { describe, expect, it } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import { runStoryClusterRemoteContract } from './remoteContract';
import { STORYCLUSTER_REPLAY_SCENARIOS } from './benchmarkCorpusReplays';
import { coherenceAuditInternal } from './coherenceAudit';
import { liveBenchmarkInternal } from './liveBenchmark';

function scenarioById(id: string) {
  const scenario = STORYCLUSTER_REPLAY_SCENARIOS.find((candidate) => candidate.scenario_id === id);
  expect(scenario, `missing replay scenario ${id}`).toBeDefined();
  return scenario!;
}

async function runScenario(scenarioId: string) {
  const scenario = scenarioById(scenarioId);
  const store = new MemoryClusterStore();
  const snapshots = [];

  for (let tickIndex = 0; tickIndex < scenario.ticks.length; tickIndex += 1) {
    const tick = scenario.ticks[tickIndex]!;
    const currentExpectedByKey = new Map<string, string>();
    tick.forEach((item) => {
      currentExpectedByKey.set(coherenceAuditInternal.itemEventKey(item), item.expected_event_id);
    });
    const response = await runStoryClusterRemoteContract(
      { topic_id: scenario.topic_id, items: tick.map(({ expected_event_id: _omit, ...item }) => item) },
      { store, clock: () => 1_780_000_000_000 + (tickIndex * 1_000) },
    );
    const bundles = response.bundles;
    const storyByEvent = new Map<string, string | null>();
    for (const [eventId, storyIds] of liveBenchmarkInternal.eventStoryIdsFromBundles(bundles, currentExpectedByKey)) {
      storyByEvent.set(eventId, liveBenchmarkInternal.singleStoryId(storyIds));
    }
    snapshots.push({
      tickIndex,
      bundles,
      clusters: store.loadTopic(scenario.topic_id).clusters,
      storyByEvent,
    });
  }

  return snapshots;
}

describe('StoryCluster known-event replay scenarios', () => {
  it('restores the same extortion story id after a gap tick across real public article variants', async () => {
    const snapshots = await runScenario('replay-known-event-extortion-gap-return');
    const observed = snapshots.map((snapshot) => snapshot.storyByEvent.get('pardon_lobbyist_extortion_case') ?? null);

    expect(observed[0]).toBeTruthy();
    expect(observed[1]).toBeNull();
    expect(observed[2]).toBe(observed[0]);
  });

  it('keeps the flag-burn story stable while separating the White House facility story', async () => {
    const snapshots = await runScenario('replay-known-event-flag-burn-shadow-return');
    const flagStoryIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('white_house_flag_burning_case') ?? null);
    const facilityStoryId = snapshots[1]?.storyByEvent.get('white_house_screening_facility_plan') ?? null;

    expect(flagStoryIds[0]).toBeTruthy();
    expect(facilityStoryId).toBeTruthy();
    expect(facilityStoryId).not.toBe(flagStoryIds[0]);
    expect(flagStoryIds[2]).toBe(flagStoryIds[0]);
  });

  it('grows the prank-death bundle across outlets without changing story identity', async () => {
    const snapshots = await runScenario('replay-known-event-prank-source-growth');
    const prankStoryIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('teacher_prank_death_case') ?? null);
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === prankStoryIds[1]);

    expect(prankStoryIds[0]).toBeTruthy();
    expect(prankStoryIds[1]).toBe(prankStoryIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
  });
});
