import { describe, expect, it } from 'vitest';
import { stageRunnerInternal } from './stageRunner';

describe('stageRunnerInternal', () => {
  it('normalizes tokens, classifies simplified document types, and resolves language', () => {
    expect(stageRunnerInternal.normalizeToken('  A!  B?  ')).toBe('a b');
    expect(stageRunnerInternal.classifyDocument('Breaking alert now')).toBe('breaking');
    expect(stageRunnerInternal.classifyDocument('Analysis: market impacts')).toBe('analysis');
    expect(stageRunnerInternal.classifyDocument('Opinion piece from desk')).toBe('opinion');
    expect(stageRunnerInternal.classifyDocument('General roundup')).toBe('general');
    expect(stageRunnerInternal.resolveLanguage({ title: 'El gobierno anunció nuevas sanciones para el mercado esta noche.' })).toBe('es');
    expect(stageRunnerInternal.resolveLanguage({ title: 'Plain text', language_hint: 'fr' })).toBe('fr');
  });

  it('normalizes requests and helper math utilities', () => {
    const normalized = stageRunnerInternal.normalizeRequest(
      {
        topic_id: 'topic-x',
        documents: [{
          doc_id: 'doc-1',
          source_id: 'wire-a',
          title: '  Headline  ',
          summary: '  Summary  ',
          published_at: 100,
          url: 'https://example.com/1',
          canonical_url: 'https://example.com/1',
          publisher: 'Desk',
          entity_keys: [' One ', ''],
        }],
      },
      50,
    );

    expect(normalized.topicId).toBe('topic-x');
    expect(normalized.referenceNowMs).toBe(100);
    expect(normalized.documents[0]?.title).toBe('Headline');
    expect(normalized.documents[0]?.summary).toBe('Summary');
    expect(normalized.documents[0]?.entity_keys).toEqual(['One']);
    expect(stageRunnerInternal.clamp01(Number.NaN)).toBe(0);
    expect(stageRunnerInternal.clamp01(2)).toBe(1);
    expect(stageRunnerInternal.hashToHex('abc')).toHaveLength(16);
  });

  it('covers telemetry helpers and stage counters', () => {
    const bareState = {
      documents: [],
      clusters: [{ key: 'story-1' }],
      bundles: [{ story_id: 'story-1' }],
      stage_metrics: {
        summarize_publish_payloads: { summaries_generated: 1 },
      },
    } as any;

    expect(stageRunnerInternal.stageInputCount('summarize_publish_payloads', bareState)).toBe(1);
    expect(stageRunnerInternal.stageInputCount('hybrid_scoring', bareState)).toBe(0);
    expect(stageRunnerInternal.stageOutputCount('dynamic_cluster_assignment', bareState)).toBe(1);
    expect(stageRunnerInternal.stageOutputCount('summarize_publish_payloads', bareState)).toBe(1);
    expect(stageRunnerInternal.stageOutputCount('language_translation', bareState)).toBe(0);
    expect(stageRunnerInternal.stageGatePassRate(0, 0)).toBe(1);
    expect(stageRunnerInternal.stageGatePassRate(6, 5)).toBe(0.833);
    expect(stageRunnerInternal.stageLatencyPerItemMs(10, 0)).toBe(10);
    expect(stageRunnerInternal.stageLatencyPerItemMs(10, 4)).toBe(2.5);
    expect(stageRunnerInternal.stageArtifactCounts('summarize_publish_payloads', bareState, 1, 1)).toEqual({
      input_count: 1,
      output_count: 1,
      summaries_generated: 1,
    });

    const telemetry = stageRunnerInternal.buildTelemetry('topic-x', 0, [], 5000);
    expect(telemetry.total_latency_ms).toBe(0);
    expect(telemetry.stage_count).toBe(0);
  });
});
