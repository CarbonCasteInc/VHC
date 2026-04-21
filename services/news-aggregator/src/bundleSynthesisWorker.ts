import { createHash } from 'node:crypto';
import {
  attachPersistedFramePointIds,
  buildBundlePromptFromStoryBundle,
  parseGeneratedBundleSynthesis,
  type NewsRuntimeSynthesisCandidate,
} from '@vh/ai-engine';
import type { CandidateSynthesis, StoryBundle, TopicSynthesisV2 } from '@vh/data-model';
import {
  readStoryBundle,
  readTopicEpochCandidate,
  writeTopicEpochCandidate,
  writeTopicEpochSynthesis,
  writeTopicLatestSynthesisIfNotDowngrade,
  type VennClient,
} from '@vh/gun-client';
import type { LoggerLike } from './daemonUtils';
import {
  DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS,
  DEFAULT_BUNDLE_SYNTHESIS_MODEL,
  DEFAULT_BUNDLE_SYNTHESIS_PIPELINE_VERSION,
  DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN,
  DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS,
  postBundleSynthesisCompletion,
  type BundleSynthesisRelayResponse,
} from './bundleSynthesisRelay';

const BUNDLE_SYNTHESIS_EPOCH = 0;
const PROVIDER_ID = 'openai';
const LATEST_OWNER_PREFIX = 'news-bundle:';

export type BundleSynthesisWorkerResult =
  | { status: 'written'; storyId: string; synthesisId: string; latestStatus: 'written' | 'skipped' }
  | { status: 'skipped'; storyId: string; reason: 'story_missing' | 'no_analysis_sources' }
  | { status: 'rejected'; storyId: string; reason: 'relay_failed' | 'parse_failed' | 'source_count_mismatch' };

export interface BundleSynthesisWorkerConfig {
  client: VennClient;
  logger?: LoggerLike;
  now?: () => number;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  ratePerMinute?: number;
  pipelineVersion?: string;
  relay?: (request: {
    prompt: string;
    model: string;
    maxTokens: number;
    timeoutMs: number;
    ratePerMinute: number;
  }) => Promise<BundleSynthesisRelayResponse>;
  readBundle?: (client: VennClient, storyId: string) => Promise<StoryBundle | null>;
  readCandidate?: typeof readTopicEpochCandidate;
  writeCandidate?: (client: VennClient, candidate: CandidateSynthesis) => Promise<CandidateSynthesis>;
  writeSynthesis?: (client: VennClient, synthesis: TopicSynthesisV2) => Promise<TopicSynthesisV2>;
  writeLatest?: typeof writeTopicLatestSynthesisIfNotDowngrade;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeIdToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '_') || 'story';
}

function resolveAnalysisSources(bundle: StoryBundle): StoryBundle['sources'] {
  return bundle.primary_sources ?? bundle.sources;
}

function buildBundleFingerprint(bundle: StoryBundle, pipelineVersion: string, model: string): string {
  return digest({
    pipelineVersion,
    model_id: model,
    story_id: bundle.story_id,
    topic_id: bundle.topic_id,
    provenance_hash: bundle.provenance_hash,
    source_hashes: resolveAnalysisSources(bundle).map((source) => ({
      source_id: source.source_id,
      url_hash: source.url_hash,
    })),
  });
}

function buildCandidatePayload(input: {
  candidateId: string;
  bundle: StoryBundle;
  summary: string;
  frames: CandidateSynthesis['frames'];
  warnings: string[];
  model: string;
  now: number;
}): CandidateSynthesis {
  return {
    candidate_id: input.candidateId,
    topic_id: input.bundle.topic_id,
    epoch: BUNDLE_SYNTHESIS_EPOCH,
    critique_notes: ['publish-time story bundle synthesis'],
    facts_summary: input.summary,
    frames: input.frames,
    warnings: input.warnings,
    divergence_hints: [],
    provider: {
      provider_id: PROVIDER_ID,
      model_id: input.model,
      kind: 'remote',
    },
    created_at: input.now,
  };
}

