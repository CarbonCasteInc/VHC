import { describe, expect, it } from 'vitest';
import { runStoryClusterLiveBenchmark } from './liveBenchmark';
import {
  buildStoryClusterLiveBenchmarkArtifactIndex,
  writeStoryClusterLiveBenchmarkArtifacts,
} from './liveBenchmarkArtifacts';

const shouldRun = process.env.VH_RUN_STORYCLUSTER_LIVE_BENCHMARK === '1';
const runLiveBenchmark = shouldRun ? it : it.skip;

describe('StoryCluster live benchmark', () => {
  runLiveBenchmark('passes the sampled corpus against production OpenAI + Qdrant wiring', async () => {
    expect(process.env.NODE_ENV).toBe('production');
    expect(process.env.VH_STORYCLUSTER_VECTOR_BACKEND).toBe('qdrant');
    expect(process.env.VH_STORYCLUSTER_QDRANT_URL || process.env.QDRANT_URL).toBeTruthy();
    expect(process.env.OPENAI_API_KEY).toBeTruthy();

    const report = await runStoryClusterLiveBenchmark();

    expect(report.fixture_overall.pass).toBe(true);
    expect(report.replay_overall.pass).toBe(true);
    expect(report.fixture_overall.max_contamination_rate).toBeLessThanOrEqual(report.fixture_thresholds.max_contamination_rate);
    expect(report.fixture_overall.max_fragmentation_rate).toBeLessThanOrEqual(report.fixture_thresholds.max_fragmentation_rate);
    expect(report.fixture_overall.avg_coherence_score).toBeGreaterThanOrEqual(report.fixture_thresholds.min_coherence_score);
    expect(report.replay_overall.max_contamination_rate).toBeLessThanOrEqual(report.replay_thresholds.max_contamination_rate);
    expect(report.replay_overall.max_fragmentation_rate).toBeLessThanOrEqual(report.replay_thresholds.max_fragmentation_rate);
    expect(report.replay_overall.avg_coherence_score).toBeGreaterThanOrEqual(report.replay_thresholds.min_coherence_score);
    expect(report.replay_results.filter((dataset) => dataset.reappearance_observations === 0).every((dataset) => dataset.persistence_rate >= 0.99)).toBe(true);
    expect(report.replay_overall.reappearance_observations).toBeGreaterThan(0);
    expect(report.replay_overall.reappearance_rate).toBeGreaterThanOrEqual(0.99);

    const artifactDir = process.env.VH_STORYCLUSTER_LIVE_BENCHMARK_ARTIFACT_DIR?.trim();
    const artifactPaths = artifactDir
      ? writeStoryClusterLiveBenchmarkArtifacts(report, artifactDir)
      : null;
    const releaseArtifactIndex = buildStoryClusterLiveBenchmarkArtifactIndex(
      report,
      artifactPaths ?? {},
    );

    console.log(JSON.stringify({
      schema_version: report.schema_version,
      corpus: report.corpus,
      fixture_overall: report.fixture_overall,
      replay_overall: report.replay_overall,
      replay_continuity: releaseArtifactIndex.replay_continuity,
      replay_correction_cycles: releaseArtifactIndex.replay_correction_cycles,
      artifact_paths: artifactPaths,
      release_artifact_index: releaseArtifactIndex,
    }, null, 2));
  }, 600000);
});
