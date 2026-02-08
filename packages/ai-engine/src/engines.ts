export interface JsonCompletionEngine {
  name: string;
  kind: 'local' | 'remote';
  modelName?: string;
  generate(prompt: string): Promise<string>;
}

export type EnginePolicy =
  | 'remote-first'
  | 'local-first'
  | 'remote-only'
  | 'local-only'
  | 'shadow';

export class EngineUnavailableError extends Error {
  constructor(public readonly policy: EnginePolicy) {
    super(`No engine available for policy: ${policy}`);
    this.name = 'EngineUnavailableError';
  }
}

function hasEngine(engine?: JsonCompletionEngine): engine is JsonCompletionEngine {
  return Boolean(engine);
}

function policyCandidates(
  policy: EnginePolicy,
  localEngine?: JsonCompletionEngine,
  remoteEngine?: JsonCompletionEngine
): JsonCompletionEngine[] {
  switch (policy) {
    case 'local-only':
      return [localEngine].filter(hasEngine);
    case 'remote-only':
      return [remoteEngine].filter(hasEngine);
    case 'local-first':
      return [localEngine, remoteEngine].filter(hasEngine);
    case 'remote-first':
      return [remoteEngine, localEngine].filter(hasEngine);
    case 'shadow':
      return [localEngine, remoteEngine].filter(hasEngine);
  }
}

export class EngineRouter {
  constructor(
    private localEngine?: JsonCompletionEngine,
    private remoteEngine?: JsonCompletionEngine,
    private policy: EnginePolicy = 'local-first'
  ) {}

  async generate(prompt: string): Promise<{ text: string; engine: string }> {
    const candidates = policyCandidates(this.policy, this.localEngine, this.remoteEngine);

    for (const [index, engine] of candidates.entries()) {
      try {
        return {
          text: await engine.generate(prompt),
          engine: engine.name
        };
      } catch (error) {
        if (index === candidates.length - 1) {
          throw error;
        }
      }
    }

    throw new EngineUnavailableError(this.policy);
  }
}

export function createMockEngine(): JsonCompletionEngine {
  return {
    name: 'mock-local-engine',
    modelName: 'mock-local-v1',
    kind: 'local',
    async generate() {
      return JSON.stringify({
        final_refined: {
          summary: 'Mock summary',
          bias_claim_quote: ['quote'],
          justify_bias_claim: ['justification'],
          biases: ['bias'],
          counterpoints: ['counter'],
          sentimentScore: 0.5,
          confidence: 0.9
        }
      });
    }
  };
}

export function isE2EMode(): boolean {
  return (import.meta as any).env?.VITE_E2E_MODE === 'true' || false;
}

/**
 * Returns the default engine for the current runtime context.
 * In E2E/test mode: returns mock engine.
 * In browser: returns mock engine (callers should use createAnalysisPipeline
 * with an explicit LocalMlEngine for real inference).
 */
export function createDefaultEngine(): JsonCompletionEngine {
  return createMockEngine();
}
