import { afterEach, describe, expect, it, vi } from 'vitest';

const mockOpenAIProvider = { providerId: 'openai-provider' };
const mockTestProvider = { providerId: 'test-provider' };

vi.mock('./openaiProvider', () => ({
  createOpenAIStoryClusterProviderFromEnv: vi.fn(() => mockOpenAIProvider),
}));

vi.mock('./testModelProvider', () => ({
  createDeterministicTestModelProvider: vi.fn(() => mockTestProvider),
}));

import { stageRunnerInternal } from './stageRunner';

describe('stageRunnerInternal', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('classifies exported feed labels and resolves language hints', () => {
    expect(stageRunnerInternal.classifyDocument('Breaking: port attack update')).toBe('breaking');
    expect(stageRunnerInternal.classifyDocument('Analysis: market fallout')).toBe('analysis');
    expect(stageRunnerInternal.classifyDocument('Opinion: how to think about it')).toBe('opinion');
    expect(stageRunnerInternal.classifyDocument('Port attack disrupts terminals overnight')).toBe('general');
    expect(stageRunnerInternal.resolveLanguage({
      title: 'Port attack disrupts terminals overnight',
      summary: 'Officials say recovery talks begin Friday.',
      language_hint: 'fr',
    })).toBe('fr');
    expect(stageRunnerInternal.resolveLanguage({
      title: 'Port attack disrupts terminals overnight',
      language_hint: undefined,
    })).toBe('en');
  });

  it('resolves provider preference in explicit, test, and non-test modes', () => {
    const explicit = { providerId: 'explicit-provider' };
    expect(stageRunnerInternal.resolveModelProvider(explicit as never)).toBe(explicit);

    process.env.NODE_ENV = 'test';
    expect(stageRunnerInternal.resolveModelProvider(undefined)).toBe(mockTestProvider);

    process.env.NODE_ENV = 'production';
    expect(stageRunnerInternal.resolveModelProvider(undefined)).toBe(mockOpenAIProvider);
  });
});
