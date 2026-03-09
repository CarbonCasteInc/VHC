import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { readAuditableBundles } from './browserNewsStore';
import { LIVE_BASE_URL, headlineRows, waitForHeadlines } from './daemonFirstFeedHarness';
import { nudgeFeed } from './feedReadiness';
import type {
  AuditedBundlePairResult,
  DaemonFeedSemanticAuditOptions,
  DaemonFeedSemanticAuditReport,
  LiveSemanticAuditBundleLike,
  LiveSemanticAuditPair,
  LiveSemanticAuditPairResult,
  StoryBundleSource,
} from './daemonFirstFeedSemanticAuditTypes';

const ARTICLE_TEXT_TIMEOUT_MS = 20_000;
const DEFAULT_SAMPLE_COUNT = 2;
const SAMPLE_TIMEOUT_MS = 180_000;
const runtimeImport = new Function(
  'modulePath',
  'return import(modulePath);',
) as (modulePath: string) => Promise<unknown>;

async function loadSemanticAuditModule(): Promise<{
  buildCanonicalSourcePairs: (
    bundle: LiveSemanticAuditBundleLike,
    resolveText: (source: StoryBundleSource) => string,
  ) => LiveSemanticAuditPair[];
  classifyCanonicalSourcePairs: (
    pairs: readonly LiveSemanticAuditPair[],
    options: { apiKey: string; baseUrl?: string; model?: string },
  ) => Promise<LiveSemanticAuditPairResult[]>;
  hasRelatedTopicOnlyPair: (results: readonly LiveSemanticAuditPairResult[]) => boolean;
}> {
  return await runtimeImport('../../../../services/storycluster-engine/dist/index.js') as unknown as {
    buildCanonicalSourcePairs: (
      bundle: LiveSemanticAuditBundleLike,
      resolveText: (source: StoryBundleSource) => string,
    ) => LiveSemanticAuditPair[];
    classifyCanonicalSourcePairs: (
      pairs: readonly LiveSemanticAuditPair[],
      options: { apiKey: string; baseUrl?: string; model?: string },
    ) => Promise<LiveSemanticAuditPairResult[]>;
    hasRelatedTopicOnlyPair: (results: readonly LiveSemanticAuditPairResult[]) => boolean;
  };
}

function articleTextUrl(baseUrl: string, targetUrl: string): string {
  const resolved = new URL('/article-text', baseUrl);
  resolved.searchParams.set('url', targetUrl);
  return resolved.toString();
}

function canonicalSources(bundle: LiveSemanticAuditBundleLike): ReadonlyArray<StoryBundleSource> {
  return bundle.primary_sources ?? bundle.sources;
}

function sourceTextKey(source: Pick<StoryBundleSource, 'source_id' | 'url_hash'>): string {
  return `${source.source_id}:${source.url_hash}`;
}

