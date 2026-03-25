import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryBundleInputSchema } from '@vh/data-model';
import {
  buildEnrichmentWorkItems,
  clusterItems,
  newsClusterInternal,
} from '../newsCluster';
import { clusterHeadlineTexts } from '../newsClusterBundle';
import { normalizedItemTexts } from '../newsClusterAssignment';
import { normalizeAndDedup } from '../newsNormalize';
import type { NormalizedItem } from '../newsTypes';

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceId: 'src-a',
    publisher: 'src-a',
    url: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    title: 'Markets rally after policy update',
    publishedAt: 1707134400000,
    summary: 'Markets moved higher after a policy update.',
    author: 'Author',
    url_hash: 'hash-a',
    image_hash: undefined,
    language: 'en',
    translation_applied: false,
    cluster_text: 'markets rally after policy update markets moved higher after policy update',
    entity_keys: ['markets', 'policy'],
    ...overrides,
  };
}

function sentenceCount(text: string | undefined): number {
  if (!text) {
    return 0;
  }

  return text
    .split(/[.!?]+\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean).length;
}

describe('newsCluster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-05T14:00:00.000Z'));
    newsClusterInternal.resetStoryAssignmentState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clusters multi-source items and emits PR4 feature fields + canonical summary', () => {
    const items: NormalizedItem[] = [
      makeItem({
        sourceId: 'src-a',
        publisher: 'Publisher A',
        canonicalUrl: 'https://example.com/a',
        url_hash: 'hash-a',
        title: 'Markets rally after policy update',
        publishedAt: 1707134400000,
        entity_keys: ['markets', 'policy'],
      }),
      makeItem({
        sourceId: 'src-b',
        publisher: 'Publisher B',
        canonicalUrl: 'https://example.com/b',
        url_hash: 'hash-b',
        title: 'Policy update lifts markets worldwide',
        cluster_text: 'policy update lifts markets worldwide',
        publishedAt: 1707136200000,
        entity_keys: ['markets', 'update'],
      }),
    ];

    const bundles = clusterItems(items, 'topic-markets');

    expect(bundles).toHaveLength(1);
    const bundle = bundles[0]!;

    expect(bundle.schemaVersion).toBe('story-bundle-v0');
    expect(bundle.topic_id).toBe('topic-markets');
    expect(bundle.cluster_features.entity_keys).toEqual(['markets', 'policy', 'update']);
    expect(bundle.cluster_features.coverage_score).toBeGreaterThan(0);
    expect(bundle.cluster_features.velocity_score).toBeGreaterThan(0);
    expect(bundle.cluster_features.confidence_score).toBeGreaterThan(0);
    expect(bundle.cluster_features.primary_language).toBe('en');
    expect(bundle.cluster_features.translation_applied).toBe(false);
    expect(bundle.sources).toHaveLength(2);
    expect(bundle.provenance_hash).toMatch(/^[0-9a-f]{8}$/);

    expect(bundle.summary_hint).toBeTruthy();
    expect(sentenceCount(bundle.summary_hint)).toBeGreaterThanOrEqual(2);
    expect(sentenceCount(bundle.summary_hint)).toBeLessThanOrEqual(3);

    const inputContractCandidate = {
      story_id: bundle.story_id,
      topic_id: bundle.topic_id,
      sources: bundle.sources.map((source) => ({
        source_id: source.source_id,
        url: source.url,
        publisher: source.publisher,
        published_at: source.published_at ?? bundle.cluster_window_start,
        url_hash: source.url_hash,
      })),
      normalized_facts_text: bundle.summary_hint ?? bundle.headline,
    };

    expect(StoryBundleInputSchema.safeParse(inputContractCandidate).success).toBe(true);
  });

  it('creates separate clusters when there is no overlap or bucket mismatch', () => {
    const items: NormalizedItem[] = [
      makeItem({
        canonicalUrl: 'https://example.com/a',
        url_hash: 'hash-a',
        entity_keys: ['markets'],
        publishedAt: 1707134400000,
      }),
      makeItem({
        canonicalUrl: 'https://example.com/c',
        url_hash: 'hash-c',
        entity_keys: ['sports'],
        title: 'Sports final ends in draw',
        cluster_text: 'sports final ends in draw',
        publishedAt: 1707134700000,
      }),
      makeItem({
        canonicalUrl: 'https://example.com/d',
        url_hash: 'hash-d',
        entity_keys: ['markets'],
        title: 'Markets close higher overnight',
        cluster_text: 'markets close higher overnight',
        publishedAt: 1707145200000,
      }),
    ];

    const bundles = clusterItems(items, 'topic-mixed');
    expect(bundles).toHaveLength(3);
  });

  it('does not false-merge cuba missions coverage with unrelated justice fraud coverage after input cleanup', () => {
    const normalized = normalizeAndDedup([
      {
        sourceId: 'npr-news',
        url: 'https://www.npr.org/2026/03/24/nx-s1-5746626/cuba-doctors-mission-blockade',
        title: 'Cuba sends doctors on medical missions. The U.S. isn&apos;t a fan',
        publishedAt: 1774382397000,
        summary: 'It&apos;s a major source of revenue for the island. And it&apos;s controversial. Now countries are sending Cuban doctors home in response to pressure from the Trump administration.',
      },
      {
        sourceId: 'npr-politics',
        url: 'https://www.npr.org/2026/03/24/g-s1-114956/trump-fraud-enforcement-justice-role',
        title: 'Senate confirms Trump&apos;s pick for new role of fraud enforcement at Justice Department',
        publishedAt: 1774379219000,
        summary: 'The confirmation comes just days after the White House announced details of its own task force to pursue fraud in government programs.',
      },
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.entity_keys).not.toContain('apos');
    expect(normalized[1]?.entity_keys).not.toContain('apos');

    const bundles = clusterItems(normalized, 'topic-news');
    expect(bundles).toHaveLength(2);
    expect(bundles.map((bundle) => bundle.headline).sort()).toEqual([
      'Cuba sends doctors on medical missions. The U.S. isn&apos;t a fan',
      'Senate confirms Trump&apos;s pick for new role of fraud enforcement at Justice Department',
    ]);
  });

  it('merges Florida special-election coverage across a same-day multi-hour window', () => {
    const normalized = normalizeAndDedup([
      {
        sourceId: 'abc-politics',
        url: 'https://abcnews.com/Politics/wireStory/democrat-flips-seat-special-election-florida-district-includes-131381362',
        title: 'Democrat flips seat in election for Florida district that is home to Mar-a-Lago',
        publishedAt: 1774424017000,
        summary: 'Democrat Emily Gregory has won a special election for a Florida state House seat, flipping a district that is home to President Donald Trump&rsquo;s estate, Mar-a-Lago',
      },
      {
        sourceId: 'nypost-politics',
        url: 'https://nypost.com/2026/03/25/us-news/democrat-emily-gregory-flips-long-held-florida-gop-house-seat-that-includes-trumps-mar-a-lago/',
        title: 'Democrat Emily Gregory flips long-held Florida GOP House seat that includes Trump&#8217;s Mar-a-Lago',
        publishedAt: 1774416950000,
        summary: 'Republican Maples faced Democrat Emily Gregory in Florida House District 87, a Palm Beach seat Trump carried by roughly 10 points in 2024.',
        author: 'Fox News',
      },
      {
        sourceId: 'nbc-politics',
        url: 'https://www.nbcnews.com/politics/elections/democrat-flips-republican-florida-house-seat-includes-trump-mar-lago-rcna264660',
        title: 'Democrat flips Republican-held Florida state House district that includes Trump’s Mar-a-Lago',
        publishedAt: 1774396885000,
        summary: 'Democrat Emily Gregory won a special election Tuesday for the Florida state House district that includes President Donald Trump’s Mar-a-Lago resort, flipping the seat from Republican control, The Associated Press projects',
        author: 'Alexandra Marquez',
      },
    ]);

    const bundles = clusterItems(normalized, 'topic-news');
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.sources.map((source) => source.source_id)).toEqual([
      'abc-politics',
      'nbc-politics',
      'nypost-politics',
    ]);
  });

  it('does not cross-bucket merge when the incoming item is untimed', () => {
    const items: NormalizedItem[] = [
      makeItem({
        sourceId: 'src-a',
        publisher: 'Publisher A',
        canonicalUrl: 'https://example.com/florida-a',
        url_hash: 'hash-florida-a',
        title: 'Florida special election flips Mar-a-Lago district',
        cluster_text: 'florida special election flips mar a lago district',
        publishedAt: 1774424017000,
        entity_keys: ['florida', 'mar', 'lago', 'election'],
      }),
      makeItem({
        sourceId: 'src-b',
        publisher: 'Publisher B',
        canonicalUrl: 'https://example.com/florida-b',
        url_hash: 'hash-florida-b',
        title: 'Florida special election flips Mar-a-Lago district',
        cluster_text: 'florida special election flips mar a lago district',
        publishedAt: undefined,
        entity_keys: ['florida', 'mar', 'lago', 'election'],
      }),
    ];

    const bundles = clusterItems(items, 'topic-news');
    expect(bundles).toHaveLength(2);
  });

  it('does not cross-bucket merge same-event coverage when it falls outside the extended window', () => {
    const items: NormalizedItem[] = [
      makeItem({
        sourceId: 'src-a',
        publisher: 'Publisher A',
        canonicalUrl: 'https://example.com/florida-window-a',
        url_hash: 'hash-florida-window-a',
        title: 'Florida special election flips Mar-a-Lago district',
        cluster_text: 'florida special election flips mar a lago district',
        publishedAt: 1774396885000,
        entity_keys: ['florida', 'mar', 'lago', 'election'],
      }),
      makeItem({
        sourceId: 'src-b',
        publisher: 'Publisher B',
        canonicalUrl: 'https://example.com/florida-window-b',
        url_hash: 'hash-florida-window-b',
        title: 'Florida special election flips Mar-a-Lago district',
        cluster_text: 'florida special election flips mar a lago district',
        publishedAt: 1774424017000,
        entity_keys: ['florida', 'mar', 'lago', 'election'],
      }),
    ];

    const bundles = clusterItems(items, 'topic-news');
    expect(bundles).toHaveLength(2);
  });

  it('keeps stable story_id across incremental updates via hybrid assignment', () => {
    const first = makeItem({
      canonicalUrl: 'https://example.com/first',
      url_hash: 'hash-first',
      publishedAt: 1707134400000,
      entity_keys: ['alpha', 'shared'],
      title: 'Alpha shared story',
      cluster_text: 'alpha shared story',
    });
    const second = makeItem({
      canonicalUrl: 'https://example.com/second',
      url_hash: 'hash-second',
      publishedAt: 1707135000000,
      entity_keys: ['shared', 'beta'],
      title: 'Beta shared story',
      cluster_text: 'beta shared story',
    });
    const third = makeItem({
      canonicalUrl: 'https://example.com/third',
      url_hash: 'hash-third',
      publishedAt: 1707135600000,
      entity_keys: ['shared', 'gamma'],
      title: 'Gamma perspective on shared story',
      cluster_text: 'gamma perspective on shared story',
    });

    const firstRun = clusterItems([first, second], 'topic-stable')[0]!;
    const secondRun = clusterItems([first, second, third], 'topic-stable')[0]!;

    expect(firstRun.story_id).toBe(secondRun.story_id);
    expect(secondRun.sources).toHaveLength(3);
  });

  it('collapses near-duplicates using text and image signals before clustering', () => {
    const dupA = makeItem({
      sourceId: 'src-a',
      canonicalUrl: 'https://example.com/a1',
      url_hash: 'hash-a1',
      title: 'Breaking quake update in Tokyo',
      cluster_text: 'breaking quake update in tokyo',
      image_hash: 'img-1',
      entity_keys: ['quake', 'tokyo'],
    });

    const dupB = makeItem({
      sourceId: 'src-b',
      canonicalUrl: 'https://example.com/a2',
      url_hash: 'hash-a2',
      title: 'Latest quake update Tokyo region',
      cluster_text: 'latest quake update tokyo region',
      image_hash: 'img-1',
      entity_keys: ['quake', 'tokyo'],
      publishedAt: 1707134500000,
    });

    const unique = makeItem({
      sourceId: 'src-c',
      canonicalUrl: 'https://example.com/u1',
      url_hash: 'hash-u1',
      title: 'Separate economy update',
      cluster_text: 'separate economy update',
      image_hash: 'img-2',
      entity_keys: ['economy'],
      publishedAt: 1707134600000,
    });

    const collapsed = newsClusterInternal.collapseNearDuplicates([dupA, dupB, unique]);
    expect(collapsed).toHaveLength(2);
    expect(collapsed.map((entry) => entry.sourceId)).toEqual(['src-a', 'src-c']);

    expect(newsClusterInternal.isNearDuplicatePair(dupA, dupB)).toBe(true);
    expect(newsClusterInternal.isNearDuplicatePair(dupA, unique)).toBe(false);
  });

  it('tracks language/translation feature flags from normalized items', () => {
    const spanish = makeItem({
      sourceId: 'src-es',
      publisher: 'Publisher ES',
      canonicalUrl: 'https://example.com/es',
      url_hash: 'hash-es',
      title: 'Actualización de mercados',
      summary: 'Los mercados suben tras anuncio',
      cluster_text: 'latest update markets rise after announcement',
      language: 'es',
      translation_applied: true,
      entity_keys: ['markets', 'announcement'],
    });

    const bundle = clusterItems([spanish], 'topic-lang')[0]!;
    expect(bundle.cluster_features.primary_language).toBe('es');
    expect(bundle.cluster_features.translation_applied).toBe(true);
  });

  it('builds canonical enrichment work-items for full analysis + bias-table', () => {
    const bundle = clusterItems([makeItem()], 'topic-enrichment')[0]!;
    const workItems = buildEnrichmentWorkItems(bundle, 1707139999000);

    expect(workItems).toEqual([
      {
        story_id: bundle.story_id,
        topic_id: bundle.topic_id,
        work_type: 'full-analysis',
        summary_hint: bundle.summary_hint ?? bundle.headline,
        requested_at: 1707139999000,
      },
      {
        story_id: bundle.story_id,
        topic_id: bundle.topic_id,
        work_type: 'bias-table',
        summary_hint: bundle.summary_hint ?? bundle.headline,
        requested_at: 1707139999000,
      },
    ]);
  });

  it('skips enrichment work-items for singleton video bundles', () => {
    const bundle = clusterItems([
      makeItem({
        canonicalUrl: 'https://www.today.com/video/source-clip-1',
        url_hash: 'video-hash',
        title: 'Video: source clip',
      }),
    ], 'topic-video')[0]!;

    expect(buildEnrichmentWorkItems(bundle, 1707139999000)).toEqual([]);
  });

  it('covers internal utility branches and similarity helpers', () => {
    expect(clusterItems([], 'topic-empty')).toEqual([]);
    expect(() => clusterItems([], '   ')).toThrow('topicId must be non-empty');

    expect(newsClusterInternal.toBucketStart(undefined)).toBe(0);
    expect(newsClusterInternal.toBucketLabel(0)).toBe('1970-01-01T00');
    expect(newsClusterInternal.fallbackEntityFromTitle('### ???')).toBe('general');

    const item = makeItem({ entity_keys: [], title: 'Plain headline text', cluster_text: undefined, summary: undefined });
    expect(newsClusterInternal.entityKeysForItem(item)).toEqual(['plain']);
    expect(newsClusterInternal.textForSimilarity(item)).toBe('Plain headline text');
    expect(normalizedItemTexts([item])).toEqual(['Plain headline text']);
    expect(clusterHeadlineTexts(newsClusterInternal.toCluster([item])[0]!)).toEqual([
      'Plain headline text',
    ]);

    expect(newsClusterInternal.textSimilarity('same text', 'same text')).toBe(1);
    expect(newsClusterInternal.textSimilarity('alpha beta', 'gamma delta')).toBe(0);
    expect(newsClusterInternal.textSimilarity('!!!', '!!!')).toBe(1);
    expect(newsClusterInternal.textSimilarity('!!!', '???')).toBe(0);

    expect(newsClusterInternal.cosineSimilarity([], [])).toBe(0);
    expect(newsClusterInternal.cosineSimilarity([1], [])).toBe(0);
    expect(newsClusterInternal.cosineSimilarity([], [1])).toBe(0);
    expect(newsClusterInternal.jaccardSetSimilarity(new Set(), new Set(['x']))).toBe(0);
    expect(newsClusterInternal.overlapRatio(new Set(), new Set(['x']))).toBe(0);

    const zeroEmbedding = newsClusterInternal.toEmbedding('');
    expect(zeroEmbedding.every((value) => value === 0)).toBe(true);
    const nonZeroEmbedding = newsClusterInternal.toEmbedding('markets rally update');
    expect(nonZeroEmbedding.some((value) => value !== 0)).toBe(true);

    expect(newsClusterInternal.averageEmbeddings([])).toHaveLength(48);
    expect(newsClusterInternal.averageEmbeddings([new Array(48).fill(0)]).every((v) => v === 0)).toBe(true);
    expect(newsClusterInternal.averageEmbeddings([nonZeroEmbedding]).some((v) => v !== 0)).toBe(true);

    const tieA = makeItem({
      publishedAt: 10,
      url_hash: 'hash-b',
      canonicalUrl: 'https://example.com/tie-b',
      title: 'Zulu title',
      cluster_text: 'zulu title',
      entity_keys: ['shared'],
    });
    const tieB = makeItem({
      publishedAt: 10,
      url_hash: 'hash-a',
      canonicalUrl: 'https://example.com/tie-a',
      title: 'Alpha title',
      cluster_text: 'alpha title',
      entity_keys: ['shared'],
    });

    const tieCluster = newsClusterInternal.toCluster([tieA, tieB]);
    expect(tieCluster[0]?.items.map((entry) => entry.url_hash)).toEqual(['hash-a', 'hash-b']);
    expect(newsClusterInternal.headlineForCluster([tieA, tieB])).toBe('Alpha title');

    const untimed = makeItem({
      publishedAt: undefined,
      canonicalUrl: 'https://example.com/untimed',
      url_hash: 'hash-untimed',
      entity_keys: ['untimed'],
      title: 'Untimed title',
      cluster_text: 'untimed title',
    });

    expect(newsClusterInternal.headlineForCluster([untimed, tieB])).toBe('Alpha title');
    expect(newsClusterInternal.headlineForCluster([])).toBe('Untitled');

    const untimedBundle = clusterItems([untimed], 'topic-untimed')[0]!;
    expect(untimedBundle.sources[0]?.published_at).toBe(0);

    const untimedSibling = makeItem({
      publishedAt: undefined,
      canonicalUrl: 'https://example.com/untimed-2',
      url_hash: 'hash-untimed-2',
      entity_keys: ['untimed'],
      title: 'Untimed sibling',
      cluster_text: 'untimed sibling',
    });

    const untimedCluster = newsClusterInternal.toCluster([untimed, untimedSibling]);
    expect(untimedCluster).toHaveLength(1);
    expect(untimedCluster[0]?.bucketEnd).toBe(3_600_000);

    // Ensure nullish publishedAt fallback branches are exercised in sort logic.
    expect(newsClusterInternal.toCluster([untimed, tieB])).toHaveLength(2);
    expect(newsClusterInternal.collapseNearDuplicates([untimedSibling, tieA])).toHaveLength(2);

    const sortProbe = [
      makeItem({ publishedAt: undefined, title: 'Alpha winter briefing', canonicalUrl: 'https://example.com/probe-u1', url_hash: 'probe-u1', cluster_text: 'alpha winter briefing', entity_keys: ['alpha'] }),
      makeItem({ publishedAt: 10, title: 'Beta energy report', canonicalUrl: 'https://example.com/probe-d10', url_hash: 'probe-d10', cluster_text: 'beta energy report', entity_keys: ['beta'] }),
      makeItem({ publishedAt: undefined, title: 'Gamma market memo', canonicalUrl: 'https://example.com/probe-u2', url_hash: 'probe-u2', cluster_text: 'gamma market memo', entity_keys: ['gamma'] }),
      makeItem({ publishedAt: 5, title: 'Delta policy digest', canonicalUrl: 'https://example.com/probe-d5', url_hash: 'probe-d5', cluster_text: 'delta policy digest', entity_keys: ['delta'] }),
    ];
    expect(newsClusterInternal.collapseNearDuplicates(sortProbe)).toHaveLength(4);
    expect(newsClusterInternal.headlineForCluster(sortProbe)).toBe('Beta energy report');
    expect(
      newsClusterInternal.headlineForCluster([
        makeItem({ publishedAt: 1, title: 'B title', canonicalUrl: 'https://example.com/b-title', url_hash: 'b-title', cluster_text: 'b title', entity_keys: ['bt'] }),
        makeItem({ publishedAt: 1, title: 'A title', canonicalUrl: 'https://example.com/a-title', url_hash: 'a-title', cluster_text: 'a title', entity_keys: ['at'] }),
      ]),
    ).toBe('A title');

    const sources = [
      {
        source_id: 'b',
        publisher: 'B',
        url: 'https://example.com/b',
        url_hash: 'hash-b',
        published_at: 2,
        title: 'B',
      },
      {
        source_id: 'a',
        publisher: 'A',
        url: 'https://example.com/a',
        url_hash: 'hash-a',
        title: 'A',
      },
    ];

    expect(newsClusterInternal.provenanceHash(sources)).toBe(newsClusterInternal.provenanceHash([...sources].reverse()));
    expect(newsClusterInternal.semanticSignature([item])).toMatch(/^[0-9a-f]{8}$/);

    const summaryWithoutEntities = newsClusterInternal.canonicalSummary(
      {
        bucketStart: 1,
        bucketEnd: 1,
        items: [makeItem({ summary: undefined, title: 'bare headline' })],
        entitySet: new Set<string>(),
      },
      'bare headline',
      [],
    );
    expect(sentenceCount(summaryWithoutEntities)).toBe(2);

    const fallbackSummary = newsClusterInternal.canonicalSummary(
      {
        bucketStart: 1,
        bucketEnd: 3_600_001,
        items: [makeItem({ summary: undefined, title: '', publisher: '' } as Partial<NormalizedItem>)],
        entitySet: new Set<string>(),
      } as never,
      '',
      [],
    );
    expect(fallbackSummary).toContain('Story update available.');
    expect(fallbackSummary).toContain('multiple outlets');

    expect(newsClusterInternal.ensureSentence('')).toBe('Story update available.');
    expect(newsClusterInternal.clamp01(Number.NaN)).toBe(0);
    expect(newsClusterInternal.resolvePrimaryLanguage({ bucketStart: 0, bucketEnd: 0, items: [], entitySet: new Set() } as never)).toBe('en');

    const enrichmentBundle = clusterItems([makeItem()], 'topic-enrichment-fallback')[0]!;
    const enrichmentFallback = buildEnrichmentWorkItems(
      {
        ...enrichmentBundle,
        summary_hint: undefined,
      },
      123,
    );
    expect(enrichmentFallback[0]?.summary_hint).toBe(enrichmentBundle.headline);
    expect(enrichmentFallback[1]?.summary_hint).toBe(enrichmentBundle.headline);

    const evidence = newsClusterInternal.buildEvidence({
      bucketStart: 1707134400000,
      bucketEnd: 1707138000000,
      entitySet: new Set(['markets', 'policy']),
      items: [
        makeItem({ sourceId: 'src-a', canonicalUrl: 'https://example.com/e1', url_hash: 'hash-e1', title: 'Markets policy update', cluster_text: 'markets policy update', entity_keys: ['markets', 'policy'] }),
        makeItem({ sourceId: 'src-b', publisher: 'src-b', canonicalUrl: 'https://example.com/e2', url_hash: 'hash-e2', title: 'Policy update impacts markets', cluster_text: 'policy update impacts markets', entity_keys: ['markets', 'policy'] }),
      ],
    } as never);
    expect(evidence.some((entry) => entry.startsWith('keyword_overlap:'))).toBe(true);
    expect(evidence.some((entry) => entry.startsWith('action_match:'))).toBe(true);
    expect(evidence.some((entry) => entry.startsWith('composite_score:'))).toBe(true);
  });
});
