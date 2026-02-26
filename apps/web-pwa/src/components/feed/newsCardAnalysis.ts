import type { StoryBundle } from '@vh/data-model';
import { createRemoteEngine } from '../../../../../packages/ai-engine/src/engines';
import { createAnalysisPipeline, type PipelineResult } from '../../../../../packages/ai-engine/src/pipeline';
import type { AnalysisResult } from '../../../../../packages/ai-engine/src/schema';
import { getDevModelOverride } from '../dev/DevModelPicker';

const MAX_SOURCE_ANALYSES = 3;
const DEFAULT_RELAY_MAX_SOURCE_ANALYSES = 1;
const MAX_FRAME_ROWS = 12;

type TrinityPipelineStatus = 'start' | 'success' | 'failed' | 'fallback' | 'skipped';

function logTrinityPipeline(
  stage: string,
  status: TrinityPipelineStatus,
  payload: Record<string, unknown>,
): void {
  const entry = {
    stage,
    status,
    ...payload,
  };
  if (status === 'failed' || status === 'fallback') {
    console.warn('[vh:trinity:pipeline]', entry);
    return;
  }
  console.info('[vh:trinity:pipeline]', entry);
}

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
      const startedAt = Date.now();
      const res = await fetch(`/article-text?url=${encodeURIComponent(trimmedUrl)}`);
      if (!res.ok) {
        logTrinityPipeline('article-text-fetch', 'failed', {
          url: trimmedUrl,
          http_status: res.status,
          latency_ms: Math.max(0, Date.now() - startedAt),
        });
        throw new Error(`article-text proxy returned ${res.status}`);
      }
      const payload = readArticleTextResponse(await res.json());
      if (!payload) {
        logTrinityPipeline('article-text-fetch', 'failed', {
          url: trimmedUrl,
          reason: 'invalid-payload',
          http_status: res.status,
          latency_ms: Math.max(0, Date.now() - startedAt),
        });
        throw new Error('Invalid article-text payload');
      }
      logTrinityPipeline('article-text-fetch', 'success', {
        url: trimmedUrl,
        text_chars: payload.text.length,
        http_status: res.status,
        latency_ms: Math.max(0, Date.now() - startedAt),
      });
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

function readEnvVar(name: string): string | undefined {
  try {
    const fromImportMeta = (import.meta as any).env?.[name];
    if (typeof fromImportMeta === 'string') {
      return fromImportMeta;
    }
  } catch {
    // ignore import.meta env access failures
  }

  if (typeof process !== 'undefined') {
    const fromProcess = process?.env?.[name];
    if (typeof fromProcess === 'string') {
      return fromProcess;
    }
  }

  return undefined;
}

function isRelayEnabled(): boolean {
  return readEnvVar('VITE_VH_ANALYSIS_PIPELINE') === 'true';
}

async function readRelayErrorDetail(response: Response): Promise<string | null> {
  try {
    const raw = await response.text();
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { message?: unknown } | unknown;
        message?: unknown;
      };
      const nested = (parsed?.error && typeof parsed.error === 'object')
        ? (parsed.error as { message?: unknown }).message
        : undefined;
      const direct = parsed?.message;
      const fallback = parsed?.error;
      const candidate = nested ?? direct ?? fallback;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    } catch {
      // non-json body
    }
    return trimmed.slice(0, 300);
  } catch {
    return null;
  }
}

async function runAnalysisViaRelay(text: string): Promise<Pick<PipelineResult, 'analysis'>> {
  const devModel = getDevModelOverride();
  const startedAt = Date.now();
  const r = await fetch('/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleText: text, ...(devModel ? { model: devModel } : {}) }),
  });
  if (!r.ok) {
    const detail = await readRelayErrorDetail(r);
    logTrinityPipeline('analysis-relay', 'failed', {
      model: devModel ?? null,
      http_status: r.status,
      reason: detail ?? 'relay-non-ok',
      latency_ms: Math.max(0, Date.now() - startedAt),
    });
    throw new Error(`Analysis relay error: ${r.status}${detail ? ` ${detail}` : ''}`);
  }
  const { analysis } = await r.json();
  logTrinityPipeline('analysis-relay', 'success', {
    model: devModel ?? null,
    provider_id: normalizeOptionalString(analysis?.provider_id) ?? normalizeOptionalString(analysis?.provider?.provider_id),
    model_id: normalizeOptionalString(analysis?.model_id) ?? normalizeOptionalString(analysis?.provider?.model_id),
    http_status: r.status,
    latency_ms: Math.max(0, Date.now() - startedAt),
  });
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

function parseMaxSourceAnalyses(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(parsed, MAX_SOURCE_ANALYSES);
}

