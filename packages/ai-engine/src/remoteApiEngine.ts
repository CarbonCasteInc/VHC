import { EngineUnavailableError, type JsonCompletionEngine } from './engineTypes';
import {
  buildRemoteRequest,
  getAnalysisModel,
  getRemoteApiKey,
  RemoteAuthError,
  validateRemoteAuth,
} from './modelConfig';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface RemoteApiEngineOptions {
  endpointUrl: string;
  timeoutMs?: number;
}

export class RemoteApiEngine implements JsonCompletionEngine {
  readonly name = 'remote-api';
  readonly kind = 'remote' as const;

  private readonly endpointUrl: string;
  private readonly timeoutMs: number;

  constructor(options: RemoteApiEngineOptions) {
    const endpointUrl = options.endpointUrl.trim();
    if (!endpointUrl) {
      throw new Error('Remote API endpoint URL is required');
    }

    this.endpointUrl = endpointUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get modelName(): string {
    return getAnalysisModel();
  }

  async generate(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      validateRemoteAuth();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getRemoteApiKey()}`,
      };

      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildRemoteRequest(prompt)),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new EngineUnavailableError('remote-only');
      }

      const body = await response.json();
      const content = body?.choices?.[0]?.message?.content ?? body?.response?.text;

      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new EngineUnavailableError('remote-only');
      }

      return content;
    } catch (error) {
      if (error instanceof EngineUnavailableError || error instanceof RemoteAuthError) {
        throw error;
      }
      throw new EngineUnavailableError('remote-only');
    } /* v8 ignore next -- V8 branch artifact on finally; both try+catch paths tested */ finally {
      clearTimeout(timeoutHandle);
    }
  }
}
