import { createHash } from 'node:crypto';
import type { CandidateSynthesis, SourceAnalysisAudit, StoryBundle } from '@vh/data-model';
import {
  serializeAnalysisEvalError,
  sha256Text,
  type AnalysisEvalValidatorEvent,
} from './analysisEvalArtifactPrimitives';
import type { ArticleTextResult, ArticleTextService } from './articleTextService';
import type { BundleSynthesisRelayResponse } from './bundleSynthesisRelay';
import type { LoggerLike } from './daemonUtils';
import {
  generateArticleAnalysisPrompt,
  parseArticleAnalysisResponse,
  type ArticleAnalysisResult,
  type BundleSynthesisInput,
} from './prompts';

export type BundleSynthesisRelay = (request: {
  prompt: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  ratePerMinute: number;
  temperature: number;
}) => Promise<BundleSynthesisRelayResponse>;

export interface ReadableBundleSource {
  readonly source: StoryBundle['sources'][number];
  readonly article: ArticleTextResult;
}

export interface AnalyzedBundleSource extends ReadableBundleSource {
  readonly analysis: ArticleAnalysisResult;
  readonly analysisPrompt: string;
  readonly analysisPromptHash: string;
  readonly analysisResponse: BundleSynthesisRelayResponse;
  readonly validatorEvents: AnalysisEvalValidatorEvent[];
}

export interface FailedBundleSourceAnalysis extends ReadableBundleSource {
  readonly analysisPrompt: string;
  readonly analysisPromptHash: string;
  readonly analysisResponse?: BundleSynthesisRelayResponse;
  readonly validatorEvents: AnalysisEvalValidatorEvent[];
  readonly error: ReturnType<typeof serializeAnalysisEvalError>;
}

export function resolveAnalysisSources(bundle: StoryBundle): StoryBundle['sources'] {
  return bundle.primary_sources ?? bundle.sources;
}

export function dedupeWarnings(warnings: readonly string[]): string[] {
  return [...new Set(warnings.filter((warning) => warning.trim().length > 0))];
}

export function buildFullTextBundleFingerprint(input: {
  readonly bundle: StoryBundle;
  readonly pipelineVersion: string;
  readonly model: string;
  readonly readableSources: readonly ReadableBundleSource[];
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      pipelineVersion: input.pipelineVersion,
      model_id: input.model,
      story_id: input.bundle.story_id,
      topic_id: input.bundle.topic_id,
      provenance_hash: input.bundle.provenance_hash,
      source_hashes: input.readableSources.map(({ source, article }) => ({
        source_id: source.source_id,
        url_hash: source.url_hash,
        content_hash: article.contentHash,
      })),
    }))
    .digest('hex');
}

