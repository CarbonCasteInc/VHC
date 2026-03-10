import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, resolve } from 'node:path';
import type { StoryClusterLiveBenchmarkReport } from './liveBenchmark';

export interface StoryClusterLiveBenchmarkArtifactPaths {
  json_path: string;
  markdown_path: string;
}

const repoRootDir = fileURLToPath(new URL('../../..', import.meta.url));

export function resolveStoryClusterLiveBenchmarkOutputDir(outputDir: string): string {
  return isAbsolute(outputDir) ? outputDir : resolve(repoRootDir, outputDir);
}

export function renderStoryClusterLiveBenchmarkMarkdown(
  report: StoryClusterLiveBenchmarkReport,
): string {
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
    `- failed_dataset_ids: ${report.replay_overall.failed_dataset_ids.join(', ') || 'none'}`,
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
      `- ${result.scenario_id}: ticks=${result.tick_count}, contamination=${result.contamination_rate}, fragmentation=${result.fragmentation_rate}, coherence=${result.coherence_score}, persistence=${result.persistence_rate}, latency_ms=${result.run_latency_ms}`,
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
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderStoryClusterLiveBenchmarkMarkdown(report), 'utf8');
  return {
    json_path: jsonPath,
    markdown_path: markdownPath,
  };
}