function buildTopicSynthesisPayload(input: {
  synthesisId: string;
  candidateId: string;
  bundle: StoryBundle;
  summary: string;
  frames: CandidateSynthesis['frames'];
  warnings: string[];
  now: number;
}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: input.bundle.topic_id,
    epoch: BUNDLE_SYNTHESIS_EPOCH,
    synthesis_id: input.synthesisId,
    inputs: {
      story_bundle_ids: [input.bundle.story_id],
    },
    quorum: {
      required: 1,
      received: 1,
      reached_at: input.now,
      timed_out: false,
      selection_rule: 'deterministic',
    },
    facts_summary: input.summary,
    frames: attachPersistedFramePointIds(input.synthesisId, input.frames),
    warnings: input.warnings,
    divergence_metrics: {
      disagreement_score: input.frames.length > 0 ? 0.5 : 0,
      source_dispersion: resolveAnalysisSources(input.bundle).length > 1 ? 1 : 0,
      candidate_count: 1,
    },
    provenance: {
      candidate_ids: [input.candidateId],
      provider_mix: [{ provider_id: PROVIDER_ID, count: 1 }],
    },
    created_at: input.now,
  };
}

async function writeAcceptedSynthesis(input: {
  config: BundleSynthesisWorkerConfig;
  bundle: StoryBundle;
  candidateId: string;
  synthesisId: string;
  summary: string;
  frames: CandidateSynthesis['frames'];
  warnings: string[];
  createdAt: number;
  writeSynthesis: (client: VennClient, synthesis: TopicSynthesisV2) => Promise<TopicSynthesisV2>;
  writeLatest: typeof writeTopicLatestSynthesisIfNotDowngrade;
}): Promise<{ latestStatus: 'written' | 'skipped' }> {
  const synthesisPayload = buildTopicSynthesisPayload({
    synthesisId: input.synthesisId,
    candidateId: input.candidateId,
    bundle: input.bundle,
    summary: input.summary,
    frames: input.frames,
    warnings: input.warnings,
    now: input.createdAt,
  });

  await input.writeSynthesis(input.config.client, synthesisPayload);
  const latestResult = await input.writeLatest(input.config.client, synthesisPayload, {
    canOverwriteExisting: (existing) => existing.synthesis_id.startsWith(LATEST_OWNER_PREFIX),
  });
  return { latestStatus: latestResult.status };
}

