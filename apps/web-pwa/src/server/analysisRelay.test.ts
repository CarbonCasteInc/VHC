import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAnalysisRelayBudgetForTests,
  extractTopicId,
  relayAnalysis,
  resolveAnalysisRelayConfig,
} from './analysisRelay';

const BASE_ENV = {
  ANALYSIS_RELAY_UPSTREAM_URL: 'https://relay.example/v1/chat/completions',
  ANALYSIS_RELAY_API_KEY: 'server-secret',
};

function okResponse(payload: unknown): Response {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function validAnalysisContent(summary = 'Summary text'): string {
  return JSON.stringify({
    final_refined: {
      summary,
      bias_claim_quote: ['quote'],
      justify_bias_claim: ['reason'],
      biases: ['bias'],
      counterpoints: ['counter'],
    },
  });
}

describe('analysisRelay config + success paths', () => {
  beforeEach(() => {
    __resetAnalysisRelayBudgetForTests();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('resolves config from non-VITE env vars and applies defaults', () => {
    const config = resolveAnalysisRelayConfig(BASE_ENV);
    expect(config).toMatchObject({
      endpointUrl: BASE_ENV.ANALYSIS_RELAY_UPSTREAM_URL,
      apiKey: BASE_ENV.ANALYSIS_RELAY_API_KEY,
      providerId: 'remote-analysis-relay',
      analysesLimit: 25,
      analysesPerTopicLimit: 5,
    });

    expect(
      resolveAnalysisRelayConfig({
        VITE_ANALYSIS_RELAY_UPSTREAM_URL: 'https://bad.example',
        VITE_ANALYSIS_RELAY_API_KEY: 'bad',
      } as Record<string, string | undefined>),
    ).toBeNull();
  });

  it('applies relay config overrides for provider/model and budget limits', () => {
    const config = resolveAnalysisRelayConfig({
      ...BASE_ENV,
      ANALYSIS_RELAY_PROVIDER_ID: 'provider-1',
      ANALYSIS_RELAY_MODEL: 'server-model',
      ANALYSIS_RELAY_BUDGET_ANALYSES: '9',
      ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC: '2',
    });

    expect(config).toMatchObject({
      providerId: 'provider-1',
      modelOverride: 'server-model',
      analysesLimit: 9,
      analysesPerTopicLimit: 2,
    });
  });

  it('falls back to default limits when limit env vars are invalid', () => {
    const config = resolveAnalysisRelayConfig({
      ...BASE_ENV,
      ANALYSIS_RELAY_BUDGET_ANALYSES: 'not-a-number',
      ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC: '0',
    });

    expect(config?.analysesLimit).toBe(25);
    expect(config?.analysesPerTopicLimit).toBe(5);
  });

  it('extracts topic IDs from article payload text', () => {
    expect(extractTopicId('Topic ID: topic-123\nBody line')).toBe('topic-123');
    expect(extractTopicId('No topic id present')).toBeUndefined();
  });

  it('returns 503 when relay env config is missing', async () => {
    const result = await relayAnalysis({ prompt: 'Hello' }, { env: {} });
    expect(result).toEqual({
      status: 503,
      payload: { error: 'Analysis relay is not configured' },
    });
  });

  it('returns 400 when payload does not match article or prompt schema', async () => {
    const result = await relayAnalysis({ nope: true }, { env: BASE_ENV });
    expect(result.status).toBe(400);
    expect(result.payload.error).toBe('Invalid relay request payload');

    const nonObjectResult = await relayAnalysis('bad-payload', { env: BASE_ENV });
    expect(nonObjectResult.status).toBe(400);
  });

  it('returns 400 for invalid prompt max_tokens and temperature values', async () => {
    const invalidMaxTokens = await relayAnalysis(
      { prompt: 'Prompt body', max_tokens: 0 },
      { env: BASE_ENV },
    );
    expect(invalidMaxTokens.status).toBe(400);

    const invalidTemperature = await relayAnalysis(
      { prompt: 'Prompt body', temperature: 3 },
      { env: BASE_ENV },
    );
    expect(invalidTemperature.status).toBe(400);
  });

  it('relays prompt payloads and returns provenance + budget snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ content: '{"ok":true}', model: 'provider-model' }),
    );

    const result = await relayAnalysis(
      {
        prompt: 'Prompt body',
        model: 'client-model',
        max_tokens: 128,
        temperature: 0.2,
        topicId: 'topic-1',
      },
      { env: BASE_ENV, fetchImpl: fetchMock },
    );

    expect(result.status).toBe(200);
    expect(result.payload.provider).toEqual({
      provider_id: 'remote-analysis-relay',
      model_id: 'provider-model',
      kind: 'remote',
    });
    expect(result.payload.budget).toEqual({ analyses: 1, analyses_per_topic: 1 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(url).toBe(BASE_ENV.ANALYSIS_RELAY_UPSTREAM_URL);
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer server-secret',
    });
    expect(body).toMatchObject({
      prompt: 'Prompt body',
      model: 'client-model',
      max_tokens: 128,
      temperature: 0.2,
    });
  });

  it('enforces server model override even when client supplies model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: '{"ok":true}' }));

    await relayAnalysis(
      {
        prompt: 'Prompt body',
        model: 'client-model',
      },
      {
        env: {
          ...BASE_ENV,
          ANALYSIS_RELAY_MODEL: 'server-locked-model',
        },
        fetchImpl: fetchMock,
      },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('server-locked-model');
  });

  it('supports process.env fallback when env override is not passed', async () => {
    vi.stubEnv('ANALYSIS_RELAY_UPSTREAM_URL', BASE_ENV.ANALYSIS_RELAY_UPSTREAM_URL);
    vi.stubEnv('ANALYSIS_RELAY_API_KEY', BASE_ENV.ANALYSIS_RELAY_API_KEY);

    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: '{"ok":true}' }));
    const result = await relayAnalysis({ prompt: 'Prompt from process env' }, { fetchImpl: fetchMock });

    expect(result.status).toBe(200);
  });

  it('falls through response.text and response.model to choices/fallback model when blank', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        response: { text: '   ', model: '   ' },
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    );

    const result = await relayAnalysis(
      {
        prompt: 'Prompt body',
        model: 'client-model',
      },
      { env: BASE_ENV, fetchImpl: fetchMock },
    );

    expect(result.status).toBe(200);
    expect(result.payload.provider?.model_id).toBe('client-model');
  });

  it('uses response.text and response.model when present', async () => {
    const result = await relayAnalysis(
      {
        prompt: 'Prompt body',
      },
      {
        env: BASE_ENV,
        fetchImpl: vi.fn().mockResolvedValue(
          okResponse({ response: { text: '{"ok":true}', model: 'response-model' } }),
        ),
      },
    );

    expect(result.status).toBe(200);
    expect(result.payload.content).toBe('{"ok":true}');
    expect(result.payload.provider?.model_id).toBe('response-model');
  });

  it('parses article requests into analysis payloads and derives topic from text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: validAnalysisContent('Article summary') } }],
      }),
    );

    const articleText = [
      'Publisher: Example',
      'Topic ID: topic-derived',
      'ARTICLE BODY:',
      'Body paragraph',
    ].join('\n');

    const result = await relayAnalysis(
      { articleText },
      { env: BASE_ENV, fetchImpl: fetchMock },
    );

    expect(result.status).toBe(200);
    expect(result.payload.analysis?.summary).toBe('Article summary');
    expect(result.payload.analysis?.provider).toEqual({
      provider_id: 'remote-analysis-relay',
      model_id: 'gpt-5.2',
      kind: 'remote',
    });
    expect(result.payload.budget).toEqual({ analyses: 1, analyses_per_topic: 1 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.prompt).toContain('You are VHC.Legacy, the canonical analysis path for article synthesis.');
  });

  it('uses explicit topicId for article requests when provided', async () => {
    const result = await relayAnalysis(
      { articleText: 'ARTICLE BODY:\nBody text', topicId: 'topic-explicit' },
      {
        env: BASE_ENV,
        fetchImpl: vi.fn().mockResolvedValue(okResponse({ content: validAnalysisContent('Explicit topic summary') })),
      },
    );

    expect(result.status).toBe(200);
    expect(result.payload.budget).toEqual({ analyses: 1, analyses_per_topic: 1 });
  });

  it('forwards client model override from article request to upstream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ content: validAnalysisContent('Model override test') }),
    );

    const result = await relayAnalysis(
      { articleText: 'Topic ID: topic-model\nBody text', model: 'gpt-4o' },
      { env: BASE_ENV, fetchImpl: fetchMock },
    );

    expect(result.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('gpt-4o');
  });

  it('forwards codex-auth model override from article request to upstream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ content: validAnalysisContent('Codex override test') }),
    );

    const result = await relayAnalysis(
      {
        articleText: 'Topic ID: topic-codex\nBody text',
        model: 'openai-codex/gpt-5.2-codex',
      },
      { env: BASE_ENV, fetchImpl: fetchMock },
    );

    expect(result.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('openai-codex/gpt-5.2-codex');
  });

  it('uses default model when article request has no model field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ content: validAnalysisContent('No model override') }),
    );

    await relayAnalysis(
      { articleText: 'Topic ID: topic-default\nBody text' },
      { env: BASE_ENV, fetchImpl: fetchMock },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('gpt-5.2');
  });

  it('client article model overrides config modelOverride (dev-only relay)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ content: validAnalysisContent('Client wins') }),
    );

    await relayAnalysis(
      { articleText: 'Body text', model: 'claude-3-haiku' },
      {
        env: { ...BASE_ENV, ANALYSIS_RELAY_MODEL: 'server-locked-model' },
        fetchImpl: fetchMock,
      },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('claude-3-haiku');
  });
});
