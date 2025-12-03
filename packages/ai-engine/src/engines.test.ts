import { describe, expect, it, vi } from 'vitest';
import { EngineRouter, type JsonCompletionEngine } from './engines';

describe('EngineRouter', () => {
  const mockLocal: JsonCompletionEngine = {
    name: 'local-mock',
    kind: 'local',
    generate: vi.fn().mockResolvedValue('local-response')
  };

  const mockRemote: JsonCompletionEngine = {
    name: 'remote-mock',
    kind: 'remote',
    generate: vi.fn().mockResolvedValue('remote-response')
  };

  it('local-only uses local engine', async () => {
    const router = new EngineRouter(mockLocal, mockRemote, 'local-only');
    const result = await router.generate('prompt');
    expect(result.engine).toBe('local-mock');
    expect(result.text).toBe('local-response');
  });

  it('local-only throws without local engine', async () => {
    const router = new EngineRouter(undefined, mockRemote, 'local-only');
    await expect(router.generate('prompt')).rejects.toThrow('Local engine required');
  });

  it('remote-only uses remote engine', async () => {
    const router = new EngineRouter(mockLocal, mockRemote, 'remote-only');
    const result = await router.generate('prompt');
    expect(result.engine).toBe('remote-mock');
    expect(result.text).toBe('remote-response');
  });

  it('remote-only throws without remote engine', async () => {
    const router = new EngineRouter(mockLocal, undefined, 'remote-only');
    await expect(router.generate('prompt')).rejects.toThrow('Remote engine required');
  });

  it('local-first prefers local when available', async () => {
    const router = new EngineRouter(mockLocal, mockRemote, 'local-first');
    const result = await router.generate('prompt');
    expect(result.engine).toBe('local-mock');
  });

  it('remote-first prefers remote when available', async () => {
    const router = new EngineRouter(mockLocal, mockRemote, 'remote-first');
    const result = await router.generate('prompt');
    expect(result.engine).toBe('remote-mock');
  });

  it('throws when no engine available for policy', async () => {
    const router = new EngineRouter(undefined, undefined, 'shadow');
    await expect(router.generate('prompt')).rejects.toThrow('No engine available');
  });
});
