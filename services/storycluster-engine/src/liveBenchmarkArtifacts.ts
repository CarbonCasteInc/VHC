import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, resolve } from 'node:path';
import type { StoryClusterLiveBenchmarkReport } from './liveBenchmark';

export interface StoryClusterLiveBenchmarkArtifactPaths {
  json_path: string;
  markdown_path: string;
  index_path: string;
}

export interface StoryClusterLiveBenchmarkArtifactIndex {
  schema_version: 'storycluster-live-benchmark-index-v1';
  generated_at_ms: number;
  artifact_paths: Partial<StoryClusterLiveBenchmarkArtifactPaths>;
  fixture_overall: StoryClusterLiveBenchmarkReport['fixture_overall'];
  replay_overall: StoryClusterLiveBenchmarkReport['replay_overall'];
  replay_continuity: ReturnType<typeof splitReplayContinuity>;
  replay_correction_cycles: ReturnType<typeof splitReplayCorrectionCycles>;
}

const repoRootDir = fileURLToPath(new URL('../../..', import.meta.url));

export function splitReplayContinuity(report: StoryClusterLiveBenchmarkReport) {
  const continuous = report.replay_results.filter((result) => result.reappearance_observations === 0);
  const reappearance = report.replay_results.filter((result) => result.reappearance_observations > 0);
  return {
    continuous: {
      scenario_count: continuous.length,
      scenario_ids: continuous.map((result) => result.scenario_id),
      min_persistence_rate: continuous.length > 0
        ? Math.min(...continuous.map((result) => result.persistence_rate))
        : null,
    },
    reappearance: {
      scenario_count: reappearance.length,
      scenario_ids: reappearance.map((result) => result.scenario_id),
      min_reappearance_rate: reappearance.length > 0
        ? Math.min(...reappearance.map((result) => result.reappearance_rate))
        : null,
      total_observations: reappearance.reduce((sum, result) => sum + result.reappearance_observations, 0),
      total_retained: reappearance.reduce((sum, result) => sum + result.reappearance_retained, 0),
    },
  };
}

export function splitReplayCorrectionCycles(report: StoryClusterLiveBenchmarkReport) {
  const correctionScenarios = report.replay_results.filter(
    (result) =>
      result.merge_lineage_count > 0 ||
      result.split_lineage_count > 0 ||
      result.correction_cycle_count > 0,
  );
  const repeatedCycleScenarios = correctionScenarios.filter(
    (result) => result.split_child_reuse_cycle_count > 0 || result.correction_cycle_count > 1,
  );
  return {
    scenario_count: correctionScenarios.length,
    scenario_ids: correctionScenarios.map((result) => result.scenario_id),
    total_merge_lineage_count: correctionScenarios.reduce((sum, result) => sum + result.merge_lineage_count, 0),
    total_split_lineage_count: correctionScenarios.reduce((sum, result) => sum + result.split_lineage_count, 0),
    total_cycle_count: correctionScenarios.reduce((sum, result) => sum + result.correction_cycle_count, 0),
    total_split_child_reuse_cycle_count: correctionScenarios.reduce(
      (sum, result) => sum + result.split_child_reuse_cycle_count,
      0,
    ),
    repeated_cycle_scenario_count: repeatedCycleScenarios.length,
    repeated_cycle_scenario_ids: repeatedCycleScenarios.map((result) => result.scenario_id),
  };
}

export function buildStoryClusterLiveBenchmarkArtifactIndex(
  report: StoryClusterLiveBenchmarkReport,
  artifactPaths: Partial<StoryClusterLiveBenchmarkArtifactPaths>,
): StoryClusterLiveBenchmarkArtifactIndex {
  return {
    schema_version: 'storycluster-live-benchmark-index-v1',
    generated_at_ms: report.generated_at_ms,
    artifact_paths: artifactPaths,
    fixture_overall: report.fixture_overall,
    replay_overall: report.replay_overall,
    replay_continuity: splitReplayContinuity(report),
    replay_correction_cycles: splitReplayCorrectionCycles(report),
  };
}

export function resolveStoryClusterLiveBenchmarkOutputDir(outputDir: string): string {
  return isAbsolute(outputDir) ? outputDir : resolve(repoRootDir, outputDir);
}

