import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryBundleInputSchema } from '@vh/data-model';
import { clusterItems, newsClusterInternal } from '../newsCluster';
import type { NormalizedItem } from '../newsTypes';

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceId: 'src-a',
    publisher: 'src-a',
    url: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    title: 'Markets rally after policy update',
    publishedAt: 1707134400000,
    summary: 'Summary',
    author: 'Author',
    url_hash: 'hash-a',
    entity_keys: ['markets', 'policy'],
    ...overrides,
  };
}

describe('newsCluster', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-05T14:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clusters multi-source items by entity overlap and time bucket', () => {
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
    expect(bundle.sources).toHaveLength(2);
    expect(bundle.provenance_hash).toMatch(/^[0-9a-f]{8}$/);

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
        publishedAt: 1707134700000,
      }),
      makeItem({
        canonicalUrl: 'https://example.com/d',
        url_hash: 'hash-d',
        entity_keys: ['markets'],
        title: 'Markets close higher overnight',
        publishedAt: 1707145200000,
      }),
    ];

    const bundles = clusterItems(items, 'topic-mixed');
    expect(bundles).toHaveLength(3);
  });

  it('generates stable story_id regardless of input order', () => {
    const first = makeItem({
      canonicalUrl: 'https://example.com/first',
      url_hash: 'hash-first',
      publishedAt: 1707134400000,
      entity_keys: ['alpha', 'shared'],
      title: 'Alpha shared story',
    });
    const second = makeItem({
      canonicalUrl: 'https://example.com/second',
      url_hash: 'hash-second',
      publishedAt: 1707135000000,
      entity_keys: ['shared', 'beta'],
      title: 'Beta shared story',
    });

    const forward = clusterItems([first, second], 'topic-stable')[0]!;
    const reverse = clusterItems([second, first], 'topic-stable')[0]!;

    expect(forward.story_id).toBe(reverse.story_id);
    expect(forward.provenance_hash).toBe(reverse.provenance_hash);
  });

  it('covers cluster internals and error branches', () => {
    expect(clusterItems([], 'topic-empty')).toEqual([]);
    expect(() => clusterItems([], '   ')).toThrow('topicId must be non-empty');

    expect(newsClusterInternal.toBucketStart(undefined)).toBe(0);
    expect(newsClusterInternal.toBucketLabel(0)).toBe('1970-01-01T00');
    expect(newsClusterInternal.fallbackEntityFromTitle('### ???')).toBe('general');

    const item = makeItem({ entity_keys: [], title: 'Plain headline text' });
    expect(newsClusterInternal.entityKeysForItem(item)).toEqual(['plain']);

    const tieA = makeItem({
      publishedAt: 10,
      url_hash: 'hash-b',
      canonicalUrl: 'https://example.com/tie-b',
      title: 'Zulu title',
      entity_keys: ['shared'],
    });
    const tieB = makeItem({
      publishedAt: 10,
      url_hash: 'hash-a',
      canonicalUrl: 'https://example.com/tie-a',
      title: 'Alpha title',
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
    });

    expect(newsClusterInternal.headlineForCluster([untimed, tieB])).toBe('Alpha title');
    expect(newsClusterInternal.headlineForCluster([tieB, untimed])).toBe('Alpha title');
    expect(newsClusterInternal.headlineForCluster([])).toBe('Untitled');

    const untimedBundle = clusterItems([untimed], 'topic-untimed')[0]!;
    expect(untimedBundle.sources[0]?.published_at).toBe(0);

    const untimedSibling = makeItem({
      publishedAt: undefined,
      canonicalUrl: 'https://example.com/untimed-2',
      url_hash: 'hash-untimed-2',
      entity_keys: ['untimed'],
      title: 'Untimed sibling',
    });

    const untimedCluster = newsClusterInternal.toCluster([untimed, untimedSibling]);
    expect(untimedCluster).toHaveLength(1);
    expect(untimedCluster[0]?.bucketEnd).toBe(3_600_000);

    // Ensure nullish publishedAt fallback branches are exercised in sort logic.
    expect(newsClusterInternal.toCluster([untimed, tieB])).toHaveLength(2);

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
  });
});
