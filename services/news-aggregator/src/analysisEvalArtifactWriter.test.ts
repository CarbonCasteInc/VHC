import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYSIS_EVAL_ARTIFACT_SCHEMA_VERSION,
  type AnalysisEvalArtifact,
} from './analysisEvalArtifacts';
import { createAnalysisEvalArtifactWriterFromEnv } from './analysisEvalArtifactWriter';

function artifactFixture(): AnalysisEvalArtifact {
  return {
    schema_version: ANALYSIS_EVAL_ARTIFACT_SCHEMA_VERSION,
    artifact_id: 'analysis-eval:test-artifact',
    captured_at: 1700000003000,
    lifecycle_status: 'accepted',
    usage_policy: {
      label_status: 'weak_label_unreviewed',
      training_state: 'not_training_ready',
      raw_article_text_training_use: 'requires_rights_review',
      generated_output_training_use: 'weak_label_only_until_reviewed',
    },
    request: {
      provider_id: 'openai',
      model: 'gpt-4o-mini',
      max_tokens: 2400,
      timeout_ms: 20000,
      rate_per_minute: 20,
      temperature: 0.2,
      pipeline_version: 'news-bundle-v2-fulltext',
    },
    story: {
      story_id: 'story-1',
      topic_id: 'topic-1',
      headline: 'Headline',
      provenance_hash: 'prov-1',
      cluster_window_start: 1,
      cluster_window_end: 2,
      story_kind: 'singleton',
      analysis_kind: 'singleton',
      sources: [],
      analysis_source_ids: [],
      readable_source_ids: [],
      analyzed_source_ids: [],
      failed_analysis_source_ids: [],
    },
    source_articles: [],
    bundle_synthesis: {},
    generated: {
      facts: [],
      summary: '',
      frame_reframe_table: [],
    },
    validator_events: [],
    validator_failures: [],
    retry_count: 0,
    warnings: [],
    human_review: {
      status: 'unreviewed',
      human_edits: [],
      human_approvals: [],
      human_rejections: [],
      user_facing_corrections: [],
    },
  };
}

describe('analysisEvalArtifactWriter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('persists full JSON artifacts and a compact JSONL index when enabled', async () => {
    const artifactDir = await mkdtemp(path.join(tmpdir(), 'vh-analysis-eval-'));
    vi.stubEnv('VH_ANALYSIS_EVAL_ARTIFACTS_ENABLED', 'true');
    vi.stubEnv('VH_ANALYSIS_EVAL_ARTIFACT_DIR', artifactDir);

    const writer = createAnalysisEvalArtifactWriterFromEnv();
    expect(writer).toBeDefined();
    await writer?.write(artifactFixture());

    const index = await readFile(path.join(artifactDir, 'analysis-eval-artifacts.jsonl'), 'utf8');
    const record = JSON.parse(index.trim()) as { artifact_path: string; training_state: string };
    const artifact = JSON.parse(await readFile(record.artifact_path, 'utf8')) as AnalysisEvalArtifact;

    expect(record.training_state).toBe('not_training_ready');
    expect(artifact.artifact_id).toBe('analysis-eval:test-artifact');
    expect(artifact.usage_policy.raw_article_text_training_use).toBe('requires_rights_review');
  });
});
