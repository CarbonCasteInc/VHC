import type { CandidateSynthesis, StoryBundle, TopicSynthesisV2 } from '@vh/data-model';
import {
  buildAnalysisEvalArtifact,
  type AnalysisEvalArtifactWriter,
  type AnalysisEvalRequestMetadata,
} from './analysisEvalArtifacts';
import {
  serializeAnalysisEvalError,
  type AnalysisEvalValidatorEvent,
} from './analysisEvalArtifactPrimitives';
import { persistAnalysisEvalArtifact } from './analysisEvalArtifactWriter';
import type { BundleSynthesisRelayResponse } from './bundleSynthesisRelay';
import type {
  AnalyzedBundleSource,
  FailedBundleSourceAnalysis,
  ReadableBundleSource,
} from './bundleSynthesisFullText';
import type { LoggerLike } from './daemonUtils';
import type { BundleSynthesisResult } from './prompts';

export interface BundleSynthesisEvalArtifactContext {
  writer?: AnalysisEvalArtifactWriter;
  logger: LoggerLike;
  bundle: StoryBundle;
  analysisSources: readonly StoryBundle['sources'][number][];
  readableSources: readonly ReadableBundleSource[];
  extractionWarnings: readonly string[];
  articleAnalysis: {
    analyzedSources: readonly AnalyzedBundleSource[];
    failedSources: readonly FailedBundleSourceAnalysis[];
    warnings: readonly string[];
  };
  request: AnalysisEvalRequestMetadata;
  candidateId: string;
  synthesisId: string;
}

function extractionWarningsToEvents(warnings: readonly string[]): AnalysisEvalValidatorEvent[] {
  return warnings.map((warning) => ({
    stage: 'source_extraction',
    status: 'warning',
    code: warning,
    message: warning,
    ...(warning.includes(':') ? { source_id: warning.split(':')[1] } : {}),
  }));
}

function baseValidatorEvents(context: BundleSynthesisEvalArtifactContext): AnalysisEvalValidatorEvent[] {
  return [
    ...extractionWarningsToEvents(context.extractionWarnings),
    ...context.articleAnalysis.analyzedSources.flatMap((source) => source.validatorEvents),
    ...context.articleAnalysis.failedSources.flatMap((source) => source.validatorEvents),
  ];
}

function baseWarnings(context: BundleSynthesisEvalArtifactContext): string[] {
  return [...context.extractionWarnings, ...context.articleAnalysis.warnings];
}

function rejectedBundleStage(input: {
  rejectionReason: string;
  bundleResponse?: BundleSynthesisRelayResponse;
}): AnalysisEvalValidatorEvent['stage'] {
  if (input.rejectionReason === 'source_count_mismatch') {
    return 'bundle_synthesis_source_count';
  }
  return input.bundleResponse ? 'bundle_synthesis_parse' : 'bundle_synthesis_relay';
}

export async function persistRejectedBundleSynthesisEvalArtifact(input: {
  context: BundleSynthesisEvalArtifactContext;
  capturedAt: number;
  rejectionReason: string;
  bundlePrompt?: string;
  bundleResponse?: BundleSynthesisRelayResponse;
  error?: unknown;
  warnings?: readonly string[];
}): Promise<void> {
  const extraEvents: AnalysisEvalValidatorEvent[] = input.error
    ? [{
      stage: rejectedBundleStage(input),
      status: 'rejected',
      code: input.rejectionReason,
      message: serializeAnalysisEvalError(input.error).message,
    }]
    : [];

  await persistAnalysisEvalArtifact({
    writer: input.context.writer,
    logger: input.context.logger,
    artifact: buildAnalysisEvalArtifact({
      bundle: input.context.bundle,
      analysisSources: input.context.analysisSources,
      readableSources: input.context.readableSources,
      analyzedSources: input.context.articleAnalysis.analyzedSources,
      failedAnalysisSources: input.context.articleAnalysis.failedSources,
      request: input.context.request,
      capturedAt: input.capturedAt,
      candidateId: input.context.candidateId,
      synthesisId: input.context.synthesisId,
      lifecycleStatus: 'rejected',
      rejectionReason: input.rejectionReason,
      bundlePrompt: input.bundlePrompt,
      bundleResponse: input.bundleResponse,
      warnings: input.warnings ?? baseWarnings(input.context),
      validatorEvents: [...baseValidatorEvents(input.context), ...extraEvents],
    }),
  });
}

export async function persistAcceptedBundleSynthesisEvalArtifact(input: {
  context: BundleSynthesisEvalArtifactContext;
  capturedAt: number;
  bundlePrompt: string;
  bundleResponse: BundleSynthesisRelayResponse;
  bundleGenerated: BundleSynthesisResult;
  candidateSynthesis: CandidateSynthesis;
  finalAcceptedSynthesis: TopicSynthesisV2;
  warnings: readonly string[];
}): Promise<void> {
  await persistAnalysisEvalArtifact({
    writer: input.context.writer,
    logger: input.context.logger,
    artifact: buildAnalysisEvalArtifact({
      bundle: input.context.bundle,
      analysisSources: input.context.analysisSources,
      readableSources: input.context.readableSources,
      analyzedSources: input.context.articleAnalysis.analyzedSources,
      failedAnalysisSources: input.context.articleAnalysis.failedSources,
      request: input.context.request,
      capturedAt: input.capturedAt,
      candidateId: input.context.candidateId,
      synthesisId: input.context.synthesisId,
      lifecycleStatus: 'accepted',
      bundlePrompt: input.bundlePrompt,
      bundleResponse: input.bundleResponse,
      bundleGenerated: input.bundleGenerated,
      candidateSynthesis: input.candidateSynthesis,
      finalAcceptedSynthesis: input.finalAcceptedSynthesis,
      warnings: input.warnings,
      validatorEvents: [
        ...baseValidatorEvents(input.context),
        {
          stage: 'bundle_synthesis_parse',
          status: 'accepted',
          code: 'bundle_synthesis_schema_valid',
          message: 'Bundle synthesis response parsed against the required schema.',
        },
      ],
    }),
  });
}
