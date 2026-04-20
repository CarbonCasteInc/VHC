import type { StoryBundle, StoryBundleSource } from '@vh/data-model';
import { ArticleTextService, type ArticleTextResult } from './articleTextService';
import { ItemEligibilityLedger, type ItemEligibilityLedgerEntry } from './itemEligibilityLedger';
import {
  assessItemEligibilityFromError,
  assessItemEligibilityFromResult,
  type ItemEligibilityAssessment,
} from './itemEligibilityPolicy';
import { computeProvenanceHash } from './provenance';

export interface StoryBundleEligibilityEnrichmentOptions {
  readonly articleTextService?: Pick<ArticleTextService, 'extract'>;
  readonly itemEligibilityLedger?: Pick<ItemEligibilityLedger, 'readByUrlHash'>;
  readonly logger?: Pick<Console, 'warn'>;
}

export type StoryBundleEligibilityEnricher = (
  bundle: StoryBundle,
) => Promise<StoryBundle | null>;

function sourceKey(source: StoryBundleSource): string {
  return `${source.source_id}|${source.url_hash}`;
}

function dedupeSources(sources: readonly StoryBundleSource[]): StoryBundleSource[] {
  const deduped = new Map<string, StoryBundleSource>();
  for (const source of sources) {
    const key = sourceKey(source);
    if (!deduped.has(key)) {
      deduped.set(key, source);
    }
  }
  return [...deduped.values()];
}

function toAssessmentFromLedgerEntry(entry: ItemEligibilityLedgerEntry): ItemEligibilityAssessment {
  return {
    url: entry.canonicalUrl,
    canonicalUrl: entry.canonicalUrl,
    urlHash: entry.urlHash,
    state: entry.state,
    reason: entry.reason,
    retryable: entry.recoverable,
    displayEligible: entry.displayEligible,
  };
}

async function assessSourceEligibility(
  source: StoryBundleSource,
  articleTextService: Pick<ArticleTextService, 'extract'>,
  itemEligibilityLedger: Pick<ItemEligibilityLedger, 'readByUrlHash'>,
): Promise<ItemEligibilityAssessment> {
  const existing = await itemEligibilityLedger.readByUrlHash(source.url_hash);
  if (existing) {
    return toAssessmentFromLedgerEntry(existing);
  }

  try {
    const result: ArticleTextResult = await articleTextService.extract(source.url);
    return assessItemEligibilityFromResult(result);
  } catch (error) {
    return assessItemEligibilityFromError(source.url, error);
  }
}

function filterPrimarySources(
  primarySources: readonly StoryBundleSource[] | undefined,
  canonicalKeys: ReadonlySet<string>,
): StoryBundleSource[] | undefined {
  if (!primarySources || primarySources.length === 0) {
    return undefined;
  }

  const filtered = primarySources.filter((source) => canonicalKeys.has(sourceKey(source)));
  return filtered.length > 0 ? filtered : undefined;
}

function mergeRelatedLinks(
  bundle: StoryBundle,
  relatedSources: readonly StoryBundleSource[],
  canonicalKeys: ReadonlySet<string>,
): StoryBundleSource[] | undefined {
  const merged = dedupeSources([
    ...relatedSources,
    ...(bundle.related_links ?? []),
  ]).filter((source) => !canonicalKeys.has(sourceKey(source)));

  return merged.length > 0 ? merged : undefined;
}

export async function enrichStoryBundleWithEligibility(
  bundle: StoryBundle,
  options: StoryBundleEligibilityEnrichmentOptions = {},
): Promise<StoryBundle | null> {
  const articleTextService = options.articleTextService ?? new ArticleTextService();
  const itemEligibilityLedger = options.itemEligibilityLedger ?? new ItemEligibilityLedger();
  const logger = options.logger ?? console;

  const canonicalSources: StoryBundleSource[] = [];
  const relatedSources: StoryBundleSource[] = [];

  for (const source of bundle.sources) {
    const assessment = await assessSourceEligibility(source, articleTextService, itemEligibilityLedger);
    if (assessment.state === 'analysis_eligible') {
      canonicalSources.push(source);
      continue;
    }

    if (assessment.displayEligible) {
      relatedSources.push(source);
    }
  }

  const dedupedCanonicalSources = dedupeSources(canonicalSources);
  if (dedupedCanonicalSources.length === 0) {
    logger.warn('[vh:news-daemon] skipping bundle with no analysis-eligible sources', {
      story_id: bundle.story_id,
      source_count: bundle.sources.length,
    });
    return null;
  }

  const canonicalKeys = new Set(dedupedCanonicalSources.map((source) => sourceKey(source)));
  const primarySources = filterPrimarySources(bundle.primary_sources, canonicalKeys);
  const relatedLinks = mergeRelatedLinks(bundle, relatedSources, canonicalKeys);

  const nextProvenanceHash = computeProvenanceHash(dedupedCanonicalSources);

  return {
    ...bundle,
    sources: dedupedCanonicalSources,
    primary_sources: primarySources,
    related_links: relatedLinks,
    provenance_hash: nextProvenanceHash,
  };
}

export function createStoryBundleEligibilityEnricher(
  options: StoryBundleEligibilityEnrichmentOptions = {},
): StoryBundleEligibilityEnricher {
  return async (bundle: StoryBundle) => enrichStoryBundleWithEligibility(bundle, options);
}

export const storyBundleEligibilityEnrichmentInternal = {
  dedupeSources,
  filterPrimarySources,
  mergeRelatedLinks,
  sourceKey,
  toAssessmentFromLedgerEntry,
};
