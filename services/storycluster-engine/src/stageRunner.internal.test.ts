import { describe, expect, it } from 'vitest';
import { stageRunnerInternal } from './stageRunner';

describe('stageRunnerInternal', () => {
  it('normalizes tokens and classifies document titles', () => {
    expect(stageRunnerInternal.normalizeToken('  A!  B?  ')).toBe('a b');

    expect(stageRunnerInternal.classifyDocument('Breaking alert now')).toBe('breaking');
    expect(stageRunnerInternal.classifyDocument('Analysis: market impacts')).toBe('analysis');
    expect(stageRunnerInternal.classifyDocument('Opinion piece from desk')).toBe('opinion');
    expect(stageRunnerInternal.classifyDocument('General roundup')).toBe('general');
  });

  it('resolves language hints and lexical fallback', () => {
    expect(
      stageRunnerInternal.resolveLanguage({
        doc_id: 'd1',
        source_id: 's1',
        title: 'headline',
        published_at: 1,
        url: 'https://example.com',
        language_hint: 'DE',
      }),
    ).toBe('de');

    expect(
      stageRunnerInternal.resolveLanguage({
        doc_id: 'd2',
        source_id: 's1',
        title: 'Crise à Paris',
        published_at: 1,
        url: 'https://example.com',
      }),
    ).toBe('fr');

    expect(
      stageRunnerInternal.resolveLanguage({
        doc_id: 'd3',
        source_id: 's1',
        title: 'Default english title',
        published_at: 1,
        url: 'https://example.com',
      }),
    ).toBe('en');
  });

  it('normalizes request documents, trims optional fields, and handles reference-now modes', () => {
    const normalizedExplicit = stageRunnerInternal.normalizeRequest(
      {
        topic_id: 'topic-x',
        documents: [
          {
            doc_id: 'b',
            source_id: 's2',
            title: '  Story B  ',
            body: '  body b  ',
            language_hint: '  pt  ',
            published_at: 20,
            url: 'https://example.com/b',
          },
          {
            doc_id: 'a',
            source_id: 's1',
            title: 'Story A',
            published_at: 10,
            url: 'https://example.com/a',
          },
        ],
        reference_now_ms: 1234,
      },
      9999,
    );

    expect(normalizedExplicit.referenceNowMs).toBe(1234);
    expect(normalizedExplicit.documents.map((doc) => doc.doc_id)).toEqual(['a', 'b']);
    expect(normalizedExplicit.documents[1]?.body).toBe('body b');
    expect(normalizedExplicit.documents[1]?.language_hint).toBe('pt');

    const normalizedFallback = stageRunnerInternal.normalizeRequest(
      {
        topic_id: 'topic-x',
        documents: [
          {
            doc_id: 'c',
            source_id: 's3',
            title: 'Story C',
            published_at: 42,
            url: 'https://example.com/c',
          },
        ],
        reference_now_ms: 0,
      },
      5,
    );

    expect(normalizedFallback.referenceNowMs).toBe(42);

    const normalizedEmpty = stageRunnerInternal.normalizeRequest(
      {
        topic_id: 'topic-x',
        documents: [],
        reference_now_ms: Number.NaN,
      },
      77,
    );
    expect(normalizedEmpty.referenceNowMs).toBe(77);
  });

  it('normalizes clamp/hash/telemetry helpers and stage count selectors', () => {
    expect(stageRunnerInternal.clamp01(Number.NaN)).toBe(0);
    expect(stageRunnerInternal.clamp01(-1)).toBe(0);
    expect(stageRunnerInternal.clamp01(2)).toBe(1);
    expect(stageRunnerInternal.clamp01(0.23456)).toBe(0.235);

    expect(stageRunnerInternal.hashToHex('abc')).toBe(stageRunnerInternal.hashToHex('abc'));

    const bareState = {
      topicId: 'topic-x',
      referenceNowMs: 10,
      documents: [],
      clusters: [{ key: 'k', docs: [] }],
      bundles: [
        {
          story_id: 'story-1',
          topic_id: 'topic-x',
          headline: 'h',
          summary_hint: 's',
          cluster_window_start: 1,
          cluster_window_end: 2,
          source_doc_ids: [],
          stage_version: 'storycluster-stage-runner-v1' as const,
        },
      ],
    };

    expect(stageRunnerInternal.stageInputCount('summarize_publish_payloads', bareState)).toBe(1);
    expect(stageRunnerInternal.stageInputCount('hybrid_scoring', bareState)).toBe(0);
    expect(stageRunnerInternal.stageOutputCount('dynamic_cluster_assignment', bareState)).toBe(1);
    expect(stageRunnerInternal.stageOutputCount('summarize_publish_payloads', bareState)).toBe(1);
    expect(stageRunnerInternal.stageOutputCount('language_translation', bareState)).toBe(0);

    const emptyTelemetry = stageRunnerInternal.buildTelemetry('topic-x', 0, [], 5000);
    expect(emptyTelemetry.total_latency_ms).toBe(0);
    expect(emptyTelemetry.generated_at_ms).toBe(5000);
    expect(emptyTelemetry.stage_count).toBe(0);
  });
});
