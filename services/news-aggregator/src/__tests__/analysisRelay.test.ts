import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODEL,
  RATE_LIMIT_PER_MIN,
  buildOpenAIChatRequest,
  checkRateLimit,
  handleAnalyze,
  resetRateLimits,
} from '../analysisRelay';

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

function makeRequest(body: unknown, ip = '127.0.0.1'): MockRequest {
  return {
    body,
    ip,
  };
}

function makeResponse(): MockResponse {
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
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

const VALID_ANALYSIS = {
  summary: 'Article summary',
  bias_claim_quote: ['quote'],
  justify_bias_claim: ['justification'],
  biases: ['bias'],
  counterpoints: ['counterpoint'],
};

const originalOpenAIKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  resetRateLimits();
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  if (originalOpenAIKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  }
});

describe('buildOpenAIChatRequest', () => {
  it('uses default model when model override is not provided', () => {
    const request = buildOpenAIChatRequest('sample article text');

    expect(request.model).toBe(DEFAULT_MODEL);
    expect(request.messages[0]).toMatchObject({ role: 'system' });
    expect(request.messages[1]).toEqual({
      role: 'user',
      content: 'Analyze this news article:\n\nsample article text',
    });
    expect(request.response_format).toEqual({ type: 'json_object' });
  });

  it('uses provided model override', () => {
    const request = buildOpenAIChatRequest('sample article text', 'gpt-4.1-mini');
    expect(request.model).toBe('gpt-4.1-mini');
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
});

describe('handleAnalyze', () => {
  it('returns 503 when OPENAI_API_KEY is missing', async () => {
    const req = makeRequest({ articleText: 'hello world' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual({ error: 'Analysis service not configured (missing API key)' });
  });

  it('returns 400 when articleText is missing', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const req = makeRequest({ articleText: '   ' });
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ error: 'articleText is required' });
  });

  it('returns 429 when rate limit is exceeded', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const blockedIp = '198.51.100.7';
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

  it('returns 502 when OpenAI returns a non-2xx response', async () => {
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

  it('parses response JSON and returns analysis + provenance', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({ final_refined: VALID_ANALYSIS }),
              },
            },
          ],
        }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const req = makeRequest({ articleText: '  hello world  ', model: 'gpt-4.1-mini' }, '192.0.2.88');
    const res = makeResponse();

    await handleAnalyze(req as any, res as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(_url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });

    const parsedBody = JSON.parse(String(init.body));
    expect(parsedBody.model).toBe('gpt-4.1-mini');
    expect(parsedBody.messages[1].content).toContain('hello world');

    const payload = res.payload as {
      analysis: typeof VALID_ANALYSIS & { provider_id: string; model_id: string };
      provenance: { provider_id: string; model: string; timestamp: number };
    };

    expect(res.statusCode).toBe(200);
    expect(payload.analysis.summary).toBe('Article summary');
    expect(payload.analysis.provider_id).toBe('openai');
    expect(payload.analysis.model_id).toBe('gpt-4.1-mini');
    expect(payload.provenance.provider_id).toBe('openai');
    expect(payload.provenance.model).toBe('gpt-4.1-mini');
    expect(payload.provenance.timestamp).toBeTypeOf('number');
  });

  it('returns 500 when parsed payload fails schema validation', async () => {
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
});
