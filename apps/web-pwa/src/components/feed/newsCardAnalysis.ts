import type { StoryBundle } from '@vh/data-model';
import { createRemoteEngine } from '../../../../../packages/ai-engine/src/engines';
import { createAnalysisPipeline, type PipelineResult } from '../../../../../packages/ai-engine/src/pipeline';
import type { AnalysisResult } from '../../../../../packages/ai-engine/src/schema';
import { getDevModelOverride } from '../dev/DevModelPicker';

const MAX_SOURCE_ANALYSES = 3;
const DEFAULT_RELAY_MAX_SOURCE_ANALYSES = 1;
const MAX_FRAME_ROWS = 12;
const ARTICLE_TEXT_TIMEOUT_MS = 12_000;

export interface NewsCardSourceAnalysis {
  readonly source_id: string;
  readonly publisher: string;
  readonly url: string;
  readonly summary: string;
  readonly biases: ReadonlyArray<string>;
  readonly counterpoints: ReadonlyArray<string>;
  readonly biasClaimQuotes: ReadonlyArray<string>;
  readonly justifyBiasClaims: ReadonlyArray<string>;
  readonly perspectives?: ReadonlyArray<{ frame: string; reframe: string }>;
  readonly provider_id?: string;
  readonly model_id?: string;
}

export interface NewsCardRelatedLink {
  readonly source_id: string;
  readonly publisher: string;
  readonly url: string;
  readonly url_hash: string;
  readonly title: string;
}

export interface NewsCardAnalysisSynthesis {
  readonly summary: string;
  readonly frames: ReadonlyArray<{ frame: string; reframe: string }>;
  readonly analyses: ReadonlyArray<NewsCardSourceAnalysis>;
  readonly relatedLinks: ReadonlyArray<NewsCardRelatedLink>;
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
      const controller = new AbortController();
      const timeoutId = globalThis.setTimeout(() => {
        controller.abort();
      }, ARTICLE_TEXT_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`/article-text?url=${encodeURIComponent(trimmedUrl)}`, { signal: controller.signal });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error(`article-text timeout after ${ARTICLE_TEXT_TIMEOUT_MS}ms`);
        }
        throw error;
      } finally {
        globalThis.clearTimeout(timeoutId);
      }
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

function shouldSkipArticleTextFetch(): boolean {
  return readEnvVar('VITE_VH_ANALYSIS_SKIP_ARTICLE_TEXT') === 'true';
}

async function runAnalysisViaRelay(text: string): Promise<Pick<PipelineResult, 'analysis'>> {
  const devModel = getDevModelOverride();
  const r = await fetch('/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articleText: text, ...(devModel ? { model: devModel } : {}) }),
  });
  if (!r.ok) {
    let detail = '';
    try {
      const payload = await r.json() as { error?: unknown };
      const message = typeof payload?.error === 'string'
        ? payload.error
        : (payload?.error && typeof payload.error === 'object' && 'message' in payload.error && typeof (payload.error as any).message === 'string')
          ? (payload.error as any).message
          : '';
      if (message.trim().length > 0) {
        detail = ` ${message.trim()}`;
      }
    } catch {
      // ignore parse failures and keep status-only message
    }
    throw new Error(`Analysis relay error: ${r.status}${detail}`);
  }
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureSummarySentence(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  const ended = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

function stripSourceAttributionLead(sentence: string, publisher: string): string {
  const normalized = sentence.replace(/\s+/g, ' ').trim();
  const normalizedPublisher = publisher.trim();
  if (!normalized || !normalizedPublisher) {
    return normalized;
  }

  const publisherPattern = escapeRegExp(normalizedPublisher);
  const withoutLabel = normalized.replace(new RegExp(`^${publisherPattern}\\s*:\\s*`, 'i'), '');
  const withoutReportVerb = withoutLabel.replace(
    new RegExp(
      `^${publisherPattern}\\s+(?:says?|said|reports?|reported|writes(?:\\s+that)?|notes?|noted|focuses\\s+on|emphasizes?|describes?)\\s+`,
      'i',
    ),
    '',
  );
  return withoutReportVerb.trim();
}

export function sanitizePublicationNeutralSummary(
  summary: string,
  sourceLabels: ReadonlyArray<string> = [],
): string {
  let sanitized = summary;

  for (const label of sourceLabels) {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) {
      continue;
    }
    sanitized = sanitized.replace(
      new RegExp(`(^|[.!?]\\s+)${escapeRegExp(normalizedLabel)}\\s*:\\s+`, 'gi'),
      '$1',
    );
  }

  return sanitized.replace(/\s+/g, ' ').trim();
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
  articleText: string,
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

  return [
    context.join('\n'),
    '',
    'ARTICLE BODY:',
    articleText.trim(),
  ].join('\n');
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const n = value.trim();
  return n.length > 0 ? n : undefined;
}

