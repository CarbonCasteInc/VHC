import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteAuthError } from './modelConfig';
import { RemoteApiEngine } from './remoteApiEngine';

function okJsonResponse(payload: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
  } as unknown as Response;
}

describe('RemoteApiEngine', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('VITE_REMOTE_API_KEY', 'secret-key');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('throws when endpointUrl is empty', () => {
    expect(() => new RemoteApiEngine({ endpointUrl: '' })).toThrow('Remote API endpoint URL is required');
    expect(() => new RemoteApiEngine({ endpointUrl: '   ' })).toThrow('Remote API endpoint URL is required');
  });

  it('uses configured model identity fields', () => {
    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    expect(engine.kind).toBe('remote');
    expect(engine.name).toBe('remote-api');
    expect(engine.modelName).toBe('gpt-5.2');

    vi.stubEnv('VITE_ANALYSIS_MODEL', 'gpt-5.2-mini');
    expect(engine.modelName).toBe('gpt-5.2-mini');
  });

  it('sends expected POST payload and bearer auth header', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await engine.generate('Prompt body');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(String(calledInit.body));

    expect(calledUrl).toBe('https://remote.example/api');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-key',
    });
    expect(parsedBody).toEqual({
      prompt: 'Prompt body',
      model: 'gpt-5.2',
      max_tokens: 2048,
      temperature: 0.1,
    });
    expect(Object.keys(parsedBody).sort()).toEqual([
      'max_tokens',
      'model',
      'prompt',
      'temperature',
    ]);
  });

  it('uses configured model in request body', async () => {
    vi.stubEnv('VITE_ANALYSIS_MODEL', 'gpt-5.2-extended');

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ choices: [{ message: { content: 'result-json' } }] }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });
    await engine.generate('Prompt body');

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(String(calledInit.body));
    expect(parsedBody.model).toBe('gpt-5.2-extended');
  });

  it('does not require API key for same-origin relay endpoint', async () => {
    vi.unstubAllEnvs();

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ content: '{"ok":true}' }));

    const engine = new RemoteApiEngine({ endpointUrl: '/api/analyze' });
    await expect(engine.generate('Prompt body')).resolves.toBe('{"ok":true}');

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledInit.headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('adopts provider provenance from relay responses', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      okJsonResponse({
        content: '{"ok":true}',
        provider: {
          provider_id: 'relay-provider',
          model_id: 'gpt-5.2-relay',
        },
      }),
    );

    const engine = new RemoteApiEngine({ endpointUrl: '/api/analyze' });
    await engine.generate('Prompt body');

    expect(engine.name).toBe('relay-provider');
    expect(engine.modelName).toBe('gpt-5.2-relay');
  });

  it('ignores malformed provider payloads and keeps defaults', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        content: '{"ok":true}',
        provider: {
          provider_id: 123,
          model_id: 'm',
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      okJsonResponse({
        content: '{"ok":true}',
        provider: {
          provider_id: '   ',
          model_id: '   ',
        },
      }),
    );

    const engine = new RemoteApiEngine({ endpointUrl: '/api/analyze' });
    await engine.generate('Prompt body');
    expect(engine.name).toBe('remote-api');
    expect(engine.modelName).toBe('gpt-5.2');

    await engine.generate('Prompt body 2');
    expect(engine.name).toBe('remote-api');
    expect(engine.modelName).toBe('gpt-5.2');
  });

  it('treats non-object JSON payloads as unavailable', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse('plain-text-payload'));

    const engine = new RemoteApiEngine({ endpointUrl: '/api/analyze' });
    await expect(engine.generate('Prompt body')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only',
    });
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
      policy: 'remote-only',
    });

    await expect(engine.generate('Prompt body')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only',
    });
  });

  it('throws EngineUnavailableError on network failures', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockRejectedValue(new Error('network down'));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await expect(engine.generate('Prompt body')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only',
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
      policy: 'remote-only',
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
      policy: 'remote-only',
    });
  });

  it('throws EngineUnavailableError when response content is not a string', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ response: { text: 123 } }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await expect(engine.generate('Prompt body')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      policy: 'remote-only',
    });
  });

  it('throws RemoteAuthError when API key is missing', async () => {
    vi.unstubAllEnvs();

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ choices: [{ message: { content: 'ok' } }] }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    await expect(engine.generate('Prompt body')).rejects.toBeInstanceOf(RemoteAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads API key at request time (not cached)', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ choices: [{ message: { content: 'ok' } }] }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });

    vi.stubEnv('VITE_REMOTE_API_KEY', 'first-key');
    await engine.generate('Prompt body');

    vi.stubEnv('VITE_REMOTE_API_KEY', 'second-key');
    await engine.generate('Prompt body');

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;

    expect(firstHeaders.Authorization).toBe('Bearer first-key');
    expect(secondHeaders.Authorization).toBe('Bearer second-key');
  });

  it('never places API keys inside request payloads', async () => {
    vi.stubEnv('VITE_REMOTE_API_KEY', 'super-secret');

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(okJsonResponse({ response: { text: '{"ok":true}' } }));

    const engine = new RemoteApiEngine({ endpointUrl: 'https://remote.example/api' });
    await engine.generate('Article body text only.');

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const serializedBody = String(calledInit.body);

    expect(serializedBody).not.toMatch(/super-secret/i);
    expect(serializedBody).toMatch(/"model":"gpt-5\.2"/);
    expect(serializedBody).not.toMatch(/authorization/i);
  });
});
