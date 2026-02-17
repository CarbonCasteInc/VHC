import { describe, expect, it } from 'vitest';
import { AnalysisResultSchema, parseAnalysisResponse } from '../schema';

const BASE_ANALYSIS = {
  summary: 'Summary text',
  bias_claim_quote: ['quote'],
  justify_bias_claim: ['justification'],
  biases: ['bias'],
  counterpoints: ['counterpoint'],
};

describe('AnalysisResultSchema', () => {
  it('parses payloads without sentimentScore', () => {
    const parsed = AnalysisResultSchema.parse(BASE_ANALYSIS);

    expect(parsed.summary).toBe('Summary text');
    expect(parsed).not.toHaveProperty('sentimentScore');
  });

  it('accepts legacy payloads that still include sentimentScore', () => {
    const parsed = AnalysisResultSchema.parse({
      ...BASE_ANALYSIS,
      sentimentScore: 0.42,
    });

    expect(parsed.summary).toBe('Summary text');
    expect(parsed).not.toHaveProperty('sentimentScore');
  });

  it('parses perspectives when provided', () => {
    const parsed = AnalysisResultSchema.parse({
      ...BASE_ANALYSIS,
      perspectives: [
        { frame: 'Frame A', reframe: 'Reframe A' },
        { frame: 'Frame B', reframe: 'Reframe B' },
      ],
    });

    expect(parsed.perspectives).toEqual([
      { frame: 'Frame A', reframe: 'Reframe A' },
      { frame: 'Frame B', reframe: 'Reframe B' },
    ]);
  });

  it('parses provider fields when provided', () => {
    const parsed = parseAnalysisResponse(
      JSON.stringify({
        final_refined: {
          ...BASE_ANALYSIS,
          provider_id: 'openai',
          model_id: 'gpt-4o-mini',
        },
      }),
    );

    expect(parsed.provider_id).toBe('openai');
    expect(parsed.model_id).toBe('gpt-4o-mini');
  });
});
