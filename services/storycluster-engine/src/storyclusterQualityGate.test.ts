import { describe, expect, it } from 'vitest';
import { STORYCLUSTER_BENCHMARK_CORPUS } from './benchmarkCorpus';
import type { StoryClusterBenchmarkPairExpectation } from './benchmarkCorpusFixtures';
import { MemoryClusterStore } from './clusterStore';
import { buildStoryClusterLiveBenchmarkArtifactIndex } from './liveBenchmarkArtifacts';
import {
  coherenceAuditInternal,
  runStoryClusterCoherenceAudit,
  type StoryClusterCoherenceAuditItem,
} from './coherenceAudit';
import { runStoryClusterLiveBenchmark } from './liveBenchmark';
import { isCanonicalBundlePairLabel } from './pairOntology';
import { runStoryClusterRemoteContract, type StoryClusterRemoteBundle } from './remoteContract';

function toRemoteItems(items: readonly StoryClusterCoherenceAuditItem[]) {
  return items.map(({ expected_event_id: _expectedEventId, ...item }) => item);
}

function sourceStoryMap(bundles: readonly StoryClusterRemoteBundle[]): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const bundle of bundles) {
    for (const source of coherenceAuditInternal.bundleSources(bundle)) {
      mapping.set(source.source_id, bundle.story_id);
    }
  }
  return mapping;
}

function assertPairExpectations(
  bundles: readonly StoryClusterRemoteBundle[],
  pairExpectations: readonly StoryClusterBenchmarkPairExpectation[],
): void {
  const storiesBySource = sourceStoryMap(bundles);
  for (const pair of pairExpectations) {
    const leftStory = storiesBySource.get(pair.left_source_id) ?? null;
    const rightStory = storiesBySource.get(pair.right_source_id) ?? null;
    const sameStory = leftStory !== null && rightStory !== null && leftStory === rightStory;
    expect(
      sameStory,
      `${pair.case_id} expected ${pair.expected_label} for ${pair.left_source_id}/${pair.right_source_id}`,
    ).toBe(isCanonicalBundlePairLabel(pair.expected_label));
  }
}

describe('StoryCluster quality gate', () => {
  it('passes the canonical fixture benchmark suite and explicit pair traps', async () => {
    const report = await runStoryClusterCoherenceAudit(STORYCLUSTER_BENCHMARK_CORPUS.fixtureDatasets, {
      now: () => 1_713_000_000_000,
      thresholds: STORYCLUSTER_BENCHMARK_CORPUS.fixtureThresholds,
      contractRunner: (payload) =>
        runStoryClusterRemoteContract(payload, {
          store: new MemoryClusterStore(),
          clock: () => 1_713_000_000_000,
        }),
    });

    expect(report.overall.pass).toBe(true);
    expect(report.dataset_count).toBe(STORYCLUSTER_BENCHMARK_CORPUS.fixtureDatasets.length);
    expect(report.overall.max_contamination_rate).toBeLessThanOrEqual(
      STORYCLUSTER_BENCHMARK_CORPUS.fixtureThresholds.max_contamination_rate,
    );
    expect(report.overall.max_fragmentation_rate).toBeLessThanOrEqual(
      STORYCLUSTER_BENCHMARK_CORPUS.fixtureThresholds.max_fragmentation_rate,
    );
    expect(report.overall.avg_coherence_score).toBeGreaterThanOrEqual(
      STORYCLUSTER_BENCHMARK_CORPUS.fixtureThresholds.min_coherence_score,
    );

    for (const dataset of STORYCLUSTER_BENCHMARK_CORPUS.fixtureDatasets) {
      const response = await runStoryClusterRemoteContract(
        { topic_id: dataset.topic_id, items: toRemoteItems(dataset.items) },
        { store: new MemoryClusterStore(), clock: () => 1_713_000_000_000 },
      );
      assertPairExpectations(
        response.bundles,
        STORYCLUSTER_BENCHMARK_CORPUS.pairExpectations.filter(
          (pair) => pair.dataset_id === dataset.dataset_id,
        ),
      );
    }

    console.log(
      JSON.stringify(
        {
          benchmark: 'fixture-suite',
          overall: report.overall,
          datasets: report.datasets.map((dataset) => ({
            dataset_id: dataset.dataset_id,
            total_docs: dataset.total_docs,
            total_bundles: dataset.total_bundles,
            contamination_rate: dataset.contamination_rate,
            fragmentation_rate: dataset.fragmentation_rate,
            coherence_score: dataset.coherence_score,
          })),
        },
        null,
        2,
      ),
    );
  });

  it('passes replay thresholds and preserves story identity across ticks', async () => {
    const report = await runStoryClusterLiveBenchmark({
      now: () => 1_714_000_000_000,
      fixtureDatasets: [],
      replayScenarios: STORYCLUSTER_BENCHMARK_CORPUS.replayScenarios,
      replayThresholds: STORYCLUSTER_BENCHMARK_CORPUS.replayThresholds,
      remoteRunner: runStoryClusterRemoteContract,
      storeFactory: () => new MemoryClusterStore(),
    });
    const artifactIndex = buildStoryClusterLiveBenchmarkArtifactIndex(report, {});
    const continuousReplayResults = report.replay_results.filter(
      (dataset) => dataset.reappearance_observations === 0 && dataset.persistence_observations > 0,
    );
    const reappearanceReplayResults = report.replay_results.filter((dataset) => dataset.reappearance_observations > 0);

    expect(report.replay_overall.failed_dataset_ids).toEqual([]);
    expect(report.replay_overall.max_contamination_rate).toBeLessThanOrEqual(
      STORYCLUSTER_BENCHMARK_CORPUS.replayThresholds.max_contamination_rate,
    );
    expect(report.replay_overall.max_fragmentation_rate).toBeLessThanOrEqual(
      STORYCLUSTER_BENCHMARK_CORPUS.replayThresholds.max_fragmentation_rate,
    );
    expect(report.replay_overall.avg_coherence_score).toBeGreaterThanOrEqual(
      STORYCLUSTER_BENCHMARK_CORPUS.replayThresholds.min_coherence_score,
    );
    expect(continuousReplayResults.length).toBeGreaterThan(0);
    expect(continuousReplayResults.every((dataset) => dataset.persistence_rate >= 0.99)).toBe(true);
    expect(reappearanceReplayResults.length).toBeGreaterThan(0);
    expect(report.replay_overall.reappearance_observations).toBeGreaterThan(0);
    expect(report.replay_overall.reappearance_rate).toBeGreaterThanOrEqual(0.99);
    expect(report.replay_overall.merge_lineage_count).toBeGreaterThan(0);
    expect(report.replay_overall.split_lineage_count).toBeGreaterThan(0);
    expect(artifactIndex.replay_correction_cycles.total_cycle_count).toBeGreaterThan(0);
    expect(artifactIndex.replay_correction_cycles.repeated_cycle_scenario_count).toBeGreaterThan(0);

    console.log(
      JSON.stringify(
        {
          benchmark: 'replay-suite',
          aggregate: report.replay_overall,
          replay_correction_cycles: artifactIndex.replay_correction_cycles,
          datasets: report.replay_results.map((dataset) => ({
            dataset_id: dataset.dataset_id,
            contamination_rate: dataset.contamination_rate,
            fragmentation_rate: dataset.fragmentation_rate,
            coherence_score: dataset.coherence_score,
            persistence_rate: dataset.persistence_rate,
            reappearance_rate: dataset.reappearance_rate,
          })),
        },
        null,
        2,
      ),
    );
  });
});
