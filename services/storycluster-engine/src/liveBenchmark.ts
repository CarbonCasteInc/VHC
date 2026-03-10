import { STORYCLUSTER_BENCHMARK_CORPUS } from './benchmarkCorpus';
import { projectBundleSources } from './bundleProjection';
import { MemoryClusterStore, type ClusterStore } from './clusterStore';
import {
  coherenceAuditInternal,
  type StoryClusterCoherenceAuditDataset,
  type StoryClusterCoherenceAuditItem,
  type StoryClusterCoherenceThresholds,
  type StoryClusterCoherenceDatasetResult,
} from './coherenceAudit';
import {
  runStoryClusterRemoteContract,
  type StoryClusterRemoteBundle,
  type StoryClusterRemoteResponse,
} from './remoteContract';
import {
  aggregateReplayContinuity,
  createReplayContinuityTracker,
  observeReplayContinuityTick,
  summarizeReplayContinuity,
} from './liveBenchmarkReplayMetrics';
import type { StoredClusterRecord } from './stageState';
import type { StoryClusterReplayScenario } from './benchmarkCorpusReplays';

export type { StoryClusterReplayScenario } from './benchmarkCorpusReplays';

export interface StoryClusterFixtureBenchmarkResult extends StoryClusterCoherenceDatasetResult {
  run_latency_ms: number;
}

export interface StoryClusterReplayBenchmarkResult extends StoryClusterCoherenceDatasetResult {
  scenario_id: string;
  tick_count: number;
  persistence_rate: number;
  persistence_observations: number;
  persistence_retained: number;
  reappearance_rate: number;
  reappearance_observations: number;
  reappearance_retained: number;
  merge_lineage_count: number;
  split_lineage_count: number;
  run_latency_ms: number;
}

export interface StoryClusterLiveBenchmarkReport {
  schema_version: 'storycluster-live-benchmark-v1';
  generated_at_ms: number;
  fixture_thresholds: StoryClusterCoherenceThresholds;
  replay_thresholds: StoryClusterCoherenceThresholds;
  fixture_results: StoryClusterFixtureBenchmarkResult[];
  replay_results: StoryClusterReplayBenchmarkResult[];
  fixture_overall: {
    pass: boolean;
    avg_coherence_score: number;
    max_contamination_rate: number;
    max_fragmentation_rate: number;
    failed_dataset_ids: string[];
  };
  replay_overall: {
    pass: boolean;
    avg_coherence_score: number;
    max_contamination_rate: number;
    max_fragmentation_rate: number;
    failed_dataset_ids: string[];
    persistence_rate: number;
    persistence_observations: number;
    persistence_retained: number;
    reappearance_rate: number;
    reappearance_observations: number;
    reappearance_retained: number;
    merge_lineage_count: number;
    split_lineage_count: number;
  };
  corpus: {
    fixture_dataset_count: number;
    replay_scenario_count: number;
  };
}

export interface StoryClusterLiveBenchmarkOptions {
  now?: () => number;
  fixtureDatasets?: StoryClusterCoherenceAuditDataset[];
  fixtureThresholds?: Partial<StoryClusterCoherenceThresholds>;
  replayScenarios?: StoryClusterReplayScenario[];
  replayThresholds?: Partial<StoryClusterCoherenceThresholds>;
  remoteRunner?: typeof runStoryClusterRemoteContract;
  storeFactory?: () => ClusterStore;
}

const defaultCorpus = STORYCLUSTER_BENCHMARK_CORPUS;

function bundleFromCluster(cluster: StoredClusterRecord): StoryClusterRemoteBundle {
  const projected = projectBundleSources(cluster.source_documents);
  const sources = projected.primary_sources
    .map((source) => ({
      source_id: source.source_id,
      publisher: source.publisher,
      url: source.canonical_url,
      url_hash: source.url_hash,
      published_at: source.published_at,
      title: source.title,
    }))
    .sort((left, right) => `${left.source_id}:${left.url_hash}`.localeCompare(`${right.source_id}:${right.url_hash}`));
  const secondaryAssets = projected.secondary_assets
    .map((source) => ({
      source_id: source.source_id,
      publisher: source.publisher,
      url: source.canonical_url,
      url_hash: source.url_hash,
      published_at: source.published_at,
      title: source.title,
    }))
    .sort((left, right) => `${left.source_id}:${left.url_hash}`.localeCompare(`${right.source_id}:${right.url_hash}`));
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: cluster.story_id,
    topic_id: cluster.story_id,
    headline: cluster.headline,
    summary_hint: cluster.summary_hint,
    cluster_window_start: cluster.cluster_window_start,
    cluster_window_end: cluster.cluster_window_end,
    sources,
    primary_sources: sources,
    secondary_assets: secondaryAssets,
    cluster_features: {
      entity_keys: Object.keys(cluster.entity_scores).sort(),
      time_bucket: new Date(cluster.cluster_window_end).toISOString().slice(0, 13),
      semantic_signature: cluster.semantic_signature,
      coverage_score: sources.length,
      velocity_score: sources.length,
      confidence_score: 1,
      primary_language: cluster.primary_language,
      translation_applied: cluster.translation_applied,
    },
    provenance_hash: cluster.story_id,
    created_at: cluster.created_at,
  };
}

