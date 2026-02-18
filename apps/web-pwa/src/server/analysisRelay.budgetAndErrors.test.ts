import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAnalysisRelayBudgetForTests,
  relayAnalysis,
} from './analysisRelay';
import * as schemaModule from '../../../../packages/ai-engine/src/schema';

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

function statusResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
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

describe('analysisRelay budget + error paths', () => {
  beforeEach(() => {
    __resetAnalysisRelayBudgetForTests();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns 429 for daily analyses limit and per-topic limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: '{"ok":true}' }));

    const limitedEnv = {
      ...BASE_ENV,
      ANALYSIS_RELAY_BUDGET_ANALYSES: '1',
      ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC: '1',
    };

    const first = await relayAnalysis(
      { prompt: 'first', topicId: 'topic-a' },
      { env: limitedEnv, fetchImpl: fetchMock },
    );
    expect(first.status).toBe(200);

    const dailyDenied = await relayAnalysis(
      { prompt: 'second', topicId: 'topic-b' },
      { env: limitedEnv, fetchImpl: fetchMock },
    );
    expect(dailyDenied.status).toBe(429);
    expect(dailyDenied.payload.error).toContain('Daily limit of 1 reached for analyses');

    __resetAnalysisRelayBudgetForTests();

    const perTopicEnv = {
      ...BASE_ENV,
      ANALYSIS_RELAY_BUDGET_ANALYSES: '9',
      ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC: '1',
    };

    await relayAnalysis(
      { prompt: 'first', topicId: 'topic-a' },
      { env: perTopicEnv, fetchImpl: fetchMock },
    );

    const topicDenied = await relayAnalysis(
      { prompt: 'second', topicId: 'topic-a' },
      { env: perTopicEnv, fetchImpl: fetchMock },
    );

    expect(topicDenied.status).toBe(429);
    expect(topicDenied.payload.error).toContain('Per-topic cap of 1 reached for analyses_per_topic on topic topic-a');
  });

  it('resets budget counters across UTC day boundaries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: '{"ok":true}' }));
    const env = {
      ...BASE_ENV,
      ANALYSIS_RELAY_BUDGET_ANALYSES: '1',
    };

    const day1 = () => new Date('2026-02-17T00:00:00.000Z');
    const day2 = () => new Date('2026-02-18T00:00:00.000Z');

    const first = await relayAnalysis(
      { prompt: 'day-1' },
      { env, fetchImpl: fetchMock, now: day1 },
    );
    expect(first.status).toBe(200);

    const deniedSameDay = await relayAnalysis(
      { prompt: 'day-1-second' },
      { env, fetchImpl: fetchMock, now: day1 },
    );
    expect(deniedSameDay.status).toBe(429);

    const allowedNextDay = await relayAnalysis(
      { prompt: 'day-2' },
      { env, fetchImpl: fetchMock, now: day2 },
    );
    expect(allowedNextDay.status).toBe(200);
  });

  it('handles upstream error responses, missing content, parse errors, and thrown fetch errors', async () => {
    const nonOk = await relayAnalysis(
      { prompt: 'x' },
      { env: BASE_ENV, fetchImpl: vi.fn().mockResolvedValue(statusResponse(500)) },
    );
    expect(nonOk).toEqual({ status: 502, payload: { error: 'Upstream returned 500' } });

    const missingContent = await relayAnalysis(
      { prompt: 'x' },
      { env: BASE_ENV, fetchImpl: vi.fn().mockResolvedValue(okResponse({})) },
    );
    expect(missingContent).toEqual({
      status: 502,
      payload: { error: 'Upstream response missing content' },
    });

    const missingContentFromNonObject = await relayAnalysis(
      { prompt: 'x' },
      { env: BASE_ENV, fetchImpl: vi.fn().mockResolvedValue(okResponse('raw-string-response')) },
    );
    expect(missingContentFromNonObject).toEqual({
      status: 502,
      payload: { error: 'Upstream response missing content' },
    });

    const parseFailure = await relayAnalysis(
      { articleText: 'Topic ID: parse-topic\nBody' },
      { env: BASE_ENV, fetchImpl: vi.fn().mockResolvedValue(okResponse({ content: 'not-json' })) },
    );
    expect(parseFailure.status).toBe(502);
    expect(parseFailure.payload.error).toBe('Relay could not parse analysis output');

    const thrownFetch = await relayAnalysis(
      { prompt: 'x' },
      {
        env: BASE_ENV,
        fetchImpl: vi.fn().mockRejectedValue(new Error('network down')),
      },
    );
    expect(thrownFetch).toEqual({
      status: 502,
      payload: { error: 'network down' },
    });

    const thrownNonError = await relayAnalysis(
      { prompt: 'x' },
      {
        env: BASE_ENV,
        fetchImpl: vi.fn().mockRejectedValue('network down'),
      },
    );
    expect(thrownNonError).toEqual({
      status: 502,
      payload: { error: 'Relay request failed' },
    });
  });

  it('handles parse failures that throw non-Error values', async () => {
    const parseSpy = vi
      .spyOn(schemaModule, 'parseAnalysisResponse')
      .mockImplementation(() => {
        throw 'non-error-parse';
      });

    const result = await relayAnalysis(
      { articleText: 'Topic ID: parse-topic\nBody' },
      {
        env: BASE_ENV,
        fetchImpl: vi.fn().mockResolvedValue(okResponse({ content: validAnalysisContent('x') })),
      },
    );

    expect(result.status).toBe(502);
    expect(result.payload.details).toBe('Unknown parse failure');
    parseSpy.mockRestore();
  });

  it('uses global fetch fallback when fetchImpl is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ content: '{"ok":true}' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await relayAnalysis({ prompt: 'global fetch path' }, { env: BASE_ENV });

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles environments where process is unavailable', async () => {
    const originalProcess = globalThis.process;
    vi.stubGlobal('process', undefined);

    const result = await relayAnalysis({ prompt: 'x' });

    expect(result).toEqual({
      status: 503,
      payload: { error: 'Analysis relay is not configured' },
    });

    vi.stubGlobal('process', originalProcess);
  });
});
