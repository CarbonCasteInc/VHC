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
  BUNDLE_SYNTHESIS_EPOCH,
  buildCandidatePayload,
  normalizeIdToken,
  writeAcceptedSynthesis,
} from './bundleSynthesisPayloads';
import { generateBundleSynthesisPrompt, parseBundleSynthesisResponse, PromptParseError } from './prompts';

const PROVIDER_ID = 'openai';

export type BundleSynthesisWorkerResult =
  | { status: 'written'; storyId: string; synthesisId: string; latestStatus: 'written' | 'skipped' }
  | { status: 'skipped'; storyId: string; reason: 'story_missing' | 'no_analysis_sources' }
  | { status: 'rejected'; storyId: string; reason: 'relay_failed' | 'parse_failed' | 'source_count_mismatch' | 'source_text_unavailable' };

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
      const { latestStatus } = await writeAcceptedSynthesis({
        client: config.client,
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
      logger.warn('[vh:bundle-synthesis] no source analyses completed; rejected', { story_id: storyId });
      await persistRejectedBundleSynthesisEvalArtifact({
        context: artifactContext,
        capturedAt: now(),
        rejectionReason: 'relay_failed',
        warnings: dedupeWarnings([...extracted.warnings, ...articleAnalysis.warnings]),
      });
      return { status: 'rejected', storyId, reason: 'relay_failed' };
    }

    let response: BundleSynthesisRelayResponse;
    const bundlePrompt = generateBundleSynthesisPrompt(
      toBundleSynthesisInput(bundle, articleAnalysis.analyzedSources),
    );
    try {
      response = await relay({
        prompt: bundlePrompt,
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
        bundlePrompt,
        warnings: dedupeWarnings([...extracted.warnings, ...articleAnalysis.warnings]),
        error,
      });
      return { status: 'rejected', storyId, reason: 'relay_failed' };
    }

    let parsed: ReturnType<typeof parseBundleSynthesisResponse>;
    try {
      parsed = parseBundleSynthesisResponse(response.content, articleAnalysis.analyzedSources.length);
    } catch (error) {
      logger.warn('[vh:bundle-synthesis] generated output rejected', { story_id: storyId, error });
      const reason = error instanceof PromptParseError && error.message.startsWith('source_count:')
        ? 'source_count_mismatch'
        : 'parse_failed';
      await persistRejectedBundleSynthesisEvalArtifact({
        context: artifactContext,
        capturedAt: now(),
        rejectionReason: reason,
        bundlePrompt,
        bundleResponse: response,
        warnings: dedupeWarnings([...extracted.warnings, ...articleAnalysis.warnings]),
        error,
      });
      return { status: 'rejected', storyId, reason };
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
    await writeCandidate(config.client, candidatePayload);
    const { latestStatus, synthesis } = await writeAcceptedSynthesis({
      client: config.client,
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
    await persistAcceptedBundleSynthesisEvalArtifact({
      context: artifactContext,
      capturedAt: createdAt,
      bundlePrompt,
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
