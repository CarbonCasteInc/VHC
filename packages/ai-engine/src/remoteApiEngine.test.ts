import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteApiEngine } from './remoteApiEngine';

function okJsonResponse(payload: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(payload)
  } as unknown as Response;
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({})
  } as unknown as Response;
}

describe('RemoteApiEngine', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws when endpointUrl is empty', () => {
    expect(() => new RemoteApiEngine({ endpointUrl: '' })).toThrow('Remote API endpoint URL is required');
    expect(() => new RemoteApiEngine({ endpointUrl: '   ' })).toThrow('Remote API endpoint URL is required');
  });

  it('uses fixed engine identity fields', () => {
    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    expect(engine.kind).toBe('remote');
    expect(engine.name).toBe('remote-api');
    expect(engine.modelName).toBe('remote-api-v1');
  });

  it('sends expected POST payload and optional bearer auth header', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }));

    const engine = new RemoteApiEngine({
      endpointUrl: 'https://remote.example/api',
      apiKey: 'secret-key'
    });

    await engine.generate('Prompt body');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(String(calledInit.body));

    expect(calledUrl).toBe('https://remote.example/api');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-key'
    });
    expect(parsedBody).toEqual({
      prompt: 'Prompt body',
      max_tokens: 2048,
      temperature: 0.1
    });
    expect(Object.keys(parsedBody).sort()).toEqual(['max_tokens', 'prompt', 'temperature']);
  });

  it('does not include identity headers and returns OpenAI-style message content', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ choices: [{ message: { content: 'result-json' } }] }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });
    const result = await engine.generate('Prompt body');

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledInit.headers).toEqual({
      'Content-Type': 'application/json'
    });
    expect(String(result)).toBe('result-json');
  });

  it('falls back to response.text payload when choices content is missing', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ response: { text: 'fallback-result' } }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await expect(engine.generate('Prompt body')).resolves.toBe('fallback-result');
  });

  it('throws EngineUnavailableError on HTTP failures', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(errorResponse(500));
    fetchMock.mockResolvedValueOnce(errorResponse(401));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await expect(engine.generate('Prompt body')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only'
    });

    await expect(engine.generate('Prompt body')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only'
    });
  });

  it('throws EngineUnavailableError on network failures', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockRejectedValue(new Error('network down'));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await expect(engine.generate('Prompt body')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only'
    });
  });

  it('throws EngineUnavailableError on timeout', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation((_url, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }) as Promise<Response>;
    });

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });
    const pending = engine.generate('Prompt body');
    const assertion = expect(pending).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only'
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('cleans up timeout timers after successful completion', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ response: { text: '{"ok":true}' } }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await expect(engine.generate('Prompt body')).resolves.toBe('{"ok":true}');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('throws EngineUnavailableError when response content is empty', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ choices: [{ message: { content: '' } }] }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await expect(engine.generate('Prompt body')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only'
    });
  });

  it('throws EngineUnavailableError when response content is not a string', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ response: { text: 123 } }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await expect(engine.generate('Prompt body')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only'
    });
  });

  it('sends only prompt/max_tokens/temperature and no identity payload patterns', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ response: { text: '{"ok":true}' } }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });
    await engine.generate('Article body text only.');

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const serializedBody = String(calledInit.body);
    const parsedBody = JSON.parse(serializedBody);

    expect(parsedBody).toEqual({
      prompt: 'Article body text only.',
      max_tokens: 2048,
      temperature: 0.1
    });
    expect(serializedBody).not.toMatch(/https?:\/\//i);
    expect(serializedBody).not.toMatch(/nullifier/i);
    expect(serializedBody).not.toMatch(/proof/i);
    expect(serializedBody).not.toMatch(/constituency/i);
  });
});
