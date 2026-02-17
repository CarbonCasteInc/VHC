import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnalysisPipeline } from './pipeline';
import { AnalysisParseError } from './schema';
import { createMockEngine, type JsonCompletionEngine } from './engines';

const { mockCreateDefaultEngine } = vi.hoisted(() => ({
  mockCreateDefaultEngine: vi.fn()
}));

vi.mock('./engines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engines')>();
  return {
    ...actual,
    createDefaultEngine: () => mockCreateDefaultEngine()
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
      confidence: 0.9
    }
  });
}

function makeEngine(
  name: string,
  kind: 'local' | 'remote',
  generate: JsonCompletionEngine['generate'],
  modelName?: string
): JsonCompletionEngine {
  return {
    name,
    kind,
    modelName,
    generate
  };
}

beforeEach(() => {
  mockCreateDefaultEngine.mockReset();
  mockCreateDefaultEngine.mockImplementation(() => createMockEngine());
});

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
    expect(result.analysis.summary).toBe('A source article body about 2024 elections.');
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
    expect(result.analysis.summary).toBe('Mock summary');
    expect(mockCreateDefaultEngine).toHaveBeenCalledTimes(1);
  });

  it('uses local-first policy with remote fallback when configured', async () => {
    const localEngine = makeEngine(
      'local-webllm',
      'local',
      vi.fn().mockRejectedValue(new Error('local engine failed')),
      'local-model'
    );
    const remoteEngine = makeEngine(
      'remote-api',
      'remote',
      vi.fn().mockResolvedValue(validWrappedResult('Article text for router.')),
      'remote-model'
    );

    mockCreateDefaultEngine.mockReturnValue(localEngine);

    const pipeline = createAnalysisPipeline({
      policy: 'local-first',
      remoteEngine
    });

    const result = await pipeline('Article text for router.');

    expect(localEngine.generate).toHaveBeenCalledTimes(1);
    expect(remoteEngine.generate).toHaveBeenCalledTimes(1);
    expect(result.engine).toEqual({
      id: 'remote-api',
      kind: 'remote',
      modelName: 'remote-model'
    });
  });

  it('local-first without remote engine behaves as local-only', async () => {
    const localEngine = makeEngine(
      'local-webllm',
      'local',
      vi.fn().mockResolvedValue(validWrappedResult('Local only article text.')),
      'local-model'
    );

    mockCreateDefaultEngine.mockReturnValue(localEngine);

    const pipeline = createAnalysisPipeline({ policy: 'local-first' });
    const result = await pipeline('Local only article text.');

    expect(localEngine.generate).toHaveBeenCalledTimes(1);
    expect(result.engine).toEqual({
      id: 'local-webllm',
      kind: 'local',
      modelName: 'local-model'
    });
  });

  it('local-only policy ignores provided remote engine', async () => {
    const localEngine = makeEngine(
      'local-webllm',
      'local',
      vi.fn().mockResolvedValue(validWrappedResult('Policy local-only text.')),
      'local-model'
    );
    const remoteEngine = makeEngine(
      'remote-api',
      'remote',
      vi.fn().mockResolvedValue(validWrappedResult('Remote should not run.')),
      'remote-model'
    );

    mockCreateDefaultEngine.mockReturnValue(localEngine);

    const pipeline = createAnalysisPipeline({
      policy: 'local-only',
      remoteEngine
    });

    const result = await pipeline('Policy local-only text.');

    expect(localEngine.generate).toHaveBeenCalledTimes(1);
    expect(remoteEngine.generate).not.toHaveBeenCalled();
    expect(result.engine).toEqual({
      id: 'local-webllm',
      kind: 'local',
      modelName: 'local-model'
    });
  });

  it('keeps backward compatibility when passed a bare JsonCompletionEngine', async () => {
    const bareEngine = makeEngine(
      'legacy-engine',
      'local',
      vi.fn().mockResolvedValue(validWrappedResult('Legacy path text.')),
      'legacy-model'
    );

    const pipeline = createAnalysisPipeline(bareEngine);
    const result = await pipeline('Legacy path text.');

    expect(mockCreateDefaultEngine).not.toHaveBeenCalled();
    expect(bareEngine.generate).toHaveBeenCalledTimes(1);
    expect(result.engine).toEqual({
      id: 'legacy-engine',
      kind: 'local',
      modelName: 'legacy-model'
    });
  });
});
