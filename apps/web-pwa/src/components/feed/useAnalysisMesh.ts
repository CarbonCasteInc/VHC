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
const MESH_READ_MAX_ATTEMPTS = 3;
const MESH_READ_RETRY_BASE_DELAY_MS = 700;
const ANALYSIS_PENDING_TTL_MS = 90_000;
const PENDING_ACK_TIMEOUT_MS = 1_000;
const ANALYSIS_PENDING_OWNER =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `pending-${Math.random().toString(16).slice(2)}`;

function isCrossModelReuseEnabled(): boolean {
  const viteValue = (import.meta as any).env?.VITE_VH_ANALYSIS_CROSS_MODEL_REUSE;
  const processValue =
    typeof process !== 'undefined'
      ? process.env?.VITE_VH_ANALYSIS_CROSS_MODEL_REUSE
      : undefined;
  const raw = (viteValue ?? processValue ?? 'true').toString().trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
}

const CROSS_MODEL_REUSE_ENABLED = isCrossModelReuseEnabled();

interface AnalysisPendingPayload {
  readonly story_id: string;
  readonly provenance_hash: string;
  readonly model_scope: string;
  readonly owner: string;
  readonly started_at: number;
  readonly expires_at: number;
}

export interface AnalysisPendingStatus {
  readonly owner: string;
  readonly startedAt: number;
  readonly expiresAt: number;
}

function isMeshDebugEnabled(): boolean {
  try {
    if ((import.meta as any).env?.VITE_VH_ANALYSIS_MESH_DEBUG === 'true') {
      return true;
    }
  } catch {
    // ignore import.meta env access failures
  }

  if (typeof process !== 'undefined') {
    return process?.env?.VITE_VH_ANALYSIS_MESH_DEBUG === 'true';
  }

  return false;
}

const MESH_DEBUG_ENABLED = isMeshDebugEnabled();

function ensureNonEmpty(value: string | undefined | null, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function toPendingChain(client: ReturnType<typeof resolveClientFromAppStore>, storyId: string, modelScopeKey: string): any {
  return (client as any).mesh
    .get('news')
    .get('stories')
    .get(storyId)
    .get('analysis_pending')
    .get(modelScopeKey);
}

function readOnce(chain: any): Promise<Record<string, unknown> | null> {
  return new Promise<Record<string, unknown> | null>((resolve) => {
    chain.once((data: unknown) => {
      if (data && typeof data === 'object') {
        const payload = { ...(data as Record<string, unknown>) };
        delete (payload as any)._;
        resolve(payload);
        return;
      }
      resolve(null);
    });
  });
}

function putWithTimeout(chain: any, value: Record<string, unknown>): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, PENDING_ACK_TIMEOUT_MS);

    chain.put(value, (_ack?: { err?: string }) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve();
    });
  });
}

function parsePendingPayload(
  payload: Record<string, unknown> | null,
  story: StoryBundle,
  modelScopeKey: string,
): AnalysisPendingStatus | null {
  if (!payload) return null;

  const storyId = typeof payload.story_id === 'string' ? payload.story_id : '';
  const provenanceHash =
    typeof payload.provenance_hash === 'string' ? payload.provenance_hash : '';
  const modelScope = typeof payload.model_scope === 'string' ? payload.model_scope : '';
  const owner = typeof payload.owner === 'string' ? payload.owner : '';
  const startedAt =
    typeof payload.started_at === 'number' && Number.isFinite(payload.started_at)
      ? Math.floor(payload.started_at)
      : 0;
  const expiresAt =
    typeof payload.expires_at === 'number' && Number.isFinite(payload.expires_at)
      ? Math.floor(payload.expires_at)
      : 0;

  if (!storyId || !owner || startedAt <= 0 || expiresAt <= 0) {
    return null;
  }
  if (storyId !== story.story_id) {
    return null;
  }
  if (provenanceHash !== story.provenance_hash || modelScope !== modelScopeKey) {
    return null;
  }
  if (expiresAt <= Date.now()) {
    return null;
  }

  return { owner, startedAt, expiresAt };
}

