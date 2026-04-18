import { resolveTokenParam } from './analysisRelay';

export const DEFAULT_BUNDLE_SYNTHESIS_MODEL = 'gpt-4o-mini';
export const DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS = 1_200;
export const DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS = 20_000;
export const DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN = 20;
export const BUNDLE_SYNTHESIS_RATE_WINDOW_MS = 60_000;

export interface BundleSynthesisCompletionOptions {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  rateLimitKey?: string;
  rateLimitPerMinute?: number;
  fetchFn?: typeof fetch;
}

const rateLimits = new Map<string, { count: number; resetAt: number }>();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getBundleSynthesisModel(): string {
  return process.env.VH_BUNDLE_SYNTHESIS_MODEL || DEFAULT_BUNDLE_SYNTHESIS_MODEL;
}

export function getBundleSynthesisMaxTokens(): number {
  return parsePositiveInt(
    process.env.VH_BUNDLE_SYNTHESIS_MAX_TOKENS,
    DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS,
  );
}

export function getBundleSynthesisTimeoutMs(): number {
  return parsePositiveInt(
    process.env.VH_BUNDLE_SYNTHESIS_TIMEOUT_MS,
    DEFAULT_BUNDLE_SYNTHESIS_TIMEOUT_MS,
  );
}

export function getBundleSynthesisRatePerMinute(): number {
  return parsePositiveInt(
    process.env.VH_BUNDLE_SYNTHESIS_RATE_PER_MIN,
    DEFAULT_BUNDLE_SYNTHESIS_RATE_PER_MIN,
  );
}

export function checkBundleSynthesisRateLimit(
  key: string,
  limit = getBundleSynthesisRatePerMinute(),
): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + BUNDLE_SYNTHESIS_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count += 1;
  return true;
}

export function resetBundleSynthesisRateLimits(): void {
  rateLimits.clear();
}

export function buildBundleOpenAIChatRequest(prompt: string, model?: string, maxTokens?: number) {
  const usedModel = model || getBundleSynthesisModel();
  const tokenParam = resolveTokenParam(usedModel);
  return {
    model: usedModel,
    messages: [
      {
        role: 'system' as const,
        content: 'You are a cross-source news synthesis engine. Return strict JSON only.',
      },
      { role: 'user' as const, content: prompt },
    ],
    [tokenParam]: maxTokens ?? getBundleSynthesisMaxTokens(),
    temperature: 0.3,
    response_format: { type: 'json_object' as const },
  };
}

export async function postBundleSynthesisCompletion(
  prompt: string,
  options: BundleSynthesisCompletionOptions = {},
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Bundle synthesis service not configured (missing OPENAI_API_KEY)');
  }

  const rateLimitKey = options.rateLimitKey ?? 'bundle-synthesis:global';
  if (!checkBundleSynthesisRateLimit(rateLimitKey, options.rateLimitPerMinute)) {
    throw new Error(`Bundle synthesis rate limit exceeded for ${rateLimitKey}`);
  }

  const timeoutMs = options.timeoutMs ?? getBundleSynthesisTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchFn = options.fetchFn ?? fetch;

  try {
    const response = await fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(
        buildBundleOpenAIChatRequest(prompt, options.model, options.maxTokens),
      ),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => 'unknown');
      throw new Error(`OpenAI API error: ${response.status} ${detail}`);
    }

    const body = (await response.json()) as any;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('No content in OpenAI response');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}
