import { describe, expect, it } from 'vitest';
import { STORYCLUSTER_BENCHMARK_CORPUS } from './benchmarkCorpus';
import type { StoryClusterBenchmarkPairExpectation } from './benchmarkCorpusFixtures';
import { MemoryClusterStore } from './clusterStore';
import {
  coherenceAuditInternal,
  runStoryClusterCoherenceAudit,
  type StoryClusterCoherenceAuditItem,
  type StoryClusterCoherenceDatasetResult,
} from './coherenceAudit';
import { liveBenchmarkInternal, type StoryClusterReplayScenario } from './liveBenchmark';
import { isCanonicalBundlePairLabel } from './pairOntology';
import { runStoryClusterRemoteContract, type StoryClusterRemoteBundle } from './remoteContract';

function toRemoteItems(items: readonly StoryClusterCoherenceAuditItem[]) {
  return items.map(({ expected_event_id: _expectedEventId, ...item }) => item);
}

function aggregateResults(results: readonly StoryClusterCoherenceDatasetResult[]) {
  return {
    max_contamination_rate: Math.max(...results.map((result) => result.contamination_rate)),
    max_fragmentation_rate: Math.max(...results.map((result) => result.fragmentation_rate)),
    avg_coherence_score: Number(
      (
        results.reduce((total, result) => total + result.coherence_score, 0) /
        Math.max(1, results.length)
      ).toFixed(6),
    ),
    dataset_count: results.length,
    failed_dataset_ids: results.filter((result) => !result.pass).map((result) => result.dataset_id),
  };
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

async function computeReplayResults(scenario: StoryClusterReplayScenario) {
  const store = new MemoryClusterStore();
  const expectedByKey = new Map<string, string>();
  const previousStoryByEvent = new Map<string, string | null>();
  let persistenceObservations = 0;
  let persistenceRetained = 0;

  for (let tickIndex = 0; tickIndex < scenario.ticks.length; tickIndex += 1) {
    const tick = scenario.ticks[tickIndex]!;
    tick.forEach((item) => {
      expectedByKey.set(coherenceAuditInternal.itemEventKey(item), item.expected_event_id);
    });

    await runStoryClusterRemoteContract(
      { topic_id: scenario.topic_id, items: toRemoteItems(tick) },
      { store, clock: () => 1_714_000_000_000 + tickIndex * 1_000 },
    );

    const bundles = store.loadTopic(scenario.topic_id).clusters.map(liveBenchmarkInternal.bundleFromCluster);
    const currentStoryIds = liveBenchmarkInternal.eventStoryIdsFromBundles(bundles, expectedByKey);

    for (const [eventId, storyIds] of currentStoryIds) {
      const previous = previousStoryByEvent.get(eventId);
      const current = liveBenchmarkInternal.singleStoryId(storyIds);
      if (previous !== undefined) {
        persistenceObservations += 1;
        if (previous !== null && current !== null && previous === current) {
          persistenceRetained += 1;
        }
      }
      previousStoryByEvent.set(eventId, current);
    }
  }

  const finalState = store.loadTopic(scenario.topic_id);
  return {
    result: coherenceAuditInternal.computeDatasetResult(
      {
        dataset_id: scenario.scenario_id,
        topic_id: scenario.topic_id,
        items: scenario.ticks.flat(),
      },
      {
        bundles: finalState.clusters.map(liveBenchmarkInternal.bundleFromCluster),
        telemetry: coherenceAuditInternal.createEmptyTelemetry(scenario.topic_id),
      },
      STORYCLUSTER_BENCHMARK_CORPUS.replayThresholds,
    ),
    persistenceObservations,
    persistenceRetained,
  };
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
    const replayResults: StoryClusterCoherenceDatasetResult[] = [];
    let persistenceObservations = 0;
    let persistenceRetained = 0;

    for (const scenario of STORYCLUSTER_BENCHMARK_CORPUS.replayScenarios) {
      const replay = await computeReplayResults(scenario);
      replayResults.push(replay.result);
      persistenceObservations += replay.persistenceObservations;
      persistenceRetained += replay.persistenceRetained;
    }

    const persistenceRate = Number(
      (persistenceRetained / Math.max(1, persistenceObservations)).toFixed(6),
    );
    const aggregate = aggregateResults(replayResults);

    expect(aggregate.failed_dataset_ids).toEqual([]);
    expect(aggregate.max_contamination_rate).toBeLessThanOrEqual(
      STORYCLUSTER_BENCHMARK_CORPUS.replayThresholds.max_contamination_rate,
    );
    expect(aggregate.max_fragmentation_rate).toBeLessThanOrEqual(
      STORYCLUSTER_BENCHMARK_CORPUS.replayThresholds.max_fragmentation_rate,
    );
    expect(aggregate.avg_coherence_score).toBeGreaterThanOrEqual(
      STORYCLUSTER_BENCHMARK_CORPUS.replayThresholds.min_coherence_score,
    );
    expect(persistenceRate).toBeGreaterThanOrEqual(0.99);

    console.log(
      JSON.stringify(
        {
          benchmark: 'replay-suite',
          aggregate,
          persistence_rate: persistenceRate,
          persistence_observations: persistenceObservations,
          persistence_retained: persistenceRetained,
          datasets: replayResults.map((dataset) => ({
            dataset_id: dataset.dataset_id,
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
});
