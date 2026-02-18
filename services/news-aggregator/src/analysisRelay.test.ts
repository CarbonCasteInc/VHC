import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TOKENS,
  RATE_LIMIT_PER_MIN,
  RATE_WINDOW_MS,
  buildOpenAIChatRequest,
  checkRateLimit,
  getRelayModel,
  handleAnalyze,
  resetRateLimits,
  resolveTokenParam,
} from './analysisRelay';

interface MockRequest {
  body?: unknown;
  ip?: string;
}

interface MockResponse {
  statusCode: number;
  payload: unknown;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_ANALYSIS_RELAY_MODEL = process.env.ANALYSIS_RELAY_MODEL;
const ORIGINAL_VITE_ANALYSIS_MODEL = process.env.VITE_ANALYSIS_MODEL;

const VALID_ANALYSIS = {
  summary: 'Article summary',
  bias_claim_quote: ['quote'],
  justify_bias_claim: ['justification'],
  biases: ['bias'],
  counterpoints: ['counterpoint'],
};

function restoreEnv(name: 'OPENAI_API_KEY' | 'ANALYSIS_RELAY_MODEL' | 'VITE_ANALYSIS_MODEL', value?: string) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function makeRequest(body: unknown, ip = '127.0.0.1'): MockRequest {
  return { body, ip };
}

function makeResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: 200,
    payload: undefined,
    status: vi.fn(),
    json: vi.fn(),
  };

  response.status.mockImplementation((code: number) => {
    response.statusCode = code;
    return response;
  });

  response.json.mockImplementation((payload: unknown) => {
    response.payload = payload;
    return response;
  });

  return response;
}

beforeEach(() => {
  resetRateLimits();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANALYSIS_RELAY_MODEL;
  delete process.env.VITE_ANALYSIS_MODEL;
});

afterEach(() => {
  restoreEnv('OPENAI_API_KEY', ORIGINAL_OPENAI_KEY);
  restoreEnv('ANALYSIS_RELAY_MODEL', ORIGINAL_ANALYSIS_RELAY_MODEL);
  restoreEnv('VITE_ANALYSIS_MODEL', ORIGINAL_VITE_ANALYSIS_MODEL);
  vi.unstubAllGlobals();
});

describe('resolveTokenParam', () => {
  it.each(['gpt-5.2', 'gpt-5.2-codex', 'o1-preview', 'o3-mini'])(
    'returns max_completion_tokens for %s',
    (model) => {
      expect(resolveTokenParam(model)).toBe('max_completion_tokens');
    },
  );

  it.each(['gpt-4o-mini', 'gpt-4o', 'claude-3-opus'])(
    'returns max_tokens for %s',
    (model) => {
      expect(resolveTokenParam(model)).toBe('max_tokens');
    },
  );
});

describe('getRelayModel', () => {
  it('prefers ANALYSIS_RELAY_MODEL when present', () => {
    process.env.ANALYSIS_RELAY_MODEL = 'o3-mini';
    process.env.VITE_ANALYSIS_MODEL = 'gpt-4o-mini';

    expect(getRelayModel()).toBe('o3-mini');
  });

  it('falls back to VITE_ANALYSIS_MODEL when ANALYSIS_RELAY_MODEL is not set', () => {
    process.env.VITE_ANALYSIS_MODEL = 'gpt-4.1-mini';

    expect(getRelayModel()).toBe('gpt-4.1-mini');
  });

  it('falls back to gpt-4o-mini when no env model is set', () => {
    expect(getRelayModel()).toBe('gpt-4o-mini');
  });
});

describe('checkRateLimit', () => {
  it('blocks after configured request count and resets via helper', () => {
    const ip = '203.0.113.10';

    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
      expect(checkRateLimit(ip)).toBe(true);
    }

    expect(checkRateLimit(ip)).toBe(false);

    resetRateLimits();
    expect(checkRateLimit(ip)).toBe(true);
  });

  it('allows requests again once the rate window has elapsed', () => {
    const ip = '198.51.100.9';
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(10_000);
    expect(checkRateLimit(ip)).toBe(true);

    nowSpy.mockReturnValue(10_000 + RATE_WINDOW_MS + 1);
    expect(checkRateLimit(ip)).toBe(true);
  });
});

describe('buildOpenAIChatRequest', () => {
  it('includes JSON response_format and prompt messages', () => {
    const request = buildOpenAIChatRequest('sample article text', 'gpt-4o-mini');

    expect(request.messages[0]).toMatchObject({ role: 'system' });
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: 'Analyze this news article:\n\nsample article text',
    });
    expect(request.response_format).toEqual({ type: 'json_object' });
  });

  it('uses max_completion_tokens for gpt-5/o-series models', () => {
    const request = buildOpenAIChatRequest('sample article text', 'gpt-5.2');

    expect(request.model).toBe('gpt-5.2');
    expect(request).toMatchObject({ max_completion_tokens: MAX_TOKENS });
    expect(request).not.toHaveProperty('max_tokens');
  });

  it('uses max_tokens for legacy models', () => {
    const request = buildOpenAIChatRequest('sample article text', 'gpt-4o-mini');

    expect(request.model).toBe('gpt-4o-mini');
    expect(request).toMatchObject({ max_tokens: MAX_TOKENS });
    expect(request).not.toHaveProperty('max_completion_tokens');
  });

  it('threads model from env fallback chain', () => {
    process.env.ANALYSIS_RELAY_MODEL = 'o1-preview';

    const request = buildOpenAIChatRequest('sample article text');

    expect(request.model).toBe('o1-preview');
    expect(request).toMatchObject({ max_completion_tokens: MAX_TOKENS });
  });
});

