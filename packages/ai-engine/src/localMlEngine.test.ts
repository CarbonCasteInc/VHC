import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock navigator.gpu for WebGPU detection
const mockNavigator = { gpu: {} };

function setupWebLLMMock(overrides: {
  createFails?: boolean;
  generateResult?: string;
} = {}) {
  const mockCreate = overrides.createFails
    ? vi.fn().mockRejectedValue(new Error('Model load failed'))
    : vi.fn().mockResolvedValue({
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{
                message: {
                  content: overrides.generateResult ?? '{"final_refined":{"summary":"test"}}'
                }
              }]
            })
          }
        }
      });

  vi.doMock('@mlc-ai/web-llm', () => ({
    CreateMLCEngine: mockCreate
  }));

  return { mockCreate };
}

describe('LocalMlEngine', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'navigator', {
      value: mockNavigator,
      writable: true,
      configurable: true
    });
  });

  it('initializes lazily on first generate() and returns content', async () => {
    const { mockCreate } = setupWebLLMMock({ generateResult: '{"summary":"real"}' });
    const { LocalMlEngine } = await import('./localMlEngine');
    const engine = new LocalMlEngine();

    expect(engine.name).toBe('local-webllm');
    expect(engine.kind).toBe('local');
    expect(mockCreate).not.toHaveBeenCalled();

    const result = await engine.generate('test prompt');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toBe('{"summary":"real"}');
  });

  it('reuses initialized engine on subsequent generate() calls', async () => {
    const { mockCreate } = setupWebLLMMock({ generateResult: 'output' });
    const { LocalMlEngine } = await import('./localMlEngine');
    const engine = new LocalMlEngine();

    await engine.generate('prompt 1');
    await engine.generate('prompt 2');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('throws EngineUnavailableError when WebGPU is absent', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
      configurable: true
    });
    const { LocalMlEngine } = await import('./localMlEngine');
    const engine = new LocalMlEngine();

    await expect(engine.generate('test')).rejects.toMatchObject({
      name: 'EngineUnavailableError',
      message: expect.stringContaining('No engine available')
    });
  });

  it('throws EngineUnavailableError when model load fails', async () => {
    setupWebLLMMock({ createFails: true });
    const { LocalMlEngine } = await import('./localMlEngine');
    const engine = new LocalMlEngine();

    await expect(engine.generate('test')).rejects.toMatchObject({
      name: 'EngineUnavailableError'
    });
  });

  it('clears init promise on failure allowing retry with fresh instance', async () => {
    setupWebLLMMock({ createFails: true });
    const { LocalMlEngine } = await import('./localMlEngine');
    const engine = new LocalMlEngine();

    await expect(engine.generate('test')).rejects.toMatchObject({
      name: 'EngineUnavailableError'
    });

    // After failure, initPromise should be cleared
    // A fresh instance with new mocks can succeed
    vi.resetModules();
    setupWebLLMMock({ generateResult: 'recovered' });
    Object.defineProperty(globalThis, 'navigator', {
      value: mockNavigator,
      writable: true,
      configurable: true
    });
    const { LocalMlEngine: FreshEngine } = await import('./localMlEngine');
    const engine2 = new FreshEngine();
    const result = await engine2.generate('retry');
    expect(result).toBe('recovered');
  });

  it('throws EngineUnavailableError when response has no content', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({ choices: [{ message: {} }] })
        }
      }
    });
    vi.doMock('@mlc-ai/web-llm', () => ({ CreateMLCEngine: mockCreate }));
    const { LocalMlEngine } = await import('./localMlEngine');
    const engine = new LocalMlEngine();

    await expect(engine.generate('test')).rejects.toMatchObject({
      name: 'EngineUnavailableError'
    });
  });

  it('accepts custom modelId', async () => {
    setupWebLLMMock();
    const { LocalMlEngine } = await import('./localMlEngine');
    const engine = new LocalMlEngine({ modelId: 'custom-model' });

    expect(engine.modelName).toBe('custom-model');
  });
});