function logMeshDebug(event: string, payload: Record<string, unknown>): void {
  if (!MESH_DEBUG_ENABLED) {
    return;
  }

  console.info('[vh:analysis:mesh:debug]', {
    event,
    ...payload,
  });
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
    analysisKey: artifact.analysisKey,
    modelScope: artifact.model_scope,
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

  const waitForRetry = async (attempt: number): Promise<void> => {
    const delayMs = MESH_READ_RETRY_BASE_DELAY_MS * attempt;
    logMeshDebug('read-retry-scheduled', {
      story_id: story.story_id,
      attempt,
      next_attempt_in_ms: delayMs,
    });
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(() => resolve(), delayMs);
    });
  };

  try {
    const derivedKey = await deriveAnalysisKey({
      story_id: story.story_id,
      provenance_hash: story.provenance_hash,
      pipeline_version: ANALYSIS_PIPELINE_VERSION,
      model_scope: modelScopeKey,
    });

    for (let attempt = 1; attempt <= MESH_READ_MAX_ATTEMPTS; attempt += 1) {
      logMeshDebug('read-derived-key', {
        story_id: story.story_id,
        attempt,
        max_attempts: MESH_READ_MAX_ATTEMPTS,
        analysis_key: derivedKey,
        provenance_hash: story.provenance_hash,
        model_scope: modelScopeKey,
      });

      const directArtifact = await readAnalysis(client, story.story_id, derivedKey);
      if (directArtifact) {
        if (
          directArtifact.model_scope !== modelScopeKey ||
          directArtifact.provenance_hash !== story.provenance_hash
        ) {
          logMeshDebug('read-derived-key-mismatch', {
            story_id: story.story_id,
            attempt,
            expected_analysis_key: derivedKey,
            expected_provenance_hash: story.provenance_hash,
            expected_model_scope: modelScopeKey,
            actual_analysis_key: directArtifact.analysisKey,
            actual_provenance_hash: directArtifact.provenance_hash,
            actual_model_scope: directArtifact.model_scope,
          });
          emitTelemetry('derived-key-invalid');
          return null;
        }

        logMeshDebug('read-derived-key-hit', {
          story_id: story.story_id,
          attempt,
          analysis_key: directArtifact.analysisKey,
          provenance_hash: directArtifact.provenance_hash,
          model_scope: directArtifact.model_scope,
        });
        emitTelemetry('derived-key');
        return toSynthesis(directArtifact);
      }

      logMeshDebug('read-derived-key-miss', {
        story_id: story.story_id,
        attempt,
        analysis_key: derivedKey,
        provenance_hash: story.provenance_hash,
        model_scope: modelScopeKey,
      });

      const latestArtifact = await readLatestAnalysis(client, story.story_id);
      if (!latestArtifact) {
        logMeshDebug('read-latest-pointer-miss', {
          story_id: story.story_id,
          attempt,
          analysis_key: derivedKey,
          provenance_hash: story.provenance_hash,
          model_scope: modelScopeKey,
        });
      } else {
        logMeshDebug('read-latest-pointer-candidate', {
          story_id: story.story_id,
          attempt,
          expected_analysis_key: derivedKey,
          expected_provenance_hash: story.provenance_hash,
          expected_model_scope: modelScopeKey,
          actual_analysis_key: latestArtifact.analysisKey,
          actual_provenance_hash: latestArtifact.provenance_hash,
          actual_model_scope: latestArtifact.model_scope,
        });

        if (latestArtifact.provenance_hash !== story.provenance_hash) {
          logMeshDebug('read-latest-pointer-provenance-mismatch', {
            story_id: story.story_id,
            attempt,
            expected_provenance_hash: story.provenance_hash,
            actual_provenance_hash: latestArtifact.provenance_hash,
            analysis_key: latestArtifact.analysisKey,
            model_scope: latestArtifact.model_scope,
          });
        } else if (
          latestArtifact.model_scope !== modelScopeKey &&
          !CROSS_MODEL_REUSE_ENABLED
        ) {
          logMeshDebug('read-latest-pointer-model-scope-mismatch', {
            story_id: story.story_id,
            attempt,
            expected_model_scope: modelScopeKey,
            actual_model_scope: latestArtifact.model_scope,
            analysis_key: latestArtifact.analysisKey,
            provenance_hash: latestArtifact.provenance_hash,
          });
        } else {
          if (latestArtifact.model_scope !== modelScopeKey) {
            logMeshDebug('read-latest-pointer-cross-model-reuse', {
              story_id: story.story_id,
              attempt,
              expected_model_scope: modelScopeKey,
              actual_model_scope: latestArtifact.model_scope,
              analysis_key: latestArtifact.analysisKey,
              provenance_hash: latestArtifact.provenance_hash,
            });
          }
          logMeshDebug('read-latest-pointer-hit', {
            story_id: story.story_id,
            attempt,
            analysis_key: latestArtifact.analysisKey,
            provenance_hash: latestArtifact.provenance_hash,
            model_scope: latestArtifact.model_scope,
          });
          emitTelemetry('latest-pointer');
          return toSynthesis(latestArtifact);
        }
      }

      if (attempt < MESH_READ_MAX_ATTEMPTS) {
        await waitForRetry(attempt);
      }
    }

    emitTelemetry('miss');
    return null;
  } catch (error) {
    emitTelemetry('miss');
    logMeshDebug('read-failed', {
      story_id: story.story_id,
      provenance_hash: story.provenance_hash,
      model_scope: modelScopeKey,
      error: error instanceof Error ? error.message : String(error),
    });
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

  let debugArtifact: Pick<StoryAnalysisArtifact, 'analysisKey' | 'provenance_hash' | 'model_scope'> | null = null;

  try {
    const artifact = await toArtifact(story, synthesis, modelScopeKey);
    debugArtifact = {
      analysisKey: artifact.analysisKey,
      provenance_hash: artifact.provenance_hash,
      model_scope: artifact.model_scope,
    };

    logMeshDebug('write-attempt', {
      story_id: story.story_id,
      analysis_key: artifact.analysisKey,
      provenance_hash: artifact.provenance_hash,
      model_scope: artifact.model_scope,
    });

    await writeAnalysis(client, artifact);

    logMeshDebug('write-success', {
      story_id: story.story_id,
      analysis_key: artifact.analysisKey,
      provenance_hash: artifact.provenance_hash,
      model_scope: artifact.model_scope,
      latency_ms: Math.max(0, Date.now() - startedAt),
    });

    logAnalysisMeshWrite({
      source: 'news-card',
      event: 'mesh_write_success',
      story_id: story.story_id,
      latency_ms: Math.max(0, Date.now() - startedAt),
    });
  } catch (error) {
    logMeshDebug('write-failed', {
      story_id: story.story_id,
      analysis_key: debugArtifact?.analysisKey,
      provenance_hash: debugArtifact?.provenance_hash,
      model_scope: debugArtifact?.model_scope,
      error: error instanceof Error ? error.message : String(error),
      latency_ms: Math.max(0, Date.now() - startedAt),
    });

    logAnalysisMeshWrite({
      source: 'news-card',
      event: 'mesh_write_failed',
      story_id: story.story_id,
      error: error instanceof Error ? error.message : String(error),
      latency_ms: Math.max(0, Date.now() - startedAt),
    });
  }
}

