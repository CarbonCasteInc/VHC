import { describe, expect, it } from 'vitest';
import {
  buildStoryAdvancedArtifact,
  buildStoryAdvancedArtifacts,
  newsAdvancedPipelineInternal,
  type StoryMETuple,
  type StoryTemporalAnchor,
} from './newsAdvancedPipeline';
import type { StoryBundle } from './newsTypes';

const BASE_BUNDLE: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-pr6-1',
  topic_id: 'topic-pr6',
  headline: 'Canada announces sanctions after port attack today',
  summary_hint: 'Officials said protests continued while a relief deal was signed.',
  cluster_window_start: 1_707_000_000_000,
  cluster_window_end: 1_707_003_600_000,
  sources: [
    {
      source_id: 'src-a',
      publisher: 'Publisher A',
      url: 'https://example.com/a',
      url_hash: 'hash-a',
      published_at: 1_707_000_100_000,
      title: 'Canada announces sanctions on shipping firms today',
    },
    {
      source_id: 'src-b',
      publisher: 'Publisher B',
      url: 'https://example.com/b',
      url_hash: 'hash-b',
      published_at: 1_707_001_800_000,
      title: 'EU protests escalate after port attack yesterday',
    },
    {
      source_id: 'src-c',
      publisher: 'Publisher C',
      url: 'https://example.com/c',
      url_hash: 'hash-c',
      published_at: 1_707_003_500_000,
      title: 'UN signs 2026-02-05 relief deal for ceasefire',
    },
  ],
  cluster_features: {
    entity_keys: ['canada', 'eu', 'port', 'ceasefire'],
    time_bucket: '2024-02-06T09',
    semantic_signature: 'abc12345',
    coverage_score: 0.8,
    velocity_score: 0.55,
    confidence_score: 0.75,
    primary_language: 'en',
    translation_applied: false,
  },
  provenance_hash: 'deadbeef',
  created_at: 1_707_003_700_000,
};

function makeTuple(
  id: string,
  confidence: number,
  normalizedAt: number,
  adjudication: 'accepted' | 'review' | 'rejected',
  subject = 'ent-a',
  object: string | undefined = 'ent-b',
): StoryMETuple {
  const temporal: StoryTemporalAnchor = {
    normalized_at: normalizedAt,
    granularity: 'hour',
    source: 'published_at',
  };

  return {
    tuple_id: id,
    story_id: 'story-pr6-1',
    source_url_hash: `hash-${id}`,
    subject_entity_id: subject,
    object_entity_id: object,
    predicate: 'announce',
    confidence,
    adjudication,
    temporal,
    gdelt: {
      code: '010',
      label: 'Make public statement',
      confidence,
      impact_score: 0.4,
    },
  };
}

