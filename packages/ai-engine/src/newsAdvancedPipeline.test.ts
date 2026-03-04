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
      makeTuple('w2', 0.8, 1450, 'review', 'ent-a', undefined),
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
});
