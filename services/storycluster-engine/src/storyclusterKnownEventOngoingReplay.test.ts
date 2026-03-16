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

  it('preserves the Rumeysa Ozturk story id across transfer, return order, and release', async () => {
    const snapshots = await runScenario('replay-known-event-rumeysa-ozturk-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('rumeysa_ozturk_detention_episode') ?? null);
    const finalCluster = snapshots[2]?.clusters.find((cluster) => cluster.story_id === storyIds[2]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(3);
  });

  it('preserves the Mohsen Mahdawi story id across arrest, detention hearing, and release', async () => {
    const snapshots = await runScenario('replay-known-event-mohsen-mahdawi-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('mohsen_mahdawi_detention_episode') ?? null);
    const finalCluster = snapshots[2]?.clusters.find((cluster) => cluster.story_id === storyIds[2]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(3);
  });

  it('preserves the Ras Baraka Delaney Hall story id across arrest, court appearance, and lawsuit', async () => {
    const snapshots = await runScenario('replay-known-event-ras-baraka-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('ras_baraka_delaney_hall_episode') ?? null);
    const finalCluster = snapshots[2]?.clusters.find((cluster) => cluster.story_id === storyIds[2]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(3);
  });

  it('preserves the Voice of America dismantling story id across firings, dismantling, compliance, and job-cut fallout', async () => {
    const snapshots = await runScenario('replay-known-event-voice-of-america-arc');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('voice_of_america_dismantling_episode') ?? null,
    );
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the Harvard foreign-student sanctions story id across the court orders', async () => {
    const snapshots = await runScenario('replay-known-event-harvard-foreign-students-arc');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('harvard_foreign_students_sanctions_episode') ?? null,
    );
    const finalCluster = snapshots[2]?.clusters.find((cluster) => cluster.story_id === storyIds[2]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(3);
  });

  it('preserves the Yunseo Chung deportation story id across lawsuit and detention-order fallout', async () => {
    const snapshots = await runScenario('replay-known-event-yunseo-chung-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('yunseo_chung_deportation_episode') ?? null);
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === storyIds[1]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(2);
  });

  it('preserves the AP White House access story id across the curtailment, reinstatement, enforcement, and appeals phases', async () => {
    const snapshots = await runScenario('replay-known-event-ap-access-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('associated_press_access_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the CFPB dismantling story id across chaos, injunction, layoffs, and defunding phases', async () => {
    const snapshots = await runScenario('replay-known-event-cfpb-dismantling-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('cfpb_dismantling_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the birthright-citizenship order story id across injunction and appeals phases', async () => {
    const snapshots = await runScenario('replay-known-event-birthright-citizenship-order-arc');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('birthright_citizenship_order_episode') ?? null,
    );
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the Key Bridge collapse story id across collapse, salvage, reopening, and cleanup fallout', async () => {
    const snapshots = await runScenario('replay-known-event-key-bridge-collapse-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('key_bridge_collapse_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the DC midair collision story id across crash, salvage, investigation data, and helicopter restrictions', async () => {
    const snapshots = await runScenario('replay-known-event-dc-midair-collision-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('dc_midair_collision_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the Air India Ahmedabad crash story id across crash and investigation phases', async () => {
    const snapshots = await runScenario('replay-known-event-air-india-crash-arc');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('air_india_ahmedabad_crash_episode') ?? null,
    );
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });
});
