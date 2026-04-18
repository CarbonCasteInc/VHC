import {
  deriveAnalysisKey,
  type StoryAnalysisArtifact,
  type StoryAnalysisBundleIdentity,
  type StoryBundle,
} from '@vh/data-model';
import { readAnalysis, readLatestAnalysis, writeAnalysis } from '@vh/gun-client';
import { isPlaceholderPerspectiveText } from '../../../../../packages/ai-engine/src/schema';
import { resolveClientFromAppStore } from '../../store/clientResolver';
import { logAnalysisMeshWrite } from '../../utils/analysisTelemetry';
import {
  sanitizePublicationNeutralSummary,
  type NewsCardAnalysisSynthesis,
} from './newsCardAnalysis';

const ANALYSIS_PIPELINE_VERSION = 'news-card-analysis-v1';
const MESH_READ_MAX_ATTEMPTS = 3;
const MESH_READ_RETRY_BASE_DELAY_MS = 700;
const MESH_READ_DEFAULT_BUDGET_MS = 8_000;
const ANALYSIS_PENDING_TTL_MS = 90_000;
const PENDING_ACK_TIMEOUT_MS = 1_000;
const PENDING_READ_ONCE_TIMEOUT_DEFAULT_MS = 500;
const PENDING_READBACK_ATTEMPTS = 4;
const PENDING_READBACK_RETRY_MS = 250;

function resolveMeshReadOnceTimeoutMs(): number {
  let raw: unknown;
  try {
    raw = (import.meta as any).env?.VITE_VH_GUN_READ_TIMEOUT_MS;
  } catch {
    raw = undefined;
  }
  if ((raw === undefined || raw === null || raw === '') && typeof process !== 'undefined') {
    raw = process.env?.VITE_VH_GUN_READ_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 2_500;
  }
  return Math.max(500, Math.floor(parsed));
}

const MESH_READ_ONCE_TIMEOUT_MS = resolveMeshReadOnceTimeoutMs();

function resolveMeshReadBudgetMs(): number {
  let raw: unknown;
  try {
    raw = (import.meta as any).env?.VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS;
  } catch {
    raw = undefined;
  }
  if ((raw === undefined || raw === null || raw === '') && typeof process !== 'undefined') {
    raw = process.env?.VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MESH_READ_DEFAULT_BUDGET_MS;
  }
  return Math.max(1_000, Math.floor(parsed));
}

const MESH_READ_BUDGET_MS = resolveMeshReadBudgetMs();

function resolvePendingReadOnceTimeoutMs(): number {
  let raw: unknown;
  try {
    raw = (import.meta as any).env?.VITE_VH_ANALYSIS_PENDING_READ_TIMEOUT_MS;
  } catch {
    raw = undefined;
  }
  if ((raw === undefined || raw === null || raw === '') && typeof process !== 'undefined') {
    raw = process.env?.VITE_VH_ANALYSIS_PENDING_READ_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return PENDING_READ_ONCE_TIMEOUT_DEFAULT_MS;
  }
  return Math.max(100, Math.floor(parsed));
}

const PENDING_READ_ONCE_TIMEOUT_MS = resolvePendingReadOnceTimeoutMs();
const ANALYSIS_PENDING_OWNER =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `pending-${Math.random().toString(16).slice(2)}`;

class MeshArtifactInvalidError extends Error {
  constructor(public readonly reason: 'empty_frames') {
    super(`mesh artifact invalid: ${reason}`);
    this.name = 'MeshArtifactInvalidError';
  }
}

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

function filterValidFrameRows(
  rows: ReadonlyArray<{ frame: string; reframe: string }>,
): Array<{ frame: string; reframe: string }> {
  const valid: Array<{ frame: string; reframe: string }> = [];
  for (const row of rows) {
    const frame = row.frame?.trim() ?? '';
    const reframe = row.reframe?.trim() ?? '';
    if (!frame || !reframe) {
      continue;
    }
    if (isPlaceholderPerspectiveText(frame) || isPlaceholderPerspectiveText(reframe)) {
      continue;
    }
    valid.push({ frame, reframe });
  }
  return valid;
}

function buildAnalysisBundleIdentity(story: StoryBundle): StoryAnalysisBundleIdentity {
  const sourceArticleIds = [
    ...new Set(story.sources.map((source) => `${source.source_id}:${source.url_hash}`)),
  ].sort();

  return {
    bundle_revision: story.provenance_hash,
    source_article_ids: sourceArticleIds,
    source_count: sourceArticleIds.length,
    cluster_window_start: Math.max(0, Math.floor(story.cluster_window_start)),
    cluster_window_end: Math.max(0, Math.floor(story.cluster_window_end)),
  };
}

