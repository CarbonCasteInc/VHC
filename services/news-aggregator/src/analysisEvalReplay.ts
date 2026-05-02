import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { TopicSynthesisV2Schema, type TopicSynthesisV2 } from '@vh/data-model';
import {
  readTopicLatestSynthesis,
  writeTopicSynthesis,
  type VennClient,
} from '@vh/gun-client';
import type { LoggerLike } from './daemonUtils';

const DEFAULT_ARTIFACT_DIR = '.tmp/analysis-eval-artifacts';

export interface AcceptedAnalysisEvalSynthesis {
  artifact_path: string;
  captured_at: number;
  story_id: string | null;
  synthesis: TopicSynthesisV2;
}

export interface AnalysisEvalReplayResult {
  candidates: number;
  written: number;
  already_current: number;
  failed: number;
}

export interface AnalysisEvalReplayOptions {
  client: VennClient;
  artifactDir: string;
  logger?: LoggerLike;
  readLatest?: typeof readTopicLatestSynthesis;
  writeSynthesis?: typeof writeTopicSynthesis;
  runWrite?: <T>(
    writeClass: string,
    attributes: Record<string, unknown>,
    task: () => Promise<T>,
  ) => Promise<T>;
}

function synthesisRank(entry: AcceptedAnalysisEvalSynthesis): [number, number, number] {
  return [
    Number.isFinite(entry.synthesis.epoch) ? entry.synthesis.epoch : 0,
    Number.isFinite(entry.synthesis.created_at) ? entry.synthesis.created_at : 0,
    Number.isFinite(entry.captured_at) ? entry.captured_at : 0,
  ];
}

function compareRank(leftEntry: AcceptedAnalysisEvalSynthesis, rightEntry: AcceptedAnalysisEvalSynthesis): number {
  const left = synthesisRank(leftEntry);
  const right = synthesisRank(rightEntry);
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }
  return 0;
}

export async function loadAcceptedAnalysisEvalSyntheses(
  artifactRoot: string,
  logger: LoggerLike = console,
): Promise<AcceptedAnalysisEvalSynthesis[]> {
  const artifactDir = path.join(artifactRoot, 'artifacts');
  let names: string[];
  try {
    names = await readdir(artifactDir);
  } catch (error) {
    logger.warn('[vh:analysis-eval-replay] artifact directory unavailable', {
      artifact_dir: artifactDir,
      error,
    });
    return [];
  }

  const latestByTopic = new Map<string, AcceptedAnalysisEvalSynthesis>();
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const artifactPath = path.join(artifactDir, name);
    try {
      const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as {
        lifecycle_status?: unknown;
        captured_at?: unknown;
        story?: { story_id?: unknown };
        final_accepted_synthesis?: unknown;
      };
      if (artifact.lifecycle_status !== 'accepted') {
        continue;
      }
      const parsed = TopicSynthesisV2Schema.safeParse(artifact.final_accepted_synthesis);
      if (!parsed.success) {
        continue;
      }
      const entry: AcceptedAnalysisEvalSynthesis = {
        artifact_path: artifactPath,
        captured_at: typeof artifact.captured_at === 'number' ? artifact.captured_at : 0,
        story_id: typeof artifact.story?.story_id === 'string' ? artifact.story.story_id : null,
        synthesis: parsed.data,
      };
      const existing = latestByTopic.get(entry.synthesis.topic_id);
      if (!existing || compareRank(existing, entry) <= 0) {
        latestByTopic.set(entry.synthesis.topic_id, entry);
      }
    } catch (error) {
      logger.warn('[vh:analysis-eval-replay] artifact parse failed', {
        artifact_path: artifactPath,
        error,
      });
    }
  }

  return [...latestByTopic.values()].sort((left, right) =>
    left.synthesis.topic_id.localeCompare(right.synthesis.topic_id),
  );
}

export async function replayAcceptedAnalysisEvalSyntheses(
  options: AnalysisEvalReplayOptions,
): Promise<AnalysisEvalReplayResult> {
  const logger = options.logger ?? console;
  const readLatest = options.readLatest ?? readTopicLatestSynthesis;
  const writeSynthesisAdapter = options.writeSynthesis ?? writeTopicSynthesis;
  const runWrite =
    options.runWrite ??
    (<T,>(_writeClass: string, _attributes: Record<string, unknown>, task: () => Promise<T>) => task());
  const entries = await loadAcceptedAnalysisEvalSyntheses(options.artifactDir, logger);
  const result: AnalysisEvalReplayResult = {
    candidates: entries.length,
    written: 0,
    already_current: 0,
    failed: 0,
  };

  for (const entry of entries) {
    try {
      const current = await readLatest(options.client, entry.synthesis.topic_id);
      if (current?.synthesis_id === entry.synthesis.synthesis_id) {
        result.already_current += 1;
        continue;
      }
      await runWrite(
        'analysis_eval_replay',
        {
          topic_id: entry.synthesis.topic_id,
          synthesis_id: entry.synthesis.synthesis_id,
          story_id: entry.story_id,
        },
        () => writeSynthesisAdapter(options.client, entry.synthesis),
      );
      result.written += 1;
      logger.info('[vh:analysis-eval-replay] synthesis replayed', {
        topic_id: entry.synthesis.topic_id,
        story_id: entry.story_id,
        synthesis_id: entry.synthesis.synthesis_id,
      });
    } catch (error) {
      result.failed += 1;
      logger.warn('[vh:analysis-eval-replay] synthesis replay failed', {
        topic_id: entry.synthesis.topic_id,
        story_id: entry.story_id,
        synthesis_id: entry.synthesis.synthesis_id,
        error,
      });
    }
  }

  logger.info('[vh:analysis-eval-replay] complete', {
    artifact_dir: options.artifactDir,
    ...result,
  });
  return result;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !['0', 'false', 'off', 'no'].includes(normalized);
}

export function resolveAnalysisEvalReplayArtifactDirFromEnv(): string | null {
  if (
    !isTruthyFlag(process.env.VH_ANALYSIS_EVAL_REPLAY_ON_START) &&
    !isTruthyFlag(process.env.VH_ANALYSIS_EVAL_ARTIFACTS_ENABLED)
  ) {
    return null;
  }
  const configuredDir = process.env.VH_ANALYSIS_EVAL_ARTIFACT_DIR?.trim();
  return configuredDir || path.resolve(process.cwd(), DEFAULT_ARTIFACT_DIR);
}
