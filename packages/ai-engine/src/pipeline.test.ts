import { describe, expect, it, vi } from 'vitest';
import { createAnalysisPipeline } from './pipeline';
import { AnalysisParseError } from './schema';
import type { JsonCompletionEngine } from './engines';

vi.mock('./engines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engines')>();
  return {
    ...actual,
    createDefaultEngine: () => actual.createMockEngine()
  };
});

function validWrappedResult(summary = 'Source summary') {
  return JSON.stringify({
    final_refined: {
      summary,
      bias_claim_quote: ['quote'],
      justify_bias_claim: ['justification'],
      biases: ['bias'],
      counterpoints: ['counterpoint'],
      sentimentScore: 0.5,
      confidence: 0.9
    }
  });
}

describe('createAnalysisPipeline', () => {
  it('runs prompt -> engine -> parse -> validation success path', async () => {
    const articleText = 'A source article body about 2024 elections.';
    const engine: JsonCompletionEngine = {
      name: 'local-engine',
      kind: 'local',
      modelName: 'local-model-v1',
      generate: vi.fn().mockResolvedValue(validWrappedResult('A source article body about 2024 elections.'))
    };

    const pipeline = createAnalysisPipeline(engine);
    const result = await pipeline(articleText);

    expect(engine.generate).toHaveBeenCalledTimes(1);
    expect(engine.generate).toHaveBeenCalledWith(expect.stringContaining(articleText));
    expect(result.analysis.sentimentScore).toBe(0.5);
    expect(result.engine).toEqual({
      id: 'local-engine',
      kind: 'local',
      modelName: 'local-model-v1'
    });
    expect(result.warnings).toEqual([]);
  });

  it('throws parse error on malformed JSON', async () => {
    const engine: JsonCompletionEngine = {
      name: 'bad-json-engine',
      kind: 'local',
      generate: vi.fn().mockResolvedValue('{"final_refined": }')
    };

    const pipeline = createAnalysisPipeline(engine);

    await expect(pipeline('article text')).rejects.toThrow(AnalysisParseError.JSON_PARSE_ERROR);
  });

  it('throws schema validation error for missing required fields', async () => {
    const engine: JsonCompletionEngine = {
      name: 'schema-invalid-engine',
      kind: 'local',
      generate: vi.fn().mockResolvedValue(
        JSON.stringify({
          final_refined: {
            summary: 'Missing sentiment score',
            bias_claim_quote: ['quote'],
            justify_bias_claim: ['justification'],
            biases: ['bias'],
            counterpoints: ['counterpoint']
          }
        })
      )
    };

    const pipeline = createAnalysisPipeline(engine);

    await expect(pipeline('article text')).rejects.toThrow(AnalysisParseError.SCHEMA_VALIDATION_ERROR);
  });

  it('propagates engine failures', async () => {
    const engine: JsonCompletionEngine = {
      name: 'failing-engine',
      kind: 'local',
      generate: vi.fn().mockRejectedValue(new Error('engine unavailable'))
    };

    const pipeline = createAnalysisPipeline(engine);

    await expect(pipeline('article text')).rejects.toThrow('engine unavailable');
  });

  it('returns validation warnings for hallucinated years', async () => {
    const engine: JsonCompletionEngine = {
      name: 'warning-engine',
      kind: 'local',
      generate: vi.fn().mockResolvedValue(validWrappedResult('In 2099 this happened.'))
    };

    const pipeline = createAnalysisPipeline(engine);
    const result = await pipeline('Source does not mention the future.');

    expect(result.warnings).toEqual([
      expect.stringContaining('2099')
    ]);
  });

  it('includes engine metadata and defaults modelName to engine name', async () => {
    const engine: JsonCompletionEngine = {
      name: 'remote-engine',
      kind: 'remote',
      generate: vi.fn().mockResolvedValue(validWrappedResult())
    };

    const pipeline = createAnalysisPipeline(engine);
    const result = await pipeline('remote article text');

    expect(result.engine).toEqual({
      id: 'remote-engine',
      kind: 'remote',
      modelName: 'remote-engine'
    });
  });

  it('uses default local engine when no engine is provided', async () => {
    const pipeline = createAnalysisPipeline();
    const result = await pipeline('default engine article text');

    expect(result.engine).toEqual({
      id: 'mock-local-engine',
      kind: 'local',
      modelName: 'mock-local-v1'
    });
    expect(result.analysis.sentimentScore).toBeTypeOf('number');
  });
});
