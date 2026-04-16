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
    const currentExpectedByKey = new Map<string, string>();
    tick.forEach((item) => {
      const key = coherenceAuditInternal.itemEventKey(item);
      expectedByKey.set(key, item.expected_event_id);
      currentExpectedByKey.set(key, item.expected_event_id);
    });
    const response = await runStoryClusterRemoteContract(
      { topic_id: scenario.topic_id, items: tick.map(({ expected_event_id: _omit, ...item }) => item) },
      { store, clock: () => 1_781_000_000_000 + tickIndex * 1_000 },
    );
    const storyByEvent = new Map<string, string | null>();
    for (
      const [eventId, storyIds] of liveBenchmarkInternal.eventStoryIdsFromBundles(
        response.bundles,
        currentExpectedByKey,
      )
    ) {
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
  it('preserves the No Kings protest story id when BBC corroboration attaches to the PBS rally coverage', async () => {
    const snapshots = await runScenario('replay-known-event-no-kings-protests-source-growth');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('no_kings_protests_episode') ?? null);
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === storyIds[1]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(2);
  });

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

  it('grows the birthright arguments story across CBS and NBC without changing story identity', async () => {
    const snapshots = await runScenario('replay-known-event-birthright-arguments-source-growth');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('birthright_citizenship_argument_episode') ?? null,
    );
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === storyIds[1]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
    expect(finalCluster?.source_documents.map((document) => document.source_id).sort()).toEqual([
      'cbs-birthright-arguments-replay',
      'nbc-birthright-arguments-replay',
    ]);
  });

  it('grows the Cuba tanker story across Guardian and CBS without changing story identity', async () => {
    const snapshots = await runScenario('replay-known-event-cuba-tanker-source-growth');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('cuba_russian_tanker_episode') ?? null);
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === storyIds[1]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
    expect(finalCluster?.source_documents.map((document) => document.source_id).sort()).toEqual([
      'cbs-cuba-tanker-replay',
      'guardian-world-cuba-tanker-replay',
    ]);
  });

  it('keeps the Cuba tanker story separate from unrelated Guardian Trump-opinion coverage', async () => {
    const snapshots = await runScenario('replay-known-event-cuba-tanker-vs-trump-opinion-separation');
    const cubaStoryId = snapshots[0]?.storyByEvent.get('cuba_russian_tanker_episode') ?? null;
    const opinionStoryId = snapshots[1]?.storyByEvent.get('trump_democrats_primary_opinion_episode') ?? null;
    const finalCubaCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === cubaStoryId);
    const finalOpinionCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === opinionStoryId);

    expect(cubaStoryId).toBeTruthy();
    expect(opinionStoryId).toBeTruthy();
    expect(opinionStoryId).not.toBe(cubaStoryId);
    expect(finalCubaCluster?.source_documents).toHaveLength(1);
    expect(finalOpinionCluster?.source_documents).toHaveLength(1);
  });

  it('grows the DHS airport-disruption story across BBC, ABC, WaPo, and NBC without changing identity', async () => {
    const snapshots = await runScenario('replay-known-event-dhs-airport-shutdown-source-growth');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('dhs_shutdown_airport_disruption_episode') ?? null,
    );
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
    expect(finalCluster?.source_documents.map((document) => document.source_id).sort()).toEqual([
      'abc-dhs-shutdown-airport-replay',
      'bbc-dhs-shutdown-airport-replay',
      'nbc-dhs-shutdown-airport-replay',
      'wapo-dhs-shutdown-airport-replay',
    ]);
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

  it('keeps the Trump library design and Kennedy Center Chicago visit in separate stories', async () => {
    const snapshots = await runScenario('replay-known-event-trump-library-vs-kennedy-separation');
    const libraryStoryId = snapshots[0]?.storyByEvent.get('trump_presidential_library_design_episode') ?? null;
    const kennedyStoryId = snapshots[1]?.storyByEvent.get('kennedy_center_chicago_visit_episode') ?? null;
    const finalLibraryCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === libraryStoryId);
    const finalKennedyCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === kennedyStoryId);

    expect(libraryStoryId).toBeTruthy();
    expect(kennedyStoryId).toBeTruthy();
    expect(kennedyStoryId).not.toBe(libraryStoryId);
    expect(finalLibraryCluster?.source_documents).toHaveLength(1);
    expect(finalKennedyCluster?.source_documents).toHaveLength(1);
  });

  it('preserves the Helene I-40 recovery story id across delayed reopening, reopening, and post-slide recovery', async () => {
    const snapshots = await runScenario('replay-known-event-helene-i40-recovery-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('helene_i40_recovery_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the Ruidoso flood recovery story id across impact, cleanup, home-damage surveys, and disaster relief', async () => {
    const snapshots = await runScenario('replay-known-event-ruidoso-flood-recovery-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('ruidoso_flood_recovery_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the Lahaina wildfire recovery story id across debris, housing, and long-tail cleanup phases', async () => {
    const snapshots = await runScenario('replay-known-event-lahaina-wildfire-recovery-arc');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('lahaina_wildfire_recovery_episode') ?? null,
    );
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the Iran-US nuclear talks story id across Oman and Rome negotiation phases', async () => {
    const snapshots = await runScenario('replay-known-event-iran-us-nuclear-talks-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('iran_us_nuclear_talks_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the 2025 Gaza ceasefire story id across draft, implementation, extension disputes, and breakdown', async () => {
    const snapshots = await runScenario('replay-known-event-gaza-ceasefire-2025-arc');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('gaza_ceasefire_2025_episode') ?? null);
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('preserves the 2025 Ukraine Istanbul talks story id across direct talks, follow-up disputes, and humanitarian follow-through', async () => {
    const snapshots = await runScenario('replay-known-event-ukraine-istanbul-talks-arc');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('ukraine_istanbul_talks_episode') ?? null,
    );
    const finalCluster = snapshots[3]?.clusters.find((cluster) => cluster.story_id === storyIds[3]);

    expect(storyIds.every(Boolean)).toBe(true);
    expect(new Set(storyIds.filter(Boolean)).size).toBe(1);
    expect(finalCluster?.source_documents).toHaveLength(4);
  });

  it('grows the Iran F-15E downing story across CBS and Military Times without changing story identity', async () => {
    const snapshots = await runScenario('replay-known-event-iran-f15e-source-growth');
    const storyIds = snapshots.map((snapshot) => snapshot.storyByEvent.get('iran_f15e_downed_episode') ?? null);
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === storyIds[1]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
    expect(finalCluster?.source_documents.map((document) => document.source_id).sort()).toEqual([
      'cbs-iran-f15e-replay',
      'militarytimes-iran-f15e-replay',
    ]);
  });

  it('grows the Southern California wildfire story across the Guardian and Los Angeles Times without changing story identity', async () => {
    const snapshots = await runScenario('replay-known-event-socal-wildfires-source-growth');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('socal_wildfires_apr3_episode') ?? null,
    );
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === storyIds[1]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
    expect(finalCluster?.source_documents.map((document) => document.source_id).sort()).toEqual([
      'guardian-socal-fires-replay',
      'latimes-socal-fires-replay',
    ]);
  });

  it('grows the DHS pay-during-shutdown story across CBS and FedSmith without changing story identity', async () => {
    const snapshots = await runScenario('replay-known-event-dhs-pay-shutdown-source-growth');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('dhs_pay_despite_shutdown_episode') ?? null,
    );
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === storyIds[1]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
    expect(finalCluster?.source_documents.map((document) => document.source_id).sort()).toEqual([
      'cbs-dhs-pay-replay',
      'fedsmith-dhs-pay-replay',
    ]);
  });

  it('grows the Big Bend wall backlash story across the Texas Tribune and Big Bend Sentinel without changing story identity', async () => {
    const snapshots = await runScenario('replay-known-event-big-bend-wall-source-growth');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('big_bend_wall_backlash_episode') ?? null,
    );
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === storyIds[1]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
    expect(finalCluster?.source_documents.map((document) => document.source_id).sort()).toEqual([
      'bigbendsentinel-wall-road-replay',
      'texastribune-big-bend-wall-replay',
    ]);
  });

  it('grows the mail-voting lawsuit story across BBC and Democracy Docket without changing story identity', async () => {
    const snapshots = await runScenario('replay-known-event-mail-voting-lawsuit-source-growth');
    const storyIds = snapshots.map((snapshot) =>
      snapshot.storyByEvent.get('mail_voting_order_lawsuit_episode') ?? null,
    );
    const finalCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === storyIds[1]);

    expect(storyIds[0]).toBeTruthy();
    expect(storyIds[1]).toBe(storyIds[0]);
    expect(finalCluster?.source_documents).toHaveLength(2);
    expect(finalCluster?.source_documents.map((document) => document.source_id).sort()).toEqual([
      'bbc-mail-voting-lawsuit-replay',
      'democracydocket-mail-voting-lawsuit-replay',
    ]);
  });

  it('keeps the Nevada voter-list lawsuit separate from the unrelated college-sports executive-order story', async () => {
    const snapshots = await runScenario('replay-known-event-nevada-voter-lists-vs-college-sports-order-separation');
    const sportsStoryId = snapshots[1]?.storyByEvent.get('college_sports_stabilization_order_episode') ?? null;
    const nevadaStoryId = snapshots[1]?.storyByEvent.get('nevada_voter_list_order_lawsuit_episode') ?? null;
    const sportsCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === sportsStoryId);
    const nevadaCluster = snapshots[1]?.clusters.find((cluster) => cluster.story_id === nevadaStoryId);

    expect(sportsStoryId).toBeTruthy();
    expect(nevadaStoryId).toBeTruthy();
    expect(nevadaStoryId).not.toBe(sportsStoryId);
    expect(sportsCluster?.source_documents).toHaveLength(1);
    expect(nevadaCluster?.source_documents).toHaveLength(1);
  });
});
