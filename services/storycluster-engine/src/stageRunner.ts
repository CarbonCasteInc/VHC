import {
  STORYCLUSTER_STAGE_SEQUENCE,
  StoryClusterStageError,
  type StoryClusterPipelineRequest,
  type StoryClusterPipelineResponse,
  type StoryClusterStageTelemetry,
} from './contracts';
import { getDefaultClusterStore, type ClusterStore } from './clusterStore';
import { createInitialState, resolveStageHandlers } from './stageHandlers';
import {
  buildTelemetry,
  clamp01,
  normalizeRequest,
  stageArtifactCounts,
  stageGatePassRate,
  stageInputCount,
  stageLatencyPerItemMs,
  stageOutputCount,
} from './stageHelpers';
import type { StageOverrideMap } from './stageState';
import { classifyDocumentType, resolveLanguage } from './contentSignals';
import { sha256Hex } from './hashUtils';
import type { StoryClusterModelProvider } from './modelProvider';
import { createOpenAIStoryClusterProviderFromEnv } from './openaiProvider';
import { createDeterministicTestModelProvider } from './testModelProvider';
import { normalizeText } from './textSignals';
import { type ClusterVectorBackend, resolveVectorBackend } from './vectorBackend';

function traceEnabled(): boolean {
  const raw = process.env.VH_STORYCLUSTER_TRACE?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function traceLog(event: string, detail: Record<string, unknown>): void {
  if (!traceEnabled()) {
    return;
  }
  console.info(`[vh:storycluster] ${event}`, detail);
}

export interface StoryClusterStageRunnerOptions {
  clock?: () => number;
  stageOverrides?: StageOverrideMap;
  store?: ClusterStore;
  modelProvider?: StoryClusterModelProvider;
  vectorBackend?: ClusterVectorBackend;
}

function resolveModelProvider(
  provider: StoryClusterModelProvider | undefined,
): StoryClusterModelProvider {
  if (provider) {
    return provider;
  }
  if (process.env.VH_STORYCLUSTER_USE_TEST_PROVIDER === 'true') {
    return createDeterministicTestModelProvider();
  }
  if (process.env.NODE_ENV === 'test') {
    return createDeterministicTestModelProvider();
  }
  return createOpenAIStoryClusterProviderFromEnv();
}

export async function runStoryClusterStagePipeline(
  request: StoryClusterPipelineRequest,
  options: StoryClusterStageRunnerOptions = {},
): Promise<StoryClusterPipelineResponse> {
  const clock = options.clock ?? Date.now;
  const store = options.store ?? getDefaultClusterStore();
  const vectorBackend = resolveVectorBackend(options.vectorBackend);
  const modelProvider = resolveModelProvider(options.modelProvider);
  const storeReadiness = store.readiness();
  if (!storeReadiness.ok) {
    throw new Error(`storycluster store is not ready: ${storeReadiness.detail}`);
  }
  const vectorReadiness = await vectorBackend.readiness();
  if (!vectorReadiness.ok) {
    throw new Error(`storycluster vector backend is not ready: ${vectorReadiness.detail}`);
  }

  const normalized = normalizeRequest(request, Math.floor(clock()));
  const handlers = resolveStageHandlers(options.stageOverrides, modelProvider, vectorBackend);
  let state = createInitialState(normalized, store);
  const stageTelemetry: StoryClusterStageTelemetry[] = [];
  const pipelineStartedAtMs = Math.floor(clock());

  traceLog('pipeline_started', {
    topic_id: normalized.topicId,
    document_count: normalized.documents.length,
  });

  for (const stageId of STORYCLUSTER_STAGE_SEQUENCE) {
    const startedAtMs = Math.floor(clock());
    const inputCount = stageInputCount(stageId, state);

    traceLog('stage_started', {
      topic_id: normalized.topicId,
      stage_id: stageId,
      input_count: inputCount,
    });

    try {
      state = await handlers[stageId](state);
      const endedAtMs = Math.floor(clock());
      const outputCount = stageOutputCount(stageId, state);
      const latencyMs = Math.max(0, endedAtMs - startedAtMs);
      stageTelemetry.push({
        stage_id: stageId,
        status: 'ok',
        input_count: inputCount,
        output_count: outputCount,
        gate_pass_rate: stageGatePassRate(inputCount, outputCount),
        started_at_ms: startedAtMs,
        ended_at_ms: endedAtMs,
        latency_ms: latencyMs,
        latency_per_item_ms: stageLatencyPerItemMs(latencyMs, inputCount),
        artifact_counts: stageArtifactCounts(stageId, state, inputCount, outputCount),
      });
      traceLog('stage_completed', {
        topic_id: normalized.topicId,
        stage_id: stageId,
        input_count: inputCount,
        output_count: outputCount,
        latency_ms: latencyMs,
      });
    } catch (error) {
      const endedAtMs = Math.floor(clock());
      const detail = error instanceof Error ? error.message : String(error);
      const latencyMs = Math.max(0, endedAtMs - startedAtMs);
      stageTelemetry.push({
        stage_id: stageId,
        status: 'error',
        input_count: inputCount,
        output_count: 0,
        gate_pass_rate: 0,
        started_at_ms: startedAtMs,
        ended_at_ms: endedAtMs,
        latency_ms: latencyMs,
        latency_per_item_ms: stageLatencyPerItemMs(latencyMs, inputCount),
        artifact_counts: {
          failed_stage: 1,
          retained_docs_before_error: state.documents.length,
        },
        detail,
      });
      traceLog('stage_failed', {
        topic_id: normalized.topicId,
        stage_id: stageId,
        input_count: inputCount,
        latency_ms: latencyMs,
        detail,
      });
      throw new StoryClusterStageError(
        stageId,
        detail,
        buildTelemetry(normalized.topicId, normalized.documents.length, stageTelemetry, endedAtMs),
      );
    }
  }

  store.saveTopic(state.topic_state);
  await vectorBackend.replaceTopicClusters(normalized.topicId, state.topic_state.clusters);
  const generatedAtMs = Math.floor(clock());
  const storylines = state.storylines ?? [];
  traceLog('pipeline_completed', {
    topic_id: normalized.topicId,
    document_count: normalized.documents.length,
    bundle_count: state.bundles.length,
    storyline_count: storylines.length,
    duration_ms: Math.max(0, generatedAtMs - pipelineStartedAtMs),
  });
  return {
    bundles: state.bundles,
    storylines,
    telemetry: buildTelemetry(normalized.topicId, normalized.documents.length, stageTelemetry, generatedAtMs),
  };
}

export const stageRunnerInternal = {
  buildTelemetry,
  clamp01,
  classifyDocument: (title: string) => {
    const type = classifyDocumentType(title, undefined, '');
    if (type === 'breaking_update') return 'breaking';
    if (type === 'analysis') return 'analysis';
    if (type === 'opinion') return 'opinion';
    return 'general';
  },
  hashToHex: sha256Hex,
  normalizeRequest,
  normalizeToken: normalizeText,
  resolveModelProvider,
  resolveLanguage: (document: { title: string; summary?: string; language_hint?: string }) =>
    resolveLanguage(`${document.title} ${document.summary ?? ''}`.trim(), document.language_hint),
  resolveVectorBackend,
  stageArtifactCounts,
  stageGatePassRate,
  stageInputCount,
  stageLatencyPerItemMs,
  stageOutputCount,
};
