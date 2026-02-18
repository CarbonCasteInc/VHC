import { LocalMlEngine } from './localMlEngine';
import { RemoteApiEngine } from './remoteApiEngine';

export type { JsonCompletionEngine, EnginePolicy } from './engineTypes';
export { EngineUnavailableError } from './engineTypes';

import type { JsonCompletionEngine, EnginePolicy } from './engineTypes';
import { EngineUnavailableError } from './engineTypes';

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
          confidence: 0.9
        }
      });
    }
  };
}

function readEnvVar(name: string): string | undefined {
  const viteValue = (import.meta as any).env?.[name];
  const nodeValue = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const value = viteValue ?? nodeValue;
  return typeof value === 'string' ? value : undefined;
}

export function isE2EMode(): boolean {
  const viteE2EMode = readEnvVar('VITE_E2E_MODE');
  return viteE2EMode === 'true';
}

/**
 * Returns the default engine for the current runtime context.
 * In E2E/test mode: returns mock engine.
 * Otherwise: returns the real local WebLLM engine.
 */
export function createDefaultEngine(): JsonCompletionEngine {
  if (isE2EMode()) {
    return createMockEngine();
  }
  return new LocalMlEngine();
}

/** @deprecated Use server-side relay (/api/analyze) instead. Will be removed in future release. */
export function createRemoteEngine(): JsonCompletionEngine | undefined {
  if (isE2EMode()) {
    return undefined;
  }

  const endpointUrl = readEnvVar('VITE_REMOTE_ENGINE_URL')?.trim() ?? '';
  if (!endpointUrl) {
    return undefined;
  }

  if (/^https?:\/\//i.test(endpointUrl)) {
    console.warn('[vh:ai-engine] Direct remote engine URLs are deprecated. Prefer server relay endpoint /api/analyze.');
  }

  return new RemoteApiEngine({
    endpointUrl
  });
}
