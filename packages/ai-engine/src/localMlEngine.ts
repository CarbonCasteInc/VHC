import { EngineUnavailableError, type JsonCompletionEngine } from './engines';

const DEFAULT_MODEL_ID = 'Llama-3.1-8B-Instruct-q4f16_1-MLC';

export interface LocalMlEngineOptions {
  modelId?: string;
}

/**
 * WebLLM-backed local engine. Lazy-initializes on first generate() call.
 * Requires WebGPU; throws EngineUnavailableError if unavailable.
 */
export class LocalMlEngine implements JsonCompletionEngine {
  readonly name = 'local-webllm';
  readonly kind = 'local' as const;
  readonly modelName: string;

  private mlcEngine: any = null;
  private initPromise: Promise<void> | null = null;
  private readonly modelId: string;

  constructor(options: LocalMlEngineOptions = {}) {
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID;
    this.modelName = this.modelId;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.mlcEngine) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.loadModel();
    return this.initPromise;
  }

  private async loadModel(): Promise<void> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      throw new EngineUnavailableError('local-only');
    }

    try {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
      this.mlcEngine = await CreateMLCEngine(this.modelId);
    } catch (error) {
      this.initPromise = null;
      if (error instanceof EngineUnavailableError) throw error;
      throw new EngineUnavailableError('local-only');
    }
  }

  async generate(prompt: string): Promise<string> {
    await this.ensureInitialized();

    const response = await this.mlcEngine.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 2048
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new EngineUnavailableError('local-only');
    }
    return content;
  }
}