function getRuntimeMaxSourceAnalyses(): number {
  if (!isRelayEnabled()) {
    return MAX_SOURCE_ANALYSES;
  }

  const override = parseMaxSourceAnalyses(readEnvVar('VITE_VH_ANALYSIS_MAX_SOURCE_ANALYSES'));
  return override ?? DEFAULT_RELAY_MAX_SOURCE_ANALYSES;
}

function selectSourcesForAnalysis(
  story: StoryBundle,
  maxSourceAnalyses: number = MAX_SOURCE_ANALYSES,
): StoryBundle['sources'] {
  const deduped = new Map<string, StoryBundle['sources'][number]>();
  for (const s of story.sources) {
    const k = `${s.source_id}|${s.url_hash}`;
    if (!deduped.has(k)) deduped.set(k, s);
  }
  return Array.from(deduped.values()).slice(0, Math.max(1, maxSourceAnalyses));
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
  maxSourceAnalyses: number,
): Promise<NewsCardAnalysisSynthesis> {
  const selectedSources = selectSourcesForAnalysis(story, maxSourceAnalyses);
  const analyzed: NewsCardSourceAnalysis[] = [];

  for (const source of selectedSources) {
    const sourceStartedAt = Date.now();
    logTrinityPipeline('story-source-analysis', 'start', {
      story_id: story.story_id,
      topic_id: story.topic_id,
      source_id: source.source_id,
      source_url: source.url,
    });

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
        logTrinityPipeline('story-source-analysis', 'fallback', {
          story_id: story.story_id,
          topic_id: story.topic_id,
          source_id: source.source_id,
          source_url: source.url,
          reason: error instanceof Error ? error.message : String(error),
          fallback: 'metadata-only',
          latency_ms: Math.max(0, Date.now() - sourceStartedAt),
        });
      }

      const input = buildAnalysisInput(story, source, articleText);
      const result = await runAnalysis(input);
      analyzed.push(toSourceAnalysis(source, result.analysis));
      logTrinityPipeline('story-source-analysis', 'success', {
        story_id: story.story_id,
        topic_id: story.topic_id,
        source_id: source.source_id,
        source_url: source.url,
        used_article_text: articleText !== null,
        bias_rows: result.analysis.biases.length,
        counterpoint_rows: result.analysis.counterpoints.length,
        latency_ms: Math.max(0, Date.now() - sourceStartedAt),
      });
    } catch (error) {
      console.warn('[vh:news-card-analysis] source analysis failed', {
        sourceId: source.source_id,
        url: source.url,
        error,
      });
      logTrinityPipeline('story-source-analysis', 'failed', {
        story_id: story.story_id,
        topic_id: story.topic_id,
        source_id: source.source_id,
        source_url: source.url,
        reason: error instanceof Error ? error.message : String(error),
        latency_ms: Math.max(0, Date.now() - sourceStartedAt),
      });
    }
  }

  if (analyzed.length === 0) {
    logTrinityPipeline('story-synthesis', 'failed', {
      story_id: story.story_id,
      topic_id: story.topic_id,
      selected_sources: selectedSources.length,
      reason: 'all-sources-failed',
    });
    throw new Error('Analysis pipeline unavailable for all story sources');
  }

  const frameRows = toFrameRows(analyzed);
  logTrinityPipeline('story-synthesis', 'success', {
    story_id: story.story_id,
    topic_id: story.topic_id,
    selected_sources: selectedSources.length,
    analyzed_sources: analyzed.length,
    frame_rows: frameRows.length,
  });

  return {
    summary: synthesizeSummary(analyzed),
    frames: frameRows,
    analyses: analyzed,
  };
}

export async function synthesizeStoryFromAnalysisPipeline(
  story: StoryBundle,
  options?: NewsCardAnalysisOptions,
): Promise<NewsCardAnalysisSynthesis> {
  const fetchArticleText = getArticleTextFetcher(options);

  if (options?.runAnalysis) {
    return runSynthesis(story, options.runAnalysis, fetchArticleText, MAX_SOURCE_ANALYSES);
  }

  const maxSourceAnalyses = getRuntimeMaxSourceAnalyses();
  const cacheKey = toStoryCacheKey(story);
  const resolved = resolvedSynthesisCache.get(cacheKey);
  if (resolved) {
    return resolved;
  }

  let pending = synthesisCache.get(cacheKey);
  if (!pending) {
    pending = runSynthesis(story, getRunAnalysis(), fetchArticleText, maxSourceAnalyses);
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
  getRuntimeMaxSourceAnalyses,
  runAnalysisViaRelay,
  selectSourcesForAnalysis,
  synthesizeSummary,
  toFrameRows,
  toSourceAnalysis,
  toStoryCacheKey,
};
