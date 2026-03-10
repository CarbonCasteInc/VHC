import type { StoryClusterTelemetryEnvelope } from './contracts';
import type { StoryClusterCoverageRole } from './documentPolicy';
import { runStoryClusterRemoteContract, type StoryClusterRemoteBundle, type StoryClusterRemoteItem, type StoryClusterRemoteResponse } from './remoteContract';

export interface StoryClusterCoherenceAuditItem extends StoryClusterRemoteItem {
  expected_event_id: string;
  coverage_role?: StoryClusterCoverageRole;
}

export interface StoryClusterCoherenceAuditDataset {
  dataset_id: string;
  topic_id: string;
  items: StoryClusterCoherenceAuditItem[];
}

export interface StoryClusterCoherenceThresholds {
  max_contamination_rate: number;
  max_fragmentation_rate: number;
  min_coherence_score: number;
}

export interface StoryClusterCoherenceDatasetResult {
  dataset_id: string;
  topic_id: string;
  total_docs: number;
  total_bundles: number;
  total_events: number;
  contamination_docs: number;
  fragmentation_splits: number;
  contamination_rate: number;
  fragmentation_rate: number;
  coherence_score: number;
  pass: boolean;
}

export interface StoryClusterCoherenceAuditReport {
  schema_version: 'storycluster-coherence-audit-v1';
  generated_at_ms: number;
  dataset_count: number;
  thresholds: StoryClusterCoherenceThresholds;
  datasets: StoryClusterCoherenceDatasetResult[];
  overall: {
    pass: boolean;
    avg_coherence_score: number;
    max_contamination_rate: number;
    max_fragmentation_rate: number;
    failed_dataset_ids: string[];
  };
}

type StoryClusterContractRunner = (
  payload: unknown,
  options?: {
    now?: () => number;
  },
) => Promise<StoryClusterRemoteResponse> | StoryClusterRemoteResponse;

const DEFAULT_THRESHOLDS: StoryClusterCoherenceThresholds = {
  max_contamination_rate: 0.1,
  max_fragmentation_rate: 0.25,
  min_coherence_score: 0.85,
};

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function toRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(6));
}

function normalizeThreshold(
  key: keyof StoryClusterCoherenceThresholds,
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`threshold ${key} must be a finite number between 0 and 1`);
  }

  return Number(value.toFixed(6));
}

function resolveThresholds(
  input: Partial<StoryClusterCoherenceThresholds> | undefined,
): StoryClusterCoherenceThresholds {
  return {
    max_contamination_rate: normalizeThreshold(
      'max_contamination_rate',
      input?.max_contamination_rate,
      DEFAULT_THRESHOLDS.max_contamination_rate,
    ),
    max_fragmentation_rate: normalizeThreshold(
      'max_fragmentation_rate',
      input?.max_fragmentation_rate,
      DEFAULT_THRESHOLDS.max_fragmentation_rate,
    ),
    min_coherence_score: normalizeThreshold(
      'min_coherence_score',
      input?.min_coherence_score,
      DEFAULT_THRESHOLDS.min_coherence_score,
    ),
  };
}

function normalizeExpectedEvent(value: string, path: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error(`${path}.expected_event_id must be a non-empty string`);
  }
  return normalized;
}

function normalizeCoverageRole(
  value: StoryClusterCoverageRole | undefined,
): StoryClusterCoverageRole {
  return value === 'related' ? 'related' : 'canonical';
}

function itemEventKey(item: Pick<StoryClusterRemoteItem, 'sourceId' | 'url_hash'>): string {
  return `${item.sourceId}::${item.url_hash}`;
}

function sourceEventKey(source: { source_id: string; url_hash: string }): string {
  return `${source.source_id}::${source.url_hash}`;
}

function bundleSources(bundle: StoryClusterRemoteResponse['bundles'][number]): Array<{ source_id: string; url_hash: string }> {
  return [
    ...(bundle.primary_sources ?? bundle.sources),
    ...(bundle.secondary_assets ?? []),
  ];
}

