interface ChatJsonOptions {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

interface EmbeddingOptions {
  model: string;
  texts: string[];
  dimensions: number;
}

export interface OpenAIClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const CHAT_COMPLETIONS_PATH = '/chat/completions';
const EMBEDDINGS_PATH = '/embeddings';

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? 'https://api.openai.com/v1').trim();
  if (!trimmed) {
    throw new Error('OpenAI base URL must be non-empty');
  }
  return trimmed.replace(/\/+$/, '');
}

function normalizeApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('OpenAI API key must be non-empty');
  }
  return trimmed;
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('OpenAI timeout must be a positive finite number');
  }
  return Math.floor(timeoutMs);
}

function resolveFetch(fetchFn: typeof fetch | undefined): typeof fetch {
  const candidate = fetchFn ?? globalThis.fetch;
  if (typeof candidate !== 'function') {
    throw new Error('fetch is unavailable; provide fetchFn');
  }
  return candidate;
}

function resolveTokenParam(model: string): 'max_completion_tokens' | 'max_tokens' {
  return /^(gpt-5|o1|o3)/i.test(model) ? 'max_completion_tokens' : 'max_tokens';
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI returned invalid JSON: ${text.slice(0, 240)}`);
  }
}

function extractJsonContent(payload: unknown): unknown {
  const record = payload as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = record?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI chat response missing content');
  }
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`OpenAI chat response missing JSON object: ${content.slice(0, 240)}`);
  }
  return JSON.parse(match[0]) as unknown;
}

export class OpenAIClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAIClientOptions) {
    this.apiKey = normalizeApiKey(options.apiKey);
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.fetchFn = resolveFetch(options.fetchFn);
  }

  async chatJson<T>(options: ChatJsonOptions): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const tokenParam = resolveTokenParam(options.model);
      const response = await this.fetchFn(`${this.baseUrl}${CHAT_COMPLETIONS_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.user },
          ],
          temperature: options.temperature ?? 0,
          [tokenParam]: options.maxTokens ?? 2_000,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenAI chat request failed: HTTP ${response.status} ${text.slice(0, 240)}`);
      }

      const result = extractJsonContent(await parseJsonResponse(response)) as T;
      clearTimeout(timer);
      return result;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenAI chat request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    }
  }

  async embed(options: EmbeddingOptions): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(`${this.baseUrl}${EMBEDDINGS_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          input: options.texts,
          dimensions: options.dimensions,
          encoding_format: 'float',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenAI embedding request failed: HTTP ${response.status} ${text.slice(0, 240)}`);
      }

      const payload = await parseJsonResponse(response) as { data?: Array<{ embedding?: unknown }> };
      const vectors = payload.data?.map((entry, index) => {
        if (!Array.isArray(entry.embedding)) {
          throw new Error(`OpenAI embedding response missing vector at index ${index}`);
        }
        return entry.embedding.map((value, valueIndex) => {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`OpenAI embedding vector contains invalid value at ${index}:${valueIndex}`);
          }
          return Number(value);
        });
      });

      if (!vectors || vectors.length !== options.texts.length) {
        throw new Error('OpenAI embedding response length mismatch');
      }

      clearTimeout(timer);
      return vectors;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenAI embedding request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    }
  }
}
