import { describe, expect, it } from 'vitest';
import {
  AnalysisParseError,
  AnalysisResultSchema,
  parseAnalysisResponse,
} from '../schema';

const BASE_ANALYSIS = {
  summary: 'Summary text',
  bias_claim_quote: ['quote'],
  justify_bias_claim: ['justification'],
  biases: ['bias'],
  counterpoints: ['counterpoint'],
};

describe('AnalysisResultSchema', () => {
  it('allows missing sentimentScore', () => {
    const parsed = AnalysisResultSchema.parse(BASE_ANALYSIS);
    expect(parsed.sentimentScore).toBeUndefined();
  });

  it('accepts legacy payloads that still include sentimentScore', () => {
    const parsed = AnalysisResultSchema.parse({
      ...BASE_ANALYSIS,
      sentimentScore: 0.42,
    });

    expect(parsed.sentimentScore).toBe(0.42);
  });

  it('parses unwrapped payload objects', () => {
    const parsed = parseAnalysisResponse(
      JSON.stringify({
        ...BASE_ANALYSIS,
        sentimentScore: 0.1,
      }),
    );

    expect(parsed.sentimentScore).toBe(0.1);
  });

  it('parses perspectives and provider payloads', () => {
    const parsed = parseAnalysisResponse(
      JSON.stringify({
        final_refined: {
          ...BASE_ANALYSIS,
          perspectives: [
            { frame: 'Frame A', reframe: 'Reframe A' },
            { id: 'p2', frame: 'Frame B', reframe: 'Reframe B' },
          ],
          provider_id: 'legacy-provider',
          model_id: 'legacy-model',
          provider: {
            provider_id: 'relay',
            model_id: 'gpt-5.2',
            kind: 'remote',
          },
        },
      }),
    );

    expect(parsed.perspectives).toEqual([
      { frame: 'Frame A', reframe: 'Reframe A' },
      { id: 'p2', frame: 'Frame B', reframe: 'Reframe B' },
    ]);
    expect(parsed.provider_id).toBe('legacy-provider');
    expect(parsed.model_id).toBe('legacy-model');
    expect(parsed.provider).toEqual({
      provider_id: 'relay',
      model_id: 'gpt-5.2',
      kind: 'remote',
    });
  });

  it('throws parse errors for invalid payloads', () => {
    expect(() => parseAnalysisResponse('no json')).toThrow(
      AnalysisParseError.NO_JSON_OBJECT_FOUND,
    );

    expect(() => parseAnalysisResponse('{"final_refined": }')).toThrow(
      AnalysisParseError.JSON_PARSE_ERROR,
    );

    expect(() =>
      parseAnalysisResponse(
        JSON.stringify({
          final_refined: {
            ...BASE_ANALYSIS,
            counterpoints: 'not-an-array',
          },
        }),
      ),
    ).toThrow(AnalysisParseError.SCHEMA_VALIDATION_ERROR);
  });
});
