import { afterEach, describe, expect, it, vi } from 'vitest';

const { MockLocalMlEngine, MockRemoteApiEngine } = vi.hoisted(() => ({
  MockLocalMlEngine: vi.fn(function MockLocalMlEngine(this: any) {
    this.name = 'local-webllm';
    this.kind = 'local';
    this.modelName = 'Llama-3.1-8B-Instruct-q4f16_1-MLC';
    this.generate = vi.fn().mockResolvedValue('mock-local-response');
  }),
  MockRemoteApiEngine: vi.fn(function MockRemoteApiEngine(this: any, options: any) {
    this.name = 'remote-api';
    this.kind = 'remote';
    this.modelName = options?.modelName ?? 'remote-api-v1';
    this.options = options;
    this.generate = vi.fn().mockResolvedValue('mock-remote-response');
  })
}));

vi.mock('./localMlEngine', () => ({
  LocalMlEngine: MockLocalMlEngine
}));

vi.mock('./remoteApiEngine', () => ({
  RemoteApiEngine: MockRemoteApiEngine
}));

import {
  createDefaultEngine,
  createMockEngine,
  createRemoteEngine,
  isE2EMode,
  EngineRouter,
  EngineUnavailableError,
  type JsonCompletionEngine
} from './engines';

function makeEngine(
  name: string,
  kind: 'local' | 'remote',
  generate: JsonCompletionEngine['generate']
): JsonCompletionEngine {
  return { name, kind, generate };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  MockLocalMlEngine.mockClear();
  MockRemoteApiEngine.mockClear();
});

describe('EngineUnavailableError', () => {
  it('sets policy, name, and message', () => {
    const error = new EngineUnavailableError('local-only');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EngineUnavailableError');
    expect(error.policy).toBe('local-only');
    expect(error.message).toBe('No engine available for policy: local-only');
  });
});

describe('createMockEngine', () => {
  it('returns a local mock engine that emits valid analysis JSON with sentimentScore', async () => {
    const engine = createMockEngine();

    expect(engine.kind).toBe('local');
    expect(engine.name).toBe('mock-local-engine');

    const output = await engine.generate('prompt');
    const parsed = JSON.parse(output) as {
      final_refined: { sentimentScore: number; summary: string };
    };

    expect(parsed.final_refined.summary).toBe('Mock summary');
    expect(parsed.final_refined.sentimentScore).toBeTypeOf('number');
  });
});

describe('isE2EMode', () => {
  it('returns false by default in test environment', () => {
    expect(isE2EMode()).toBe(false);
  });

  it('returns true when VITE_E2E_MODE is true', () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    expect(isE2EMode()).toBe(true);
  });

  it('returns false when process is unavailable', () => {
    vi.stubGlobal('process', undefined);
    expect(isE2EMode()).toBe(false);
  });
});

describe('createDefaultEngine', () => {
  it('returns LocalMlEngine when e2e mode is disabled', () => {
    vi.stubEnv('VITE_E2E_MODE', 'false');

    const engine = createDefaultEngine();

    expect(engine.name).toBe('local-webllm');
    expect(engine.kind).toBe('local');
    expect(MockLocalMlEngine).toHaveBeenCalledTimes(1);
  });

  it('returns mock engine when e2e mode is enabled', () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');

    const engine = createDefaultEngine();

    expect(engine.name).toBe('mock-local-engine');
    expect(engine.kind).toBe('local');
    expect(MockLocalMlEngine).not.toHaveBeenCalled();
  });
});

describe('createRemoteEngine', () => {
  it('returns RemoteApiEngine when URL is configured', () => {
    vi.stubEnv('VITE_E2E_MODE', 'false');
    vi.stubEnv('VITE_REMOTE_ENGINE_URL', 'https://remote.example/v1');

    const engine = createRemoteEngine();

    expect(engine?.name).toBe('remote-api');
    expect(engine?.kind).toBe('remote');
    expect(MockRemoteApiEngine).toHaveBeenCalledWith({
      endpointUrl: 'https://remote.example/v1'
    });
  });

  it('does not pass auth material into engine construction', () => {
    vi.stubEnv('VITE_E2E_MODE', 'false');
    vi.stubEnv('VITE_REMOTE_ENGINE_URL', 'https://remote.example/v1');
    vi.stubEnv('VITE_REMOTE_API_KEY', 'api-key-123');

    createRemoteEngine();

    expect(MockRemoteApiEngine).toHaveBeenCalledWith({
      endpointUrl: 'https://remote.example/v1'
    });
  });

  it('returns undefined when URL is missing or empty', () => {
    vi.stubEnv('VITE_E2E_MODE', 'false');

    expect(createRemoteEngine()).toBeUndefined();
    expect(MockRemoteApiEngine).not.toHaveBeenCalled();

    vi.stubEnv('VITE_REMOTE_ENGINE_URL', '   ');
    expect(createRemoteEngine()).toBeUndefined();
    expect(MockRemoteApiEngine).not.toHaveBeenCalled();
  });

  it('returns undefined in e2e mode even when URL is configured', () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    vi.stubEnv('VITE_REMOTE_ENGINE_URL', 'https://remote.example/v1');

    expect(createRemoteEngine()).toBeUndefined();
    expect(MockRemoteApiEngine).not.toHaveBeenCalled();
  });
});

