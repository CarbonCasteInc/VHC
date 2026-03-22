import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import {
  readAuditableBundles,
  readRetainedSourceEvidenceSnapshot,
  readSemanticAuditStoreSnapshot,
  refreshNewsStoreLatest,
} from './browserNewsStore';
import { LIVE_BASE_URL, waitForHeadlines } from './daemonFirstFeedHarness';
import { nudgeFeed } from './feedReadiness';
import type {
  AuditedBundlePairResult,
  DaemonFeedSemanticAuditOptions,
  DaemonFeedSemanticAuditReport,
  LiveSemanticAuditBundleLike,
  LiveSemanticAuditPair,
  LiveSemanticAuditPairResult,
  RetainedSourceEvidenceSnapshot,
  SemanticAuditStoreSnapshot,
  SemanticAuditSupplyDiagnostics,
  StoryBundleSource,
} from './daemonFirstFeedSemanticAuditTypes';

const ARTICLE_TEXT_TIMEOUT_MS = 20_000;
const ARTICLE_FETCH_CONCURRENCY = 4;
const DEFAULT_SAMPLE_COUNT = 2;
const SAMPLE_TIMEOUT_MS = 240_000;
const SEMANTIC_AUDIT_REFRESH_LIMIT = 120;
const SEMANTIC_AUDIT_POST_REFRESH_SETTLE_MS = 4_000;
const runtimeImport = async (modulePath: string): Promise<unknown> => await import(modulePath);

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

export async function fetchArticlePayload(baseUrl: string, url: string, sourceId: string): Promise<{ title: string; text: string }> {
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
    clearTimeout(timeout);
    return {
      title: typeof payload.title === 'string' ? payload.title.trim() : '',
      text,
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`article-text timeout for ${sourceId}`);
    }
    throw error;
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => run()));
  return results;
}

function mergeObservedBundles(
  observedByStoryId: Map<string, LiveSemanticAuditBundleLike>,
  bundles: readonly LiveSemanticAuditBundleLike[],
): void {
  for (const bundle of bundles) {
    const existing = observedByStoryId.get(bundle.story_id);
    if (!existing) {
      observedByStoryId.set(bundle.story_id, bundle);
      continue;
    }

    const existingSourceCount = existing.primary_sources?.length ?? existing.sources.length;
    const nextSourceCount = bundle.primary_sources?.length ?? bundle.sources.length;
    if (nextSourceCount > existingSourceCount) {
      observedByStoryId.set(bundle.story_id, bundle);
    }
  }
}

async function waitForSampledBundles(
  page: Page,
  sampleCount: number,
  timeoutMs: number,
): Promise<{
  readonly bundles: ReadonlyArray<LiveSemanticAuditBundleLike>;
  readonly storeSnapshot: SemanticAuditStoreSnapshot;
}> {
  const deadline = Date.now() + timeoutMs;
  const progressiveSampling = process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED !== 'true';
  const observedByStoryId = new Map<string, LiveSemanticAuditBundleLike>();
  let storeSnapshot = await readSemanticAuditStoreSnapshot(page);
  while (Date.now() < deadline) {
    const auditable = await readAuditableBundles(page);
    if (progressiveSampling) {
      mergeObservedBundles(observedByStoryId, auditable);
    }
    storeSnapshot = await readSemanticAuditStoreSnapshot(page);
    if (progressiveSampling && observedByStoryId.size >= sampleCount) {
      return {
        bundles: [...observedByStoryId.values()].slice(0, sampleCount),
        storeSnapshot,
      };
    }
    if (!progressiveSampling && auditable.length >= sampleCount) {
      return {
        bundles: auditable.slice(0, sampleCount),
        storeSnapshot,
      };
    }

    await refreshNewsStoreLatest(page, Math.max(SEMANTIC_AUDIT_REFRESH_LIMIT, sampleCount * 60)).catch(() => {});
    await nudgeFeed(
      page,
      progressiveSampling ? { finalSettleMs: SEMANTIC_AUDIT_POST_REFRESH_SETTLE_MS } : undefined,
    );
    await waitForHeadlines(page);
  }

  const auditable = await readAuditableBundles(page);
  if (progressiveSampling) {
    mergeObservedBundles(observedByStoryId, auditable);
  }
  storeSnapshot = await readSemanticAuditStoreSnapshot(page);
  await persistSemanticAuditFailureSnapshot(storeSnapshot);
  return {
    bundles: progressiveSampling
      ? [...observedByStoryId.values()].slice(0, sampleCount)
      : auditable.slice(0, sampleCount),
    storeSnapshot,
  };
}

export function summarizeSemanticAuditSupply(
  sampleCount: number,
  sampledBundles: readonly LiveSemanticAuditBundleLike[],
  storeSnapshot: SemanticAuditStoreSnapshot,
): SemanticAuditSupplyDiagnostics {
  const sampledStoryCount = sampledBundles.length;
  return {
    status: sampledStoryCount >= sampleCount ? 'full' : sampledStoryCount > 0 ? 'partial' : 'empty',
    story_count: storeSnapshot.story_count,
    auditable_count: storeSnapshot.auditable_count,
    visible_story_ids: storeSnapshot.visible_story_ids,
    top_story_ids: storeSnapshot.top_story_ids,
    top_auditable_story_ids: storeSnapshot.top_auditable_story_ids,
    sample_fill_rate: sampledStoryCount / sampleCount,
    sample_shortfall: Math.max(sampleCount - sampledStoryCount, 0),
  };
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

async function persistSemanticAuditFailureSnapshot(
  snapshot: SemanticAuditStoreSnapshot,
): Promise<void> {
  const runId = process.env.VH_DAEMON_FEED_RUN_ID?.trim();
  if (!runId) {
    return;
  }

  const artifactDir = path.resolve(process.cwd(), '../../.tmp/e2e-daemon-feed', runId);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, 'semantic-audit-store-snapshot.json'),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  );
}