export function createBundleSynthesisWorker(
  config: BundleSynthesisWorkerConfig,
): (candidate: NewsRuntimeSynthesisCandidate) => Promise<BundleSynthesisWorkerResult> {
  const logger = config.logger ?? console;
  const now = config.now ?? Date.now;
  const model = config.model?.trim() || DEFAULT_BUNDLE_SYNTHESIS_MODEL;
  const maxTokens = Math.max(1, Math.floor(config.maxTokens ?? DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS));
  const timeoutMs = Math.max(1, Math.floor(config.timeoutMs ?? DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS));
  const ratePerMinute = Math.max(1, Math.floor(config.ratePerMinute ?? DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN));
  const pipelineVersion = config.pipelineVersion?.trim() || DEFAULT_BUNDLE_SYNTHESIS_PIPELINE_VERSION;
  const relay = config.relay ?? postBundleSynthesisCompletion;
  const readBundle = config.readBundle ?? readStoryBundle;
  const readCandidate = config.readCandidate ?? readTopicEpochCandidate;
  const writeCandidate = config.writeCandidate ?? writeTopicEpochCandidate;
  const writeSynthesis = config.writeSynthesis ?? writeTopicEpochSynthesis;
  const writeLatest = config.writeLatest ?? writeTopicLatestSynthesisIfNotDowngrade;

  return async (candidate) => {
    const storyId = candidate.story_id;
    const bundle = await readBundle(config.client, storyId);
    if (!bundle) {
      logger.warn('[vh:bundle-synthesis] story bundle missing; skipped', { story_id: storyId });
      return { status: 'skipped', storyId, reason: 'story_missing' };
    }

    const analysisSources = resolveAnalysisSources(bundle);
    if (analysisSources.length === 0) {
      logger.warn('[vh:bundle-synthesis] no analysis-eligible sources; skipped', { story_id: storyId });
      return { status: 'skipped', storyId, reason: 'no_analysis_sources' };
    }

    const fingerprint = buildBundleFingerprint(bundle, pipelineVersion, model);
    const candidateId = `news-bundle:${fingerprint.slice(0, 32)}`;
    const synthesisId = `news-bundle:${normalizeIdToken(bundle.story_id)}:${fingerprint.slice(0, 16)}`;
    const existingCandidate = await readCandidate(config.client, bundle.topic_id, BUNDLE_SYNTHESIS_EPOCH, candidateId);
    if (existingCandidate) {
      const { latestStatus } = await writeAcceptedSynthesis({
        config,
        bundle,
        candidateId,
        synthesisId,
        summary: existingCandidate.facts_summary,
        frames: existingCandidate.frames,
        warnings: existingCandidate.warnings,
        createdAt: existingCandidate.created_at,
        writeSynthesis,
        writeLatest,
      });
      logger.info('[vh:bundle-synthesis] duplicate candidate recovered synthesis; skipped model call', {
        story_id: storyId,
        candidate_id: candidateId,
        synthesis_id: synthesisId,
        latest_status: latestStatus,
      });
      return { status: 'written', storyId, synthesisId, latestStatus };
    }

    let response: BundleSynthesisRelayResponse;
    try {
      response = await relay({
        prompt: buildBundlePromptFromStoryBundle(bundle),
        model,
        maxTokens,
        timeoutMs,
        ratePerMinute,
      });
    } catch (error) {
      logger.warn('[vh:bundle-synthesis] relay failed', { story_id: storyId, error });
      return { status: 'rejected', storyId, reason: 'relay_failed' };
    }

    let parsed: ReturnType<typeof parseGeneratedBundleSynthesis>;
    try {
      parsed = parseGeneratedBundleSynthesis(response.content);
    } catch (error) {
      logger.warn('[vh:bundle-synthesis] generated output rejected', { story_id: storyId, error });
      return { status: 'rejected', storyId, reason: 'parse_failed' };
    }

    if (parsed.source_count !== analysisSources.length) {
      logger.warn('[vh:bundle-synthesis] generated output source count mismatch', {
        story_id: storyId,
        expected_source_count: analysisSources.length,
        generated_source_count: parsed.source_count,
      });
      return { status: 'rejected', storyId, reason: 'source_count_mismatch' };
    }

    const warnings = [
      ...(analysisSources.length === 1 ? ['single_source_story_bundle'] : []),
      ...((bundle.related_links?.length ?? 0) > 0 ? ['related_links_excluded_from_analysis'] : []),
    ];
    const createdAt = now();
    const frames = parsed.frames.map((frame) => ({
      frame: frame.frame,
      reframe: frame.reframe,
    }));
    const candidatePayload = buildCandidatePayload({
      candidateId,
      bundle,
      summary: parsed.summary,
      frames,
      warnings,
      model: response.model,
      now: createdAt,
    });
    await writeCandidate(config.client, candidatePayload);
    const { latestStatus } = await writeAcceptedSynthesis({
      config,
      bundle,
      synthesisId,
      candidateId,
      summary: parsed.summary,
      frames,
      warnings,
      createdAt,
      writeSynthesis,
      writeLatest,
    });

    logger.info('[vh:bundle-synthesis] synthesis written', {
      story_id: storyId,
      topic_id: bundle.topic_id,
      candidate_id: candidateId,
      synthesis_id: synthesisId,
      latest_status: latestStatus,
    });

    return {
      status: 'written',
      storyId,
      synthesisId,
      latestStatus,
    };
  };
}
