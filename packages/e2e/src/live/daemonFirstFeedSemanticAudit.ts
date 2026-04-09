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
  AuditedBundleReport,
  AuditedBundlePairResult,
  DaemonFeedSemanticAuditOptions,
  DaemonFeedSemanticAuditReport,
  LiveSemanticAuditBundleLike,
  LiveSemanticAuditPair,
  LiveSemanticAuditPairResult,
  RetainedSourceEvidenceSnapshot,
  SemanticAuditArticleFetchFailure,
  SemanticAuditStoreSnapshot,
  SemanticAuditSupplyDiagnostics,
  StoryBundleSource,
} from './daemonFirstFeedSemanticAuditTypes';

const ARTICLE_TEXT_TIMEOUT_MS = 20_000;
const ARTICLE_FETCH_CONCURRENCY = 4;
const ARTICLE_FETCH_MAX_ATTEMPTS = 3;
const ARTICLE_FETCH_RETRY_DELAY_MS = 1_000;
const DEFAULT_SAMPLE_COUNT = 2;
const SAMPLE_TIMEOUT_MS = 240_000;
const SEMANTIC_AUDIT_REFRESH_LIMIT = 120;
const SEMANTIC_AUDIT_POST_REFRESH_SETTLE_MS = 4_000;
const runtimeImport = async (modulePath: string): Promise<unknown> => await import(modulePath);
const RETRIABLE_ARTICLE_TEXT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

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

function isRetriableArticleTextError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.message.includes('article-text timeout for ')) {
    return true;
  }
  const statusMatch = error.message.match(/^article-text (\d{3}) for /);
  if (statusMatch) {
    const status = Number.parseInt(statusMatch[1] ?? '', 10);
    return RETRIABLE_ARTICLE_TEXT_STATUS_CODES.has(status);
  }
  return error.message === 'fetch failed'
    || error.message.startsWith('fetch failed')
    || error.message.includes('network')
    || error.message.includes('socket');
}

function formatArticleFetchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchArticlePayloadWithRetry(
  baseUrl: string,
  source: StoryBundleSource,
): Promise<
  | { readonly ok: true; readonly payload: { title: string; text: string }; readonly attempts: number }
  | { readonly ok: false; readonly failure: SemanticAuditArticleFetchFailure }
> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ARTICLE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const payload = await fetchArticlePayload(baseUrl, source.url, source.source_id);
      return { ok: true, payload, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= ARTICLE_FETCH_MAX_ATTEMPTS || !isRetriableArticleTextError(error)) {
        return {
          ok: false,
          failure: {
            source_id: source.source_id,
            url: source.url,
            error: formatArticleFetchError(error),
            attempts: attempt,
          },
        };
      }
      await delay(ARTICLE_FETCH_RETRY_DELAY_MS * attempt);
    }
  }

  return {
    ok: false,
    failure: {
      source_id: source.source_id,
      url: source.url,
      error: formatArticleFetchError(lastError),
      attempts: ARTICLE_FETCH_MAX_ATTEMPTS,
    },
  };
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
  options: Pick<DaemonFeedSemanticAuditOptions, 'openAIBaseUrl' | 'openAIModel' | 'openAIProviderId' | 'openAIUsesFixtureStub'>,
  articleFetchFailures: readonly SemanticAuditArticleFetchFailure[] = [],
): DaemonFeedSemanticAuditReport {
  const incompleteBundleCount = reports.filter((bundle) => bundle.audit_status === 'incomplete_article_text').length;
  return {
    schema_version: 'daemon-first-feed-semantic-audit-v3',
    base_url: LIVE_BASE_URL,
    openai_provenance: {
      provider_id: options.openAIProviderId ?? 'openai',
      model_id: options.openAIModel?.trim() || 'gpt-4o-mini',
      base_url: options.openAIBaseUrl?.trim() || null,
      uses_fixture_stub: options.openAIUsesFixtureStub === true,
    },
    requested_sample_count: sampleCount,
    sampled_story_count: reports.length,
    visible_story_ids: supply.visible_story_ids,
    supply,
    bundles: reports,
    article_fetch_failures: articleFetchFailures,
    overall: {
      audited_pair_count: auditedPairCount,
      related_topic_only_pair_count: relatedTopicOnlyPairCount,
      incomplete_bundle_count: incompleteBundleCount,
      article_fetch_failure_count: articleFetchFailures.length,
      sample_fill_rate: supply.sample_fill_rate,
      sample_shortfall: supply.sample_shortfall,
      pass: reports.length >= sampleCount && relatedTopicOnlyPairCount === 0 && incompleteBundleCount === 0,
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
      const cachedPayload = articleTextCache.get(source.url);
      if (cachedPayload) {
        return {
          url: source.url,
          ok: true as const,
          payload: cachedPayload,
        };
      }

      const resolution = await fetchArticlePayloadWithRetry(LIVE_BASE_URL, source);
      if (resolution.ok) {
        articleTextCache.set(source.url, resolution.payload);
        return {
          url: source.url,
          ok: true as const,
          payload: resolution.payload,
        };
      }

      return {
        url: source.url,
        ok: false as const,
        failure: resolution.failure,
      };
    },
  );
  const payloadByUrl = new Map(
    payloadEntries
      .filter((entry) => entry.ok)
      .map((entry) => [entry.url, entry.payload] as const),
  );
  const articleFetchFailures = payloadEntries
    .filter((entry) => !entry.ok)
    .map((entry) => entry.failure);
  const articleFetchFailureByUrl = new Map(
    payloadEntries
      .filter((entry) => !entry.ok)
      .map((entry) => [entry.url, entry.failure] as const),
  );
  const allPairs: LiveSemanticAuditPair[] = [];
  const incompleteBundleStoryIds = new Set<string>();

  for (const bundle of hydratedBundles) {
    const primarySources = [...(bundle.primary_sources ?? bundle.sources)];
    const sourceTexts = new Map<string, string>();
    const missingArticleSources: SemanticAuditArticleFetchFailure[] = [];

    for (const source of primarySources) {
      const payload = payloadByUrl.get(source.url);
      if (payload) {
        sourceTexts.set(`${source.source_id}:${source.url_hash}`, payload.text);
        continue;
      }

      missingArticleSources.push(articleFetchFailureByUrl.get(source.url) ?? {
        source_id: source.source_id,
        url: source.url,
        error: `article-text unavailable for ${source.source_id}`,
        attempts: 0,
      });
    }

    if (missingArticleSources.length > 0) {
      incompleteBundleStoryIds.add(bundle.story_id);
      continue;
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
    const missingArticleSources = (bundle.primary_sources ?? bundle.sources)
      .map((source) => articleFetchFailureByUrl.get(source.url))
      .filter((failure): failure is SemanticAuditArticleFetchFailure => Boolean(failure));
    const isIncomplete = incompleteBundleStoryIds.has(bundle.story_id);
    const auditStatus: AuditedBundleReport['audit_status'] = isIncomplete
      ? 'incomplete_article_text'
      : 'complete';
    return {
      story_id: bundle.story_id,
      topic_id: bundle.topic_id,
      headline: bundle.headline,
      canonical_source_count: bundle.primary_sources?.length ?? bundle.sources.length,
      secondary_asset_count: bundle.secondary_assets?.length ?? 0,
      canonical_sources: bundle.primary_sources ?? bundle.sources,
      pairs: bundleResults,
      has_related_topic_only_pair: hasRelatedTopicOnlyPair(bundleResults),
      audit_status: auditStatus,
      missing_article_sources: isIncomplete ? missingArticleSources : [],
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
    options,
    articleFetchFailures,
  );

  await persistSemanticAuditReport(report);
  return report;
}