async function persistRetainedSourceEvidenceSnapshot(
  snapshot: RetainedSourceEvidenceSnapshot,
): Promise<void> {
  const runId = process.env.VH_DAEMON_FEED_RUN_ID?.trim();
  if (!runId) {
    return;
  }

  const artifactDir = path.resolve(process.cwd(), '../../.tmp/e2e-daemon-feed', runId);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, 'retained-source-evidence-snapshot.json'),
    JSON.stringify(snapshot, null, 2),
    'utf8',
  );
}

export async function captureDaemonFirstFeedSemanticAuditSnapshots(
  page: Page,
): Promise<{
  readonly storeSnapshot: SemanticAuditStoreSnapshot;
  readonly retainedSourceEvidenceSnapshot: RetainedSourceEvidenceSnapshot;
}> {
  const [storeSnapshot, retainedSourceEvidenceSnapshot] = await Promise.all([
    readSemanticAuditStoreSnapshot(page),
    readRetainedSourceEvidenceSnapshot(page),
  ]);
  await Promise.all([
    persistSemanticAuditFailureSnapshot(storeSnapshot),
    persistRetainedSourceEvidenceSnapshot(retainedSourceEvidenceSnapshot),
  ]);
  return {
    storeSnapshot,
    retainedSourceEvidenceSnapshot,
  };
}

export function buildDaemonFeedSemanticAuditReport(
  sampleCount: number,
  reports: DaemonFeedSemanticAuditReport['bundles'],
  auditedPairCount: number,
  relatedTopicOnlyPairCount: number,
  supply: SemanticAuditSupplyDiagnostics,
): DaemonFeedSemanticAuditReport {
  return {
    schema_version: 'daemon-first-feed-semantic-audit-v2',
    base_url: LIVE_BASE_URL,
    requested_sample_count: sampleCount,
    sampled_story_count: reports.length,
    visible_story_ids: supply.visible_story_ids,
    supply,
    bundles: reports,
    overall: {
      audited_pair_count: auditedPairCount,
      related_topic_only_pair_count: relatedTopicOnlyPairCount,
      sample_fill_rate: supply.sample_fill_rate,
      sample_shortfall: supply.sample_shortfall,
      pass: reports.length >= sampleCount && relatedTopicOnlyPairCount === 0,
    },
  };
}

export async function runDaemonFirstFeedSemanticAudit(
  page: Page,
  options: DaemonFeedSemanticAuditOptions,
): Promise<DaemonFeedSemanticAuditReport> {
  const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const timeoutMs = options.timeoutMs ?? SAMPLE_TIMEOUT_MS;
  const articleTextCache = new Map<string, { title: string; text: string }>();
  const {
    buildCanonicalSourcePairs,
    classifyCanonicalSourcePairs,
    hasRelatedTopicOnlyPair,
  } = await loadSemanticAuditModule();

  const { bundles: sampledBundles, storeSnapshot } = await waitForSampledBundles(page, sampleCount, timeoutMs);
  const retainedSourceEvidenceSnapshot = await readRetainedSourceEvidenceSnapshot(page);
  await persistRetainedSourceEvidenceSnapshot(retainedSourceEvidenceSnapshot);
  const hydratedBundles = [...sampledBundles];
  const canonicalSources = Array.from(
    new Map(
      hydratedBundles.flatMap((bundle) => (bundle.primary_sources ?? bundle.sources).map((source) => [
        source.url,
        source,
      ])),
    ).values(),
  );
  const payloadEntries = await mapWithConcurrency(
    canonicalSources,
    ARTICLE_FETCH_CONCURRENCY,
    async (source) => {
      const payload = articleTextCache.get(source.url)
        ?? await fetchArticlePayload(LIVE_BASE_URL, source.url, source.source_id);
      articleTextCache.set(source.url, payload);
      return [source.url, payload] as const;
    },
  );
  const payloadByUrl = new Map(payloadEntries);
  const allPairs: LiveSemanticAuditPair[] = [];

  for (const bundle of hydratedBundles) {
    const primarySources = [...(bundle.primary_sources ?? bundle.sources)];
    const sourceTexts = new Map<string, string>();

    for (const source of primarySources) {
      sourceTexts.set(`${source.source_id}:${source.url_hash}`, payloadByUrl.get(source.url)!.text);
    }

    allPairs.push(...buildCanonicalSourcePairs(
      bundle,
      (source) => sourceTexts.get(`${source.source_id}:${source.url_hash}`) ?? '',
    ));
  }

  const results = allPairs.length === 0
    ? []
    : await classifyCanonicalSourcePairs(allPairs, {
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

  const report = buildDaemonFeedSemanticAuditReport(
    sampleCount,
    reports,
    results.length,
    relatedTopicOnlyPairCount,
    summarizeSemanticAuditSupply(sampleCount, hydratedBundles, storeSnapshot),
  );

  await persistSemanticAuditReport(report);
  return report;
}
