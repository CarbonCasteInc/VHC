const DEFAULT_ANALYSIS_STUB_KEY = 'fixture-analysis-stub-key';
const DEFAULT_ANALYSIS_STUB_PORT = 9040;
export const DEFAULT_LIVE_SEMANTIC_AUDIT_PROVIDER_ID = 'openai';
export const DEFAULT_LIVE_SEMANTIC_AUDIT_MODEL = 'gpt-4o-mini';

function normalizeNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readPositiveIntEnv(value: string | undefined): number | undefined {
  const trimmed = normalizeNonEmpty(value);
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function isFixtureAnalysisStubEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true'
    && env.VH_DAEMON_FEED_USE_ANALYSIS_STUB !== 'false';
}

export function resolveSemanticAuditOpenAIConfig(
  env: Record<string, string | undefined> = process.env,
): {
  readonly apiKey: string;
  readonly providerId: string;
  readonly baseUrl?: string;
  readonly model: string;
  readonly modelId: string;
  readonly usesFixtureStub: boolean;
} {
  const configuredModel = normalizeNonEmpty(env.VH_STORYCLUSTER_AUDIT_MODEL);

  if (isFixtureAnalysisStubEnabled(env)) {
    const stubPort =
      readPositiveIntEnv(env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT)
      ?? DEFAULT_ANALYSIS_STUB_PORT;
    const modelId = configuredModel ?? 'fixture-analysis-stub';
    return {
      providerId: DEFAULT_LIVE_SEMANTIC_AUDIT_PROVIDER_ID,
      apiKey: normalizeNonEmpty(env.OPENAI_API_KEY) ?? DEFAULT_ANALYSIS_STUB_KEY,
      baseUrl: `http://127.0.0.1:${stubPort}/v1`,
      model: modelId,
      modelId,
      usesFixtureStub: true,
    };
  }

  const apiKey = normalizeNonEmpty(env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error('blocked-setup-openai-api-key-missing');
  }

  const modelId = configuredModel ?? DEFAULT_LIVE_SEMANTIC_AUDIT_MODEL;
  return {
    providerId: DEFAULT_LIVE_SEMANTIC_AUDIT_PROVIDER_ID,
    apiKey,
    baseUrl: normalizeNonEmpty(env.VH_STORYCLUSTER_AUDIT_BASE_URL),
    model: modelId,
    modelId,
    usesFixtureStub: false,
  };
}

export const semanticAuditOpenAIInternal = {
  DEFAULT_LIVE_SEMANTIC_AUDIT_MODEL,
  normalizeNonEmpty,
  readPositiveIntEnv,
};
