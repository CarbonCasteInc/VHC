import { describe, expect, it } from 'vitest';
import {
  STORYCLUSTER_STAGE_SEQUENCE,
  StoryClusterStageError,
  type StoryClusterInputDocument,
} from './contracts';
import { runStoryClusterStagePipeline } from './stageRunner';

const BASE_DOCS: StoryClusterInputDocument[] = [
  {
    doc_id: 'doc-1',
    source_id: 'wire-a',
    title: 'Breaking: Port attack triggers alerts',
    published_at: 1_709_000_000_000,
    url: 'https://example.com/doc-1',
  },
  {
    doc_id: 'doc-2',
    source_id: 'wire-a',
    title: 'Breaking: Port attack triggers alerts',
    published_at: 1_709_000_000_500,
    url: 'https://example.com/doc-2',
  },
  {
    doc_id: 'doc-3',
    source_id: 'wire-b',
    title: 'Analysis: Supply chain consequences emerge',
    published_at: 1_709_000_010_000,
    url: 'https://example.com/doc-3',
  },
  {
    doc_id: 'doc-4',
    source_id: 'wire-c',
    title: 'Opinion: Officials respond à la crise',
    published_at: 1_709_000_020_000,
    url: 'https://example.com/doc-4',
  },
  {
    doc_id: 'doc-5',
    source_id: 'wire-d',
    title: 'General update from agencies overnight',
    published_at: 1_709_000_030_000,
    url: 'https://example.com/doc-5',
  },
  {
    doc_id: 'doc-6',
    source_id: 'wire-e',
    title: 'General bulletin from agencies overnight',
    published_at: 1_709_000_040_000,
    url: 'https://example.com/doc-6',
  },
];

function makeClock(start = 1_709_001_000_000): () => number {
  let tick = start;
  return () => {
    tick += 5;
    return tick;
  };
}