function singleStoryId(stories: Set<string> | undefined): string | null {
  if (!stories || stories.size !== 1) {
    return null;
  }
  return [...stories][0] as string;
}

function eventStoryIdsFromBundles(
  bundles: readonly StoryClusterRemoteBundle[],
  expectedByKey: Map<string, string>,
): Map<string, Set<string>> {
  const mapping = new Map<string, Set<string>>();
  for (const bundle of bundles) {
    for (const source of coherenceAuditInternal.bundleSources(bundle)) {
      const eventId = expectedByKey.get(
        coherenceAuditInternal.sourceEventKey({
          source_id: source.source_id,
          url_hash: source.url_hash,
        }),
      );
      if (!eventId) {
        continue;
      }
      const stories = mapping.get(eventId) ?? new Set<string>();
      stories.add(bundle.story_id);
      mapping.set(eventId, stories);
    }
  }
  return mapping;
}

function aggregateResults(results: readonly StoryClusterCoherenceDatasetResult[]) {
  return {
    pass: results.every((result) => result.pass),
    avg_coherence_score: Number(
      (
        results.reduce((total, result) => total + result.coherence_score, 0) /
        Math.max(1, results.length)
      ).toFixed(6),
    ),
    max_contamination_rate: Math.max(0, ...results.map((result) => result.contamination_rate)),
    max_fragmentation_rate: Math.max(0, ...results.map((result) => result.fragmentation_rate)),
    failed_dataset_ids: results.filter((result) => !result.pass).map((result) => result.dataset_id),
  };
}

function resolveThresholds(
  base: StoryClusterCoherenceThresholds,
  overrides: Partial<StoryClusterCoherenceThresholds> | undefined,
): StoryClusterCoherenceThresholds {
  return coherenceAuditInternal.resolveThresholds({ ...base, ...overrides });
}

function toRemoteItems(items: readonly StoryClusterCoherenceAuditItem[]) {
  return items.map(({ expected_event_id: _expectedEventId, ...item }) => item);
}

function toResponse(topicId: string, response: StoryClusterRemoteResponse): StoryClusterRemoteResponse {
  if (Array.isArray(response.bundles)) {
    return response;
  }
  return { bundles: [], telemetry: coherenceAuditInternal.createEmptyTelemetry(topicId) };
}