function dominantEventFromCounts(counts: Map<string, number>): string {
  if (counts.size === 0) return 'unmapped';
  const sorted = [...counts.entries()].sort((left, right) => {
    if (left[1] !== right[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });
  return sorted[0]![0];
}

function computeDatasetResult(
  dataset: StoryClusterCoherenceAuditDataset,
  response: StoryClusterRemoteResponse,
  thresholds: StoryClusterCoherenceThresholds,
): StoryClusterCoherenceDatasetResult {
  const expectedByKey = new Map<string, string>();
  const coverageRoleByKey = new Map<string, StoryClusterCoverageRole>();
  const uniqueEvents = new Set<string>();

  dataset.items.forEach((item, index) => {
    const eventId = normalizeExpectedEvent(item.expected_event_id, `dataset.items[${index}]`);
    const coverageRole = normalizeCoverageRole(item.coverage_role);
    expectedByKey.set(itemEventKey(item), eventId);
    coverageRoleByKey.set(itemEventKey(item), coverageRole);
    if (coverageRole === 'canonical') {
      uniqueEvents.add(eventId);
    }
  });

  const eventBundleMap = new Map<string, Set<string>>();
  for (const eventId of uniqueEvents) {
    eventBundleMap.set(eventId, new Set<string>());
  }

  let contaminationDocs = 0;

  response.bundles.forEach((bundle, bundleIndex) => {
    const bundleId = `${bundle.story_id}:${bundleIndex}`;
    const counts = new Map<string, number>();

    for (const source of bundleSources(bundle)) {
      const sourceKey = sourceEventKey(source);
      const eventId = expectedByKey.get(sourceKey);
      if (!eventId) {
        contaminationDocs += 1;
        continue;
      }
      if (coverageRoleByKey.get(sourceKey) !== 'canonical') {
        contaminationDocs += 1;
        continue;
      }

      counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
      eventBundleMap.get(eventId)!.add(bundleId);
    }

    const dominantEvent = dominantEventFromCounts(counts);
    const dominantCount = counts.get(dominantEvent) ?? 0;
    const mappedCount = [...counts.values()].reduce((total, value) => total + value, 0);
    contaminationDocs += Math.max(0, mappedCount - dominantCount);
  });

  let fragmentationSplits = 0;
  for (const eventId of uniqueEvents) {
    const bundleCount = eventBundleMap.get(eventId)!.size;
    if (bundleCount === 0) {
      fragmentationSplits += 1;
      continue;
    }

    if (bundleCount > 1) {
      fragmentationSplits += bundleCount - 1;
    }
  }

  const contaminationRate = toRatio(contaminationDocs, dataset.items.length);
  const fragmentationRate = toRatio(fragmentationSplits, uniqueEvents.size);
  const coherenceScore = Number(
    clamp01(1 - contaminationRate * 0.6 - fragmentationRate * 0.4).toFixed(6),
  );

  const pass =
    contaminationRate <= thresholds.max_contamination_rate &&
    fragmentationRate <= thresholds.max_fragmentation_rate &&
    coherenceScore >= thresholds.min_coherence_score;

  return {
    dataset_id: dataset.dataset_id,
    topic_id: dataset.topic_id,
    total_docs: dataset.items.length,
    total_bundles: response.bundles.length,
    total_events: uniqueEvents.size,
    contamination_docs: contaminationDocs,
    fragmentation_splits: fragmentationSplits,
    contamination_rate: contaminationRate,
    fragmentation_rate: fragmentationRate,
    coherence_score: coherenceScore,
    pass,
  };
}

function assertDataset(dataset: StoryClusterCoherenceAuditDataset, index: number): void {
  const datasetId = dataset.dataset_id.trim();
  if (!datasetId) throw new Error(`datasets[${index}].dataset_id must be non-empty`);
  const topicId = dataset.topic_id.trim();
  if (!topicId) throw new Error(`datasets[${index}].topic_id must be non-empty`);
  if (!Array.isArray(dataset.items) || dataset.items.length === 0) {
    throw new Error(`datasets[${index}].items must be a non-empty array`);
  }
}

function toRemoteRequestItems(items: StoryClusterCoherenceAuditItem[]): StoryClusterRemoteItem[] {
  return items.map(({ expected_event_id: _expectedEventId, ...item }) => ({
    ...item,
  }));
}

function createEmptyTelemetry(topicId: string): StoryClusterTelemetryEnvelope {
  return {
    schema_version: 'storycluster-stage-telemetry-v1',
    topic_id: topicId,
    request_doc_count: 0,
    stage_count: 0,
    total_latency_ms: 0,
    generated_at_ms: 0,
    stages: [],
  };
}

export async function runStoryClusterCoherenceAudit(
  datasets: StoryClusterCoherenceAuditDataset[],
  options: {
    now?: () => number;
    thresholds?: Partial<StoryClusterCoherenceThresholds>;
    contractRunner?: StoryClusterContractRunner;
  } = {},
): Promise<StoryClusterCoherenceAuditReport> {
  if (!Array.isArray(datasets) || datasets.length === 0) throw new Error('datasets must be a non-empty array');
  const thresholds = resolveThresholds(options.thresholds);
  const now = options.now ?? Date.now;
  const contractRunner = options.contractRunner ?? runStoryClusterRemoteContract;

  const results = await Promise.all(datasets.map(async (dataset, index) => {
    assertDataset(dataset, index);

    const response = await contractRunner(
      {
        topic_id: dataset.topic_id,
        items: toRemoteRequestItems(dataset.items),
      },
      {
        now,
      },
    );

    if (!Array.isArray(response.bundles)) {
      return computeDatasetResult(dataset, { bundles: [], telemetry: createEmptyTelemetry(dataset.topic_id) }, thresholds);
    }

    return computeDatasetResult(dataset, response, thresholds);
  }));

  const failedDatasetIds = results.filter((result) => !result.pass).map((result) => result.dataset_id);
  const avgCoherenceScore = toRatio(
    results.reduce((total, result) => total + result.coherence_score, 0),
    results.length,
  );
  const maxContaminationRate = Math.max(...results.map((result) => result.contamination_rate));
  const maxFragmentationRate = Math.max(...results.map((result) => result.fragmentation_rate));

  return {
    schema_version: 'storycluster-coherence-audit-v1',
    generated_at_ms: Math.floor(now()),
    dataset_count: results.length,
    thresholds,
    datasets: results,
    overall: {
      pass: failedDatasetIds.length === 0,
      avg_coherence_score: avgCoherenceScore,
      max_contamination_rate: maxContaminationRate,
      max_fragmentation_rate: maxFragmentationRate,
      failed_dataset_ids: failedDatasetIds,
    },
  };
}

export const coherenceAuditInternal = {
  bundleSources,
  clamp01,
  computeDatasetResult,
  createEmptyTelemetry,
  dominantEventFromCounts,
  itemEventKey,
  normalizeThreshold,
  resolveThresholds,
  sourceEventKey,
  toRatio,
};
