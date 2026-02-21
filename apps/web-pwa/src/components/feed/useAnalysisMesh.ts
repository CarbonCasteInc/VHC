import {
  deriveAnalysisKey,
  type StoryAnalysisArtifact,
  type StoryBundle,
} from '@vh/data-model';
import { readAnalysis, readLatestAnalysis, writeAnalysis } from '@vh/gun-client';
import { resolveClientFromAppStore } from '../../store/clientResolver';
import { logAnalysisMeshWrite } from '../../utils/analysisTelemetry';
import type { NewsCardAnalysisSynthesis } from './newsCardAnalysis';

const ANALYSIS_PIPELINE_VERSION = 'news-card-analysis-v1';

function ensureNonEmpty(value: string | undefined | null, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function toSynthesis(artifact: StoryAnalysisArtifact): NewsCardAnalysisSynthesis {
  return {
    summary: artifact.summary,
    frames: artifact.frames.map((row) => ({
      frame: row.frame,
      reframe: row.reframe,
    })),
    analyses: artifact.analyses.map((entry) => ({
      source_id: entry.source_id,
      publisher: entry.publisher,
      url: entry.url,
      summary: entry.summary,
      biases: entry.biases,
      counterpoints: entry.counterpoints,
      biasClaimQuotes: entry.biasClaimQuotes,
      justifyBiasClaims: entry.justifyBiasClaims,
      provider_id: entry.provider_id,
      model_id: entry.model_id,
    })),
  };
}

async function toArtifact(
  story: StoryBundle,
  synthesis: NewsCardAnalysisSynthesis,
  modelScopeKey: string,
): Promise<StoryAnalysisArtifact> {
  const analysisKey = await deriveAnalysisKey({
    story_id: story.story_id,
    provenance_hash: story.provenance_hash,
    pipeline_version: ANALYSIS_PIPELINE_VERSION,
    model_scope: modelScopeKey,
  });

  const firstProvider = synthesis.analyses.find(
    (analysis) => analysis.provider_id?.trim() || analysis.model_id?.trim(),
  );

  return {
    schemaVersion: 'story-analysis-v1',
    story_id: story.story_id,
    topic_id: story.topic_id,
    provenance_hash: story.provenance_hash,
    analysisKey,
    pipeline_version: ANALYSIS_PIPELINE_VERSION,
    model_scope: modelScopeKey,
    summary: ensureNonEmpty(synthesis.summary, 'Summary unavailable.'),
    frames: synthesis.frames.map((row) => ({
      frame: ensureNonEmpty(row.frame, 'Frame unavailable.'),
      reframe: ensureNonEmpty(row.reframe, 'Reframe unavailable.'),
    })),
    analyses: synthesis.analyses.map((entry) => ({
      source_id: ensureNonEmpty(entry.source_id, story.story_id),
      publisher: ensureNonEmpty(entry.publisher, 'Unknown publisher'),
      url: ensureNonEmpty(entry.url, 'https://example.invalid/analysis'),
      summary: ensureNonEmpty(entry.summary, 'Summary unavailable.'),
      biases: entry.biases
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
      counterpoints: entry.counterpoints
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
      biasClaimQuotes: entry.biasClaimQuotes
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
      justifyBiasClaims: entry.justifyBiasClaims
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
      provider_id: entry.provider_id?.trim() || undefined,
      model_id: entry.model_id?.trim() || undefined,
    })),
    provider: {
      provider_id: ensureNonEmpty(firstProvider?.provider_id, 'unknown-provider'),
      model: ensureNonEmpty(firstProvider?.model_id, 'unknown-model'),
      timestamp: Date.now(),
    },
    created_at: new Date().toISOString(),
  };
}

export async function readMeshAnalysis(
  story: StoryBundle,
  modelScopeKey: string,
): Promise<NewsCardAnalysisSynthesis | null> {
  const client = resolveClientFromAppStore();
  if (!client) {
    return null;
  }

  const startedAt = Date.now();
  const emitTelemetry = (readPath: 'derived-key' | 'derived-key-invalid' | 'latest-pointer' | 'miss') => {
    console.info('[vh:analysis:mesh]', {
      story_id: story.story_id,
      read_path: readPath,
      latency_ms: Date.now() - startedAt,
    });
  };

  try {
    const derivedKey = await deriveAnalysisKey({
      story_id: story.story_id,
      provenance_hash: story.provenance_hash,
      pipeline_version: ANALYSIS_PIPELINE_VERSION,
      model_scope: modelScopeKey,
    });

    const directArtifact = await readAnalysis(client, story.story_id, derivedKey);
    if (directArtifact) {
      if (
        directArtifact.model_scope !== modelScopeKey ||
        directArtifact.provenance_hash !== story.provenance_hash
      ) {
        emitTelemetry('derived-key-invalid');
        return null;
      }

      emitTelemetry('derived-key');
      return toSynthesis(directArtifact);
    }

    const latestArtifact = await readLatestAnalysis(client, story.story_id);
    if (!latestArtifact) {
      emitTelemetry('miss');
      return null;
    }

    if (latestArtifact.provenance_hash !== story.provenance_hash) {
      emitTelemetry('miss');
      return null;
    }

    if (latestArtifact.model_scope !== modelScopeKey) {
      emitTelemetry('miss');
      return null;
    }

    emitTelemetry('latest-pointer');
    return toSynthesis(latestArtifact);
  } catch (error) {
    emitTelemetry('miss');
    console.warn('[vh:analysis:mesh] read failed', error);
    return null;
  }
}

export async function writeMeshAnalysis(
  story: StoryBundle,
  synthesis: NewsCardAnalysisSynthesis,
  modelScopeKey: string,
): Promise<void> {
  const startedAt = Date.now();
  const client = resolveClientFromAppStore();
  if (!client) {
    logAnalysisMeshWrite({
      source: 'news-card',
      event: 'mesh_write_skipped',
      story_id: story.story_id,
      reason: 'client_unavailable',
      latency_ms: 0,
    });
    return;
  }

  try {
    const artifact = await toArtifact(story, synthesis, modelScopeKey);
    await writeAnalysis(client, artifact);
    logAnalysisMeshWrite({
      source: 'news-card',
      event: 'mesh_write_success',
      story_id: story.story_id,
      latency_ms: Math.max(0, Date.now() - startedAt),
    });
  } catch (error) {
    logAnalysisMeshWrite({
      source: 'news-card',
      event: 'mesh_write_failed',
      story_id: story.story_id,
      error: error instanceof Error ? error.message : String(error),
      latency_ms: Math.max(0, Date.now() - startedAt),
    });
  }
}

export const analysisMeshInternal = {
  toArtifact,
  toSynthesis,
};
