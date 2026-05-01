import type { CandidateSynthesis, StoryBundle, TopicSynthesisV2 } from '@vh/data-model';
import {
  sha256Text,
  type AnalysisEvalSerializedError,
  type AnalysisEvalValidatorEvent,
} from './analysisEvalArtifactPrimitives';
import type { BundleSynthesisRelayResponse } from './bundleSynthesisRelay';
import type {
  AnalyzedBundleSource,
  FailedBundleSourceAnalysis,
  ReadableBundleSource,
} from './bundleSynthesisFullText';
import { ARTICLE_TEXT_EXTRACTION_VERSION } from './articleTextExtractionVersion';
import type { BundleSynthesisResult } from './prompts';

export const ANALYSIS_EVAL_ARTIFACT_SCHEMA_VERSION = 'analysis-eval-artifact-v1';
export type { AnalysisEvalSerializedError, AnalysisEvalValidatorEvent };

export interface AnalysisEvalRequestMetadata {
  provider_id: string;
  model: string;
  max_tokens: number;
  timeout_ms: number;
  rate_per_minute: number;
  temperature: number;
  pipeline_version: string;
}

export interface AnalysisEvalArtifact {
  schema_version: typeof ANALYSIS_EVAL_ARTIFACT_SCHEMA_VERSION;
  artifact_id: string;
  captured_at: number;
  lifecycle_status: 'accepted' | 'rejected';
  rejection_reason?: string;
  usage_policy: {
    label_status: 'weak_label_unreviewed';
    training_state: 'not_training_ready';
    raw_article_text_training_use: 'requires_rights_review';
    generated_output_training_use: 'weak_label_only_until_reviewed';
  };
  request: AnalysisEvalRequestMetadata;
  story: {
    story_id: string;
    topic_id: string;
    headline: string;
    provenance_hash: string;
    cluster_window_start: number;
    cluster_window_end: number;
    story_kind: 'singleton' | 'bundle';
    analysis_kind: 'singleton' | 'bundle';
    sources: StoryBundle['sources'];
    primary_sources?: StoryBundle['primary_sources'];
    related_links?: StoryBundle['related_links'];
    analysis_source_ids: string[];
    readable_source_ids: string[];
    analyzed_source_ids: string[];
    failed_analysis_source_ids: string[];
  };
  source_articles: Array<{
    source: StoryBundle['sources'][number];
    extraction: {
      url: string;
      url_hash: string;
      content_hash: string;
      source_domain: string;
      title: string;
      extraction_method: string;
      extraction_version: string;
      cache_hit: string;
      attempts: number;
      fetched_at: number;
      quality: ReadableBundleSource['article']['quality'];
      raw_extracted_article_text: string;
    };
    article_analysis: {
      request: {
        prompt: string;
        prompt_hash: string;
      };
      response?: {
        model: string;
        content: string;
        content_hash: string;
      };
      generated?: AnalyzedBundleSource['analysis'];
      validator_events: AnalysisEvalValidatorEvent[];
      error?: AnalysisEvalSerializedError;
    };
  }>;
  bundle_synthesis: {
    request?: {
      prompt: string;
      prompt_hash: string;
    };
    response?: {
      model: string;
      content: string;
      content_hash: string;
    };
    generated?: BundleSynthesisResult;
  };
  generated: {
    facts: string[];
    summary: string;
    frame_reframe_table: CandidateSynthesis['frames'];
  };
  validator_events: AnalysisEvalValidatorEvent[];
  validator_failures: AnalysisEvalValidatorEvent[];
  retry_count: number;
  warnings: string[];
  candidate_synthesis?: CandidateSynthesis;
  final_accepted_synthesis?: TopicSynthesisV2;
  human_review: {
    status: 'unreviewed';
    human_edits: unknown[];
    human_approvals: unknown[];
    human_rejections: unknown[];
    user_facing_corrections: unknown[];
  };
}

export interface AnalysisEvalArtifactWriter {
  write(artifact: AnalysisEvalArtifact): Promise<void>;
}

function responseRecord(response: BundleSynthesisRelayResponse): {
  model: string;
  content: string;
  content_hash: string;
} {
  return {
    model: response.model,
    content: response.content,
    content_hash: sha256Text(response.content),
  };
}

function articleRecord(input: {
  readable: ReadableBundleSource;
  analyzed?: AnalyzedBundleSource;
  failed?: FailedBundleSourceAnalysis;
}): AnalysisEvalArtifact['source_articles'][number] {
  const attempt = input.analyzed ?? input.failed;
  return {
    source: input.readable.source,
    extraction: {
      url: input.readable.article.url,
      url_hash: input.readable.article.urlHash,
      content_hash: input.readable.article.contentHash,
      source_domain: input.readable.article.sourceDomain,
      title: input.readable.article.title,
      extraction_method: input.readable.article.extractionMethod,
      extraction_version: ARTICLE_TEXT_EXTRACTION_VERSION,
      cache_hit: input.readable.article.cacheHit,
      attempts: input.readable.article.attempts,
      fetched_at: input.readable.article.fetchedAt,
      quality: input.readable.article.quality,
      raw_extracted_article_text: input.readable.article.text,
    },
    article_analysis: {
      request: {
        prompt: attempt?.analysisPrompt ?? '',
        prompt_hash: attempt?.analysisPromptHash ?? '',
      },
      ...(attempt?.analysisResponse ? { response: responseRecord(attempt.analysisResponse) } : {}),
      ...(input.analyzed ? { generated: input.analyzed.analysis } : {}),
      validator_events: attempt?.validatorEvents ?? [],
      ...(input.failed ? { error: input.failed.error } : {}),
    },
  };
}