describe('runStoryClusterStagePipeline', () => {
  it('runs all mandatory stages and emits deterministic telemetry envelope', () => {
    const response = runStoryClusterStagePipeline(
      {
        topic_id: 'topic-security',
        documents: BASE_DOCS,
        reference_now_ms: 1_709_000_050_000,
      },
      {
        clock: makeClock(),
      },
    );

    expect(response.telemetry.stage_count).toBe(STORYCLUSTER_STAGE_SEQUENCE.length);
    expect(response.telemetry.stages.map((stage) => stage.stage_id)).toEqual(STORYCLUSTER_STAGE_SEQUENCE);
    expect(response.telemetry.stages.every((stage) => stage.status === 'ok')).toBe(true);
    expect(response.telemetry.request_doc_count).toBe(BASE_DOCS.length);

    const dedupeStage = response.telemetry.stages.find(
      (stage) => stage.stage_id === 'near_duplicate_collapse',
    );
    expect(dedupeStage?.input_count).toBe(6);
    expect(dedupeStage?.output_count).toBe(5);

    expect(response.bundles.length).toBeGreaterThan(0);
    expect(response.bundles.every((bundle) => bundle.stage_version === 'storycluster-stage-runner-v1')).toBe(true);
    expect(response.bundles[0]?.summary_hint).toMatch(/docs/);
  });

  it('is deterministic for a fixed request regardless of input order', () => {
    const direct = runStoryClusterStagePipeline(
      {
        topic_id: 'topic-security',
        documents: BASE_DOCS,
        reference_now_ms: 1_709_000_050_000,
      },
      { clock: makeClock(2000) },
    );

    const reversed = runStoryClusterStagePipeline(
      {
        topic_id: 'topic-security',
        documents: [...BASE_DOCS].reverse(),
        reference_now_ms: 1_709_000_050_000,
      },
      { clock: makeClock(4000) },
    );

    expect(reversed.bundles).toEqual(direct.bundles);
    expect(reversed.telemetry.stages.map((stage) => stage.stage_id)).toEqual(
      direct.telemetry.stages.map((stage) => stage.stage_id),
    );
  });

  it('covers rerank tie-break branches for published_at and doc_id ordering', () => {
    let observedOrder: string[] = [];

    runStoryClusterStagePipeline(
      {
        topic_id: 'topic-rerank',
        documents: [
          { doc_id: 'a', source_id: 's1', title: 'General alpha', published_at: 100, url: 'https://example.com/a' },
          { doc_id: 'b', source_id: 's2', title: 'General beta', published_at: 90, url: 'https://example.com/b' },
          { doc_id: 'c', source_id: 's3', title: 'General charlie', published_at: 80, url: 'https://example.com/c' },
          { doc_id: 'd', source_id: 's4', title: 'General delta', published_at: 80, url: 'https://example.com/d' },
        ],
        reference_now_ms: 200,
      },
      {
        clock: makeClock(7_000),
        stageOverrides: {
          hybrid_scoring: (state) => ({
            ...state,
            documents: state.documents.map((document) => ({
              ...document,
              hybrid_score: document.doc_id === 'a' || document.doc_id === 'b' ? 0.8 : 0.7,
            })),
          }),
          dynamic_cluster_assignment: (state) => {
            observedOrder = state.documents.map((document) => document.doc_id);
            return {
              ...state,
              clusters: [{ key: 'topic-rerank:general:general', docs: state.documents }],
            };
          },
        },
      },
    );

    expect(observedOrder).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles empty document batches and falls back to clock-based reference time', () => {
    const response = runStoryClusterStagePipeline(
      {
        topic_id: 'topic-empty',
        documents: [],
        reference_now_ms: Number.NaN,
      },
      {
        clock: makeClock(9000),
      },
    );

    expect(response.bundles).toEqual([]);
    expect(response.telemetry.request_doc_count).toBe(0);
    expect(response.telemetry.stage_count).toBe(STORYCLUSTER_STAGE_SEQUENCE.length);
    expect(response.telemetry.stages.every((stage) => stage.input_count === 0)).toBe(true);
    expect(response.telemetry.stages.every((stage) => stage.output_count === 0)).toBe(true);
  });

  it('throws validation errors for invalid request inputs', () => {
    expect(() =>
      runStoryClusterStagePipeline({
        topic_id: '   ',
        documents: BASE_DOCS,
      }),
    ).toThrow('topic_id must be non-empty');

    expect(() =>
      runStoryClusterStagePipeline({
        topic_id: 'topic-security',
        documents: [{ ...BASE_DOCS[0]!, title: '   ' }],
      }),
    ).toThrow('documents must provide non-empty doc_id, source_id, title, and url');

    expect(() =>
      runStoryClusterStagePipeline({
        topic_id: 'topic-security',
        documents: [{ ...BASE_DOCS[0]!, published_at: -1 }],
      }),
    ).toThrow('invalid published_at');

    expect(() =>
      runStoryClusterStagePipeline({
        topic_id: 'topic-security',
        documents: [BASE_DOCS[0]!, { ...BASE_DOCS[0]!, source_id: 'wire-z' }],
      }),
    ).toThrow('duplicate doc_id');
  });

  it('fails closed on stage errors with telemetry', () => {
    const stringFailure = () =>
      runStoryClusterStagePipeline(
        { topic_id: 'topic-security', documents: BASE_DOCS },
        {
          clock: makeClock(12_000),
          stageOverrides: {
            hybrid_scoring: () => {
              throw 'synthetic stage failure';
            },
          },
        },
      );

    expect(stringFailure).toThrow('storycluster stage hybrid_scoring failed: synthetic stage failure');

    try {
      stringFailure();
      throw new Error('expected StoryClusterStageError');
    } catch (error) {
      expect(error).toBeInstanceOf(StoryClusterStageError);
      const stageError = error as StoryClusterStageError;
      expect(stageError.stageId).toBe('hybrid_scoring');
      expect(stageError.telemetry.stages.at(-1)?.status).toBe('error');
      expect(stageError.telemetry.stages.at(-1)?.detail).toContain('synthetic stage failure');
    }

    const objectFailure = () =>
      runStoryClusterStagePipeline(
        { topic_id: 'topic-security', documents: BASE_DOCS },
        {
          clock: makeClock(12_500),
          stageOverrides: {
            hybrid_scoring: () => {
              throw new Error('error-object-path');
            },
          },
        },
      );

    expect(objectFailure).toThrow('storycluster stage hybrid_scoring failed: error-object-path');
  });

  it('covers punctuation-token fallback in clustering and untitled summary fallback', () => {
    const punctuationRun = runStoryClusterStagePipeline(
      {
        topic_id: 'topic-punctuation',
        documents: [
          { doc_id: 'punct-1', source_id: 'wire-punct', title: '***', published_at: 10, url: 'https://example.com/punct-1' },
        ],
        reference_now_ms: 10,
      },
      { clock: makeClock(15_000) },
    );

    expect(punctuationRun.bundles[0]?.story_id).toMatch(/^story-/);

    const untitledRun = runStoryClusterStagePipeline(
      {
        topic_id: 'topic-untitled',
        documents: [
          { doc_id: 'untitled-1', source_id: 'wire-untitled', title: 'Signal', published_at: 20, url: 'https://example.com/untitled-1' },
        ],
        reference_now_ms: 20,
      },
      {
        clock: makeClock(16_000),
        stageOverrides: {
          dynamic_cluster_assignment: (state) => ({
            ...state,
            clusters: [{ key: 'topic-untitled:empty', docs: [] }],
          }),
        },
      },
    );

    expect(untitledRun.bundles[0]?.headline).toBe('Untitled story');
  });
});