export async function readPendingMeshAnalysis(
  story: StoryBundle,
  modelScopeKey: string,
): Promise<AnalysisPendingStatus | null> {
  const client = resolveClientFromAppStore();
  if (!client) {
    return null;
  }

  try {
    const payload = await readOnce(toPendingChain(client, story.story_id, modelScopeKey));
    const parsed = parsePendingPayload(payload, story, modelScopeKey);
    if (parsed) {
      logMeshDebug('pending-read-hit', {
        story_id: story.story_id,
        owner: parsed.owner,
        expires_at: parsed.expiresAt,
      });
    }
    return parsed;
  } catch (error) {
    logMeshDebug('pending-read-failed', {
      story_id: story.story_id,
      model_scope: modelScopeKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function upsertPendingMeshAnalysis(
  story: StoryBundle,
  modelScopeKey: string,
): Promise<AnalysisPendingStatus | null> {
  const client = resolveClientFromAppStore();
  if (!client) {
    return null;
  }

  const now = Date.now();
  const pendingPayload: AnalysisPendingPayload = {
    story_id: story.story_id,
    provenance_hash: story.provenance_hash,
    model_scope: modelScopeKey,
    owner: ANALYSIS_PENDING_OWNER,
    started_at: now,
    expires_at: now + ANALYSIS_PENDING_TTL_MS,
  };

  try {
    const chain = toPendingChain(client, story.story_id, modelScopeKey);
    await putWithTimeout(chain, pendingPayload as unknown as Record<string, unknown>);
    logMeshDebug('pending-write', {
      story_id: story.story_id,
      owner: ANALYSIS_PENDING_OWNER,
      expires_at: pendingPayload.expires_at,
    });
    return {
      owner: pendingPayload.owner,
      startedAt: pendingPayload.started_at,
      expiresAt: pendingPayload.expires_at,
    };
  } catch (error) {
    logMeshDebug('pending-write-failed', {
      story_id: story.story_id,
      model_scope: modelScopeKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function clearPendingMeshAnalysis(
  story: StoryBundle,
  modelScopeKey: string,
): Promise<void> {
  const client = resolveClientFromAppStore();
  if (!client) {
    return;
  }

  const now = Date.now();
  const expiredPayload: AnalysisPendingPayload = {
    story_id: story.story_id,
    provenance_hash: story.provenance_hash,
    model_scope: modelScopeKey,
    owner: ANALYSIS_PENDING_OWNER,
    started_at: now,
    expires_at: now - 1,
  };

  try {
    const chain = toPendingChain(client, story.story_id, modelScopeKey);
    await putWithTimeout(chain, expiredPayload as unknown as Record<string, unknown>);
    logMeshDebug('pending-clear', {
      story_id: story.story_id,
      owner: ANALYSIS_PENDING_OWNER,
    });
  } catch (error) {
    logMeshDebug('pending-clear-failed', {
      story_id: story.story_id,
      model_scope: modelScopeKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const analysisMeshInternal = {
  clearPendingMeshAnalysis,
  readPendingMeshAnalysis,
  toArtifact,
  toSynthesis,
  upsertPendingMeshAnalysis,
};
