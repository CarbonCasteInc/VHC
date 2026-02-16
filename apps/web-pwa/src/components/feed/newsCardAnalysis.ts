import type { StoryBundle } from '@vh/data-model';
import { createRemoteEngine } from '../../../../../packages/ai-engine/src/engines';
import { createAnalysisPipeline, type PipelineResult } from '../../../../../packages/ai-engine/src/pipeline';
import type { AnalysisResult } from '../../../../../packages/ai-engine/src/schema';

const MAX_SOURCE_ANALYSES = 3;
const MAX_FRAME_ROWS = 12;

export interface NewsCardSourceAnalysis {
  readonly source_id: string;
  readonly publisher: string;
  readonly url: string;
  readonly summary: string;
  readonly biases: ReadonlyArray<string>;
  readonly counterpoints: ReadonlyArray<string>;
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
const articleTextCache = new Map<string, Promise<string>>();

interface ArticleTextProxyResponse {
  readonly url: string;
  readonly text: string;
  readonly title?: string;
}

function readArticleTextResponse(value: unknown): ArticleTextProxyResponse | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    url?: unknown;
    text?: unknown;
    title?: unknown;
  };

  if (typeof candidate.url !== 'string' || typeof candidate.text !== 'string') {
    return null;
  }

  const text = candidate.text.trim();
  if (text.length === 0) {
    return null;
  }

  return {
    url: candidate.url,
    text,
    title: typeof candidate.title === 'string' ? candidate.title : undefined,
  };
}

async function fetchArticleTextViaProxy(url: string): Promise<string> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new Error('Article URL is required');
  }

  let pending = articleTextCache.get(trimmedUrl);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(`/article-text?url=${encodeURIComponent(trimmedUrl)}`);
      if (!response.ok) {
        throw new Error(`article-text proxy returned ${response.status}`);
      }

      const payload = readArticleTextResponse(await response.json());
      if (!payload) {
        throw new Error('Invalid article-text payload');
      }

      return payload.text;
    })();

    articleTextCache.set(trimmedUrl, pending);
  }

  try {
    return await pending;
  } catch (error) {
    articleTextCache.delete(trimmedUrl);
    throw error;
  }
}

function getArticleTextFetcher(
  overrides?: NewsCardAnalysisOptions,
): (url: string) => Promise<string> {
  return overrides?.fetchArticleText ?? fetchArticleTextViaProxy;
}

function getRunAnalysis(): (articleText: string) => Promise<Pick<PipelineResult, 'analysis'>> {
  if (!cachedRunAnalysis) {
    const remoteEngine = createRemoteEngine();
    const pipeline = remoteEngine
      ? createAnalysisPipeline({ policy: 'local-first', remoteEngine })
      : createAnalysisPipeline();

    cachedRunAnalysis = async (articleText: string) => pipeline(articleText);
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

  for (const source of story.sources) {
    const key = `${source.source_id}|${source.url_hash}`;
    if (!deduped.has(key)) {
      deduped.set(key, source);
    }
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
  };
}

function toFrameRows(
  analyses: ReadonlyArray<NewsCardSourceAnalysis>,
): ReadonlyArray<{ frame: string; reframe: string }> {
  const rows: Array<{ frame: string; reframe: string }> = [];

  for (const sourceAnalysis of analyses) {
    const rowCount = Math.max(
      sourceAnalysis.biases.length,
      sourceAnalysis.counterpoints.length,
    );

    for (let index = 0; index < rowCount; index++) {
      const bias = sourceAnalysis.biases[index]?.trim() || 'No clear bias detected';
      const counterpoint = sourceAnalysis.counterpoints[index]?.trim() || 'N/A';

      rows.push({
        frame: `${sourceAnalysis.publisher}: ${bias}`,
        reframe: counterpoint,
      });
    }
  }

  return rows.slice(0, MAX_FRAME_ROWS);
}

function synthesizeSummary(
  analyses: ReadonlyArray<NewsCardSourceAnalysis>,
): string {
  const highlights = analyses
    .map((sourceAnalysis) => {
      const sentence = firstSentence(sourceAnalysis.summary);
      return sentence
        ? `${sourceAnalysis.publisher}: ${sentence}`
        : `${sourceAnalysis.publisher}: Summary unavailable.`;
    })
    .filter((line) => line.trim().length > 0);

  if (highlights.length === 0) {
    return 'Summary pending synthesis.';
  }

  return highlights.join(' ');
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

  const cacheKey = `${story.story_id}:${story.provenance_hash}`;
  let pending = synthesisCache.get(cacheKey);
  if (!pending) {
    pending = runSynthesis(story, getRunAnalysis(), fetchArticleText);
    synthesisCache.set(cacheKey, pending);
  }

  try {
    return await pending;
  } catch (error) {
    synthesisCache.delete(cacheKey);
    throw error;
  }
}

export function __resetNewsCardAnalysisCacheForTests(): void {
  synthesisCache.clear();
  articleTextCache.clear();
  cachedRunAnalysis = null;
}

export const newsCardAnalysisInternal = {
  buildAnalysisInput,
  firstSentence,
  selectSourcesForAnalysis,
  synthesizeSummary,
  toFrameRows,
};
