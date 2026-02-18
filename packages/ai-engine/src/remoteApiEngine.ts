import { EngineUnavailableError, type JsonCompletionEngine } from './engineTypes';
import {
  buildRemoteRequest,
  getAnalysisModel,
  getRemoteApiKey,
  RemoteAuthError,
  validateRemoteAuth,
} from './modelConfig';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PROVIDER_ID = 'remote-api';

export interface RemoteApiEngineOptions {
  endpointUrl: string;
  timeoutMs?: number;
}

function isDirectEndpoint(endpointUrl: string): boolean {
  return /^https?:\/\//i.test(endpointUrl);
}

function readProvider(value: unknown): { provider_id: string; model_id: string } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    provider?: { provider_id?: unknown; model_id?: unknown };
    provenance?: { provider_id?: unknown; model_id?: unknown };
  };

  const provider = candidate.provider ?? candidate.provenance;
  if (!provider) {
    return null;
  }

  if (typeof provider.provider_id !== 'string' || typeof provider.model_id !== 'string') {
    return null;
  }

  if (!provider.provider_id.trim() || !provider.model_id.trim()) {
    return null;
  }

  return {
    provider_id: provider.provider_id,
    model_id: provider.model_id,
  };
}

function readContent(value: unknown): string | null {
  const candidate = value as {
    content?: unknown;
    response?: { text?: unknown };
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  const content =
    candidate?.content ??
    candidate?.choices?.[0]?.message?.content ??
    candidate?.response?.text;

  if (typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }

  return content;
}

export class RemoteApiEngine implements JsonCompletionEngine {
  readonly kind = 'remote' as const;

  private readonly endpointUrl: string;
  private readonly timeoutMs: number;
  private resolvedProviderId = DEFAULT_PROVIDER_ID;
  private resolvedModelName = getAnalysisModel();

  constructor(options: RemoteApiEngineOptions) {
    const endpointUrl = options.endpointUrl.trim();
    if (!endpointUrl) {
      throw new Error('Remote API endpoint URL is required');
    }

    this.endpointUrl = endpointUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get name(): string {
    return this.resolvedProviderId;
  }

  get modelName(): string {
    if (this.resolvedProviderId === DEFAULT_PROVIDER_ID) {
      return getAnalysisModel();
    }
    return this.resolvedModelName;
  }

  async generate(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (isDirectEndpoint(this.endpointUrl)) {
        validateRemoteAuth();
        headers.Authorization = `Bearer ${getRemoteApiKey()}`;
      }

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
      const provider = readProvider(body);
      this.resolvedProviderId = provider?.provider_id ?? DEFAULT_PROVIDER_ID;
      this.resolvedModelName = provider?.model_id ?? getAnalysisModel();

      const content = readContent(body);
      if (!content) {
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
