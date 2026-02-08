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
