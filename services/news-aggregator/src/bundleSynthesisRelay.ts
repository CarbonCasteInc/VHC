import { resolveTokenParam } from './analysisRelay';

export const DEFAULT_BUNDLE_SYNTHESIS_MODEL = 'gpt-4o-mini';
export const DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS = 1200;
export const DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS = 20_000;
export const DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN = 20;
export const DEFAULT_BUNDLE_SYNTHESIS_PIPELINE_VERSION = 'news-bundle-v1';

const RATE_WINDOW_MS = 60_000;
let requestTimestamps: number[] = [];

export interface BundleSynthesisRelayRequest {
  prompt: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  ratePerMinute?: number;
  apiKey?: string;
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

export async function postBundleSynthesisCompletion(
  request: BundleSynthesisRelayRequest,
): Promise<BundleSynthesisRelayResponse> {
  const apiKey = request.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Bundle synthesis service not configured (missing OPENAI_API_KEY)');
  }

  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error('Bundle synthesis prompt is required');
  }

  const model = request.model?.trim() || getBundleSynthesisModel();
  const maxTokens = Math.max(1, Math.floor(request.maxTokens ?? DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS));
  const timeoutMs = Math.max(1, Math.floor(request.timeoutMs ?? DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS));
  const ratePerMinute = Math.max(1, Math.floor(request.ratePerMinute ?? DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN));
  const now = request.now ?? Date.now;
  assertBundleRateLimit(ratePerMinute, now());

  const fetchFn = request.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tokenParam = resolveTokenParam(model);

  try {
    const response = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You synthesize verified news story bundles. Return only strict JSON.',
          },
          { role: 'user', content: prompt },
        ],
        [tokenParam]: maxTokens,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => 'unknown');
      throw new Error(`OpenAI bundle synthesis error: HTTP ${response.status}: ${detail.slice(0, 500)}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('OpenAI bundle synthesis response did not include content');
    }

    return { content, model };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Bundle synthesis timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
