import type { StoryBundle } from '@vh/data-model';
import { createRemoteEngine } from '../../../../../packages/ai-engine/src/engines';
import { createAnalysisPipeline, type PipelineResult } from '../../../../../packages/ai-engine/src/pipeline';
import type { AnalysisResult } from '../../../../../packages/ai-engine/src/schema';
import { getDevModelOverride } from '../dev/DevModelPicker';

const MAX_SOURCE_ANALYSES = 3;
const MAX_FRAME_ROWS = 12;

export interface NewsCardSourceAnalysis {
  readonly source_id: string;
  readonly publisher: string;
  readonly url: string;
  readonly summary: string;
  readonly biases: ReadonlyArray<string>;
  readonly counterpoints: ReadonlyArray<string>;
  readonly biasClaimQuotes: ReadonlyArray<string>;
  readonly justifyBiasClaims: ReadonlyArray<string>;
  readonly provider_id?: string;
  readonly model_id?: string;
}

export interface NewsCardAnalysisSynthesis {
  readonly summary: string;
  readonly frames: ReadonlyArray<{ frame: string; reframe: string }>;
  readonly analyses: ReadonlyArray<NewsCardSourceAnalysis>;
}

interface NewsCardAnalysisOptions {
  readonly runAnalysis?: (articleText: string) => Promise<Pick<PipelineResult, 'analysis'>>;
  readonly fetchArticleText?: (url: string) => Promise<string>;
}

let cachedRunAnalysis:
  | ((articleText: string) => Promise<Pick<PipelineResult, 'analysis'>>)
  | null = null;

const synthesisCache = new Map<string, Promise<NewsCardAnalysisSynthesis>>();
const resolvedSynthesisCache = new Map<string, NewsCardAnalysisSynthesis>();
const articleTextCache = new Map<string, Promise<string>>();

function getAnalysisModelScopeKey(): string {
  const model = getDevModelOverride();
  return model ? `model:${model}` : 'model:default';
}

function toStoryCacheKey(story: StoryBundle): string {
  return `${story.story_id}:${story.provenance_hash}:${getAnalysisModelScopeKey()}`;
}

function readArticleTextResponse(
  value: unknown,
): { url: string; text: string } | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as { url?: unknown; text?: unknown };
  if (typeof c.url !== 'string' || typeof c.text !== 'string') return null;
  const text = c.text.trim();
  return text.length > 0 ? { url: c.url, text } : null;
}

async function fetchArticleTextViaProxy(url: string): Promise<string> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) throw new Error('Article URL is required');
  let pending = articleTextCache.get(trimmedUrl);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`/article-text?url=${encodeURIComponent(trimmedUrl)}`);
      if (!res.ok) throw new Error(`article-text proxy returned ${res.status}`);
      const payload = readArticleTextResponse(await res.json());
      if (!payload) throw new Error('Invalid article-text payload');
      return payload.text;
    })();
    articleTextCache.set(trimmedUrl, pending);
  }
  try { return await pending; } catch (e) { articleTextCache.delete(trimmedUrl); throw e; }
}

function getArticleTextFetcher(
  overrides?: NewsCardAnalysisOptions,
): (url: string) => Promise<string> {
  return overrides?.fetchArticleText ?? fetchArticleTextViaProxy;
}

function isRelayEnabled(): boolean {
  try { return (import.meta as any).env?.VITE_VH_ANALYSIS_PIPELINE === 'true'; } catch { return false; }
}

async function runAnalysisViaRelay(text: string): Promise<Pick<PipelineResult, 'analysis'>> {
  const devModel = getDevModelOverride();
  const r = await fetch('/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleText: text, ...(devModel ? { model: devModel } : {}) }),
  });
  if (!r.ok) throw new Error(`Analysis relay error: ${r.status}`);
  const { analysis } = await r.json();
  return { analysis };
}

function getRunAnalysis(): (articleText: string) => Promise<Pick<PipelineResult, 'analysis'>> {
  if (isRelayEnabled()) return runAnalysisViaRelay;
  if (!cachedRunAnalysis) {
    const remote = createRemoteEngine();
    const pipeline = remote
      ? createAnalysisPipeline({ policy: 'local-first', remoteEngine: remote })
      : createAnalysisPipeline();
    cachedRunAnalysis = async (text: string) => pipeline(text);
  }
  return cachedRunAnalysis;
}

function firstSentence(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }

  const match = normalized.match(/^[\s\S]*?[.!?](?:\s|$)/);
  return (match?.[0] ?? normalized).trim();
}

function selectSourcesForAnalysis(story: StoryBundle): StoryBundle['sources'] {
  const deduped = new Map<string, StoryBundle['sources'][number]>();
  for (const s of story.sources) {
    const k = `${s.source_id}|${s.url_hash}`;
    if (!deduped.has(k)) deduped.set(k, s);
  }
  return Array.from(deduped.values()).slice(0, MAX_SOURCE_ANALYSES);
}

function buildAnalysisInput(
  story: StoryBundle,
  source: StoryBundle['sources'][number],
  articleText: string | null,
): string {
  const context = [
    `Publisher: ${source.publisher}`,
    `Article title: ${source.title}`,
    `Article URL: ${source.url}`,
    `Story headline: ${story.headline}`,
    `Topic ID: ${story.topic_id}`,
    `Cluster time bucket: ${story.cluster_features.time_bucket}`,
    `Entity keys: ${story.cluster_features.entity_keys.join(', ')}`,
  ];

  if (story.summary_hint?.trim()) {
    context.push(`Bundle summary hint: ${story.summary_hint.trim()}`);
  }

  if (articleText && articleText.trim()) {
    return [
      context.join('\n'),
      '',
      'ARTICLE BODY:',
      articleText.trim(),
    ].join('\n');
  }

  return [
    context.join('\n'),
    '',
    'ARTICLE BODY: unavailable; analyze available metadata only.',
  ].join('\n');
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const n = value.trim();
  return n.length > 0 ? n : undefined;
}

