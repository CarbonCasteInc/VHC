import { resolveTokenParam, supportsChatTemperatureParam } from './analysisRelay';

export const DEFAULT_BUNDLE_SYNTHESIS_MODEL = 'gpt-4o-mini';
export const DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS = 2400;
export const DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS = 20_000;
export const DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN = 20;
export const DEFAULT_BUNDLE_SYNTHESIS_TEMPERATURE = 0.2;
export const DEFAULT_BUNDLE_SYNTHESIS_PIPELINE_VERSION = 'news-bundle-v2-fulltext';

const RATE_WINDOW_MS = 60_000;
let requestTimestamps: number[] = [];

export interface BundleSynthesisRelayRequest {
  prompt: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  ratePerMinute?: number;
  temperature?: number;
  apiKey?: string;
  upstreamUrl?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export interface BundleSynthesisRelayResponse {
  content: string;
  model: string;
}

export function getBundleSynthesisModel(): string {
  return process.env.VH_BUNDLE_SYNTHESIS_MODEL || DEFAULT_BUNDLE_SYNTHESIS_MODEL;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function shouldUseVhcPromptRelayPayload(upstreamUrl: string): boolean {
  const explicit = readEnv('VH_BUNDLE_SYNTHESIS_RELAY_PAYLOAD')?.toLowerCase();
  if (explicit) {
    return explicit === 'vhc_prompt' || explicit === 'prompt';
  }
  try {
    const parsed = new URL(upstreamUrl);
    return parsed.pathname === '/api/analyze';
  } catch {
    return false;
  }
}

function resolveBundleSynthesisApiKey(request: BundleSynthesisRelayRequest): string | undefined {
  return request.apiKey
    ?? readEnv('VH_BUNDLE_SYNTHESIS_API_KEY')
    ?? readEnv('ANALYSIS_RELAY_API_KEY')
    ?? readEnv('OPENAI_API_KEY');
}

function resolveBundleSynthesisUpstreamUrl(request: BundleSynthesisRelayRequest, apiKey?: string): string | undefined {
  return request.upstreamUrl
    ?? readEnv('VH_BUNDLE_SYNTHESIS_UPSTREAM_URL')
    ?? readEnv('ANALYSIS_RELAY_UPSTREAM_URL')
    ?? (apiKey ? 'https://api.openai.com/v1/chat/completions' : undefined);
}

function assertBundleRateLimit(ratePerMinute: number, nowMs: number): void {
  const normalizedRate = Math.max(1, Math.floor(ratePerMinute));
  requestTimestamps = requestTimestamps.filter((timestamp) => nowMs - timestamp < RATE_WINDOW_MS);
  if (requestTimestamps.length >= normalizedRate) {
    throw new Error(`Bundle synthesis rate limit exceeded (${normalizedRate}/min)`);
  }
  requestTimestamps.push(nowMs);
}

export function resetBundleSynthesisRelayState(): void {
  requestTimestamps = [];
}

function readRelayContent(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as {
    content?: unknown;
    response?: { text?: unknown };
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  if (typeof record.content === 'string' && record.content.trim()) {
    return record.content;
  }
  if (typeof record.response?.text === 'string' && record.response.text.trim()) {
    return record.response.text;
  }
  const choiceContent = record.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string' && choiceContent.trim()) {
    return choiceContent;
  }
  return null;
}

function readRelayModel(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') {
    return fallback;
  }
  const record = body as {
    model?: unknown;
    provider?: { model_id?: unknown };
    response?: { model?: unknown };
  };
  for (const candidate of [record.model, record.provider?.model_id, record.response?.model]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }
  return fallback;
}

export async function postBundleSynthesisCompletion(
  request: BundleSynthesisRelayRequest,
): Promise<BundleSynthesisRelayResponse> {
  const apiKey = resolveBundleSynthesisApiKey(request);
  if (!apiKey) {
    throw new Error('Bundle synthesis service not configured (missing API key)');
  }

  const upstreamUrl = resolveBundleSynthesisUpstreamUrl(request, apiKey);
  if (!upstreamUrl) {
    throw new Error('Bundle synthesis service not configured (missing upstream URL)');
  }

  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error('Bundle synthesis prompt is required');
  }

  const model = request.model?.trim() || getBundleSynthesisModel();
  const maxTokens = Math.max(1, Math.floor(request.maxTokens ?? DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS));
  const timeoutMs = Math.max(1, Math.floor(request.timeoutMs ?? DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS));
  const ratePerMinute = Math.max(1, Math.floor(request.ratePerMinute ?? DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN));
  const temperature = typeof request.temperature === 'number' && Number.isFinite(request.temperature)
    ? request.temperature
    : DEFAULT_BUNDLE_SYNTHESIS_TEMPERATURE;
  const now = request.now ?? Date.now;
  assertBundleRateLimit(ratePerMinute, now());

  const fetchFn = request.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tokenParam = resolveTokenParam(model);

  try {
    const requestBody = shouldUseVhcPromptRelayPayload(upstreamUrl)
      ? {
          prompt,
          model,
          max_tokens: maxTokens,
          ...(supportsChatTemperatureParam(model) ? { temperature } : {}),
        }
      : {
          model,
          messages: [
            {
              role: 'system',
              content: 'You synthesize verified news story bundles. Return only strict JSON.',
            },
            { role: 'user', content: prompt },
          ],
          [tokenParam]: maxTokens,
          ...(supportsChatTemperatureParam(model) ? { temperature } : {}),
          response_format: { type: 'json_object' },
        };

    const response = await fetchFn(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => 'unknown');
      throw new Error(`OpenAI bundle synthesis error: HTTP ${response.status}: ${detail.slice(0, 500)}`);
    }

    const body = await response.json();
    const content = readRelayContent(body);
    if (!content) {
      throw new Error('OpenAI bundle synthesis response did not include content');
    }

    return { content, model: readRelayModel(body, model) };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Bundle synthesis timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
