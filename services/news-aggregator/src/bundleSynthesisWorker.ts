import type { NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';
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
  DEFAULT_BUNDLE_SYNTHESIS_TEMPERATURE,
  DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS,
  postBundleSynthesisCompletion,
  type BundleSynthesisRelayResponse,
} from './bundleSynthesisRelay';
import { ArticleTextService } from './articleTextService';
import {
  analyzeReadableBundleSources,
  buildFullTextBundleFingerprint,
  candidateHasReusableFullTextAudit,
  dedupeWarnings,
  extractReadableBundleSources,
  resolveAnalysisSources,
  toBundleSynthesisInput,
  toSourceAnalysisAudit,
} from './bundleSynthesisFullText';
import type { AnalysisEvalArtifactWriter } from './analysisEvalArtifacts';
import { createAnalysisEvalArtifactWriterFromEnv } from './analysisEvalArtifactWriter';
import {
  persistAcceptedBundleSynthesisEvalArtifact,
  persistRejectedBundleSynthesisEvalArtifact,
} from './bundleSynthesisEvalArtifact';
import {
  AcceptedSynthesisWriteError,
  BUNDLE_SYNTHESIS_EPOCH,
  buildCandidatePayload,
  normalizeIdToken,
  writeAcceptedSynthesis,
} from './bundleSynthesisPayloads';
import { generateBundleSynthesisPrompt, parseBundleSynthesisResponse, PromptParseError } from './prompts';

const PROVIDER_ID = 'openai';
const BUNDLE_SYNTHESIS_SCHEMA_RETRY_LIMIT = 1;

export type BundleSynthesisWorkerResult =
  | { status: 'written'; storyId: string; synthesisId: string; latestStatus: 'written' | 'skipped' }
  | { status: 'skipped'; storyId: string; reason: 'story_missing' | 'no_analysis_sources' }
  | {
      status: 'rejected';
      storyId: string;
      reason:
        | 'source_text_unavailable'
        | 'source_analysis_failed'
        | 'relay_failed'
        | 'parse_failed'
        | 'source_count_mismatch'
        | 'candidate_write_failed'
        | 'epoch_write_failed'
        | 'latest_write_failed';
    };

export interface BundleSynthesisWorkerConfig {
  client: VennClient;
  logger?: LoggerLike;
  now?: () => number;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  ratePerMinute?: number;
  temperature?: number;
  pipelineVersion?: string;
  articleTextService?: Pick<ArticleTextService, 'extract'>;
  analysisEvalArtifactWriter?: AnalysisEvalArtifactWriter;
  relay?: (request: {
    prompt: string;
    model: string;
    maxTokens: number;
    timeoutMs: number;
    ratePerMinute: number;
    temperature: number;
  }) => Promise<BundleSynthesisRelayResponse>;
  readBundle?: (client: VennClient, storyId: string) => Promise<StoryBundle | null>;
  readCandidate?: typeof readTopicEpochCandidate;
  writeCandidate?: (client: VennClient, candidate: CandidateSynthesis) => Promise<CandidateSynthesis>;
  writeSynthesis?: (client: VennClient, synthesis: TopicSynthesisV2) => Promise<TopicSynthesisV2>;
  writeLatest?: typeof writeTopicLatestSynthesisIfNotDowngrade;
  publishReadyStory?: (client: VennClient, bundle: StoryBundle, synthesis: TopicSynthesisV2) => Promise<void>;
  runWrite?: <T>(
    writeClass: string,
    attributes: Record<string, unknown>,
    task: () => Promise<T>,
  ) => Promise<T>;
}

function bundleSynthesisParseFailureReason(error: unknown): 'parse_failed' | 'source_count_mismatch' {
  return error instanceof PromptParseError && error.message.startsWith('source_count:')
    ? 'source_count_mismatch'
    : 'parse_failed';
}

