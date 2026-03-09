import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIClient } from './openaiClient';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenAIClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('validates constructor inputs and fetch availability', () => {
    expect(() => new OpenAIClient({
      apiKey: '   ',
      fetchFn: async () => jsonResponse({}),
    })).toThrow('OpenAI API key must be non-empty');

    expect(() => new OpenAIClient({
      apiKey: 'key',
      baseUrl: '   ',
      fetchFn: async () => jsonResponse({}),
    })).toThrow('OpenAI base URL must be non-empty');

    expect(() => new OpenAIClient({
      apiKey: 'key',
      timeoutMs: 0,
      fetchFn: async () => jsonResponse({}),
    })).toThrow('OpenAI timeout must be a positive finite number');

    vi.stubGlobal('fetch', undefined);
    expect(() => new OpenAIClient({ apiKey: 'key' })).toThrow('fetch is unavailable; provide fetchFn');
  });

  it('sends chat requests with the correct token parameter and trims the API key', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer key');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('gpt-5-mini');
      expect(body.max_completion_tokens).toBe(77);
      expect(body.max_tokens).toBeUndefined();
      return jsonResponse({
        choices: [{ message: { content: 'prefix {"answer":1} suffix' } }],
      });
    });

    const client = new OpenAIClient({ apiKey: ' key ', fetchFn });
    await expect(client.chatJson<{ answer: number }>({
      model: 'gpt-5-mini',
      system: 'sys',
      user: 'usr',
      maxTokens: 77,
    })).resolves.toEqual({ answer: 1 });
  });

  it('uses max_tokens for non-gpt-5 chat models', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.max_tokens).toBe(22);
      expect(body.max_completion_tokens).toBeUndefined();
      return jsonResponse({
        choices: [{ message: { content: '{"ok":true}' } }],
      });
    });

    const client = new OpenAIClient({ apiKey: 'key', fetchFn, baseUrl: 'https://custom.example/v1/' });
    await expect(client.chatJson<{ ok: boolean }>({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
      maxTokens: 22,
    })).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://custom.example/v1/chat/completions',
      expect.any(Object),
    );
  });

  it('fails chat requests on http, invalid json, missing content, missing json object, and timeout', async () => {
    const httpClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => new Response('bad gateway', { status: 502 }),
    });
    await expect(httpClient.chatJson({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
    })).rejects.toThrow('OpenAI chat request failed: HTTP 502 bad gateway');

    const invalidJsonClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await expect(invalidJsonClient.chatJson({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
    })).rejects.toThrow('OpenAI returned invalid JSON:');

    const missingContentClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => jsonResponse({ choices: [{ message: { content: 42 } }] }),
    });
    await expect(missingContentClient.chatJson({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
    })).rejects.toThrow('OpenAI chat response missing content');

    const missingJsonObjectClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => jsonResponse({ choices: [{ message: { content: 'plain text only' } }] }),
    });
    await expect(missingJsonObjectClient.chatJson({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
    })).rejects.toThrow('OpenAI chat response missing JSON object: plain text only');

    const timeoutClient = new OpenAIClient({
      apiKey: 'key',
      timeoutMs: 1,
      fetchFn: (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        init?.signal?.addEventListener('abort', () => reject(abortError));
      }),
    });
    await expect(timeoutClient.chatJson({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
    })).rejects.toThrow('OpenAI chat request timed out after 1ms');

    const stringThrowClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => {
        throw 'chat-string-error';
      },
    });
    await expect(stringThrowClient.chatJson({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
    })).rejects.toBe('chat-string-error');
  });

  it('retries transient chat failures before succeeding', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: '{"ok":true}' } }],
      }));

    const client = new OpenAIClient({ apiKey: 'key', fetchFn });
    await expect(client.chatJson<{ ok: boolean }>({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
    })).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('returns embeddings and fails on malformed responses, http errors, and timeouts', async () => {
    const successClient = new OpenAIClient({
      apiKey: 'key',
      timeoutMs: 99.9,
      fetchFn: async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.dimensions).toBe(2);
        return jsonResponse({
          data: [
            { embedding: [1, 2] },
            { embedding: [3, 4] },
          ],
        });
      },
    });
    await expect(successClient.embed({
      model: 'text-embedding-3-small',
      texts: ['a', 'b'],
      dimensions: 2,
    })).resolves.toEqual([[1, 2], [3, 4]]);

    const httpClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => new Response('too many', { status: 429 }),
    });
    await expect(httpClient.embed({
      model: 'text-embedding-3-small',
      texts: ['a'],
      dimensions: 2,
    })).rejects.toThrow('OpenAI embedding request failed: HTTP 429 too many');

    const missingVectorClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => jsonResponse({ data: [{}] }),
    });
    await expect(missingVectorClient.embed({
      model: 'text-embedding-3-small',
      texts: ['a'],
      dimensions: 2,
    })).rejects.toThrow('OpenAI embedding response missing vector at index 0');

    const invalidValueClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => jsonResponse({ data: [{ embedding: [1, 'x'] }] }),
    });
    await expect(invalidValueClient.embed({
      model: 'text-embedding-3-small',
      texts: ['a'],
      dimensions: 2,
    })).rejects.toThrow('OpenAI embedding vector contains invalid value at 0:1');

    const mismatchClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => jsonResponse({ data: [{ embedding: [1, 2] }] }),
    });
    await expect(mismatchClient.embed({
      model: 'text-embedding-3-small',
      texts: ['a', 'b'],
      dimensions: 2,
    })).rejects.toThrow('OpenAI embedding response length mismatch');

    const timeoutClient = new OpenAIClient({
      apiKey: 'key',
      timeoutMs: 1,
      fetchFn: (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        init?.signal?.addEventListener('abort', () => reject(abortError));
      }),
    });
    await expect(timeoutClient.embed({
      model: 'text-embedding-3-small',
      texts: ['a'],
      dimensions: 2,
    })).rejects.toThrow('OpenAI embedding request timed out after 1ms');

    const stringThrowClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => {
        throw 'embed-string-error';
      },
    });
    await expect(stringThrowClient.embed({
      model: 'text-embedding-3-small',
      texts: ['a'],
      dimensions: 2,
    })).rejects.toBe('embed-string-error');
  });

  it('retries transient embedding failures before succeeding', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('retry later', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [1, 2] }] }));

    const client = new OpenAIClient({ apiKey: 'key', fetchFn });
    await expect(client.embed({
      model: 'text-embedding-3-small',
      texts: ['a'],
      dimensions: 2,
    })).resolves.toEqual([[1, 2]]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('throws retryable fetch errors after exhausting chat and embedding retries', async () => {
    const chatFetchFn = vi.fn(async () => {
      throw new Error('fetch failed: socket closed');
    });
    const chatClient = new OpenAIClient({ apiKey: 'key', fetchFn: chatFetchFn });
    await expect(chatClient.chatJson({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
    })).rejects.toThrow('fetch failed: socket closed');
    expect(chatFetchFn).toHaveBeenCalledTimes(3);

    const embedFetchFn = vi.fn(async () => {
      throw new Error('fetch failed: socket closed');
    });
    const embedClient = new OpenAIClient({ apiKey: 'key', fetchFn: embedFetchFn });
    await expect(embedClient.embed({
      model: 'text-embedding-3-small',
      texts: ['a'],
      dimensions: 2,
    })).rejects.toThrow('fetch failed: socket closed');
    expect(embedFetchFn).toHaveBeenCalledTimes(3);
  });

  it('falls back to empty response text when the upstream body cannot be read', async () => {
    const unreadableBody = {
      ok: false,
      status: 503,
      text: async () => {
        throw new Error('body unavailable');
      },
      json: async () => {
        throw new Error('unused');
      },
    } as unknown as Response;

    const chatClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => unreadableBody,
    });
    await expect(chatClient.chatJson({
      model: 'gpt-4o-mini',
      system: 'sys',
      user: 'usr',
    })).rejects.toThrow('OpenAI chat request failed: HTTP 503 ');

    const embedClient = new OpenAIClient({
      apiKey: 'key',
      fetchFn: async () => unreadableBody,
    });
    await expect(embedClient.embed({
      model: 'text-embedding-3-small',
      texts: ['a'],
      dimensions: 2,
    })).rejects.toThrow('OpenAI embedding request failed: HTTP 503 ');
  });
});