describe('newsAdvancedPipeline', () => {
  it('builds deterministic PR6 artifact output with ME tuples, grounding, drift, and timeline graph', () => {
    const first = buildStoryAdvancedArtifact(BASE_BUNDLE, {
      referenceNowMs: 1_707_010_000_000,
      refinementPeriodMs: 1_800_000,
      maxTuples: 10,
    });

    const second = buildStoryAdvancedArtifact(BASE_BUNDLE, {
      referenceNowMs: 1_707_010_000_000,
      refinementPeriodMs: 1_800_000,
      maxTuples: 10,
    });

    const orderProbe = buildStoryAdvancedArtifact(
      {
        ...BASE_BUNDLE,
        sources: [...BASE_BUNDLE.sources].reverse(),
      },
      {
        referenceNowMs: 1_707_010_000_000,
        refinementPeriodMs: 1_800_000,
        maxTuples: 10,
      },
    );

    expect(first).toEqual(second);
    expect(first).toEqual(orderProbe);
    expect(first.schemaVersion).toBe('story-advanced-v1');
    expect(first.story_id).toBe(BASE_BUNDLE.story_id);
    expect(first.topic_id).toBe(BASE_BUNDLE.topic_id);
    expect(first.me_tuples.length).toBeGreaterThan(0);
    expect(first.entity_links.length).toBeGreaterThan(0);
    expect(first.gdelt_grounding.length).toBeGreaterThan(0);
    expect(first.impact_blend.blended_score).toBeGreaterThanOrEqual(0);
    expect(first.impact_blend.blended_score).toBeLessThanOrEqual(1);
    expect(first.drift_metrics.refinement_iterations).toBeGreaterThan(0);
    expect(first.timeline_graph.nodes.length).toBeGreaterThan(0);
    expect(first.timeline_graph.sub_events.length).toBeGreaterThan(0);
  });

  it('normalizes temporal anchors from ISO date, relative terms, publishedAt, and fallback cluster window', () => {
    const iso = newsAdvancedPipelineInternal.normalizeTemporalAnchor(
      'Talks resume on 2026-02-05 after pause',
      undefined,
      1_700_000_000_000,
      123,
    );
    expect(iso.granularity).toBe('day');
    expect(iso.source).toBe('title');
    expect(iso.expression).toBe('2026-02-05');

    const relative = newsAdvancedPipelineInternal.normalizeTemporalAnchor(
      'Leaders met yesterday to discuss aid',
      undefined,
      1_700_000_000_000,
      123,
    );
    expect(relative.granularity).toBe('day');
    expect(relative.expression).toBe('yesterday');

    const published = newsAdvancedPipelineInternal.normalizeTemporalAnchor(
      'No explicit temporal phrase',
      999,
      1_700_000_000_000,
      123,
    );
    expect(published.source).toBe('published_at');
    expect(published.normalized_at).toBe(999);

    const fallback = newsAdvancedPipelineInternal.normalizeTemporalAnchor(
      'No explicit temporal phrase',
      undefined,
      1_700_000_000_000,
      456,
    );
    expect(fallback.source).toBe('cluster_window');
    expect(fallback.normalized_at).toBe(456);
  });

  it('resolves action profiles for matched and unmatched text', () => {
    expect(newsAdvancedPipelineInternal.resolveActionProfile('forces attack border area').predicate).toBe('attack');
    expect(newsAdvancedPipelineInternal.resolveActionProfile('summary with no keyword').predicate).toBe('report');
  });

  it('applies rerank/adjudication gates and keeps at least one review tuple when all scores are low', () => {
    const tupleInputs = [
      {
        tuple_id: 'a',
        confidence: 0.12,
        baseImpact: 0.2,
        source_url_hash: 'hash-a',
        subject_entity_id: 'ent-a',
        predicate: 'report',
        temporal: {
          normalized_at: 10,
          granularity: 'hour',
          source: 'published_at',
        } as StoryTemporalAnchor,
        gdelt: {
          code: '010',
          label: 'Make public statement',
          confidence: 0.2,
          impact_score: 0.2,
        },
      },
      {
        tuple_id: 'b',
        confidence: 0.11,
        baseImpact: 0.2,
        source_url_hash: 'hash-b',
        subject_entity_id: 'ent-b',
        predicate: 'report',
        temporal: {
          normalized_at: 11,
          granularity: 'hour',
          source: 'published_at',
        } as StoryTemporalAnchor,
        gdelt: {
          code: '010',
          label: 'Make public statement',
          confidence: 0.2,
          impact_score: 0.2,
        },
      },
    ];

    const reranked = newsAdvancedPipelineInternal.rerankAndAdjudicateTuples(tupleInputs, 'story-low', 5);
    expect(reranked[0]?.adjudication).toBe('review');
    expect(reranked[1]?.adjudication).toBe('rejected');
  });

  it('computes drift metrics for empty, single-window, and multi-window tuple distributions', () => {
    const empty = newsAdvancedPipelineInternal.computeDriftMetrics([], 1000, 2000, 100);
    expect(empty.composite).toBe(0);
    expect(empty.refinement_iterations).toBe(0);

    const single = newsAdvancedPipelineInternal.computeDriftMetrics(
      [makeTuple('t1', 0.9, 1100, 'accepted')],
      1000,
      2000,
      500,
    );
    expect(single.refinement_iterations).toBe(1);
    expect(single.entity_drift).toBe(0);

    const multi = newsAdvancedPipelineInternal.computeDriftMetrics(
      [
        makeTuple('t1', 0.9, 1100, 'accepted', 'ent-a', 'ent-b'),
        makeTuple('t2', 0.8, 1700, 'review', 'ent-c', 'ent-d'),
      ],
      1000,
      2000,
      300,
    );
    expect(multi.refinement_iterations).toBeGreaterThan(1);
    expect(multi.composite).toBeGreaterThan(0);
  });

  it('builds timeline graph with fallback node path and shared-entity edges', () => {
    const fallbackGraph = newsAdvancedPipelineInternal.buildTimelineGraph(
      [makeTuple('only', 0.2, 1200, 'rejected')],
      1000,
      200,
    );
    expect(fallbackGraph.nodes).toHaveLength(1);
    expect(fallbackGraph.edges).toHaveLength(0);

    const sharedGraph = newsAdvancedPipelineInternal.buildTimelineGraph(
      [
        makeTuple('n1', 0.9, 1000, 'accepted', 'ent-a', 'ent-b'),
        makeTuple('n2', 0.85, 1100, 'accepted', 'ent-a', 'ent-c'),
      ],
      900,
      200,
    );

    expect(sharedGraph.nodes).toHaveLength(2);
    expect(sharedGraph.edges.some((edge) => edge.relation === 'precedes')).toBe(true);
    expect(sharedGraph.edges.some((edge) => edge.relation === 'shared_entity')).toBe(true);
  });

  it('normalizes options and token helpers, and exercises entity candidate fallback path', () => {
    const normalized = newsAdvancedPipelineInternal.normalizeOptions(BASE_BUNDLE, {
      referenceNowMs: Number.NaN,
      refinementPeriodMs: 0,
      maxTuples: -1,
    });
    expect(normalized.referenceNowMs).toBe(BASE_BUNDLE.cluster_window_end);
    expect(normalized.refinementPeriodMs).toBe(30 * 60 * 1000);
    expect(normalized.maxTuples).toBe(24);

    const normalizedValid = newsAdvancedPipelineInternal.normalizeOptions(BASE_BUNDLE, {
      referenceNowMs: 1234.8,
      refinementPeriodMs: 120000.2,
      maxTuples: 2.8,
    });
    expect(normalizedValid.referenceNowMs).toBe(1234);
    expect(normalizedValid.refinementPeriodMs).toBe(120000);
    expect(normalizedValid.maxTuples).toBe(2);

    expect(newsAdvancedPipelineInternal.normalizeToken('  A! B?  ')).toBe('a b');
    expect(newsAdvancedPipelineInternal.tokenize('the rapid response force')).toEqual(['rapid', 'response', 'force']);
    expect(newsAdvancedPipelineInternal.clamp01(Number.NaN)).toBe(0);
    expect(newsAdvancedPipelineInternal.roundMetric(2)).toBe(1);

    expect(newsAdvancedPipelineInternal.jaccardDistance(new Set(), new Set())).toBe(0);
    expect(newsAdvancedPipelineInternal.jaccardDistance(new Set(['x']), new Set())).toBe(1);
    expect(newsAdvancedPipelineInternal.jaccardDistance(new Set(['x']), new Set(['x']))).toBe(0);

    const tinyBundle: StoryBundle = {
      ...BASE_BUNDLE,
      story_id: 'story-pr6-tiny',
      headline: 'Hi',
      summary_hint: undefined,
      cluster_features: {
        ...BASE_BUNDLE.cluster_features,
        entity_keys: [],
      },
      sources: [
        {
          ...BASE_BUNDLE.sources[0]!,
          source_id: 'src-z',
          url_hash: 'hash-z',
          title: 'ok',
        },
      ],
    };

    expect(newsAdvancedPipelineInternal.extractEntityCandidates(tinyBundle)).toEqual(['General']);
  });

  it('builds refinement windows and sorted artifact arrays', () => {
    const tuples = [
      makeTuple('w1', 0.9, 1000, 'accepted', 'ent-a', 'ent-b'),
      makeTuple('w2', 0.8, 1450, 'review', 'ent-a', ''),
      makeTuple('w3', 0.7, 2000, 'accepted', 'ent-c', 'ent-d'),
    ];

    const windows = newsAdvancedPipelineInternal.buildRefinementWindows(tuples, 1000, 400);
    expect(windows).toHaveLength(3);
    expect(windows[0]?.index).toBe(0);

    const artifacts = buildStoryAdvancedArtifacts([
      { ...BASE_BUNDLE, story_id: 'story-z' },
      { ...BASE_BUNDLE, story_id: 'story-a' },
    ]);

    expect(artifacts.map((artifact) => artifact.story_id)).toEqual(['story-a', 'story-z']);
  });

  it('covers additional temporal branches including tomorrow/tonight/week offsets and invalid ISO fallback', () => {
    const tomorrow = newsAdvancedPipelineInternal.normalizeTemporalAnchor('Talks continue tomorrow', undefined, 10_000, 5);
    expect(tomorrow.expression).toBe('tomorrow');
    expect(tomorrow.normalized_at).toBe(10_000 + 86_400_000);

    const tonight = newsAdvancedPipelineInternal.normalizeTemporalAnchor('Officials speak tonight', undefined, 10_000, 5);
    expect(tonight.expression).toBe('tonight');
    expect(tonight.source).toBe('title');

    const lastWeek = newsAdvancedPipelineInternal.normalizeTemporalAnchor('Violence declined last week', undefined, 10_000, 5);
    expect(lastWeek.expression).toBe('last week');

    const nextWeek = newsAdvancedPipelineInternal.normalizeTemporalAnchor('Talks resume next week', undefined, 10_000, 5);
    expect(nextWeek.expression).toBe('next week');

    const invalidIsoFallback = newsAdvancedPipelineInternal.normalizeTemporalAnchor(
      'Update on 2026-99-40 expected',
      777,
      10_000,
      5,
    );
    expect(invalidIsoFallback.source).toBe('published_at');
    expect(invalidIsoFallback.normalized_at).toBe(777);
  });

  it('covers entity link dedupe/fallback and tuple input fallback branches', () => {
    const fallbackCanonicalLinks = newsAdvancedPipelineInternal.buildEntityLinks(['the']);
    expect(fallbackCanonicalLinks[0]?.canonical_label).toBe('General');

    const dedupedLinks = newsAdvancedPipelineInternal.buildEntityLinks([
      '',
      '***',
      'United States',
      'united-states',
      'United states',
    ]);
    expect(dedupedLinks).toHaveLength(1);
    expect(dedupedLinks[0]?.support_count).toBe(3);

    const emptyLinks = newsAdvancedPipelineInternal.buildEntityLinks(['', '***']);
    expect(emptyLinks).toEqual([]);

    expect(newsAdvancedPipelineInternal.findMentionedEntityIds('united states confirms', dedupedLinks)).toEqual([
      dedupedLinks[0]!.entity_id,
    ]);
    expect(newsAdvancedPipelineInternal.findMentionedEntityIds('no overlap here', dedupedLinks)).toEqual([
      dedupedLinks[0]!.entity_id,
    ]);
    expect(newsAdvancedPipelineInternal.findMentionedEntityIds('no overlap here', [])).toEqual([]);

    const fallbackTupleBundle: StoryBundle = {
      ...BASE_BUNDLE,
      story_id: 'story-pr6-fallback-tuple',
      summary_hint: undefined,
      cluster_features: {
        ...BASE_BUNDLE.cluster_features,
        entity_keys: [],
      },
      sources: [
        {
          ...BASE_BUNDLE.sources[0]!,
          source_id: 'fallback-with-published',
          url_hash: 'hash-fallback-with-published',
          title: 'brief update',
          published_at: 1_111,
        },
        {
          ...BASE_BUNDLE.sources[0]!,
          source_id: 'fallback-no-published',
          url_hash: 'hash-fallback-no-published',
          title: 'brief update',
          published_at: undefined,
        },
      ],
    };

    const tupleInputs = newsAdvancedPipelineInternal.buildInitialTupleInputs(fallbackTupleBundle, [], {
      referenceNowMs: 100,
      refinementPeriodMs: 60_000,
      maxTuples: 4,
    });

    const tupleInputsWithLinks = newsAdvancedPipelineInternal.buildInitialTupleInputs(
      fallbackTupleBundle,
      dedupedLinks,
      {
        referenceNowMs: 100,
        refinementPeriodMs: 60_000,
        maxTuples: 4,
      },
    );

    const mentionTupleBundle: StoryBundle = {
      ...fallbackTupleBundle,
      story_id: 'story-pr6-mentions',
      sources: [
        {
          ...fallbackTupleBundle.sources[0]!,
          source_id: 'mention-source',
          url_hash: 'hash-mention-source',
          title: 'United States confirms update',
          published_at: 2_222,
        },
      ],
    };

    const tupleInputsWithMentions = newsAdvancedPipelineInternal.buildInitialTupleInputs(
      mentionTupleBundle,
      dedupedLinks,
      {
        referenceNowMs: 100,
        refinementPeriodMs: 60_000,
        maxTuples: 4,
      },
    );

    const byHash = new Map(tupleInputs.map((tuple) => [tuple.source_url_hash, tuple]));

    expect(tupleInputs).toHaveLength(2);
    expect(tupleInputs[0]?.subject_entity_id).toBe('ent-general');
    expect(tupleInputs[0]?.object_entity_id).toBeUndefined();
    expect(tupleInputsWithLinks[0]?.subject_entity_id).toBe(dedupedLinks[0]?.entity_id);
    expect(tupleInputsWithMentions[0]?.subject_entity_id).toBe(dedupedLinks[0]?.entity_id);
    expect(byHash.get('hash-fallback-with-published')?.temporal.source).toBe('published_at');
    expect(byHash.get('hash-fallback-no-published')?.temporal.source).toBe('cluster_window');
  });

  it('covers rerank tie-break, gdelt aggregation, and impact blend empty/non-empty branches', () => {
    const tupleInputs = [
      {
        tuple_id: 'b',
        confidence: 0.72,
        baseImpact: 0.2,
        source_url_hash: 'hash-b',
        subject_entity_id: 'ent-b',
        predicate: 'report',
        temporal: {
          normalized_at: 12,
          granularity: 'hour',
          source: 'published_at',
        } as StoryTemporalAnchor,
        gdelt: {
          code: '010',
          label: 'Make public statement',
          confidence: 0.5,
          impact_score: 0.2,
        },
      },
      {
        tuple_id: 'a',
        confidence: 0.72,
        baseImpact: 0.2,
        source_url_hash: 'hash-a',
        subject_entity_id: 'ent-a',
        predicate: 'report',
        temporal: {
          normalized_at: 11,
          granularity: 'hour',
          source: 'published_at',
        } as StoryTemporalAnchor,
        gdelt: {
          code: '010',
          label: 'Make public statement',
          confidence: 0.5,
          impact_score: 0.2,
        },
      },
      {
        tuple_id: 'c',
        confidence: 0.5,
        baseImpact: 0.2,
        source_url_hash: 'hash-c',
        subject_entity_id: 'ent-c',
        predicate: 'report',
        temporal: {
          normalized_at: 13,
          granularity: 'hour',
          source: 'published_at',
        } as StoryTemporalAnchor,
        gdelt: {
          code: '190',
          label: 'Use conventional military force',
          confidence: 0.6,
          impact_score: 0.7,
        },
      },
      {
        tuple_id: 'd',
        confidence: 0.49,
        baseImpact: 0.2,
        source_url_hash: 'hash-d',
        subject_entity_id: 'ent-d',
        predicate: 'report',
        temporal: {
          normalized_at: 14,
          granularity: 'hour',
          source: 'published_at',
        } as StoryTemporalAnchor,
        gdelt: {
          code: '010',
          label: 'Make public statement',
          confidence: 0.4,
          impact_score: 0.3,
        },
      },
    ];

    const reranked = newsAdvancedPipelineInternal.rerankAndAdjudicateTuples(tupleInputs, 'story-pr6-rank', 8);
    expect(reranked.map((tuple) => tuple.tuple_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(reranked.map((tuple) => tuple.adjudication)).toEqual(['accepted', 'accepted', 'review', 'rejected']);

    const gdeltGrounding = newsAdvancedPipelineInternal.buildGdeltGrounding(reranked);
    expect(gdeltGrounding[0]?.code).toBe('010');
    expect(gdeltGrounding[0]?.support_count).toBeGreaterThan(gdeltGrounding[1]?.support_count ?? 0);

    const emptyBlend = newsAdvancedPipelineInternal.buildImpactBlend(BASE_BUNDLE, [], []);
    expect(emptyBlend.components.gdelt_signal).toBe(0);
    expect(emptyBlend.components.adjudication_signal).toBe(0);

    const mixedBlend = newsAdvancedPipelineInternal.buildImpactBlend(BASE_BUNDLE, reranked, gdeltGrounding);
    expect(mixedBlend.blended_score).toBeGreaterThan(0);
  });

  it('covers normalize options non-finite cluster end and timeline/refinement same-window branches', () => {
    const invalidWindowBundle = {
      ...BASE_BUNDLE,
      cluster_window_end: Number.NaN,
    } as unknown as StoryBundle;

    const normalized = newsAdvancedPipelineInternal.normalizeOptions(invalidWindowBundle, {
      referenceNowMs: Number.NaN,
      refinementPeriodMs: Number.NaN,
      maxTuples: Number.NaN,
    });
    expect(normalized.referenceNowMs).toBe(0);

    const sameWindowRefinement = newsAdvancedPipelineInternal.buildRefinementWindows(
      [
        makeTuple('rw-1', 0.9, 1_000, 'accepted', 'ent-a', 'ent-b'),
        makeTuple('rw-2', 0.8, 1_100, 'review', 'ent-a', ''),
      ],
      900,
      500,
    );
    expect(sameWindowRefinement).toHaveLength(1);
    expect(sameWindowRefinement[0]?.tupleCount).toBe(2);

    const tieTimeline = newsAdvancedPipelineInternal.buildTimelineGraph(
      [
        makeTuple('tb', 0.8, 1_000, 'accepted', '', ''),
        makeTuple('ta', 0.7, 1_000, 'accepted', '', ''),
      ],
      900,
      500,
    );

    expect(tieTimeline.nodes.map((node) => node.tuple_id)).toEqual(['ta', 'tb']);
    expect(tieTimeline.nodes.every((node) => node.label === 'announce')).toBe(true);
    expect(tieTimeline.sub_events[0]?.dominant_entity_id).toBe('ent-general');
  });
});
