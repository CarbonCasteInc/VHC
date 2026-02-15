import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __internal,
  buildRemoteRequest,
  getAnalysisModel,
  getRemoteApiKey,
  RemoteAuthError,
  validateRemoteAuth,
} from './modelConfig';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('modelConfig', () => {
  it('returns default analysis model when env var is absent', () => {
    expect(getAnalysisModel()).toBe('gpt-5.2');
  });

  it('reads configured analysis model from env var', () => {
    vi.stubEnv('VITE_ANALYSIS_MODEL', 'custom-model-v1');
    expect(getAnalysisModel()).toBe('custom-model-v1');
  });

  it('builds validated remote request payload', () => {
    vi.stubEnv('VITE_ANALYSIS_MODEL', 'remote-model-v2');
    const request = buildRemoteRequest('Analyze this prompt');

    expect(request).toEqual({
      prompt: 'Analyze this prompt',
      model: 'remote-model-v2',
      max_tokens: 2048,
      temperature: 0.1,
    });

    expect(() => buildRemoteRequest('')).toThrow();
  });

  it('validateRemoteAuth throws RemoteAuthError when VITE_REMOTE_API_KEY is unset', () => {
    expect(() => validateRemoteAuth()).toThrow(RemoteAuthError);
    expect(() => getRemoteApiKey()).toThrow(RemoteAuthError);
  });

  it('validateRemoteAuth succeeds when VITE_REMOTE_API_KEY is set', () => {
    vi.stubEnv('VITE_REMOTE_API_KEY', 'key-123');

    expect(() => validateRemoteAuth()).not.toThrow();
    expect(getRemoteApiKey()).toBe('key-123');
  });

  it('buildRemoteRequest never includes API key material in payload body', () => {
    vi.stubEnv('VITE_ANALYSIS_MODEL', 'remote-model-v3');
    vi.stubEnv('VITE_REMOTE_API_KEY', 'super-secret-api-key');

    const request = buildRemoteRequest('Only prompt content');
    const serialized = JSON.stringify(request);

    expect(serialized).toContain('remote-model-v3');
    expect(serialized).not.toContain('super-secret-api-key');
    expect(serialized.toLowerCase()).not.toContain('authorization');
    expect(serialized.toLowerCase()).not.toContain('api_key');
  });

  it('reads auth key at call time (no caching)', () => {
    vi.stubEnv('VITE_REMOTE_API_KEY', 'first-key');
    expect(getRemoteApiKey()).toBe('first-key');

    vi.stubEnv('VITE_REMOTE_API_KEY', 'second-key');
    expect(getRemoteApiKey()).toBe('second-key');
  });

  it('covers environment reader branches', () => {
    vi.stubEnv('CUSTOM_ENV_VAR', ' value ');
    expect(__internal.readEnvVar('CUSTOM_ENV_VAR')).toBe('value');

    vi.stubEnv('CUSTOM_ENV_VAR', '   ');
    expect(__internal.readEnvVar('CUSTOM_ENV_VAR')).toBeUndefined();

    vi.unstubAllEnvs();
    expect(__internal.readEnvVar('CUSTOM_ENV_VAR')).toBeUndefined();

    const originalProcess = globalThis.process;
    vi.stubGlobal('process', undefined);
    expect(__internal.readEnvVar('CUSTOM_ENV_VAR')).toBeUndefined();
    vi.stubGlobal('process', originalProcess);
  });
});