export async function extractReadableBundleSources(input: {
  readonly storyId: string;
  readonly sources: readonly StoryBundle['sources'][number][];
  readonly articleTextService: Pick<ArticleTextService, 'extract'>;
  readonly logger: LoggerLike;
}): Promise<{ readableSources: ReadableBundleSource[]; warnings: string[] }> {
  const readableSources: ReadableBundleSource[] = [];
  const warnings: string[] = [];

  for (const source of input.sources) {
    try {
      const article = await input.articleTextService.extract(source.url);
      if (!article.text.trim()) {
        warnings.push(`source_text_empty:${source.source_id}`);
        continue;
      }
      readableSources.push({ source, article });
    } catch (error) {
      warnings.push(`source_text_unavailable:${source.source_id}`);
      input.logger.warn('[vh:bundle-synthesis] source text unavailable', {
        story_id: input.storyId,
        source_id: source.source_id,
        url_hash: source.url_hash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { readableSources, warnings };
}

export async function analyzeReadableBundleSources(input: {
  readonly storyId: string;
  readonly readableSources: readonly ReadableBundleSource[];
  readonly relay: BundleSynthesisRelay;
  readonly model: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly ratePerMinute: number;
  readonly temperature: number;
  readonly logger: LoggerLike;
}): Promise<{
  analyzedSources: AnalyzedBundleSource[];
  failedSources: FailedBundleSourceAnalysis[];
  warnings: string[];
}> {
  const analyzedSources: AnalyzedBundleSource[] = [];
  const failedSources: FailedBundleSourceAnalysis[] = [];
  const warnings: string[] = [];

  for (const readable of input.readableSources) {
    const { source, article } = readable;
    const prompt = generateArticleAnalysisPrompt(article.text, {
      publisher: source.publisher,
      title: source.title,
      url: source.url,
    });
    let response: BundleSynthesisRelayResponse | undefined;
    try {
      response = await input.relay({
        prompt,
        model: input.model,
        maxTokens: input.maxTokens,
        timeoutMs: input.timeoutMs,
        ratePerMinute: input.ratePerMinute,
        temperature: input.temperature,
      });
      const analysis = parseArticleAnalysisResponse(response.content, {
        article_id: `${source.source_id}:${source.url_hash}`,
        source_id: source.source_id,
        url: source.url,
        url_hash: source.url_hash,
        engine: response.model,
      });
      analyzedSources.push({
        ...readable,
        analysis,
        analysisPrompt: prompt,
        analysisPromptHash: sha256Text(prompt),
        analysisResponse: response,
        validatorEvents: [{
          stage: 'article_analysis_parse',
          status: 'accepted',
          code: 'article_analysis_schema_valid',
          message: 'Article analysis response parsed against the required schema.',
          source_id: source.source_id,
        }],
      });
    } catch (error) {
      warnings.push(`source_analysis_failed:${source.source_id}`);
      failedSources.push({
        ...readable,
        analysisPrompt: prompt,
        analysisPromptHash: sha256Text(prompt),
        ...(response ? { analysisResponse: response } : {}),
        error: serializeAnalysisEvalError(error),
        validatorEvents: [{
          stage: response ? 'article_analysis_parse' : 'article_analysis_relay',
          status: 'rejected',
          code: response ? 'article_analysis_schema_rejected' : 'article_analysis_relay_failed',
          message: error instanceof Error ? error.message : String(error),
          source_id: source.source_id,
        }],
      });
      input.logger.warn('[vh:bundle-synthesis] source analysis failed', {
        story_id: input.storyId,
        source_id: source.source_id,
        url_hash: source.url_hash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { analyzedSources, failedSources, warnings };
}

export function toBundleSynthesisInput(
  bundle: StoryBundle,
  analyzedSources: readonly AnalyzedBundleSource[],
): BundleSynthesisInput {
  return {
    storyId: bundle.story_id,
    headline: bundle.headline,
    articleAnalyses: analyzedSources.map(({ source, analysis }) => ({
      publisher: source.publisher,
      title: source.title,
      analysis,
    })),
  };
}

export function toSourceAnalysisAudit(
  analyzed: AnalyzedBundleSource,
  providerId: string,
): SourceAnalysisAudit {
  const { source, analysis } = analyzed;
  return {
    source_id: source.source_id,
    publisher: source.publisher,
    title: source.title,
    url: source.url,
    url_hash: source.url_hash,
    key_facts: analysis.key_facts,
    summary: analysis.summary,
    bias_claim_quote: analysis.bias_claim_quote,
    justify_bias_claim: analysis.justify_bias_claim,
    biases: analysis.biases,
    counterpoints: analysis.counterpoints,
    perspectives: analysis.perspectives,
    confidence: analysis.confidence,
    analyzed_at: analysis.analyzed_at,
    provider: {
      provider_id: providerId,
      model_id: analysis.engine,
      kind: 'remote',
    },
  };
}

export function candidateHasReusableFullTextAudit(candidate: CandidateSynthesis): boolean {
  return (
    candidate.frames.some((row) => row.frame.trim() && row.reframe.trim())
    && (candidate.key_facts?.some((fact) => fact.trim().length > 0) ?? false)
    && ((candidate.source_analyses?.length ?? 0) > 0)
    && (candidate.source_analyses?.every((analysis) => (
      analysis.key_facts.some((fact) => fact.trim().length > 0)
      && analysis.summary.trim().length > 0
      && Array.isArray(analysis.justify_bias_claim)
    )) ?? false)
  );
}