function normalizePerspectiveRows(
  rows: ReadonlyArray<{ frame: string; reframe: string }> | undefined,
): ReadonlyArray<{ frame: string; reframe: string }> {
  if (!rows) return [];
  const normalized: Array<{ frame: string; reframe: string }> = [];
  for (const row of rows) {
    const frame = row.frame.trim();
    const reframe = row.reframe.trim();
    if (!frame || !reframe) continue;
    if (/^(?:n\/a|no clear bias detected)$/i.test(frame)) continue;
    if (/^(?:n\/a|no clear bias detected)$/i.test(reframe)) continue;
    normalized.push({ frame, reframe });
  }
  return normalized;
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
    perspectives: normalizePerspectiveRows(analysis.perspectives),
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
    const perspectiveRows = normalizePerspectiveRows(sa.perspectives);
    if (perspectiveRows.length > 0) {
      rows.push(...perspectiveRows);
      continue;
    }

    const count = Math.max(sa.biases.length, sa.counterpoints.length);
    for (let i = 0; i < count; i++) {
      const bias = sa.biases[i]?.trim() || 'No clear bias detected';
      const cp = sa.counterpoints[i]?.trim() || 'N/A';
      rows.push({ frame: `${sa.publisher}: ${bias}`, reframe: cp });
    }
  }
  return rows.slice(0, MAX_FRAME_ROWS);
}

function toRelatedLink(
  source: StoryBundle['sources'][number],
): NewsCardRelatedLink {
  return {
    source_id: source.source_id,
    publisher: source.publisher,
    url: source.url,
    url_hash: source.url_hash,
    title: source.title,
  };
}

function synthesizeSummary(analyses: ReadonlyArray<NewsCardSourceAnalysis>): string {
  const seen = new Set<string>();
  const sentences: string[] = [];

  for (const analysis of analyses) {
    const first = firstSentence(analysis.summary);
    const neutral = sanitizePublicationNeutralSummary(
      stripSourceAttributionLead(first, analysis.publisher),
      [analysis.publisher, analysis.source_id],
    );
    const synthesized = ensureSummarySentence(neutral);
    const key = synthesized.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!synthesized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    sentences.push(synthesized);
    if (sentences.length >= 4) {
      break;
    }
  }

  return sentences.length === 0 ? 'Summary pending synthesis.' : sentences.join(' ');
}

async function runSynthesis(
  story: StoryBundle,
  runAnalysis: (articleText: string) => Promise<Pick<PipelineResult, 'analysis'>>,
  fetchArticleText: (url: string) => Promise<string>,
  maxSourceAnalyses: number,
): Promise<NewsCardAnalysisSynthesis> {
  const selectedSources = selectSourcesForAnalysis(story, maxSourceAnalyses);
  const analyzed: NewsCardSourceAnalysis[] = [];
  const relatedLinks: NewsCardRelatedLink[] = [];
  const skipArticleTextFetch = shouldSkipArticleTextFetch();

  for (const source of selectedSources) {
    if (skipArticleTextFetch) {
      console.info('[vh:news-card-analysis] source analysis skipped; article text disabled', {
        sourceId: source.source_id,
        url: source.url,
      });
      continue;
    }

    try {
      const articleText = await fetchArticleText(source.url);
      if (!articleText.trim()) {
        console.warn('[vh:news-card-analysis] source analysis skipped; empty article text', {
          sourceId: source.source_id,
          url: source.url,
        });
        relatedLinks.push(toRelatedLink(source));
        continue;
      }
      const input = buildAnalysisInput(story, source, articleText);
      try {
        const result = await runAnalysis(input);
        analyzed.push(toSourceAnalysis(source, result.analysis));
      } catch (error) {
        console.warn('[vh:news-card-analysis] source analysis skipped; analysis unavailable', {
          sourceId: source.source_id,
          url: source.url,
          error,
        });
      }
    } catch (error) {
      console.warn('[vh:news-card-analysis] source analysis skipped; article text unavailable', {
        sourceId: source.source_id,
        url: source.url,
        error,
      });
      relatedLinks.push(toRelatedLink(source));
    }
  }

  if (analyzed.length === 0) {
    throw new Error('Analysis pipeline unavailable for all story sources');
  }

  return {
    summary: synthesizeSummary(analyzed),
    frames: toFrameRows(analyzed),
    analyses: analyzed,
    relatedLinks,
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
  shouldSkipArticleTextFetch,
  stripSourceAttributionLead,
  sanitizePublicationNeutralSummary,
  synthesizeSummary,
  toFrameRows,
  toRelatedLink,
  toSourceAnalysis,
  toStoryCacheKey,
};