function toSourceAnalysis(
  source: StoryBundle['sources'][number],
  analysis: AnalysisResult,
): NewsCardSourceAnalysis {
  return {
    source_id: source.source_id,
    publisher: source.publisher,
    url: source.url,
    summary: analysis.summary.trim(),
    biases: analysis.biases,
    counterpoints: analysis.counterpoints,
    biasClaimQuotes: analysis.bias_claim_quote,
    justifyBiasClaims: analysis.justify_bias_claim,
    provider_id:
      normalizeOptionalString(analysis.provider_id) ??
      normalizeOptionalString(analysis.provider?.provider_id),
    model_id:
      normalizeOptionalString(analysis.model_id) ??
      normalizeOptionalString(analysis.provider?.model_id),
  };
}

function toFrameRows(
  analyses: ReadonlyArray<NewsCardSourceAnalysis>,
): ReadonlyArray<{ frame: string; reframe: string }> {
  const rows: Array<{ frame: string; reframe: string }> = [];
  for (const sa of analyses) {
    const count = Math.max(sa.biases.length, sa.counterpoints.length);
    for (let i = 0; i < count; i++) {
      const bias = sa.biases[i]?.trim() || 'No clear bias detected';
      const cp = sa.counterpoints[i]?.trim() || 'N/A';
      rows.push({ frame: `${sa.publisher}: ${bias}`, reframe: cp });
    }
  }
  return rows.slice(0, MAX_FRAME_ROWS);
}

function synthesizeSummary(analyses: ReadonlyArray<NewsCardSourceAnalysis>): string {
  const hl = analyses
    .map((sa) => {
      const s = firstSentence(sa.summary);
      return s ? `${sa.publisher}: ${s}` : `${sa.publisher}: Summary unavailable.`;
    })
    .filter((l) => l.trim().length > 0);
  return hl.length === 0 ? 'Summary pending synthesis.' : hl.join(' ');
}

async function runSynthesis(
  story: StoryBundle,
  runAnalysis: (articleText: string) => Promise<Pick<PipelineResult, 'analysis'>>,
  fetchArticleText: (url: string) => Promise<string>,
): Promise<NewsCardAnalysisSynthesis> {
  const selectedSources = selectSourcesForAnalysis(story);
  const analyzed: NewsCardSourceAnalysis[] = [];

  for (const source of selectedSources) {
    try {
      let articleText: string | null = null;
      try {
        articleText = await fetchArticleText(source.url);
      } catch (error) {
        console.warn('[vh:news-card-analysis] article fetch failed; using metadata fallback', {
          sourceId: source.source_id,
          url: source.url,
          error,
        });
      }

      const input = buildAnalysisInput(story, source, articleText);
      const result = await runAnalysis(input);
      analyzed.push(toSourceAnalysis(source, result.analysis));
    } catch (error) {
      console.warn('[vh:news-card-analysis] source analysis failed', {
        sourceId: source.source_id,
        url: source.url,
        error,
      });
    }
  }

  if (analyzed.length === 0) {
    throw new Error('Analysis pipeline unavailable for all story sources');
  }

  return {
    summary: synthesizeSummary(analyzed),
    frames: toFrameRows(analyzed),
    analyses: analyzed,
  };
}

export async function synthesizeStoryFromAnalysisPipeline(
  story: StoryBundle,
  options?: NewsCardAnalysisOptions,
): Promise<NewsCardAnalysisSynthesis> {
  const fetchArticleText = getArticleTextFetcher(options);

  if (options?.runAnalysis) {
    return runSynthesis(story, options.runAnalysis, fetchArticleText);
  }

  const cacheKey = toStoryCacheKey(story);
  const resolved = resolvedSynthesisCache.get(cacheKey);
  if (resolved) {
    return resolved;
  }

  let pending = synthesisCache.get(cacheKey);
  if (!pending) {
    pending = runSynthesis(story, getRunAnalysis(), fetchArticleText);
    synthesisCache.set(cacheKey, pending);
  }

  try {
    const result = await pending;
    resolvedSynthesisCache.set(cacheKey, result);
    return result;
  } catch (error) {
    synthesisCache.delete(cacheKey);
    resolvedSynthesisCache.delete(cacheKey);
    throw error;
  }
}

export function getCachedSynthesisForStory(
  story: StoryBundle,
): NewsCardAnalysisSynthesis | null {
  return resolvedSynthesisCache.get(toStoryCacheKey(story)) ?? null;
}

export function __resetNewsCardAnalysisCacheForTests(): void {
  synthesisCache.clear();
  resolvedSynthesisCache.clear();
  articleTextCache.clear();
  cachedRunAnalysis = null;
}

export const newsCardAnalysisInternal = {
  buildAnalysisInput,
  firstSentence,
  getAnalysisModelScopeKey,
  runAnalysisViaRelay,
  selectSourcesForAnalysis,
  synthesizeSummary,
  toFrameRows,
  toSourceAnalysis,
  toStoryCacheKey,
};
