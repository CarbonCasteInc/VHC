import { mkdtempSync, readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoryClusterLiveBenchmarkReport } from './liveBenchmark';
import {
  buildStoryClusterLiveBenchmarkArtifactIndex,
  renderStoryClusterLiveBenchmarkMarkdown,
  resolveStoryClusterLiveBenchmarkOutputDir,
  splitReplayCorrectionCycles,
  splitReplayContinuity,
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
        dataset_id: 'replay-continuous',
        scenario_id: 'replay-continuous',
        topic_id: 'topic-c',
        total_docs: 2,
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
        persistence_observations: 2,
        persistence_retained: 2,
        reappearance_rate: 0,
        reappearance_observations: 0,
        reappearance_retained: 0,
        merge_lineage_count: 0,
        split_lineage_count: 0,
        correction_cycle_count: 0,
        split_child_reuse_cycle_count: 0,
        run_latency_ms: 20,
      },
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
        correction_cycle_count: 1,
        split_child_reuse_cycle_count: 0,
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
      persistence_observations: 3,
      persistence_retained: 3,
      reappearance_rate: 1,
      reappearance_observations: 1,
      reappearance_retained: 1,
      merge_lineage_count: 1,
      split_lineage_count: 1,
      correction_cycle_count: 1,
      split_child_reuse_cycle_count: 0,
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
  it('splits replay continuity for continuous-only reports', () => {
    const report = makeReport();
    report.replay_results = [report.replay_results[0]!];

    expect(splitReplayContinuity(report)).toEqual({
      continuous: {
        scenario_count: 1,
        scenario_ids: ['replay-continuous'],
        min_persistence_rate: 1,
      },
      reappearance: {
        scenario_count: 0,
        scenario_ids: [],
        min_reappearance_rate: null,
        total_observations: 0,
        total_retained: 0,
      },
    });
  });

  it('splits replay continuity for reappearance-only reports', () => {
    const report = makeReport();
    report.replay_results = [report.replay_results[1]!];

    expect(splitReplayContinuity(report)).toEqual({
      continuous: {
        scenario_count: 0,
        scenario_ids: [],
        min_persistence_rate: null,
      },
      reappearance: {
        scenario_count: 1,
        scenario_ids: ['replay-a'],
        min_reappearance_rate: 1,
        total_observations: 1,
        total_retained: 1,
      },
    });
  });

  it('summarizes correction cycles from replay lineage counts', () => {
    const report = makeReport();
    report.replay_results = [
      report.replay_results[0]!,
      {
        ...report.replay_results[1]!,
        scenario_id: 'replay-correction-a',
        merge_lineage_count: 2,
        split_lineage_count: 3,
        correction_cycle_count: 3,
        split_child_reuse_cycle_count: 1,
      },
      {
        ...report.replay_results[1]!,
        scenario_id: 'replay-correction-b',
        merge_lineage_count: 1,
        split_lineage_count: 1,
        correction_cycle_count: 1,
        split_child_reuse_cycle_count: 0,
      },
    ];

    expect(splitReplayCorrectionCycles(report)).toEqual({
      scenario_count: 2,
      scenario_ids: ['replay-correction-a', 'replay-correction-b'],
      total_merge_lineage_count: 3,
      total_split_lineage_count: 4,
      total_cycle_count: 4,
      total_split_child_reuse_cycle_count: 1,
      repeated_cycle_scenario_count: 1,
      repeated_cycle_scenario_ids: ['replay-correction-a'],
    });
  });

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
    expect(successMarkdown).toContain('total_split_child_reuse_cycle_count: 0');
    expect(successMarkdown).toContain('splits=1');

    const outputDir = mkdtempSync(join(tmpdir(), 'storycluster-live-benchmark-'));
    tempDirs.push(outputDir);
    const paths = writeStoryClusterLiveBenchmarkArtifacts(successReport, outputDir);
    const index = JSON.parse(readFileSync(paths.index_path, 'utf8')) as {
      schema_version: string;
      replay_continuity: {
        continuous: { scenario_count: number; min_persistence_rate: number | null };
        reappearance: { scenario_count: number; min_reappearance_rate: number | null; total_observations: number };
      };
    };

    expect(readFileSync(paths.json_path, 'utf8')).toContain('storycluster-live-benchmark-v1');
    expect(readFileSync(paths.markdown_path, 'utf8')).toContain('# StoryCluster Live Benchmark Report');
    expect(index.schema_version).toBe('storycluster-live-benchmark-index-v1');
    expect(index.replay_continuity.continuous.scenario_count).toBe(1);
    expect(index.replay_continuity.continuous.min_persistence_rate).toBe(1);
    expect(index.replay_continuity.reappearance.scenario_count).toBe(1);
    expect(index.replay_continuity.reappearance.min_reappearance_rate).toBe(1);
    expect(index.replay_continuity.reappearance.total_observations).toBe(1);
    expect((index as {
      replay_correction_cycles: {
        total_cycle_count: number;
        total_split_child_reuse_cycle_count: number;
        repeated_cycle_scenario_count: number;
      };
    }).replay_correction_cycles.total_cycle_count).toBe(1);
    expect((index as {
      replay_correction_cycles: {
        total_cycle_count: number;
        total_split_child_reuse_cycle_count: number;
        repeated_cycle_scenario_count: number;
      };
    }).replay_correction_cycles.total_split_child_reuse_cycle_count).toBe(0);
    expect((index as {
      replay_correction_cycles: {
        total_cycle_count: number;
        total_split_child_reuse_cycle_count: number;
        repeated_cycle_scenario_count: number;
      };
    }).replay_correction_cycles.repeated_cycle_scenario_count).toBe(0);
  });

  it('renders none markers when no correction-cycle scenarios are present', () => {
    const report = makeReport();
    report.replay_results = [report.replay_results[0]!];

    const markdown = renderStoryClusterLiveBenchmarkMarkdown(report);

    expect(markdown).toContain('scenario_ids: none');
    expect(markdown).toContain('repeated_cycle_scenario_ids: none');
  });

  it('builds a release artifact index with replay continuity split', () => {
    const report = makeReport();
    const index = buildStoryClusterLiveBenchmarkArtifactIndex(report, {
      json_path: '/tmp/storycluster-live-benchmark.json',
      markdown_path: '/tmp/storycluster-live-benchmark.md',
      index_path: '/tmp/release-artifact-index.json',
    });

    expect(index.schema_version).toBe('storycluster-live-benchmark-index-v1');
    expect(index.artifact_paths.index_path).toBe('/tmp/release-artifact-index.json');
    expect(index.replay_continuity.continuous.scenario_ids).toEqual(['replay-continuous']);
    expect(index.replay_continuity.reappearance.scenario_ids).toEqual(['replay-a']);
  });

  it('resolves relative output directories against the repo root', () => {
    const resolved = resolveStoryClusterLiveBenchmarkOutputDir(
      'docs/reports/evidence/storycluster/live/test-relative-output',
    );

    expect(resolved).toMatch(/\/docs\/reports\/evidence\/storycluster\/live\/test-relative-output$/);
  });
});
