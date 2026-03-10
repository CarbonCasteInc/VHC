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

    expect(report.replay_results).toHaveLength(1);
    expect(report.replay_results[0]?.scenario_id).toBe('replay-topology-correction-cycles');
    expect(report.replay_results[0]?.merge_lineage_count).toBeGreaterThan(0);
    expect(report.replay_results[0]?.split_lineage_count).toBeGreaterThan(0);
    expect(report.replay_overall.merge_lineage_count).toBeGreaterThan(0);
    expect(report.replay_overall.split_lineage_count).toBeGreaterThan(0);
    expect(artifactIndex.replay_correction_cycles.scenario_count).toBe(1);
    expect(artifactIndex.replay_correction_cycles.total_cycle_count).toBeGreaterThan(1);
    expect(artifactIndex.replay_correction_cycles.repeated_cycle_scenario_count).toBe(1);
    expect(artifactIndex.replay_correction_cycles.repeated_cycle_scenario_ids).toEqual([
      'replay-topology-correction-cycles',
    ]);
  });
});