function retryBundleSynthesisPrompt(input: {
  readonly originalPrompt: string;
  readonly expectedSourceCount: number;
  readonly reason: 'parse_failed' | 'source_count_mismatch';
  readonly error: unknown;
}): string {
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
  return [
    input.originalPrompt,
    '',
    'Schema retry: the previous bundle synthesis response was rejected by strict validation.',
    `Failure reason: ${input.reason}.`,
    `Expected source_count: ${input.expectedSourceCount}.`,
    `Validation message: ${errorMessage}`,
    'Return only JSON matching the original schema. Keep source_count exactly equal to Expected source_count and include non-empty key_facts, summary, and frame_reframe_table.',
  ].join('\n');
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
  const temperature = typeof config.temperature === 'number' && Number.isFinite(config.temperature)
    ? config.temperature
    : DEFAULT_BUNDLE_SYNTHESIS_TEMPERATURE;
  const pipelineVersion = config.pipelineVersion?.trim() || DEFAULT_BUNDLE_SYNTHESIS_PIPELINE_VERSION;
  const relay = config.relay ?? postBundleSynthesisCompletion;
  const articleTextService = config.articleTextService ?? new ArticleTextService();
  const analysisEvalArtifactWriter = config.analysisEvalArtifactWriter ?? createAnalysisEvalArtifactWriterFromEnv();
  const readBundle = config.readBundle ?? readStoryBundle;
  const readCandidate = config.readCandidate ?? readTopicEpochCandidate;
  const writeCandidate = config.writeCandidate ?? writeTopicEpochCandidate;
  const writeSynthesis = config.writeSynthesis ?? writeTopicEpochSynthesis;
  const writeLatest = config.writeLatest ?? writeTopicLatestSynthesisIfNotDowngrade;
  const publishReadyStory = config.publishReadyStory;
  const runWrite = config.runWrite ?? (<T>(_: string, __: Record<string, unknown>, task: () => Promise<T>) => task());
  const writeCandidateWithLane = (client: VennClient, candidatePayload: CandidateSynthesis) =>
    runWrite(
      'synthesis_candidate',
      {
        topic_id: candidatePayload.topic_id,
        candidate_id: candidatePayload.candidate_id,
      },
      () => writeCandidate(client, candidatePayload),
    );
  const writeSynthesisWithLane = (client: VennClient, synthesis: TopicSynthesisV2) =>
    runWrite(
      'synthesis_epoch',
      {
        topic_id: synthesis.topic_id,
        synthesis_id: synthesis.synthesis_id,
      },
      () => writeSynthesis(client, synthesis),
    );
  const writeLatestWithLane: typeof writeTopicLatestSynthesisIfNotDowngrade = (client, synthesis, options) =>
    {
      const candidateSynthesis = synthesis as Partial<TopicSynthesisV2>;
      return runWrite(
        'synthesis_latest',
        {
          topic_id: candidateSynthesis.topic_id ?? null,
          synthesis_id: candidateSynthesis.synthesis_id ?? null,
        },
        () => writeLatest(client, synthesis, options),
      );
    };

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

    const request = {
      provider_id: PROVIDER_ID,
      model,
      max_tokens: maxTokens,
      timeout_ms: timeoutMs,
      rate_per_minute: ratePerMinute,
      temperature,
      pipeline_version: pipelineVersion,
    };

    const extracted = await extractReadableBundleSources({
      storyId,
      sources: analysisSources,
      articleTextService,
      logger,
    });
    if (extracted.readableSources.length === 0) {
      logger.warn('[vh:bundle-synthesis] no readable analysis sources; rejected', { story_id: storyId });
      await persistRejectedBundleSynthesisEvalArtifact({
        context: {
          writer: analysisEvalArtifactWriter,
          logger,
          bundle,
          analysisSources,
          readableSources: [],
          extractionWarnings: extracted.warnings,
          articleAnalysis: {
            analyzedSources: [],
            failedSources: [],
            warnings: [],
          },
          request,
          candidateId: `news-bundle:unreadable:${normalizeIdToken(bundle.story_id)}:${bundle.provenance_hash.slice(0, 12)}`,
          synthesisId: `news-bundle:${normalizeIdToken(bundle.story_id)}:unreadable-${bundle.provenance_hash.slice(0, 12)}`,
        },
        capturedAt: now(),
        rejectionReason: 'source_text_unavailable',
        warnings: dedupeWarnings(extracted.warnings),
        error: new Error('No readable article text was available for the analysis sources.'),
      });
      return { status: 'rejected', storyId, reason: 'source_text_unavailable' };
    }

    const fingerprint = buildFullTextBundleFingerprint({
      bundle,
      pipelineVersion,
      model,
      readableSources: extracted.readableSources,
    });
    const candidateId = `news-bundle:${fingerprint.slice(0, 32)}`;
    const synthesisId = `news-bundle:${normalizeIdToken(bundle.story_id)}:${fingerprint.slice(0, 16)}`;
    const existingCandidate = await readCandidate(config.client, bundle.topic_id, BUNDLE_SYNTHESIS_EPOCH, candidateId);
    if (existingCandidate && candidateHasReusableFullTextAudit(existingCandidate)) {
      let latestStatus: 'written' | 'skipped';
      let synthesis: TopicSynthesisV2;
      try {
        ({ latestStatus, synthesis } = await writeAcceptedSynthesis({
          client: config.client,
          bundle,
          candidateId,
          synthesisId,
          summary: existingCandidate.facts_summary,
          frames: existingCandidate.frames,
          warnings: existingCandidate.warnings,
          createdAt: existingCandidate.created_at,
          writeSynthesis: writeSynthesisWithLane,
          writeLatest: writeLatestWithLane,
        }));
      } catch (error) {
        const reason = error instanceof AcceptedSynthesisWriteError ? error.stage : 'epoch_write_failed';
        logger.warn('[vh:bundle-synthesis] duplicate candidate synthesis write failed', {
          story_id: storyId,
          candidate_id: candidateId,
          synthesis_id: synthesisId,
          reason,
          error,
        });
        return { status: 'rejected', storyId, reason };
      }
      if (publishReadyStory) {
        try {
          await publishReadyStory(config.client, bundle, synthesis);
        } catch (error) {
          logger.warn('[vh:bundle-synthesis] duplicate candidate product-ready publish failed', {
            story_id: storyId,
            candidate_id: candidateId,
            synthesis_id: synthesisId,
            error,
          });
          return { status: 'rejected', storyId, reason: 'latest_write_failed' };
        }
      }
      logger.info('[vh:bundle-synthesis] duplicate candidate recovered synthesis; skipped model call', {
        story_id: storyId,
        candidate_id: candidateId,
        synthesis_id: synthesisId,
        latest_status: latestStatus,
      });
      return { status: 'written', storyId, synthesisId, latestStatus };
    }
    if (existingCandidate) {
      logger.warn('[vh:bundle-synthesis] existing candidate lacked full-text audit data; regenerating', {
        story_id: storyId,
        candidate_id: candidateId,
      });
    }

    const articleAnalysis = await analyzeReadableBundleSources({
      storyId,
      readableSources: extracted.readableSources,
      relay,
      model,
      maxTokens,
      timeoutMs,
      ratePerMinute,
      temperature,
      logger,
    });
    const artifactContext = {
      writer: analysisEvalArtifactWriter,
      logger,
      bundle,
      analysisSources,
      readableSources: extracted.readableSources,
      extractionWarnings: extracted.warnings,
      articleAnalysis,
      request,
      candidateId,
      synthesisId,
    };
    if (articleAnalysis.analyzedSources.length === 0) {
      const reason = articleAnalysis.failedSources.length > 0 ? 'source_analysis_failed' : 'relay_failed';
      logger.warn('[vh:bundle-synthesis] no source analyses completed; rejected', { story_id: storyId, reason });
      await persistRejectedBundleSynthesisEvalArtifact({
        context: artifactContext,
        capturedAt: now(),
        rejectionReason: reason,
        warnings: dedupeWarnings([...extracted.warnings, ...articleAnalysis.warnings]),
      });
      return { status: 'rejected', storyId, reason };
    }

    const bundlePrompt = generateBundleSynthesisPrompt(
      toBundleSynthesisInput(bundle, articleAnalysis.analyzedSources),
    );
    let parsed: ReturnType<typeof parseBundleSynthesisResponse> | null = null;
    let response: BundleSynthesisRelayResponse | null = null;
    let acceptedBundlePrompt = bundlePrompt;
    let lastParseError: unknown = null;
    for (let attempt = 0; attempt <= BUNDLE_SYNTHESIS_SCHEMA_RETRY_LIMIT; attempt += 1) {
      const prompt = attempt === 0
        ? bundlePrompt
        : retryBundleSynthesisPrompt({
          originalPrompt: bundlePrompt,
          expectedSourceCount: articleAnalysis.analyzedSources.length,
          reason: bundleSynthesisParseFailureReason(lastParseError),
          error: lastParseError,
        });
      try {
        response = await relay({
          prompt,
          model,
          maxTokens,
          timeoutMs,
          ratePerMinute,
          temperature,
        });
      } catch (error) {
        logger.warn('[vh:bundle-synthesis] relay failed', { story_id: storyId, error });
        await persistRejectedBundleSynthesisEvalArtifact({
          context: artifactContext,
          capturedAt: now(),
          rejectionReason: 'relay_failed',
          bundlePrompt: prompt,
          warnings: dedupeWarnings([...extracted.warnings, ...articleAnalysis.warnings]),
          error,
        });
        return { status: 'rejected', storyId, reason: 'relay_failed' };
      }

      try {
        parsed = parseBundleSynthesisResponse(response.content, articleAnalysis.analyzedSources.length);
        acceptedBundlePrompt = prompt;
        break;
      } catch (error) {
        lastParseError = error;
        const reason = bundleSynthesisParseFailureReason(error);
        if (attempt < BUNDLE_SYNTHESIS_SCHEMA_RETRY_LIMIT) {
          logger.warn('[vh:bundle-synthesis] generated output rejected; retrying once', {
            story_id: storyId,
            reason,
            error,
          });
          continue;
        }
        logger.warn('[vh:bundle-synthesis] generated output rejected', { story_id: storyId, reason, error });
        await persistRejectedBundleSynthesisEvalArtifact({
          context: artifactContext,
          capturedAt: now(),
          rejectionReason: reason,
          bundlePrompt: prompt,
          bundleResponse: response ?? undefined,
          warnings: dedupeWarnings([...extracted.warnings, ...articleAnalysis.warnings]),
          error,
        });
        return { status: 'rejected', storyId, reason };
      }
    }
    if (!parsed || !response) {
      return { status: 'rejected', storyId, reason: 'parse_failed' };
    }

    const warnings = dedupeWarnings([
      ...(articleAnalysis.analyzedSources.length === 1 ? ['single_source_story_bundle'] : []),
      ...((bundle.related_links?.length ?? 0) > 0 ? ['related_links_excluded_from_analysis'] : []),
      ...extracted.warnings,
      ...articleAnalysis.warnings,
      ...parsed.warnings.filter((warning) => warning !== 'single-source-only'),
    ]);
    const createdAt = now();
    const frames = parsed.frame_reframe_table.map(({ frame, reframe }) => ({ frame, reframe }));
    const sourceAnalyses = articleAnalysis.analyzedSources.map((analyzed) => (
      toSourceAnalysisAudit(analyzed, PROVIDER_ID)
    ));
    const candidatePayload = buildCandidatePayload({
      candidateId,
      bundle,
      keyFacts: parsed.key_facts,
      summary: parsed.summary,
      frames,
      sourceAnalyses,
      warnings,
      model: response.model,
      now: createdAt,
    });
    try {
      await writeCandidateWithLane(config.client, candidatePayload);
    } catch (error) {
      logger.warn('[vh:bundle-synthesis] candidate write failed', { story_id: storyId, candidate_id: candidateId, error });
      await persistRejectedBundleSynthesisEvalArtifact({
        context: artifactContext,
        capturedAt: createdAt,
        rejectionReason: 'candidate_write_failed',
        bundlePrompt: acceptedBundlePrompt,
        bundleResponse: response,
        warnings,
        error,
      });
      return { status: 'rejected', storyId, reason: 'candidate_write_failed' };
    }
    let latestStatus: 'written' | 'skipped';
    let synthesis: TopicSynthesisV2;
    try {
      ({ latestStatus, synthesis } = await writeAcceptedSynthesis({
        client: config.client,
        bundle,
        synthesisId,
        candidateId,
        summary: parsed.summary,
        frames,
        warnings,
        createdAt,
        writeSynthesis: writeSynthesisWithLane,
        writeLatest: writeLatestWithLane,
      }));
    } catch (error) {
      const reason = error instanceof AcceptedSynthesisWriteError ? error.stage : 'epoch_write_failed';
      logger.warn('[vh:bundle-synthesis] accepted synthesis write failed', {
        story_id: storyId,
        candidate_id: candidateId,
        synthesis_id: synthesisId,
        reason,
        error,
      });
      await persistRejectedBundleSynthesisEvalArtifact({
        context: artifactContext,
        capturedAt: createdAt,
        rejectionReason: reason,
        bundlePrompt: acceptedBundlePrompt,
        bundleResponse: response,
        warnings,
        error,
      });
      return { status: 'rejected', storyId, reason };
    }
    if (publishReadyStory) {
      try {
        await publishReadyStory(config.client, bundle, synthesis);
      } catch (error) {
        logger.warn('[vh:bundle-synthesis] product-ready publish failed', {
          story_id: storyId,
          candidate_id: candidateId,
          synthesis_id: synthesisId,
          error,
        });
        await persistRejectedBundleSynthesisEvalArtifact({
          context: artifactContext,
          capturedAt: createdAt,
          rejectionReason: 'latest_write_failed',
          bundlePrompt: acceptedBundlePrompt,
          bundleResponse: response,
          warnings,
          error,
        });
        return { status: 'rejected', storyId, reason: 'latest_write_failed' };
      }
    }
    await persistAcceptedBundleSynthesisEvalArtifact({
      context: artifactContext,
      capturedAt: createdAt,
      bundlePrompt: acceptedBundlePrompt,
      bundleResponse: response,
      bundleGenerated: parsed,
      candidateSynthesis: candidatePayload,
      finalAcceptedSynthesis: synthesis,
      warnings,
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
