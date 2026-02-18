import { describe, expect, it } from 'vitest';
import {
  AnalysisSchema,
  CanonicalAnalysisSchema,
  AggregateSentimentSchema,
  CivicDecaySchema,
  MessageSchema,
  ProfileSchema
} from './schemas';

describe('data-model schemas', () => {
  it('accepts a valid profile', () => {
    const result = ProfileSchema.parse({
      pubkey: 'pk',
      username: 'venn-user',
      bio: 'hello',
      avatarCid: 'cid'
    });
    expect(result.username).toBe('venn-user');
  });

  it('rejects too-short username', () => {
    expect(() =>
      ProfileSchema.parse({
        pubkey: 'pk',
        username: 'aa'
      })
    ).toThrow();
  });

  it('rejects too-long username', () => {
    expect(() =>
      ProfileSchema.parse({
        pubkey: 'pk',
        username: 'a'.repeat(31)
      })
    ).toThrow();
  });

  it('rejects message with invalid kind', () => {
    expect(() =>
      MessageSchema.parse({
        id: '1',
        timestamp: Date.now(),
        sender: 'pk',
        content: 'cipher',
        kind: 'video'
      })
    ).toThrow();
  });

  it('rejects invalid message timestamp', () => {
    expect(() =>
      MessageSchema.parse({
        id: '1',
        timestamp: -1,
        sender: 'pk',
        content: 'cipher',
        kind: 'text'
      })
    ).toThrow();
  });

  it('backfills analysis sentimentScore to 0 when omitted', () => {
    const parsed = AnalysisSchema.parse({
      canonicalId: 'abc',
      summary: 'test',
      biases: ['x'],
      counterpoints: ['y'],
      timestamp: Date.now()
    });

    expect(parsed.sentimentScore).toBe(0);
  });

  it('rejects analysis with out-of-range sentiment score', () => {
    expect(() =>
      AnalysisSchema.parse({
        canonicalId: 'abc',
        summary: 'test',
        biases: ['x'],
        counterpoints: ['y'],
        sentimentScore: -2,
        timestamp: Date.now()
      })
    ).toThrow();
  });

  it('defaults analysis sentiment score to 0 when omitted', () => {
    const result = AnalysisSchema.parse({
      canonicalId: 'abc',
      summary: 'test',
      biases: ['x'],
      counterpoints: ['y'],
      timestamp: Date.now()
    });

    expect(result.sentimentScore).toBe(0);
  });

  it('validates aggregate sentiment', () => {
    const valid = AggregateSentimentSchema.parse({
      topic_id: 'abc',
      analysis_id: 'def',
      point_stats: {
        'point-1': { agree: 10, disagree: 2 }
      },
      bias_vector: { 'point-1': 1 },
      weight: 1.5,
      engagementScore: 0.8
    });
    expect(valid.weight).toBe(1.5);
  });

  it('validates canonical analysis requires urlHash and url', () => {
    const valid = CanonicalAnalysisSchema.parse({
      schemaVersion: 'canonical-analysis-v1',
      url: 'https://example.com',
      urlHash: 'abc',
      summary: 'test',
      bias_claim_quote: ['quote'],
      justify_bias_claim: ['justification'],
      biases: ['bias'],
      counterpoints: ['counter'],
      timestamp: 123
    });
    expect(valid.urlHash).toBe('abc');
    expect(valid.sentimentScore).toBe(0);
    expect(valid.engine).toBeUndefined();
    expect(valid.warnings).toBeUndefined();
  });

  it('accepts optional engine and warnings in canonical analysis', () => {
    const withMeta = CanonicalAnalysisSchema.parse({
      schemaVersion: 'canonical-analysis-v1',
      url: 'https://example.com',
      urlHash: 'abc',
      summary: 'test',
      bias_claim_quote: ['quote'],
      justify_bias_claim: ['justification'],
      biases: ['bias'],
      counterpoints: ['counter'],
      sentimentScore: 0.5,
      timestamp: 123,
      engine: { id: 'mock-local-engine', kind: 'local', modelName: 'mock-local-v1' },
      warnings: ['hallucinated year 2099']
    });
    expect(withMeta.engine?.id).toBe('mock-local-engine');
    expect(withMeta.engine?.kind).toBe('local');
    expect(withMeta.engine?.modelName).toBe('mock-local-v1');
    expect(withMeta.warnings).toEqual(['hallucinated year 2099']);
  });

  it('defaults canonical analysis sentiment score to 0 when omitted', () => {
    const parsed = CanonicalAnalysisSchema.parse({
      schemaVersion: 'canonical-analysis-v1',
      url: 'https://example.com',
      urlHash: 'abc',
      summary: 'test',
      bias_claim_quote: ['quote'],
      justify_bias_claim: ['justification'],
      biases: ['bias'],
      counterpoints: ['counter'],
      timestamp: 123
    });

    expect(parsed.sentimentScore).toBe(0);
  });

  it('rejects invalid engine kind in canonical analysis', () => {
    expect(() =>
      CanonicalAnalysisSchema.parse({
        schemaVersion: 'canonical-analysis-v1',
        url: 'https://example.com',
        urlHash: 'abc',
        summary: 'test',
        bias_claim_quote: ['q'],
        justify_bias_claim: ['j'],
        biases: ['b'],
        counterpoints: ['c'],
        sentimentScore: 0,
        timestamp: 0,
        engine: { id: 'e', kind: 'invalid', modelName: 'm' }
      })
    ).toThrow();

    expect(() =>
      CanonicalAnalysisSchema.parse({
        url: 'notaurl',
        urlHash: '',
        summary: 's',
        biases: [],
        counterpoints: [],
        sentimentScore: 0,
        timestamp: 0
      })
    ).toThrow();
  });

  it('enforces civic decay constraints', () => {
    const decay = CivicDecaySchema.parse({
      topicId: 'topic',
      interactions: 2,
      weight: 1,
      lastUpdated: Date.now()
    });
    expect(decay.weight).toBeGreaterThan(0);
    expect(() =>
      CivicDecaySchema.parse({
        topicId: '',
        interactions: -1,
        weight: -1,
        lastUpdated: -1
      })
    ).toThrow();
  });
});
