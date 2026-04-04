import { describe, expect, it } from 'vitest';
import {
  isFixtureAnalysisStubEnabled,
  resolveSemanticAuditOpenAIConfig,
  semanticAuditOpenAIInternal,
} from './daemonFirstFeedSemanticAuditOpenAI';

describe('daemonFirstFeedSemanticAuditOpenAI', () => {
  it('uses the local analysis stub in fixture mode without requiring a real OpenAI key', () => {
    expect(resolveSemanticAuditOpenAIConfig({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      VH_DAEMON_FEED_ANALYSIS_STUB_PORT: '9123',
    })).toEqual({
      apiKey: 'fixture-analysis-stub-key',
      providerId: 'openai',
      baseUrl: 'http://127.0.0.1:9123/v1',
      model: 'fixture-analysis-stub',
      modelId: 'fixture-analysis-stub',
      usesFixtureStub: true,
    });
  });

  it('prefers the real key when fixture mode uses the analysis stub locally', () => {
    expect(resolveSemanticAuditOpenAIConfig({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      OPENAI_API_KEY: 'real-key',
      VH_STORYCLUSTER_AUDIT_MODEL: 'gpt-5.4-mini',
    })).toEqual({
      apiKey: 'real-key',
      providerId: 'openai',
      baseUrl: 'http://127.0.0.1:9040/v1',
      model: 'gpt-5.4-mini',
      modelId: 'gpt-5.4-mini',
      usesFixtureStub: true,
    });
  });

  it('requires a real API key outside fixture-stub mode', () => {
    expect(() => resolveSemanticAuditOpenAIConfig({})).toThrow(
      'blocked-setup-openai-api-key-missing',
    );
  });

  it('supports explicit upstream overrides outside fixture mode', () => {
    expect(resolveSemanticAuditOpenAIConfig({
      OPENAI_API_KEY: 'real-key',
      VH_STORYCLUSTER_AUDIT_BASE_URL: 'https://example.test/v1/chat/completions',
      VH_STORYCLUSTER_AUDIT_MODEL: 'gpt-5.4',
    })).toEqual({
      apiKey: 'real-key',
      providerId: 'openai',
      baseUrl: 'https://example.test/v1/chat/completions',
      model: 'gpt-5.4',
      modelId: 'gpt-5.4',
      usesFixtureStub: false,
    });
  });

  it('detects fixture-stub enablement from the feed-mode env contract', () => {
    expect(isFixtureAnalysisStubEnabled({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
    })).toBe(true);
    expect(isFixtureAnalysisStubEnabled({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      VH_DAEMON_FEED_USE_ANALYSIS_STUB: 'false',
    })).toBe(false);
    expect(isFixtureAnalysisStubEnabled({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'false',
    })).toBe(false);
  });

  it('covers internal normalization helpers', () => {
    expect(semanticAuditOpenAIInternal.normalizeNonEmpty('  value  ')).toBe('value');
    expect(semanticAuditOpenAIInternal.normalizeNonEmpty('   ')).toBeUndefined();
    expect(semanticAuditOpenAIInternal.readPositiveIntEnv('42')).toBe(42);
    expect(semanticAuditOpenAIInternal.readPositiveIntEnv('0')).toBeUndefined();
    expect(semanticAuditOpenAIInternal.readPositiveIntEnv('bad')).toBeUndefined();
  });
});