describe('handleAnalyze', () => {
  it('returns 503 when OPENAI_API_KEY is missing', async () => {
    const req = makeRequest({ articleText: 'hello world' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual({ error: 'Analysis service not configured (missing API key)' });
  });

  it('returns 400 when articleText is missing or blank', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const req = makeRequest({ articleText: '   ' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ error: 'articleText is required' });
  });

  it('returns 429 when rate limit is exceeded', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const blockedIp = '192.0.2.7';
    for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) {
      checkRateLimit(blockedIp);
    }

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const req = makeRequest({ articleText: 'hello world' }, blockedIp);
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(429);
    expect(res.payload).toEqual({ error: 'Rate limit exceeded' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 when OpenAI returns non-2xx and includes upstream detail', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('upstream error'),
      }),
    );

    const req = makeRequest({ articleText: 'hello world' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(502);
    expect(res.payload).toEqual({
      error: 'OpenAI API error: 500',
      detail: 'upstream error',
    });
  });

  it('returns 502 with unknown detail when upstream text retrieval fails', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error('boom')),
      }),
    );

    const req = makeRequest({ articleText: 'hello world' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(502);
    expect(res.payload).toEqual({
      error: 'OpenAI API error: 503',
      detail: 'unknown',
    });
  });

  it('returns 502 when response content is missing', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: null } }] }),
      }),
    );

    const req = makeRequest({ articleText: 'hello world' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(502);
    expect(res.payload).toEqual({ error: 'No content in OpenAI response' });
  });

  it('returns 502 when no JSON object is found in response content', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'plain text only' } }] }),
      }),
    );

    const req = makeRequest({ articleText: 'hello world' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(502);
    expect(res.payload).toEqual({ error: 'No JSON found in OpenAI response' });
  });

  it('returns 500 when schema validation fails', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify({ final_refined: { summary: 'missing arrays' } }),
                },
              },
            ],
          }),
      }),
    );

    const req = makeRequest({ articleText: 'hello world' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.payload).toMatchObject({
      error: expect.stringContaining('Required'),
    });
  });

  it('returns generic 500 message when thrown value is not an Error instance', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue('network down'),
    );

    const req = makeRequest({ articleText: 'hello world' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual({ error: 'Analysis failed' });
  });

  it('uses top-level parsed JSON when final_refined is absent', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: JSON.stringify(VALID_ANALYSIS),
                },
              },
            ],
          }),
      }),
    );

    const req = makeRequest({ articleText: 'hello world', model: 'gpt-4o-mini' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    const payload = res.payload as {
      analysis: typeof VALID_ANALYSIS & { provider_id: string; model_id: string };
      provenance: { provider_id: string; model: string; timestamp: number };
    };

    expect(res.statusCode).toBe(200);
    expect(payload.analysis.summary).toBe('Article summary');
    expect(payload.analysis.model_id).toBe('gpt-4o-mini');
    expect(payload.provenance.model).toBe('gpt-4o-mini');
  });

  it('returns analysis payload with provenance and model derived from env', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANALYSIS_RELAY_MODEL = 'gpt-5.2-codex';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: `prefix ${JSON.stringify({ final_refined: VALID_ANALYSIS })} suffix`,
              },
            },
          ],
        }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const req = { body: { articleText: '  hello world  ' } };
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });

    const parsedBody = JSON.parse(String(init.body));
    expect(parsedBody.model).toBe('gpt-5.2-codex');
    expect(parsedBody.max_completion_tokens).toBe(MAX_TOKENS);
    expect(parsedBody.max_tokens).toBeUndefined();
    expect(parsedBody.response_format).toEqual({ type: 'json_object' });
    expect(parsedBody.messages[1].content).toContain('hello world');

    const payload = res.payload as {
      analysis: typeof VALID_ANALYSIS & { provider_id: string; model_id: string };
      provenance: { provider_id: string; model: string; timestamp: number };
    };

    expect(res.statusCode).toBe(200);
    expect(payload.analysis).toMatchObject({
      ...VALID_ANALYSIS,
      provider_id: 'openai',
      model_id: 'gpt-5.2-codex',
    });
    expect(payload.provenance.provider_id).toBe('openai');
    expect(payload.provenance.model).toBe('gpt-5.2-codex');
    expect(payload.provenance.timestamp).toBeTypeOf('number');
  });
});