function indexBySourceId<T extends { source: StoryBundle['sources'][number] }>(
  entries: readonly T[],
): Map<string, T> {
  return new Map(entries.map((entry) => [entry.source.source_id, entry]));
}

export function buildAnalysisEvalArtifact(input: {
  bundle: StoryBundle;
  analysisSources: readonly StoryBundle['sources'][number][];
  readableSources: readonly ReadableBundleSource[];
  analyzedSources: readonly AnalyzedBundleSource[];
  failedAnalysisSources: readonly FailedBundleSourceAnalysis[];
  request: AnalysisEvalRequestMetadata;
  capturedAt: number;
  candidateId: string;
  synthesisId: string;
  lifecycleStatus: 'accepted' | 'rejected';
  rejectionReason?: string;
  bundlePrompt?: string;
  bundleResponse?: BundleSynthesisRelayResponse;
  bundleGenerated?: BundleSynthesisResult;
  candidateSynthesis?: CandidateSynthesis;
  finalAcceptedSynthesis?: TopicSynthesisV2;
  warnings: readonly string[];
  validatorEvents: readonly AnalysisEvalValidatorEvent[];
}): AnalysisEvalArtifact {
  const analyzedBySource = indexBySourceId(input.analyzedSources);
  const failedBySource = indexBySourceId(input.failedAnalysisSources);
  const generatedFrames = input.bundleGenerated?.frame_reframe_table.map(({ frame, reframe }) => ({ frame, reframe }))
    ?? input.candidateSynthesis?.frames
    ?? [];
  const validatorEvents = [...input.validatorEvents];
  const artifactId = `analysis-eval:${sha256Text(JSON.stringify({
    story_id: input.bundle.story_id,
    candidate_id: input.candidateId,
    synthesis_id: input.synthesisId,
    captured_at: input.capturedAt,
    status: input.lifecycleStatus,
  })).slice(0, 32)}`;

  return {
    schema_version: ANALYSIS_EVAL_ARTIFACT_SCHEMA_VERSION,
    artifact_id: artifactId,
    captured_at: input.capturedAt,
    lifecycle_status: input.lifecycleStatus,
    ...(input.rejectionReason ? { rejection_reason: input.rejectionReason } : {}),
    usage_policy: {
      label_status: 'weak_label_unreviewed',
      training_state: 'not_training_ready',
      raw_article_text_training_use: 'requires_rights_review',
      generated_output_training_use: 'weak_label_only_until_reviewed',
    },
    request: input.request,
    story: {
      story_id: input.bundle.story_id,
      topic_id: input.bundle.topic_id,
      headline: input.bundle.headline,
      provenance_hash: input.bundle.provenance_hash,
      cluster_window_start: input.bundle.cluster_window_start,
      cluster_window_end: input.bundle.cluster_window_end,
      story_kind: input.bundle.sources.length > 1 ? 'bundle' : 'singleton',
      analysis_kind: input.analysisSources.length > 1 ? 'bundle' : 'singleton',
      sources: input.bundle.sources,
      ...(input.bundle.primary_sources ? { primary_sources: input.bundle.primary_sources } : {}),
      ...(input.bundle.related_links ? { related_links: input.bundle.related_links } : {}),
      analysis_source_ids: input.analysisSources.map((source) => source.source_id),
      readable_source_ids: input.readableSources.map(({ source }) => source.source_id),
      analyzed_source_ids: input.analyzedSources.map(({ source }) => source.source_id),
      failed_analysis_source_ids: input.failedAnalysisSources.map(({ source }) => source.source_id),
    },
    source_articles: input.readableSources.map((readable) => articleRecord({
      readable,
      analyzed: analyzedBySource.get(readable.source.source_id),
      failed: failedBySource.get(readable.source.source_id),
    })),
    bundle_synthesis: {
      ...(input.bundlePrompt ? {
        request: {
          prompt: input.bundlePrompt,
          prompt_hash: sha256Text(input.bundlePrompt),
        },
      } : {}),
      ...(input.bundleResponse ? { response: responseRecord(input.bundleResponse) } : {}),
      ...(input.bundleGenerated ? { generated: input.bundleGenerated } : {}),
    },
    generated: {
      facts: input.bundleGenerated?.key_facts ?? input.candidateSynthesis?.key_facts ?? [],
      summary: input.bundleGenerated?.summary ?? input.candidateSynthesis?.facts_summary ?? '',
      frame_reframe_table: generatedFrames,
    },
    validator_events: validatorEvents,
    validator_failures: validatorEvents.filter((event) => event.status === 'rejected'),
    retry_count: 0,
    warnings: [...input.warnings],
    ...(input.candidateSynthesis ? { candidate_synthesis: input.candidateSynthesis } : {}),
    ...(input.finalAcceptedSynthesis ? { final_accepted_synthesis: input.finalAcceptedSynthesis } : {}),
    human_review: {
      status: 'unreviewed',
      human_edits: [],
      human_approvals: [],
      human_rejections: [],
      user_facing_corrections: [],
    },
  };
}