export function renderStoryClusterLiveBenchmarkMarkdown(
  report: StoryClusterLiveBenchmarkReport,
): string {
  const replayCorrectionCycles = splitReplayCorrectionCycles(report);
  const lines = [
    '# StoryCluster Live Benchmark Report',
    '',
    `Generated: ${new Date(report.generated_at_ms).toISOString()}`,
    '',
    '## Fixture Overall',
    '',
    `- pass: ${report.fixture_overall.pass}`,
    `- avg_coherence_score: ${report.fixture_overall.avg_coherence_score}`,
    `- max_contamination_rate: ${report.fixture_overall.max_contamination_rate}`,
    `- max_fragmentation_rate: ${report.fixture_overall.max_fragmentation_rate}`,
    `- failed_dataset_ids: ${report.fixture_overall.failed_dataset_ids.join(', ') || 'none'}`,
    '',
    '## Replay Overall',
    '',
    `- pass: ${report.replay_overall.pass}`,
    `- avg_coherence_score: ${report.replay_overall.avg_coherence_score}`,
    `- max_contamination_rate: ${report.replay_overall.max_contamination_rate}`,
    `- max_fragmentation_rate: ${report.replay_overall.max_fragmentation_rate}`,
    `- persistence_rate: ${report.replay_overall.persistence_rate}`,
    `- reappearance_rate: ${report.replay_overall.reappearance_rate}`,
    `- merge_lineage_count: ${report.replay_overall.merge_lineage_count}`,
    `- split_lineage_count: ${report.replay_overall.split_lineage_count}`,
    `- failed_dataset_ids: ${report.replay_overall.failed_dataset_ids.join(', ') || 'none'}`,
    '',
    '## Replay Correction Cycles',
    '',
    `- scenario_count: ${replayCorrectionCycles.scenario_count}`,
    `- total_cycle_count: ${replayCorrectionCycles.total_cycle_count}`,
    `- total_split_child_reuse_cycle_count: ${replayCorrectionCycles.total_split_child_reuse_cycle_count}`,
    `- repeated_cycle_scenario_count: ${replayCorrectionCycles.repeated_cycle_scenario_count}`,
    `- scenario_ids: ${replayCorrectionCycles.scenario_ids.join(', ') || 'none'}`,
    `- repeated_cycle_scenario_ids: ${replayCorrectionCycles.repeated_cycle_scenario_ids.join(', ') || 'none'}`,
    '',
    '## Fixture Datasets',
    '',
    ...report.fixture_results.flatMap((result) => [
      `- ${result.dataset_id}: docs=${result.total_docs}, bundles=${result.total_bundles}, contamination=${result.contamination_rate}, fragmentation=${result.fragmentation_rate}, coherence=${result.coherence_score}, latency_ms=${result.run_latency_ms}`,
    ]),
    '',
    '## Replay Scenarios',
    '',
    ...report.replay_results.flatMap((result) => [
      `- ${result.scenario_id}: ticks=${result.tick_count}, contamination=${result.contamination_rate}, fragmentation=${result.fragmentation_rate}, coherence=${result.coherence_score}, persistence=${result.persistence_rate}, reappearance=${result.reappearance_rate}, merges=${result.merge_lineage_count}, splits=${result.split_lineage_count}, latency_ms=${result.run_latency_ms}`,
    ]),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function writeStoryClusterLiveBenchmarkArtifacts(
  report: StoryClusterLiveBenchmarkReport,
  outputDir: string,
): StoryClusterLiveBenchmarkArtifactPaths {
  const resolvedOutputDir = resolveStoryClusterLiveBenchmarkOutputDir(outputDir);
  mkdirSync(resolvedOutputDir, { recursive: true });
  const jsonPath = join(resolvedOutputDir, 'storycluster-live-benchmark.json');
  const markdownPath = join(resolvedOutputDir, 'storycluster-live-benchmark.md');
  const indexPath = join(resolvedOutputDir, 'release-artifact-index.json');
  const artifactIndex = buildStoryClusterLiveBenchmarkArtifactIndex(report, {
    json_path: jsonPath,
    markdown_path: markdownPath,
    index_path: indexPath,
  });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderStoryClusterLiveBenchmarkMarkdown(report), 'utf8');
  writeFileSync(indexPath, `${JSON.stringify(artifactIndex, null, 2)}\n`, 'utf8');
  return {
    json_path: jsonPath,
    markdown_path: markdownPath,
    index_path: indexPath,
  };
}
