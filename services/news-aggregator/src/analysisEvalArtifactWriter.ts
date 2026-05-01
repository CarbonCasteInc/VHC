import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AnalysisEvalArtifact,
  AnalysisEvalArtifactWriter,
} from './analysisEvalArtifacts';
import type { LoggerLike } from './daemonUtils';

const DEFAULT_ARTIFACT_DIR = '.tmp/analysis-eval-artifacts';

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !['0', 'false', 'off', 'no'].includes(normalized);
}

function safeFileToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]+/g, '_').slice(0, 180) || 'artifact';
}

export function createJsonlAnalysisEvalArtifactWriter(input: {
  artifactDir: string;
}): AnalysisEvalArtifactWriter {
  return {
    async write(artifact) {
      const artifactsDir = path.join(input.artifactDir, 'artifacts');
      await mkdir(artifactsDir, { recursive: true });
      const artifactPath = path.join(artifactsDir, `${safeFileToken(artifact.artifact_id)}.json`);
      await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
      await appendFile(
        path.join(input.artifactDir, 'analysis-eval-artifacts.jsonl'),
        `${JSON.stringify(indexRecord(artifact, artifactPath))}\n`,
        'utf8',
      );
    },
  };
}

function indexRecord(artifact: AnalysisEvalArtifact, artifactPath: string): Record<string, unknown> {
  return {
    artifact_id: artifact.artifact_id,
    schema_version: artifact.schema_version,
    lifecycle_status: artifact.lifecycle_status,
    captured_at: artifact.captured_at,
    story_id: artifact.story.story_id,
    topic_id: artifact.story.topic_id,
    artifact_path: artifactPath,
    training_state: artifact.usage_policy.training_state,
  };
}

export function createAnalysisEvalArtifactWriterFromEnv(): AnalysisEvalArtifactWriter | undefined {
  if (!isTruthyFlag(process.env.VH_ANALYSIS_EVAL_ARTIFACTS_ENABLED)) {
    return undefined;
  }
  const configuredDir = process.env.VH_ANALYSIS_EVAL_ARTIFACT_DIR?.trim();
  return createJsonlAnalysisEvalArtifactWriter({
    artifactDir: configuredDir || path.resolve(process.cwd(), DEFAULT_ARTIFACT_DIR),
  });
}

export async function persistAnalysisEvalArtifact(input: {
  writer?: AnalysisEvalArtifactWriter;
  artifact: AnalysisEvalArtifact;
  logger: LoggerLike;
}): Promise<void> {
  if (!input.writer) {
    return;
  }
  try {
    await input.writer.write(input.artifact);
  } catch (error) {
    input.logger.warn('[vh:bundle-synthesis] analysis eval artifact write failed', {
      artifact_id: input.artifact.artifact_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