async function runReplayScenario(
  scenario: StoryClusterReplayScenario,
  thresholds: StoryClusterCoherenceThresholds,
  now: () => number,
  remoteRunner: typeof runStoryClusterRemoteContract,
  storeFactory: () => ClusterStore,
): Promise<StoryClusterReplayBenchmarkResult> {
  const startedAt = now();
  const store = storeFactory();
  const expectedByKey = new Map<string, string>();
  const continuity = createReplayContinuityTracker();
  const mergeLineage = new Set<string>();
  const splitLineage = new Set<string>();

  for (const [tickIndex, tick] of scenario.ticks.entries()) {
    await scenario.before_tick?.({
      scenario_id: scenario.scenario_id,
      topic_id: scenario.topic_id,
      tick_index: tickIndex,
      store,
      remoteRunner,
    });
    tick.forEach((item) => {
      expectedByKey.set(coherenceAuditInternal.itemEventKey(item), item.expected_event_id);
    });
    const response = toResponse(
      scenario.topic_id,
      await remoteRunner({ topic_id: scenario.topic_id, items: toRemoteItems(tick) }, { store, clock: now }),
    );
    const topicState = store.loadTopic(scenario.topic_id);
    for (const cluster of topicState.clusters) {
      for (const mergedFrom of cluster.lineage.merged_from) {
        mergeLineage.add(`${cluster.story_id}<-${mergedFrom}`);
      }
      if (cluster.lineage.split_from) {
        splitLineage.add(`${cluster.story_id}->${cluster.lineage.split_from}`);
      }
    }
    const bundles = response.bundles;
    const currentStoryByEvent = new Map<string, string | null>();
    for (const [eventId, storyIds] of eventStoryIdsFromBundles(bundles, expectedByKey)) {
      currentStoryByEvent.set(eventId, singleStoryId(storyIds));
    }
    observeReplayContinuityTick(continuity, currentStoryByEvent);
  }

  const finalState = store.loadTopic(scenario.topic_id);
  const result = coherenceAuditInternal.computeDatasetResult(
    {
      dataset_id: scenario.scenario_id,
      topic_id: scenario.topic_id,
      items: scenario.ticks.flat(),
    },
    {
      bundles: finalState.clusters.map(bundleFromCluster),
      telemetry: coherenceAuditInternal.createEmptyTelemetry(scenario.topic_id),
    },
    thresholds,
  );
  const continuityTotals = summarizeReplayContinuity(continuity);

  return {
    ...result,
    scenario_id: scenario.scenario_id,
    tick_count: scenario.ticks.length,
    ...continuityTotals,
    merge_lineage_count: mergeLineage.size,
    split_lineage_count: splitLineage.size,
    run_latency_ms: Math.max(0, now() - startedAt),
  };
}

export async function runStoryClusterLiveBenchmark(
  options: StoryClusterLiveBenchmarkOptions = {},
): Promise<StoryClusterLiveBenchmarkReport> {
  const now = options.now ?? Date.now;
  const remoteRunner = options.remoteRunner ?? runStoryClusterRemoteContract;
  const storeFactory = options.storeFactory ?? (() => new MemoryClusterStore());
  const fixtureDatasets = options.fixtureDatasets ?? defaultCorpus.fixtureDatasets;
  const replayScenarios = options.replayScenarios ?? defaultCorpus.replayScenarios;
  const fixtureThresholds = resolveThresholds(defaultCorpus.fixtureThresholds, options.fixtureThresholds);
  const replayThresholds = resolveThresholds(defaultCorpus.replayThresholds, options.replayThresholds);

  const fixtureResults: StoryClusterFixtureBenchmarkResult[] = [];
  for (const dataset of fixtureDatasets) {
    const startedAt = now();
    const response = toResponse(
      dataset.topic_id,
      await remoteRunner(
        { topic_id: dataset.topic_id, items: toRemoteItems(dataset.items) },
        { store: storeFactory(), clock: now },
      ),
    );
    const result = coherenceAuditInternal.computeDatasetResult(dataset, response, fixtureThresholds);
    fixtureResults.push({ ...result, run_latency_ms: Math.max(0, now() - startedAt) });
  }

  const replayResults: StoryClusterReplayBenchmarkResult[] = [];
  for (const scenario of replayScenarios) {
    replayResults.push(await runReplayScenario(scenario, replayThresholds, now, remoteRunner, storeFactory));
  }

  const fixtureOverall = aggregateResults(fixtureResults);
  const replayAggregate = aggregateResults(replayResults);
  const continuityTotals = aggregateReplayContinuity(replayResults);
  const mergeLineageCount = replayResults.reduce((total, result) => total + result.merge_lineage_count, 0);
  const splitLineageCount = replayResults.reduce((total, result) => total + result.split_lineage_count, 0);

  return {
    schema_version: 'storycluster-live-benchmark-v1',
    generated_at_ms: Math.floor(now()),
    fixture_thresholds: fixtureThresholds,
    replay_thresholds: replayThresholds,
    fixture_results: fixtureResults,
    replay_results: replayResults,
    fixture_overall: fixtureOverall,
    replay_overall: {
      ...replayAggregate,
      ...continuityTotals,
      merge_lineage_count: mergeLineageCount,
      split_lineage_count: splitLineageCount,
    },
    corpus: {
      fixture_dataset_count: fixtureDatasets.length,
      replay_scenario_count: replayScenarios.length,
    },
  };
}

export const liveBenchmarkInternal = {
  aggregateResults,
  bundleFromCluster,
  defaultCorpus,
  eventStoryIdsFromBundles,
  resolveThresholds,
  singleStoryId,
  toResponse,
};