async function fetchArticlePayload(baseUrl: string, url: string, sourceId: string): Promise<{ title: string; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARTICLE_TEXT_TIMEOUT_MS);
  try {
    const response = await fetch(articleTextUrl(baseUrl, url), {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`article-text ${response.status} for ${sourceId}`);
    }
    const payload = await response.json() as { title?: unknown; text?: unknown };
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) {
      throw new Error(`article-text missing text for ${sourceId}`);
    }
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    return { title, text };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`article-text timeout for ${sourceId}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCanonicalSourceTexts(
  baseUrl: string,
  bundles: readonly LiveSemanticAuditBundleLike[],
): Promise<Map<string, string>> {
  const sourceTexts = new Map<string, string>();
  const payloadsByUrl = new Map<string, Promise<{ title: string; text: string }>>();
  const sources = bundles.flatMap((bundle) => canonicalSources(bundle));

  await Promise.all(sources.map(async (source) => {
    let payloadPromise = payloadsByUrl.get(source.url);
    if (!payloadPromise) {
      payloadPromise = fetchArticlePayload(baseUrl, source.url, source.source_id);
      payloadsByUrl.set(source.url, payloadPromise);
    }
    const payload = await payloadPromise;
    sourceTexts.set(sourceTextKey(source), payload.text);
  }));

  return sourceTexts;
}

async function waitForSampledBundles(
  page: Page,
  sampleCount: number,
  timeoutMs: number,
): Promise<LiveSemanticAuditBundleLike[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const auditable = await readAuditableBundles(page);
    if (auditable.length >= sampleCount) {
      return auditable.slice(0, sampleCount);
    }

    await nudgeFeed(page);
    await waitForHeadlines(page);
  }

  throw new Error(`semantic-audit-insufficient-bundles:${sampleCount}`);
}

function groupPairResults(pairs: readonly LiveSemanticAuditPair[], results: readonly LiveSemanticAuditPairResult[]) {
  const resultsById = new Map(results.map((result) => [result.pair_id, result]));
  const grouped = new Map<string, AuditedBundlePairResult[]>();

  for (const pair of pairs) {
    const result = resultsById.get(pair.pair_id);
    if (!result) {
      throw new Error(`missing-audit-result:${pair.pair_id}`);
    }
    const list = grouped.get(pair.story_id) ?? [];
    list.push({
      ...result,
      left: {
        source_id: pair.left.source_id,
        publisher: pair.left.publisher,
        title: pair.left.title,
        url: pair.left.url,
      },
      right: {
        source_id: pair.right.source_id,
        publisher: pair.right.publisher,
        title: pair.right.title,
        url: pair.right.url,
      },
    });
    grouped.set(pair.story_id, list);
  }

  return grouped;
}

async function persistSemanticAuditReport(report: DaemonFeedSemanticAuditReport): Promise<void> {
  const runId = process.env.VH_DAEMON_FEED_RUN_ID?.trim();
  if (!runId) {
    return;
  }

  const artifactDir = path.resolve(process.cwd(), '../../.tmp/e2e-daemon-feed', runId);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, 'semantic-audit-report.json'),
    JSON.stringify(report, null, 2),
    'utf8',
  );
}

export async function runDaemonFirstFeedSemanticAudit(
  page: Page,
  options: DaemonFeedSemanticAuditOptions,
): Promise<DaemonFeedSemanticAuditReport> {
  const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const timeoutMs = options.timeoutMs ?? SAMPLE_TIMEOUT_MS;
  const {
    buildCanonicalSourcePairs,
    classifyCanonicalSourcePairs,
    hasRelatedTopicOnlyPair,
  } = await loadSemanticAuditModule();

  const visibleStoryIds = (await headlineRows(page)).map((row) => row.storyId);
  const hydratedBundles = await waitForSampledBundles(
    page,
    sampleCount,
    timeoutMs,
  );
  const sourceTexts = await fetchCanonicalSourceTexts(LIVE_BASE_URL, hydratedBundles);
  const allPairs: LiveSemanticAuditPair[] = [];

  for (const bundle of hydratedBundles) {
    allPairs.push(...buildCanonicalSourcePairs(
      bundle,
      (source) => sourceTexts.get(sourceTextKey(source)) ?? '',
    ));
  }

  const results = await classifyCanonicalSourcePairs(allPairs, {
    apiKey: options.openAIApiKey,
    baseUrl: options.openAIBaseUrl,
    model: options.openAIModel,
  });

  const resultsByStory = groupPairResults(allPairs, results);
  const reports = hydratedBundles.map((bundle) => {
    const bundleResults = resultsByStory.get(bundle.story_id) ?? [];
    return {
      story_id: bundle.story_id,
      topic_id: bundle.topic_id,
      headline: bundle.headline,
      canonical_source_count: bundle.primary_sources?.length ?? bundle.sources.length,
      secondary_asset_count: bundle.secondary_assets?.length ?? 0,
      canonical_sources: bundle.primary_sources ?? bundle.sources,
      pairs: bundleResults,
      has_related_topic_only_pair: hasRelatedTopicOnlyPair(bundleResults),
    };
  });

  const relatedTopicOnlyPairCount = reports.reduce(
    (total, bundle) => total + bundle.pairs.filter((pair) => pair.label === 'related_topic_only').length,
    0,
  );

  const report: DaemonFeedSemanticAuditReport = {
    schema_version: 'daemon-first-feed-semantic-audit-v1',
    base_url: LIVE_BASE_URL,
    requested_sample_count: sampleCount,
    sampled_story_count: reports.length,
    visible_story_ids: visibleStoryIds,
    bundles: reports,
    overall: {
      audited_pair_count: results.length,
      related_topic_only_pair_count: relatedTopicOnlyPairCount,
      pass: reports.length >= sampleCount && relatedTopicOnlyPairCount === 0,
    },
  };

  await persistSemanticAuditReport(report);
  return report;
}
