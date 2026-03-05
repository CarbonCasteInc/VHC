import {
  STORYCLUSTER_STAGE_SEQUENCE,
  StoryClusterStageError,
  type StoryClusterPipelineRequest,
  type StoryClusterPipelineResponse,
  type StoryClusterStageTelemetry,
} from './contracts';
import { createInitialState, resolveStageHandlers } from './stageHandlers';
import {
  buildTelemetry,
  clamp01,
  classifyDocument,
  hashToHex,
  normalizeRequest,
  normalizeToken,
  resolveLanguage,
  stageArtifactCounts,
  stageGatePassRate,
  stageInputCount,
  stageLatencyPerItemMs,
  stageOutputCount,
} from './stageHelpers';
import type { StageOverrideMap } from './stageState';

export interface StoryClusterStageRunnerOptions {
  clock?: () => number;
  stageOverrides?: StageOverrideMap;
}

export function runStoryClusterStagePipeline(
  request: StoryClusterPipelineRequest,
  options: StoryClusterStageRunnerOptions = {},
): StoryClusterPipelineResponse {
  const clock = options.clock ?? Date.now;
  const normalized = normalizeRequest(request, Math.floor(clock()));
  const handlers = resolveStageHandlers(options.stageOverrides);

  let state = createInitialState(normalized);
  const stageTelemetry: StoryClusterStageTelemetry[] = [];

  for (const stageId of STORYCLUSTER_STAGE_SEQUENCE) {
    const startedAtMs = Math.floor(clock());
    const inputCount = stageInputCount(stageId, state);

    try {
      state = handlers[stageId](state);
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
      throw new StoryClusterStageError(
        stageId,
        detail,
        buildTelemetry(normalized.topicId, normalized.documents.length, stageTelemetry, endedAtMs),
      );
    }
  }

  const generatedAtMs = Math.floor(clock());

  return {
    bundles: state.bundles,
    telemetry: buildTelemetry(
      normalized.topicId,
      normalized.documents.length,
      stageTelemetry,
      generatedAtMs,
    ),
  };
}

export const stageRunnerInternal = {
  buildTelemetry,
  clamp01,
  classifyDocument,
  normalizeToken,
  resolveLanguage,
  normalizeRequest,
  hashToHex,
  stageArtifactCounts,
  stageGatePassRate,
  stageInputCount,
  stageLatencyPerItemMs,
  stageOutputCount,
};