describe('EngineRouter', () => {
  it('local-only uses local engine', async () => {
    const local = makeEngine('local-mock', 'local', vi.fn().mockResolvedValue('local-response'));
    const remote = makeEngine('remote-mock', 'remote', vi.fn().mockResolvedValue('remote-response'));
    const router = new EngineRouter(local, remote, 'local-only');

    const result = await router.generate('prompt');

    expect(result).toEqual({ engine: 'local-mock', text: 'local-response' });
    expect(local.generate).toHaveBeenCalledTimes(1);
    expect(remote.generate).not.toHaveBeenCalled();
  });

  it('remote-only uses remote engine', async () => {
    const local = makeEngine('local-mock', 'local', vi.fn().mockResolvedValue('local-response'));
    const remote = makeEngine('remote-mock', 'remote', vi.fn().mockResolvedValue('remote-response'));
    const router = new EngineRouter(local, remote, 'remote-only');

    const result = await router.generate('prompt');

    expect(result).toEqual({ engine: 'remote-mock', text: 'remote-response' });
    expect(remote.generate).toHaveBeenCalledTimes(1);
    expect(local.generate).not.toHaveBeenCalled();
  });

  it('local-first falls back to remote when local engine is missing', async () => {
    const remote = makeEngine('remote-mock', 'remote', vi.fn().mockResolvedValue('remote-response'));
    const router = new EngineRouter(undefined, remote, 'local-first');

    const result = await router.generate('prompt');

    expect(result).toEqual({ engine: 'remote-mock', text: 'remote-response' });
    expect(remote.generate).toHaveBeenCalledTimes(1);
  });

  it('remote-first falls back to local when remote engine is missing', async () => {
    const local = makeEngine('local-mock', 'local', vi.fn().mockResolvedValue('local-response'));
    const router = new EngineRouter(local, undefined, 'remote-first');

    const result = await router.generate('prompt');

    expect(result).toEqual({ engine: 'local-mock', text: 'local-response' });
    expect(local.generate).toHaveBeenCalledTimes(1);
  });

  it('local-first falls back when preferred engine throws', async () => {
    const local = makeEngine('local-mock', 'local', vi.fn().mockRejectedValue(new Error('local failed')));
    const remote = makeEngine('remote-mock', 'remote', vi.fn().mockResolvedValue('remote-response'));
    const router = new EngineRouter(local, remote, 'local-first');

    const result = await router.generate('prompt');

    expect(result).toEqual({ engine: 'remote-mock', text: 'remote-response' });
    expect(local.generate).toHaveBeenCalledTimes(1);
    expect(remote.generate).toHaveBeenCalledTimes(1);
  });

  it('throws preferred error when both candidates fail', async () => {
    const local = makeEngine('local-mock', 'local', vi.fn().mockRejectedValue(new Error('local failed')));
    const remote = makeEngine('remote-mock', 'remote', vi.fn().mockRejectedValue(new Error('remote failed')));
    const router = new EngineRouter(local, remote, 'local-first');

    await expect(router.generate('prompt')).rejects.toThrow('remote failed');
    expect(local.generate).toHaveBeenCalledTimes(1);
    expect(remote.generate).toHaveBeenCalledTimes(1);
  });

  it('throws EngineUnavailableError when no engine is available for policy', async () => {
    const router = new EngineRouter(undefined, undefined, 'shadow');

    await expect(router.generate('prompt')).rejects.toBeInstanceOf(EngineUnavailableError);
    await expect(router.generate('prompt')).rejects.toMatchObject({
      message: 'No engine available for policy: shadow'
    });
  });
});
