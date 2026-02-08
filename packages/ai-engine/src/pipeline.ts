import { buildPrompt } from './prompts';
import { parseAnalysisResponse, type AnalysisResult } from './schema';
import { validateAnalysisAgainstSource } from './validation';
import {
  createDefaultEngine,
  EngineRouter,
  type EnginePolicy,
  type JsonCompletionEngine
} from './engines';

export interface PipelineResult {
  analysis: AnalysisResult;
  engine: {
    id: string;
    kind: 'remote' | 'local';
    modelName: string;
  };
  warnings: string[];
}

export interface PipelineConfig {
  policy?: EnginePolicy;
  remoteEngine?: JsonCompletionEngine;
}

interface PipelineRuntime {
  router: EngineRouter;
  candidates: JsonCompletionEngine[];
}

function createSingleEngineRuntime(engine: JsonCompletionEngine): PipelineRuntime {
  if (engine.kind === 'remote') {
    return {
      router: new EngineRouter(undefined, engine, 'remote-only'),
      candidates: [engine]
    };
  }

  return {
    router: new EngineRouter(engine, undefined, 'local-only'),
    candidates: [engine]
  };
}

function createConfiguredRuntime(config: PipelineConfig): PipelineRuntime {
  const localEngine = createDefaultEngine();
  const remoteEngine = config.policy === 'local-first' ? config.remoteEngine : undefined;
  const policy: EnginePolicy = remoteEngine ? 'local-first' : 'local-only';

  return {
    router: new EngineRouter(localEngine, remoteEngine, policy),
    candidates: remoteEngine ? [localEngine, remoteEngine] : [localEngine]
  };
}

function isPipelineConfig(
  engineOrConfig: JsonCompletionEngine | PipelineConfig | undefined
): engineOrConfig is PipelineConfig {
  return engineOrConfig !== undefined && !('generate' in engineOrConfig);
}

function toEngineMetadata(engine: JsonCompletionEngine): PipelineResult['engine'] {
  return {
    id: engine.name,
    kind: engine.kind,
    modelName: engine.modelName ?? engine.name
  };
}

export function createAnalysisPipeline(
  engineOrConfig?: JsonCompletionEngine | PipelineConfig
): (articleText: string) => Promise<PipelineResult> {
  const runtime = isPipelineConfig(engineOrConfig)
    ? createConfiguredRuntime(engineOrConfig)
    : createSingleEngineRuntime(engineOrConfig ?? createDefaultEngine());

  return async (articleText: string): Promise<PipelineResult> => {
    const prompt = buildPrompt(articleText);
    const { text, engine } = await runtime.router.generate(prompt);
    const analysis = parseAnalysisResponse(text);
    const warnings = validateAnalysisAgainstSource(articleText, analysis).map((warning) => warning.message);
    const successfulEngine = runtime.candidates.find((candidate) => candidate.name === engine);
    /* v8 ignore next 3 -- defensive guard: router always returns a candidate name */
    if (!successfulEngine) {
      throw new Error(`Pipeline: engine '${engine}' not found in candidates`);
    }

    return {
      analysis,
      engine: toEngineMetadata(successfulEngine),
      warnings
    };
  };
}
