import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS,
  BUNDLE_SYNTHESIS_RATE_WINDOW_MS,
  buildBundleOpenAIChatRequest,
  checkBundleSynthesisRateLimit,
  getBundleSynthesisModel,
  postBundleSynthesisCompletion,
  resetBundleSynthesisRateLimits,
} from './bundleSynthesisRelay';

const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_MODEL = process.env.VH_BUNDLE_SYNTHESIS_MODEL;

beforeEach(() => {
  resetBundleSynthesisRateLimits();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.VH_BUNDLE_SYNTHESIS_MODEL;
});

afterEach(() => {
  if (ORIGINAL_OPENAI_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  }
  if (ORIGINAL_MODEL === undefined) {
    delete process.env.VH_BUNDLE_SYNTHESIS_MODEL;
  } else {
    process.env.VH_BUNDLE_SYNTHESIS_MODEL = ORIGINAL_MODEL;
  }
  vi.unstubAllGlobals();
});

describe('bundleSynthesisRelay', () => {
  it('builds OpenAI chat requests with model/token env defaults', () => {
    process.env.VH_BUNDLE_SYNTHESIS_MODEL = 'gpt-5.2';

    const request = buildBundleOpenAIChatRequest('prompt text');

    expect(getBundleSynthesisModel()).toBe('gpt-5.2');
    expect(request.model).toBe('gpt-5.2');
    expect(request).toMatchObject({
      max_completion_tokens: DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS,
      response_format: { type: 'json_object' },
    });
    expect(request.messages[1]).toEqual({ role: 'user', content: 'prompt text' });
  });

  it('rate-limits by key and resets after the window', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(10_000);

    expect(checkBundleSynthesisRateLimit('story-1', 1)).toBe(true);
    expect(checkBundleSynthesisRateLimit('story-1', 1)).toBe(false);
    expect(checkBundleSynthesisRateLimit('story-2', 1)).toBe(true);

    nowSpy.mockReturnValue(10_000 + BUNDLE_SYNTHESIS_RATE_WINDOW_MS + 1);
    expect(checkBundleSynthesisRateLimit('story-1', 1)).toBe(true);
  });

  it('posts bundle synthesis completions and returns raw model text', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"summary":"ok"}' } }],
        }),
        { status: 200 },
      ),
    );

    await expect(
      postBundleSynthesisCompletion('prompt text', {
        model: 'gpt-4o-mini',
        maxTokens: 42,
        timeoutMs: 1000,
        rateLimitKey: 'story-1',
        fetchFn,
      }),
    ).resolves.toBe('{"summary":"ok"}');

    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
  });

  it('throws on missing key, rate limit, upstream errors, and missing content', async () => {
    await expect(postBundleSynthesisCompletion('prompt')).rejects.toThrow('missing OPENAI_API_KEY');

    process.env.OPENAI_API_KEY = 'test-key';
    const okFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    await expect(
      postBundleSynthesisCompletion('prompt', {
        rateLimitKey: 'story-limited',
        rateLimitPerMinute: 1,
        fetchFn: okFetch,
      }),
    ).rejects.toThrow('No content in OpenAI response');
    await expect(
      postBundleSynthesisCompletion('prompt', {
        rateLimitKey: 'story-limited',
        rateLimitPerMinute: 1,
        fetchFn: okFetch,
      }),
    ).rejects.toThrow('rate limit exceeded');

    await expect(
      postBundleSynthesisCompletion('prompt', {
        rateLimitKey: 'story-http',
        fetchFn: vi.fn(async () => new Response('bad', { status: 502 })),
      }),
    ).rejects.toThrow('OpenAI API error: 502');
  });
});
