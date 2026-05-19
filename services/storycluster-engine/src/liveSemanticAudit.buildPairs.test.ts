import { describe, expect, it } from 'vitest';
import {
  buildCanonicalSourcePairs,
  classifyCanonicalSourcePairs,
  hasRelatedTopicOnlyPair,
  type LiveSemanticAuditBundleLike,
} from './liveSemanticAudit';

function makeBundle(overrides: Partial<LiveSemanticAuditBundleLike> = {}): LiveSemanticAuditBundleLike {
  return {
    story_id: 'story-1',
    topic_id: 'topic-news',
    headline: 'Markets fall after strike',
    sources: [
      {
        source_id: 'wire-a',
        publisher: 'Wire A',
        url: 'https://example.com/a',
        url_hash: 'hash-a',
        published_at: 100,
        title: 'Markets fall after strike',
      },
      {
        source_id: 'wire-b',
        publisher: 'Wire B',
        url: 'https://example.com/b',
        url_hash: 'hash-b',
        published_at: 110,
        title: 'Investors react to strike',
      },
    ],
    ...overrides,
  };
}

describe('liveSemanticAudit pair building', () => {
  it('builds deterministic canonical pairs from primary sources only', () => {
    const bundle = makeBundle({
      primary_sources: [
        {
          source_id: 'wire-b',
          publisher: 'Wire B',
          url: 'https://example.com/b',
          url_hash: 'hash-b',
          published_at: 110,
          title: 'Investors react to strike',
        },
        {
          source_id: 'wire-a',
          publisher: 'Wire A',
          url: 'https://example.com/a',
          url_hash: 'hash-a',
          published_at: 100,
          title: 'Markets fall after strike',
        },
        {
          source_id: 'wire-c',
          publisher: 'Wire C',
          url: 'https://example.com/c',
          url_hash: 'hash-c',
          published_at: 112,
          title: 'Stocks slide after attack',
        },
      ],
      secondary_assets: [
        {
          source_id: 'wire-a-video',
          publisher: 'Wire A',
          url: 'https://example.com/video',
          url_hash: 'hash-video',
          published_at: 101,
          title: 'Video recap',
        },
      ],
    });

    const textBySource = new Map([
      ['wire-a:hash-a', 'Alpha text'],
      ['wire-b:hash-b', 'Bravo text'],
      ['wire-c:hash-c', 'Charlie text'],
    ]);

    const pairs = buildCanonicalSourcePairs(bundle, (source) => textBySource.get(`${source.source_id}:${source.url_hash}`) ?? '');
    expect(pairs.map((pair) => pair.pair_id)).toEqual([
      'story-1::wire-a:hash-a::wire-b:hash-b',
      'story-1::wire-a:hash-a::wire-c:hash-c',
      'story-1::wire-b:hash-b::wire-c:hash-c',
    ]);
    expect(pairs.every((pair) => pair.left.source_id !== 'wire-a-video' && pair.right.source_id !== 'wire-a-video')).toBe(true);
  });

  it('rejects missing canonical source text and empty pair requests', async () => {
    expect(() => buildCanonicalSourcePairs(makeBundle(), () => '   ')).toThrow(
      'missing audit text for canonical source 0 (wire-a) in story-1',
    );

    await expect(classifyCanonicalSourcePairs([], { apiKey: 'test-key' })).resolves.toEqual([]);
  });

  it('detects related-topic failures', () => {
    expect(hasRelatedTopicOnlyPair([
      {
        pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
        label: 'same_incident',
        confidence: 0.9,
        rationale: 'Good pair.',
      },
      {
        pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
        label: 'related_topic_only',
        confidence: 0.88,
        rationale: 'Broad topic overlap only.',
      },
    ])).toBe(true);
  });

  it('labels exact duplicate source URLs without remote classification', async () => {
    const bundle = makeBundle({
      sources: [
        {
          source_id: 'ap-politics',
          publisher: 'AP Politics',
          url: 'https://apnews.com/article/greenland-us-landry-visit-nielsen-bbece2f899116788fe45525dcfe7d030',
          url_hash: 'c9346c73',
          published_at: 100,
          title: "Greenland's prime minister tells Trump's envoy self-determination cannot be negotiated",
        },
        {
          source_id: 'ap-topnews',
          publisher: 'AP Top News',
          url: 'https://apnews.com/article/greenland-us-landry-visit-nielsen-bbece2f899116788fe45525dcfe7d030',
          url_hash: 'c9346c73',
          published_at: 101,
          title: "Greenland's prime minister tells Trump's envoy self-determination cannot be negotiated",
        },
      ],
    });
    const pairs = buildCanonicalSourcePairs(bundle, () => 'Same AP article text.');

    const results = await classifyCanonicalSourcePairs(pairs, { apiKey: 'unused-for-exact-duplicates' });

    expect(results).toEqual([{
      pair_id: 'story-1::ap-politics:c9346c73::ap-topnews:c9346c73',
      label: 'duplicate',
      confidence: 1,
      rationale: 'Exact duplicate source URL or URL hash across publisher feeds.',
    }]);
  });
});
