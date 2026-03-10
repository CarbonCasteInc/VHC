import { mkdtempSync, readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoryClusterLiveBenchmarkReport } from './liveBenchmark';
import {
  renderStoryClusterLiveBenchmarkMarkdown,
  resolveStoryClusterLiveBenchmarkOutputDir,
  writeStoryClusterLiveBenchmarkArtifacts,
} from './liveBenchmarkArtifacts';

const tempDirs: string[] = [];

function makeReport(failedDatasetIds: string[] = []): StoryClusterLiveBenchmarkReport {
  return {
    schema_version: 'storycluster-live-benchmark-v1',
    generated_at_ms: 100,
    fixture_thresholds: {
      max_contamination_rate: 0.02,
      max_fragmentation_rate: 0.05,
      min_coherence_score: 0.93,
    },
    replay_thresholds: {
      max_contamination_rate: 0.05,
      max_fragmentation_rate: 0.08,
      min_coherence_score: 0.88,
    },
    fixture_results: [
      {
        dataset_id: 'fixture-a',
        topic_id: 'topic-a',
        total_docs: 2,
        total_bundles: 1,
        total_events: 1,
        contamination_docs: 0,
        fragmentation_splits: 0,
        contamination_rate: 0,
        fragmentation_rate: 0,
        coherence_score: 1,
        pass: failedDatasetIds.length === 0,
        run_latency_ms: 12,
      },
    ],
    replay_results: [
      {
        dataset_id: 'replay-a',
        scenario_id: 'replay-a',
        topic_id: 'topic-r',
        total_docs: 3,
        total_bundles: 1,
        total_events: 1,
        contamination_docs: 0,
        fragmentation_splits: 0,
        contamination_rate: 0,
        fragmentation_rate: 0,
        coherence_score: 1,
        pass: failedDatasetIds.length === 0,
        tick_count: 2,
        persistence_rate: 1,
        persistence_observations: 1,
        persistence_retained: 1,
        reappearance_rate: 1,
        reappearance_observations: 1,
        reappearance_retained: 1,
        merge_lineage_count: 1,
        split_lineage_count: 1,
        run_latency_ms: 25,
      },
    ],
    fixture_overall: {
      pass: failedDatasetIds.length === 0,
      avg_coherence_score: 1,
      max_contamination_rate: 0,
      max_fragmentation_rate: 0,
      failed_dataset_ids: failedDatasetIds,
    },
    replay_overall: {
      pass: failedDatasetIds.length === 0,
      avg_coherence_score: 1,
      max_contamination_rate: 0,
      max_fragmentation_rate: 0,
      failed_dataset_ids: failedDatasetIds,
      persistence_rate: 1,
      persistence_observations: 1,
      persistence_retained: 1,
      reappearance_rate: 1,
      reappearance_observations: 1,
      reappearance_retained: 1,
      merge_lineage_count: 1,
      split_lineage_count: 1,
    },
    corpus: {
      fixture_dataset_count: 1,
      replay_scenario_count: 1,
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe('live benchmark artifacts', () => {
  it('renders and writes markdown and json artifacts', () => {
    const successReport = makeReport();
    const failedReport = makeReport(['fixture-a']);
    const successMarkdown = renderStoryClusterLiveBenchmarkMarkdown(successReport);
    const failedMarkdown = renderStoryClusterLiveBenchmarkMarkdown(failedReport);

    expect(successMarkdown).toContain('failed_dataset_ids: none');
    expect(failedMarkdown).toContain('failed_dataset_ids: fixture-a');
    expect(successMarkdown).toContain('persistence_rate: 1');
    expect(successMarkdown).toContain('reappearance_rate: 1');
    expect(successMarkdown).toContain('merge_lineage_count: 1');
    expect(successMarkdown).toContain('splits=1');

    const outputDir = mkdtempSync(join(tmpdir(), 'storycluster-live-benchmark-'));
    tempDirs.push(outputDir);
    const paths = writeStoryClusterLiveBenchmarkArtifacts(successReport, outputDir);

    expect(readFileSync(paths.json_path, 'utf8')).toContain('storycluster-live-benchmark-v1');
    expect(readFileSync(paths.markdown_path, 'utf8')).toContain('# StoryCluster Live Benchmark Report');
  });

  it('resolves relative output directories against the repo root', () => {
    const resolved = resolveStoryClusterLiveBenchmarkOutputDir(
      'docs/reports/evidence/storycluster/live/test-relative-output',
    );

    expect(resolved).toContain('/Users/bldt/Desktop/VHC/VHC/docs/reports/evidence/storycluster/live/test-relative-output');
  });
});