function storyIdentityMatchesArtifact(story: StoryBundle, artifact: StoryAnalysisArtifact): boolean {
  if (!artifact.bundle_identity) {
    return artifact.provenance_hash === story.provenance_hash;
  }

  return JSON.stringify(artifact.bundle_identity) === JSON.stringify(buildAnalysisBundleIdentity(story));
}

function toPendingChain(client: ReturnType<typeof resolveClientFromAppStore>, storyId: string, modelScopeKey: string): any {
  return (client as any).mesh
    .get('news')
    .get('stories')
    .get(storyId)
    .get('analysis_pending')
    .get(modelScopeKey);
}

function readOnce(
  chain: any,
  timeoutMs: number = MESH_READ_ONCE_TIMEOUT_MS,
): Promise<Record<string, unknown> | null> {
  return new Promise<Record<string, unknown> | null>((resolve) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    chain.once((data: unknown) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
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
    summary: sanitizePublicationNeutralSummary(
      artifact.summary,
      artifact.analyses.flatMap((entry) => [entry.source_id, entry.publisher]),
    ),
    frames: filterValidFrameRows(artifact.frames),
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
    relatedLinks: (artifact.relatedLinks ?? []).map((entry) => ({
      source_id: entry.source_id,
      publisher: entry.publisher,
      url: entry.url,
      url_hash: entry.url_hash,
      title: entry.title,
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
  const validFrames = filterValidFrameRows(synthesis.frames);
  if (validFrames.length === 0) {
    throw new MeshArtifactInvalidError('empty_frames');
  }

  return {
    schemaVersion: 'story-analysis-v1',
    story_id: story.story_id,
    topic_id: story.topic_id,
    provenance_hash: story.provenance_hash,
    analysisKey,
    pipeline_version: ANALYSIS_PIPELINE_VERSION,
    model_scope: modelScopeKey,
    summary: ensureNonEmpty(synthesis.summary, 'Summary unavailable.'),
    frames: validFrames,
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
    relatedLinks: synthesis.relatedLinks.map((entry) => ({
      source_id: ensureNonEmpty(entry.source_id, story.story_id),
      publisher: ensureNonEmpty(entry.publisher, 'Unknown publisher'),
      url: ensureNonEmpty(entry.url, 'https://example.invalid/related'),
      url_hash: ensureNonEmpty(entry.url_hash, `${story.story_id}-related`),
      title: ensureNonEmpty(entry.title, 'Related story'),
    })),
    bundle_identity: buildAnalysisBundleIdentity(story),
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
  const emitTelemetry = (
    readPath:
      | 'derived-key'
      | 'derived-key-invalid'
      | 'latest-pointer'
      | 'stale-placeholder-rejected'
      | 'miss',
    source?: 'derived-key' | 'latest-pointer',
  ) => {
    console.info('[vh:analysis:mesh]', {
      story_id: story.story_id,
      read_path: readPath,
      ...(source ? { source } : {}),
      latency_ms: Date.now() - startedAt,
    });
  };

  const waitForRetry = async (attempt: number, remainingBudgetMs: number): Promise<void> => {
    const delayMs = Math.min(
      MESH_READ_RETRY_BASE_DELAY_MS * attempt,
      Math.max(0, remainingBudgetMs),
    );
    if (delayMs <= 0) {
      return;
    }
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
    const deadlineAt = startedAt + MESH_READ_BUDGET_MS;

    for (let attempt = 1; attempt <= MESH_READ_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 1 && Date.now() >= deadlineAt) {
        logMeshDebug('read-budget-exhausted', {
          story_id: story.story_id,
          attempt,
          budget_ms: MESH_READ_BUDGET_MS,
        });
        break;
      }
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
          !storyIdentityMatchesArtifact(story, directArtifact)
        ) {
          logMeshDebug('read-derived-key-mismatch', {
            story_id: story.story_id,
            attempt,
            expected_analysis_key: derivedKey,
            expected_provenance_hash: story.provenance_hash,
            expected_bundle_identity: buildAnalysisBundleIdentity(story),
            expected_model_scope: modelScopeKey,
            actual_analysis_key: directArtifact.analysisKey,
            actual_provenance_hash: directArtifact.provenance_hash,
            actual_bundle_identity: directArtifact.bundle_identity ?? null,
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
        const synthesis = toSynthesis(directArtifact);
        if (synthesis.frames.length === 0) {
          logMeshDebug('read-derived-key-placeholder-rejected', {
            story_id: story.story_id,
            attempt,
            analysis_key: directArtifact.analysisKey,
            provenance_hash: directArtifact.provenance_hash,
            model_scope: directArtifact.model_scope,
          });
          emitTelemetry('stale-placeholder-rejected', 'derived-key');
          return null;
        }
        emitTelemetry('derived-key');
        return synthesis;
      }

      logMeshDebug('read-derived-key-miss', {
        story_id: story.story_id,
        attempt,
        analysis_key: derivedKey,
        provenance_hash: story.provenance_hash,
        model_scope: modelScopeKey,
      });

      const latestArtifact = await readLatestAnalysis(client, story.story_id, { fallbackToList: false });
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

        if (!storyIdentityMatchesArtifact(story, latestArtifact)) {
          logMeshDebug('read-latest-pointer-bundle-identity-mismatch', {
            story_id: story.story_id,
            attempt,
            expected_bundle_identity: buildAnalysisBundleIdentity(story),
            actual_analysis_key: latestArtifact.analysisKey,
            actual_provenance_hash: latestArtifact.provenance_hash,
            actual_bundle_identity: latestArtifact.bundle_identity ?? null,
            actual_model_scope: latestArtifact.model_scope,
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
            provenance_mode: 'exact',
          });
          const synthesis = toSynthesis(latestArtifact);
          if (synthesis.frames.length === 0) {
            logMeshDebug('read-latest-pointer-placeholder-rejected', {
              story_id: story.story_id,
              attempt,
              analysis_key: latestArtifact.analysisKey,
              provenance_hash: latestArtifact.provenance_hash,
              model_scope: latestArtifact.model_scope,
            });
            emitTelemetry('stale-placeholder-rejected', 'latest-pointer');
            return null;
          }
          emitTelemetry('latest-pointer');
          return synthesis;
        }
      }

      if (attempt < MESH_READ_MAX_ATTEMPTS) {
        const remainingBudgetMs = deadlineAt - Date.now();
        if (remainingBudgetMs <= 0) {
          break;
        }
        await waitForRetry(attempt, remainingBudgetMs);
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
    if (error instanceof MeshArtifactInvalidError) {
      logMeshDebug('write-skipped', {
        story_id: story.story_id,
        reason: error.reason,
        latency_ms: Math.max(0, Date.now() - startedAt),
      });

      logAnalysisMeshWrite({
        source: 'news-card',
        event: 'mesh_write_skipped',
        story_id: story.story_id,
        reason: error.reason,
        latency_ms: Math.max(0, Date.now() - startedAt),
      });
      return;
    }

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
    const payload = await readOnce(
      toPendingChain(client, story.story_id, modelScopeKey),
      PENDING_READ_ONCE_TIMEOUT_MS,
    );
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
    let observedContention: AnalysisPendingStatus | null = null;

    for (let attempt = 1; attempt <= PENDING_READBACK_ATTEMPTS; attempt += 1) {
      const observedPayload = await readOnce(chain, PENDING_READ_ONCE_TIMEOUT_MS);
      const observedPending = parsePendingPayload(observedPayload, story, modelScopeKey);
      if (observedPending?.owner === ANALYSIS_PENDING_OWNER) {
        logMeshDebug('pending-write', {
          story_id: story.story_id,
          owner: ANALYSIS_PENDING_OWNER,
          expires_at: observedPending.expiresAt,
          readback_attempt: attempt,
        });
        return observedPending;
      }

      if (observedPending && observedPending.owner !== ANALYSIS_PENDING_OWNER) {
        observedContention = observedPending;
      }

      if (attempt < PENDING_READBACK_ATTEMPTS) {
        await sleep(PENDING_READBACK_RETRY_MS);
      }
    }

    if (observedContention) {
      logMeshDebug('pending-lock-contention', {
        story_id: story.story_id,
        expected_owner: ANALYSIS_PENDING_OWNER,
        requested_started_at: pendingPayload.started_at,
        observed_owner: observedContention.owner,
        observed_started_at: observedContention.startedAt,
      });
      return null;
    }

    // If readback never returns a parseable payload, assume eventual-consistency lag and proceed.
    logMeshDebug('pending-write-readback-miss', {
      story_id: story.story_id,
      owner: ANALYSIS_PENDING_OWNER,
      expires_at: pendingPayload.expires_at,
    });
    return {
      owner: ANALYSIS_PENDING_OWNER,
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
  buildAnalysisBundleIdentity,
  clearPendingMeshAnalysis,
  filterValidFrameRows,
  readPendingMeshAnalysis,
  toArtifact,
  toSynthesis,
  upsertPendingMeshAnalysis,
};
