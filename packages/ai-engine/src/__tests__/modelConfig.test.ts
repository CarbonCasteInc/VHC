import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __internal,
  buildRemoteRequest,
  getAnalysisModel,
  getRemoteApiKey,
  RemoteAuthError,
  validateRemoteAuth,
} from '../modelConfig';

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

  it('throws RemoteAuthError when key is missing and validates when present', () => {
    expect(() => validateRemoteAuth()).toThrow(RemoteAuthError);
    expect(() => getRemoteApiKey()).toThrow(RemoteAuthError);

    vi.stubEnv('VITE_REMOTE_API_KEY', 'key-123');

    expect(() => validateRemoteAuth()).not.toThrow();
    expect(getRemoteApiKey()).toBe('key-123');
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
  });
});
