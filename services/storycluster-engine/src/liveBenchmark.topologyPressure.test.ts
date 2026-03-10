import { describe, expect, it } from 'vitest';
import { STORYCLUSTER_REPLAY_TOPOLOGY_SCENARIOS } from './benchmarkCorpusReplayTopologyScenarios';
import { buildStoryClusterLiveBenchmarkArtifactIndex } from './liveBenchmarkArtifacts';
import { runStoryClusterLiveBenchmark } from './liveBenchmark';

describe('StoryCluster live benchmark topology pressure', () => {
  it('surfaces non-zero split-pair pressure from deterministic replay scenarios', async () => {
    const report = await runStoryClusterLiveBenchmark({
      now: () => 1_714_500_000_000,
      fixtureDatasets: [],
      replayScenarios: STORYCLUSTER_REPLAY_TOPOLOGY_SCENARIOS,
    });
    const artifactIndex = buildStoryClusterLiveBenchmarkArtifactIndex(report, {});

    expect(report.replay_results).toHaveLength(2);
    expect(report.replay_results.map((result) => result.scenario_id)).toEqual([
      'replay-topology-pressure-port-attack',
      'replay-topology-pressure-market-shadow',
    ]);
    expect(report.replay_overall.merge_lineage_count).toBeGreaterThan(0);
    expect(report.replay_overall.split_lineage_count).toBeGreaterThan(0);
    expect(report.replay_results.find((result) => result.scenario_id === 'replay-topology-pressure-market-shadow')?.split_pair_activation_count).toBe(2);
    expect(report.replay_results.find((result) => result.scenario_id === 'replay-topology-pressure-market-shadow')?.split_pair_reactivation_count).toBe(1);
    expect(artifactIndex.replay_topology_pressure.scenario_count).toBe(2);
    expect(artifactIndex.replay_topology_pressure.total_split_pair_activation_count).toBeGreaterThan(1);
    expect(artifactIndex.replay_topology_pressure.total_split_pair_reactivation_count).toBeGreaterThan(0);
    expect(artifactIndex.replay_topology_pressure.reactivated_scenario_count).toBeGreaterThanOrEqual(1);
    expect(artifactIndex.replay_topology_pressure.reactivated_scenario_ids).toContain(
      'replay-topology-pressure-market-shadow',
    );
    expect(artifactIndex.replay_topology_pressure.scenario_ids).toContain(
      'replay-topology-pressure-port-attack',
    );
  });
});
