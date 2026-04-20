import { describe, expect, it, vi } from 'vitest';
import type { StoryBundle, StoryBundleSource } from '@vh/data-model';
import { InMemoryItemEligibilityLedgerStore, ItemEligibilityLedger } from './itemEligibilityLedger';
import { createStoryBundleEligibilityEnricher, enrichStoryBundleWithEligibility } from './storyBundleEligibilityEnrichment';

function makeSource(overrides: Partial<StoryBundleSource> = {}): StoryBundleSource {
  return {
    source_id: 'source-1',
    publisher: 'Publisher One',
    url: 'https://example.com/story-1',
    url_hash: 'hash-1',
    title: 'Headline One',
    published_at: 1_700_000_000_000,
    ...overrides,
  };
}

function makeBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  const sources = [
    makeSource(),
    makeSource({
      source_id: 'source-2',
      publisher: 'Publisher Two',
      url: 'https://example.com/story-2',
      url_hash: 'hash-2',
      title: 'Headline Two',
    }),
    makeSource({
      source_id: 'source-3',
      publisher: 'Publisher Three',
      url: 'https://example.com/story-3',
      url_hash: 'hash-3',
      title: 'Headline Three',
    }),
  ];

  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'topic-1',
    storyline_id: 'storyline-1',
    headline: 'Headline',
    summary_hint: 'Summary',
    cluster_window_start: 1,
    cluster_window_end: 2,
    sources,
    primary_sources: sources.slice(0, 2),
    cluster_features: {
      entity_keys: ['topic'],
      time_bucket: '2026-04-13T10',
      semantic_signature: 'sig-1',
    },
    provenance_hash: 'old-prov',
    created_at: 3,
    ...overrides,
  };
}

describe('storyBundleEligibilityEnrichment', () => {
  it('partitions canonical sources and related links at publish time', async () => {
    const store = new InMemoryItemEligibilityLedgerStore();
    const ledger = new ItemEligibilityLedger({ store, now: () => 100 });
    await ledger.writeAssessment({
      canonicalUrl: 'https://example.com/story-1',
      urlHash: 'hash-1',
      state: 'analysis_eligible',
      reason: 'analysis_eligible',
      displayEligible: true,
    });
    await ledger.writeAssessment({
      canonicalUrl: 'https://example.com/story-2',
      urlHash: 'hash-2',
      state: 'link_only',
      reason: 'quality-too-low',
      displayEligible: true,
    });
    await ledger.writeAssessment({
      canonicalUrl: 'https://example.com/story-3',
      urlHash: 'hash-3',
      state: 'hard_blocked',
      reason: 'removed',
      displayEligible: false,
    });

    const bundle = makeBundle();
    const result = await enrichStoryBundleWithEligibility(bundle, {
      itemEligibilityLedger: ledger,
      articleTextService: { extract: vi.fn() as any },
    });

    expect(result).not.toBeNull();
    expect(result?.sources).toEqual([bundle.sources[0]!]);
    expect(result?.primary_sources).toEqual([bundle.primary_sources?.[0]!]);
    expect(result?.related_links).toEqual([bundle.sources[1]!]);
    expect(result?.provenance_hash).not.toBe('old-prov');
  });

  it('assesses missing sources through article extraction before publishing', async () => {
    const ledger = new ItemEligibilityLedger({ now: () => 200 });
    const extract = vi.fn(async (url: string) => {
      if (url.endsWith('story-1')) {
        return {
          url,
          urlHash: 'hash-1',
          contentHash: 'content-1',
          sourceDomain: 'example.com',
          title: 'Headline One',
          text: 'Long enough article text to qualify for analysis.',
          extractionMethod: 'article-extractor' as const,
          cacheHit: 'none' as const,
          attempts: 1,
          fetchedAt: 200,
          quality: {
            charCount: 900,
            wordCount: 180,
            sentenceCount: 5,
            score: 0.9,
          },
        };
      }
      throw Object.assign(new Error('too short'), {
        code: 'quality-too-low',
        retryable: false,
      });
    });

    const bundle = makeBundle({
      sources: [makeSource(), makeSource({ source_id: 'source-2', url: 'https://example.com/story-2', url_hash: 'hash-2' })],
      primary_sources: [makeSource(), makeSource({ source_id: 'source-2', url: 'https://example.com/story-2', url_hash: 'hash-2' })],
    });

    const result = await enrichStoryBundleWithEligibility(bundle, {
      itemEligibilityLedger: ledger,
      articleTextService: { extract },
    });

    expect(extract).toHaveBeenCalledTimes(2);
    expect(result?.sources).toEqual([bundle.sources[0]!]);
    expect(result?.related_links).toEqual([bundle.sources[1]!]);
  });

  it('returns null when no sources remain analysis-eligible', async () => {
    const ledger = new ItemEligibilityLedger({ now: () => 300 });
    const logger = { warn: vi.fn() };
    const bundle = makeBundle({
      sources: [makeSource()],
      primary_sources: [makeSource()],
    });

    const result = await enrichStoryBundleWithEligibility(bundle, {
      itemEligibilityLedger: ledger,
      articleTextService: {
        extract: vi.fn(async () => {
          throw Object.assign(new Error('gone'), {
            code: 'removed',
            retryable: false,
          });
        }),
      },
      logger,
    });

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] skipping bundle with no analysis-eligible sources',
      expect.objectContaining({ story_id: 'story-1', source_count: 1 }),
    );
  });

  it('creates a reusable enricher closure', async () => {
    const store = new InMemoryItemEligibilityLedgerStore();
    const ledger = new ItemEligibilityLedger({ store, now: () => 400 });
    await ledger.writeAssessment({
      canonicalUrl: 'https://example.com/story-1',
      urlHash: 'hash-1',
      state: 'analysis_eligible',
      reason: 'analysis_eligible',
      displayEligible: true,
    });

    const enricher = createStoryBundleEligibilityEnricher({
      itemEligibilityLedger: ledger,
      articleTextService: { extract: vi.fn() as any },
    });

    const result = await enricher(makeBundle({
      sources: [makeSource()],
      primary_sources: [makeSource()],
    }));
    expect(result?.sources).toEqual([makeSource()]);
  });
});
