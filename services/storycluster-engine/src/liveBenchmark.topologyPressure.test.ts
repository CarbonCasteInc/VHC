import { describe, expect, it } from 'vitest';
import { STORYCLUSTER_REPLAY_TOPOLOGY_SCENARIOS } from './benchmarkCorpusReplayTopologyScenarios';
import { buildStoryClusterLiveBenchmarkArtifactIndex } from './liveBenchmarkArtifacts';
import { runStoryClusterLiveBenchmark } from './liveBenchmark';

describe('StoryCluster live benchmark topology pressure', () => {
  it('surfaces non-zero correction cycles from deterministic replay scenarios', async () => {
    const report = await runStoryClusterLiveBenchmark({
      now: () => 1_714_500_000_000,
      fixtureDatasets: [],
      replayScenarios: STORYCLUSTER_REPLAY_TOPOLOGY_SCENARIOS,
    });
    const artifactIndex = buildStoryClusterLiveBenchmarkArtifactIndex(report, {});

    expect(report.replay_results).toHaveLength(2);
    expect(report.replay_results.map((result) => result.scenario_id)).toEqual([
      'replay-topology-correction-cycles',
      'replay-topology-market-reentry-cycles',
    ]);
    expect(report.replay_overall.merge_lineage_count).toBeGreaterThan(0);
    expect(report.replay_overall.split_lineage_count).toBeGreaterThan(0);
    expect(report.replay_results.find((result) => result.scenario_id === 'replay-topology-market-reentry-cycles')?.correction_cycle_count).toBe(2);
    expect(report.replay_results.find((result) => result.scenario_id === 'replay-topology-market-reentry-cycles')?.split_child_reuse_cycle_count).toBe(1);
    expect(artifactIndex.replay_correction_cycles.scenario_count).toBe(2);
    expect(artifactIndex.replay_correction_cycles.total_cycle_count).toBeGreaterThan(1);
    expect(artifactIndex.replay_correction_cycles.total_split_child_reuse_cycle_count).toBeGreaterThan(0);
    expect(artifactIndex.replay_correction_cycles.repeated_cycle_scenario_count).toBeGreaterThanOrEqual(1);
    expect(artifactIndex.replay_correction_cycles.repeated_cycle_scenario_ids).toContain(
      'replay-topology-market-reentry-cycles',
    );
    expect(artifactIndex.replay_correction_cycles.scenario_ids).toContain(
      'replay-topology-correction-cycles',
    );
  });
});
