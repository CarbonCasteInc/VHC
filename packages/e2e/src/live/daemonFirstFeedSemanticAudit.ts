import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { LIVE_BASE_URL, headlineRows, waitForHeadlines } from './daemonFirstFeedHarness';
import type {
  AuditedBundlePairResult,
  DaemonFeedSemanticAuditOptions,
  DaemonFeedSemanticAuditReport,
  LiveSemanticAuditBundleLike,
  LiveSemanticAuditPair,
  LiveSemanticAuditPairResult,
  SemanticAuditBundleCandidate,
  StoryBundleSource,
} from './daemonFirstFeedSemanticAuditTypes';

const ARTICLE_TEXT_TIMEOUT_MS = 20_000;
const DEFAULT_SAMPLE_COUNT = 2;
const SAMPLE_TIMEOUT_MS = 180_000;
const MIN_CANONICAL_SOURCES = 2;

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

function urlHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

async function visibleBundleCandidates(page: Page): Promise<SemanticAuditBundleCandidate[]> {
  const candidates = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('article[data-testid^="news-card-"]'))
    .map((card) => {
      const headlineNode = card.querySelector<HTMLElement>('[data-testid^="news-card-headline-"]');
      if (!headlineNode) return null;
      const topicId = (headlineNode.getAttribute('data-testid') ?? '').replace('news-card-headline-', '');
      const storyId = headlineNode.getAttribute('data-story-id') ?? '';
      const headline = (headlineNode.textContent ?? '').trim();
      if (!topicId || !storyId || !headline) return null;

      const sources = Array.from(card.querySelectorAll<HTMLAnchorElement>('[data-testid^="source-badge-"]'))
        .map((anchor) => {
          const sourceId = (anchor.getAttribute('data-testid') ?? '').replace('source-badge-', '');
          const publisher = (anchor.textContent ?? '').trim();
          const url = anchor.href ?? '';
          if (!sourceId || !publisher || !url) return null;
          return {
            source_id: sourceId,
            publisher,
            url,
          };
        })
        .filter((source): source is { source_id: string; publisher: string; url: string } => Boolean(source));

      const overflowNode = card.querySelector<HTMLElement>('[data-testid="source-badge-overflow"]');
      const overflowText = (overflowNode?.textContent ?? '').trim();
      const overflowMatch = overflowText.match(/\+(\d+)/);

      return {
        story_id: storyId,
        topic_id: topicId,
        headline,
        sourceBadgeCount: sources.length,
        sourceOverflowCount: Number.parseInt(overflowMatch?.[1] ?? '0', 10) || 0,
        sources,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)));
  return candidates;
}

async function waitForSampledBundles(
  page: Page,
  sampleCount: number,
  timeoutMs: number,
): Promise<SemanticAuditBundleCandidate[]> {
  const deadline = Date.now() + timeoutMs;
  let loadOlderAttempts = 0;
  while (Date.now() < deadline) {
    const visible = await visibleBundleCandidates(page);
    const auditable = visible
      .filter((bundle) => bundle.sourceBadgeCount >= MIN_CANONICAL_SOURCES)
      .filter((bundle) => bundle.sourceOverflowCount === 0);
    if (auditable.length >= sampleCount) {
      return auditable.slice(0, sampleCount);
    }

    const sentinel = page.getByTestId('feed-load-sentinel');
    if (await sentinel.count().catch(() => 0)) {
      await sentinel.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1_500);
      const expanded = await visibleBundleCandidates(page);
      const expandedAuditable = expanded
        .filter((bundle) => bundle.sourceBadgeCount >= MIN_CANONICAL_SOURCES)
        .filter((bundle) => bundle.sourceOverflowCount === 0);
      if (expandedAuditable.length >= sampleCount) {
        return expandedAuditable.slice(0, sampleCount);
      }
      loadOlderAttempts += 1;
      if (loadOlderAttempts % 2 === 0) {
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      }
    }

    await page.getByTestId('feed-refresh-button').click().catch(() => {});
    await page.waitForTimeout(1_000);
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

  const visibleStoryIds = (await headlineRows(page)).map((row) => row.storyId);
  const candidates = await waitForSampledBundles(page, sampleCount, timeoutMs);
  const allPairs: LiveSemanticAuditPair[] = [];
  const hydratedBundles: LiveSemanticAuditBundleLike[] = [];

  for (const candidate of candidates) {
    const primarySources: StoryBundleSource[] = [];
    const sourceTexts = new Map<string, string>();

    for (const source of candidate.sources) {
      const payload = articleTextCache.get(source.url)
        ?? await fetchArticlePayload(LIVE_BASE_URL, source.url, source.source_id);
      articleTextCache.set(source.url, payload);

      const hydratedSource: StoryBundleSource = {
        source_id: source.source_id,
        publisher: source.publisher,
        url: source.url,
        url_hash: urlHash(source.url),
        title: payload.title || source.publisher,
      };
      primarySources.push(hydratedSource);
      sourceTexts.set(`${hydratedSource.source_id}:${hydratedSource.url_hash}`, payload.text);
    }

    const bundle: LiveSemanticAuditBundleLike = {
      story_id: candidate.story_id,
      topic_id: candidate.topic_id,
      headline: candidate.headline,
      sources: primarySources,
      primary_sources: primarySources,
      secondary_assets: [],
    };

    hydratedBundles.push(bundle);
    allPairs.push(...buildCanonicalSourcePairs(
      bundle,
      (source) => sourceTexts.get(`${source.source_id}:${source.url_hash}`) ?? '',
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

  return {
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
}
