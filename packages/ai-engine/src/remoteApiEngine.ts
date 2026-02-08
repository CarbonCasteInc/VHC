import { EngineUnavailableError, type JsonCompletionEngine } from './engineTypes';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL_NAME = 'remote-api-v1';

export interface RemoteApiEngineOptions {
  endpointUrl: string;
  timeoutMs?: number;
  modelName?: string;
  apiKey?: string;
}

export class RemoteApiEngine implements JsonCompletionEngine {
  readonly name = 'remote-api';
  readonly kind = 'remote' as const;
  readonly modelName: string;

  private readonly endpointUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;

  constructor(options: RemoteApiEngineOptions) {
    const endpointUrl = options.endpointUrl.trim();
    if (!endpointUrl) {
      throw new Error('Remote API endpoint URL is required');
    }

    this.endpointUrl = endpointUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.modelName = options.modelName ?? DEFAULT_MODEL_NAME;
    this.apiKey = options.apiKey;
  }

  async generate(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt,
          max_tokens: 2048,
          temperature: 0.1
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        throw new EngineUnavailableError('remote-only');
      }

      const body = await response.json();
      const content =
        body?.choices?.[0]?.message?.content ??
        body?.response?.text;

      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new EngineUnavailableError('remote-only');
      }

      return content;
    } catch (error) {
      clearTimeout(timeoutHandle);
      if (error instanceof EngineUnavailableError) {
        throw error;
      }
      throw new EngineUnavailableError('remote-only');
    }
  }
}
