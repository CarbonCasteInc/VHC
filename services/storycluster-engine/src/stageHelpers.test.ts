import { describe, expect, it } from 'vitest';
import {
  buildTelemetry,
  normalizeRequest,
  stageArtifactCounts,
  stageGatePassRate,
  stageInputCount,
  stageLatencyPerItemMs,
  stageOutputCount,
  storeReadiness,
} from './stageHelpers';

describe('stageHelpers', () => {
  it('rejects malformed pipeline requests and respects explicit reference times', () => {
    expect(() => normalizeRequest({ topic_id: ' ', documents: [] }, 10)).toThrow('topic_id must be non-empty');
    expect(() => normalizeRequest({
      topic_id: 'topic-x',
      documents: [{ doc_id: 'doc-1', source_id: 'wire-a', title: '', published_at: 1, url: 'https://example.com' }],
    } as any, 10)).toThrow('documents must provide non-empty doc_id, source_id, title, and url');
    expect(() => normalizeRequest({
      topic_id: 'topic-x',
      documents: [{ doc_id: 'doc-1', source_id: 'wire-a', title: 'Headline', published_at: -1, url: 'https://example.com' }],
    } as any, 10)).toThrow('document doc-1 has invalid published_at');
    expect(() => normalizeRequest({
      topic_id: 'topic-x',
      documents: [
        { doc_id: 'doc-1', source_id: 'wire-a', title: 'Headline', published_at: 1, url: 'https://example.com/1' },
        { doc_id: 'doc-1', source_id: 'wire-b', title: 'Headline', published_at: 2, url: 'https://example.com/2' },
      ],
    } as any, 10)).toThrow('duplicate doc_id: doc-1');

    const normalized = normalizeRequest({
      topic_id: 'topic-x',
      reference_now_ms: 999,
      documents: [{
        doc_id: 'doc-1',
        source_id: 'wire-a',
        title: 'Headline',
        published_at: 1,
        url: 'https://example.com',
        url_hash: ' hash-a ',
        image_hash: ' image-a ',
        language_hint: ' en ',
      }],
    } as any, 10);
    expect(normalized.referenceNowMs).toBe(999);
    expect(normalized.documents[0]?.url_hash).toBe('hash-a');
    expect(normalized.documents[0]?.image_hash).toBe('image-a');
    expect(normalized.documents[0]?.language_hint).toBe('en');
  });

  it('covers telemetry helpers and readiness wrappers', () => {
    const state = {
      documents: [],
      clusters: [{ key: 'story-1' }],
      bundles: [{ story_id: 'story-1' }],
      stage_metrics: {},
    } as any;

    expect(stageInputCount('hybrid_scoring', state)).toBe(0);
    expect(stageOutputCount('language_translation', state)).toBe(0);
    expect(stageGatePassRate(4, 2)).toBe(0.5);
    expect(stageLatencyPerItemMs(9, 3)).toBe(3);
    expect(stageArtifactCounts('language_translation', state, 0, 0)).toEqual({ input_count: 0, output_count: 0 });
    expect(storeReadiness({ readiness: () => ({ ok: false, detail: 'offline' }) } as any)).toEqual({ ok: false, detail: 'offline' });

    const telemetry = buildTelemetry('topic-x', 1, [{
      stage_id: 'language_translation',
      status: 'ok',
      started_at_ms: 100,
      completed_at_ms: 120,
      latency_ms: 20,
      latency_per_item_ms: 20,
      input_count: 1,
      output_count: 1,
      gate_pass_rate: 1,
      artifact_counts: { input_count: 1, output_count: 1 },
    }], 150);
    expect(telemetry.total_latency_ms).toBe(50);
  });
});
