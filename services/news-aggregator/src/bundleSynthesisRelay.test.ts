import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  postBundleSynthesisCompletion,
  resetBundleSynthesisRelayState,
} from './bundleSynthesisRelay';

describe('bundleSynthesisRelay', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetBundleSynthesisRelayState();
  });

  it('uses the bundle-specific upstream and key when configured', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_UPSTREAM_URL', 'http://127.0.0.1:9040/v1/chat/completions');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_API_KEY', 'bundle-key');

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"summary":"ok","frames":[{"frame":"f","reframe":"r"}],"source_count":1,"source_publishers":["A"],"verification_confidence":0.9}' } }],
    }), { status: 200 }));

    const response = await postBundleSynthesisCompletion({
      prompt: 'Generate bundle synthesis',
      model: 'fixture-model',
      fetchFn,
    });

    expect(response.model).toBe('fixture-model');
    expect(response.content).toContain('"summary":"ok"');
    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:9040/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer bundle-key' }),
      }),
    );
  });

  it('falls back to the Web PWA analysis relay upstream for local deterministic stacks', async () => {
    vi.stubEnv('ANALYSIS_RELAY_UPSTREAM_URL', 'http://127.0.0.1:9100/v1/chat/completions');
    vi.stubEnv('ANALYSIS_RELAY_API_KEY', 'analysis-key');

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"summary":"ok","frames":[{"frame":"f","reframe":"r"}],"source_count":1,"source_publishers":["A"],"verification_confidence":0.9}' } }],
    }), { status: 200 }));

    await postBundleSynthesisCompletion({
      prompt: 'Generate bundle synthesis',
      model: 'fixture-model',
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:9100/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer analysis-key' }),
      }),
    );
  });

  it('still defaults to OpenAI when only OPENAI_API_KEY is present', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');

    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"summary":"ok","frames":[{"frame":"f","reframe":"r"}],"source_count":1,"source_publishers":["A"],"verification_confidence":0.9}' } }],
    }), { status: 200 }));

    await postBundleSynthesisCompletion({
      prompt: 'Generate bundle synthesis',
      model: 'fixture-model',
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer openai-key' }),
      }),
    );
  });
});
