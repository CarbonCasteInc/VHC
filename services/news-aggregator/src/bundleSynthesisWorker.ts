import { createHash } from 'node:crypto';
import {
  readStoryBundle,
  readTopicEpochCandidate,
  writeTopicEpochCandidate,
  writeTopicEpochSynthesis,
  writeTopicLatestSynthesisIfNotDowngrade,
  type SafeLatestWriteResult,
  type VennClient,
} from '@vh/gun-client';
import {
  buildBundlePromptFromStoryBundle,
  parseGeneratedBundleSynthesis,
  type GeneratedBundleSynthesisResult,
  type NewsRuntimeSynthesisCandidate,
  type StoryBundle,
} from '@vh/ai-engine';
import type { CandidateSynthesis, TopicSynthesisV2 } from '@vh/data-model';
import type { EnrichmentWorker, LoggerLike } from './daemonUtils';

const DEFAULT_PIPELINE_VERSION = 'news-bundle-v1';
const SYNTHESIS_ID_PREFIX = 'news-bundle:';

export interface BundleSynthesisWorkerDeps {
  client: VennClient;
  readStoryBundle: typeof readStoryBundle;
  readTopicEpochCandidate: typeof readTopicEpochCandidate;
  writeTopicEpochCandidate: typeof writeTopicEpochCandidate;
  writeTopicEpochSynthesis: typeof writeTopicEpochSynthesis;
  writeTopicLatestSynthesisIfNotDowngrade: typeof writeTopicLatestSynthesisIfNotDowngrade;
  relay: (prompt: string, context?: { storyId: string; topicId: string }) => Promise<string>;
  modelId: string;
  now: () => number;
  logger: LoggerLike;
  pipelineVersion?: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function deriveCandidateId(
  storyId: string,
  provenanceHash: string,
  modelId: string,
  pipelineVersion = DEFAULT_PIPELINE_VERSION,
): string {
  const input = `${pipelineVersion}|${storyId}|${provenanceHash}|${modelId}`;
  return `${SYNTHESIS_ID_PREFIX}${sha256Hex(input)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort|timeout/i.test(error.message));
}

function sortedPublishers(bundle: StoryBundle): string[] {
  const sources = bundle.primary_sources ?? bundle.sources;
  return Array.from(new Set(sources.map((source) => source.publisher))).sort();
}

function toCandidatePayload(input: {
  candidateId: string;
  topicId: string;
  parsed: GeneratedBundleSynthesisResult;
  modelId: string;
  warnings: string[];
  now: number;
}): CandidateSynthesis {
  return {
    candidate_id: input.candidateId,
    topic_id: input.topicId,
    epoch: 0,
    critique_notes: [],
    facts_summary: input.parsed.summary,
    frames: input.parsed.frames,
    warnings: input.warnings,
    divergence_hints: [],
    provider: {
      provider_id: 'openai',
      model_id: input.modelId,
      kind: 'remote',
    },
    created_at: input.now,
  };
}

function toSynthesisPayload(input: {
  storyId: string;
  topicId: string;
  provenanceHash: string;
  candidateId: string;
  parsed: GeneratedBundleSynthesisResult;
  warnings: string[];
  now: number;
}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: input.topicId,
    epoch: 0,
    synthesis_id: `${SYNTHESIS_ID_PREFIX}${input.storyId}:${input.provenanceHash.slice(0, 16)}`,
    inputs: { story_bundle_ids: [input.storyId] },
    quorum: {
      required: 1,
      received: 1,
      reached_at: input.now,
      timed_out: false,
      selection_rule: 'deterministic',
    },
    facts_summary: input.parsed.summary,
    frames: input.parsed.frames,
    warnings: input.warnings,
    divergence_metrics: {
      disagreement_score: 0,
      source_dispersion: 0,
      candidate_count: 1,
    },
    provenance: {
      candidate_ids: [input.candidateId],
      provider_mix: [{ provider_id: 'openai', count: 1 }],
    },
    created_at: input.now,
  };
}

export function createBundleSynthesisWorker(deps: BundleSynthesisWorkerDeps): EnrichmentWorker {
  const pipelineVersion = deps.pipelineVersion ?? DEFAULT_PIPELINE_VERSION;

  return async (candidate: NewsRuntimeSynthesisCandidate) => {
    const storyId = candidate.story_id;
    const startedAt = deps.now();

    const bundle = await deps.readStoryBundle(deps.client, storyId);
    if (!bundle) {
      deps.logger.warn('[vh:bundle-synth] bundle_missing', {
        story_id: storyId,
        pipeline_version: pipelineVersion,
        model_id: deps.modelId,
      });
      return;
    }

    const topicId = bundle.topic_id;
    const provenanceHash = bundle.provenance_hash;
    const bundleSources = bundle.primary_sources ?? bundle.sources;
    const actualSourceCount = bundleSources.length;
    const actualPublishers = sortedPublishers(bundle as StoryBundle);
    const candidateId = deriveCandidateId(storyId, provenanceHash, deps.modelId, pipelineVersion);

    deps.logger.info('[vh:bundle-synth] start', {
      story_id: storyId,
      topic_id: topicId,
      provenance_hash: provenanceHash,
      candidate_id: candidateId,
      pipeline_version: pipelineVersion,
      model_id: deps.modelId,
    });

    const existingCandidate = await deps.readTopicEpochCandidate(deps.client, topicId, 0, candidateId);
    if (existingCandidate) {
      deps.logger.info('[vh:bundle-synth] idempotent_skip', {
        story_id: storyId,
        topic_id: topicId,
        candidate_id: candidateId,
        pipeline_version: pipelineVersion,
        model_id: deps.modelId,
      });
      return;
    }

    const prompt = buildBundlePromptFromStoryBundle(bundle as StoryBundle);
    let raw: string;
    try {
      raw = await deps.relay(prompt, { storyId, topicId });
    } catch (error) {
      const event = isAbortError(error) ? 'relay_timeout' : 'relay_failed';
      deps.logger.warn(`[vh:bundle-synth] ${event}`, {
        story_id: storyId,
        topic_id: topicId,
        model_id: deps.modelId,
        pipeline_version: pipelineVersion,
        error_message: error instanceof Error ? error.message : String(error),
        latency_ms: Math.max(0, deps.now() - startedAt),
      });
      return;
    }

    let parsed: GeneratedBundleSynthesisResult;
    try {
      parsed = parseGeneratedBundleSynthesis(raw);
    } catch (error) {
      deps.logger.warn('[vh:bundle-synth] parse_failed', {
        story_id: storyId,
        topic_id: topicId,
        model_id: deps.modelId,
        pipeline_version: pipelineVersion,
        parse_error_code: error instanceof Error ? error.message : 'unknown',
      });
      return;
    }

    if (parsed.source_count !== actualSourceCount) {
      deps.logger.warn('[vh:bundle-synth] source_count_mismatch', {
        story_id: storyId,
        topic_id: topicId,
        model_id: deps.modelId,
        pipeline_version: pipelineVersion,
        parsed_source_count: parsed.source_count,
        actual_source_count: actualSourceCount,
      });
      return;
    }

    const now = deps.now();
    const warnings = actualSourceCount === 1 ? ['single-source-only'] : [];
    const candidatePayload = toCandidatePayload({
      candidateId,
      topicId,
      parsed,
      modelId: deps.modelId,
      warnings,
      now,
    });

    await deps.writeTopicEpochCandidate(deps.client, candidatePayload);
    deps.logger.info('[vh:bundle-synth] candidate_written', {
      story_id: storyId,
      candidate_id: candidateId,
      epoch: 0,
      quorum_received: 1,
      pipeline_version: pipelineVersion,
      model_id: deps.modelId,
    });

    const synthesisPayload = toSynthesisPayload({
      storyId,
      topicId,
      provenanceHash,
      candidateId,
      parsed,
      warnings,
      now,
    });

    await deps.writeTopicEpochSynthesis(deps.client, synthesisPayload);
    deps.logger.info('[vh:bundle-synth] epoch_synthesis_written', {
      story_id: storyId,
      topic_id: topicId,
      synthesis_id: synthesisPayload.synthesis_id,
      epoch: 0,
      pipeline_version: pipelineVersion,
      model_id: deps.modelId,
    });

    const latestResult: SafeLatestWriteResult = await deps.writeTopicLatestSynthesisIfNotDowngrade(
      deps.client,
      synthesisPayload,
      {
        ownershipGuard: (existing) => existing.synthesis_id.startsWith(SYNTHESIS_ID_PREFIX),
      },
    );

    if (latestResult.written) {
      deps.logger.info('[vh:bundle-synth] latest_written', {
        story_id: storyId,
        topic_id: topicId,
        synthesis_id: synthesisPayload.synthesis_id,
        pipeline_version: pipelineVersion,
        model_id: deps.modelId,
      });
    } else {
      deps.logger.info('[vh:bundle-synth] latest_skipped', {
        story_id: storyId,
        topic_id: topicId,
        reason: latestResult.reason,
        pipeline_version: pipelineVersion,
        model_id: deps.modelId,
      });
    }

    deps.logger.info('[vh:bundle-synth] done', {
      story_id: storyId,
      topic_id: topicId,
      candidate_id: candidateId,
      synthesis_id: synthesisPayload.synthesis_id,
      actual_source_count: actualSourceCount,
      publishers: actualPublishers,
      latest_written: latestResult.written,
      latest_skip_reason: latestResult.written ? undefined : latestResult.reason,
      latency_ms: Math.max(0, deps.now() - startedAt),
      pipeline_version: pipelineVersion,
      model_id: deps.modelId,
    });
  };
}

export const bundleSynthesisWorkerInternal = {
  DEFAULT_PIPELINE_VERSION,
  SYNTHESIS_ID_PREFIX,
  deriveCandidateId,
  isAbortError,
  toCandidatePayload,
  toSynthesisPayload,
};
