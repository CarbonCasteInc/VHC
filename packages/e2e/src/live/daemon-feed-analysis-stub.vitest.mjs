import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildFixtureAnalysis,
  fixtureAnalysisStubInternal,
  startFixtureAnalysisStub,
  startFixtureAnalysisStubWhenLaunchedDirectly,
  stopFixtureAnalysisStub,
} from './daemon-feed-analysis-stub.mjs';

afterEach(async () => {
  await stopFixtureAnalysisStub();
  fixtureAnalysisStubInternal.removeShutdownHandler();
  vi.restoreAllMocks();
});

describe('daemon-feed-analysis-stub', () => {
  it('builds a semantically anchored analysis from prompt metadata and body', () => {
    const analysis = buildFixtureAnalysis([
      'Publisher: CBS News',
      'Article title: Emergency Geneva talks begin after overnight missile strike hits fuel depots',
      'Story headline: Emergency Geneva talks begin after overnight missile strike hits fuel depots',
      '',
      'ARTICLE BODY:',
      'Emergency ceasefire talks began in Geneva after an overnight missile strike hit fuel depots and forced negotiators back to the table. More detail follows.',
    ].join('\n'));

    expect(analysis.summary).toContain('Emergency ceasefire talks began in Geneva');
    expect(analysis.bias_claim_quote[0]).toContain('Emergency Geneva talks begin');
    expect(analysis.perspectives[0]?.frame).toContain('Emergency Geneva talks begin');
  });

  it('falls back cleanly when the body is unavailable', () => {
    const analysis = buildFixtureAnalysis([
      'Article title: Atlantic port strike enters second day, delaying container traffic',
      'Story headline: Atlantic port strike enters second day, delaying container traffic',
      '',
      'ARTICLE BODY: unavailable; analyze available metadata only.',
    ].join('\n'));

    expect(analysis.summary).toContain('Atlantic port strike enters second day');
    expect(analysis.counterpoints).toHaveLength(1);
    expect(analysis.biases).toEqual(['Urgency framing']);
  });

  it('covers parsing helpers and server endpoints', async () => {
    expect(fixtureAnalysisStubInternal.firstSentence('')).toBe('');
    expect(fixtureAnalysisStubInternal.firstSentence(null)).toBe('');
    expect(fixtureAnalysisStubInternal.firstSentence('No punctuation here')).toBe('No punctuation here');
    expect(fixtureAnalysisStubInternal.firstSentence('Alpha. Beta.')).toBe('Alpha.');
    expect(fixtureAnalysisStubInternal.readStubPort({})).toBe(9040);
    expect(fixtureAnalysisStubInternal.readStubPort({ VH_DAEMON_FEED_ANALYSIS_STUB_PORT: '9111' })).toBe(9111);
    expect(fixtureAnalysisStubInternal.resolveRequestUrl(undefined).pathname).toBe('/');
    expect(fixtureAnalysisStubInternal.resolveResponseModel({ model: ' custom-model ' })).toBe('custom-model');
    expect(fixtureAnalysisStubInternal.resolveResponseModel({ model: '   ' })).toBe('fixture-analysis-stub');
    expect(fixtureAnalysisStubInternal.resolveResponseModel({ model: 7 })).toBe('fixture-analysis-stub');
    expect(fixtureAnalysisStubInternal.readMessageText('bad')).toBe('');
    expect(
      fixtureAnalysisStubInternal.readMessageText([
        { content: 'one' },
        { content: [{ text: 'two' }, { text: 'three' }, {}] },
        { content: { ignored: true } },
      ]),
    ).toBe('one\ntwo\nthree');
    expect(fixtureAnalysisStubInternal.readTaggedLine('Article title: Hello world', 'Article title')).toBe('Hello world');
    expect(fixtureAnalysisStubInternal.readTaggedLine('No tagged line here', 'Article title')).toBe('');
    expect(
      fixtureAnalysisStubInternal.readArticleBody('ARTICLE BODY: unavailable; analyze available metadata only.'),
    ).toBe('');
    expect(fixtureAnalysisStubInternal.readArticleBody('No body marker')).toBe('');
    await expect(
      fixtureAnalysisStubInternal.readJsonBody((async function* emptyBody() {})()),
    ).resolves.toEqual({});
    await expect(
      fixtureAnalysisStubInternal.readJsonBody((async function* mixedBody() {
        yield '{"model":"';
        yield Buffer.from('fixture-analysis-stub","messages":[]}');
      })()),
    ).resolves.toEqual({ model: 'fixture-analysis-stub', messages: [] });

    const fallbackAnalysis = buildFixtureAnalysis('No useful prompt');
    expect(fallbackAnalysis.summary).toBe('Fixture analysis summary.');
    expect(fallbackAnalysis.bias_claim_quote[0]).toBe('Primary report emphasis');

    const startedServer = startFixtureAnalysisStub();
    const health = await fetch(`${fixtureAnalysisStubInternal.baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(startedServer).toBe(startFixtureAnalysisStub());

    const notFound = await fetch(`${fixtureAnalysisStubInternal.baseUrl}/missing`, { method: 'POST' });
    expect(notFound.status).toBe(404);

    const emptyCompletion = await fetch(`${fixtureAnalysisStubInternal.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    expect(emptyCompletion.status).toBe(200);
    const emptyPayload = await emptyCompletion.json();
    expect(emptyPayload.model).toBe('fixture-analysis-stub');

    const completion = await fetch(`${fixtureAnalysisStubInternal.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'fixture-analysis-stub',
        messages: [{
          role: 'user',
          content: [
            'Article title: Emergency Geneva talks begin after overnight missile strike hits fuel depots',
            'Story headline: Emergency Geneva talks begin after overnight missile strike hits fuel depots',
            '',
            'ARTICLE BODY:',
            'Emergency ceasefire talks began in Geneva after an overnight missile strike hit fuel depots.',
          ].join('\n'),
        }],
      }),
    });
    expect(completion.status).toBe(200);
    const payload = await completion.json();
    const content = payload.choices?.[0]?.message?.content;
    expect(typeof content).toBe('string');
    expect(content).toContain('Emergency ceasefire talks began in Geneva');
  });

  it('covers direct-launch startup branch and signal shutdown', async () => {
    const fixtureModulePath = fileURLToPath(new URL('./daemon-feed-analysis-stub.mjs', import.meta.url));
    const priorArgv1 = process.argv[1];
    const priorPort = process.env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    try {
      process.argv[1] = fixtureModulePath;
      process.env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT = '9041';
      expect(startFixtureAnalysisStubWhenLaunchedDirectly('not-the-module', import.meta.url)).toBe(false);
      expect(
        startFixtureAnalysisStubWhenLaunchedDirectly(fixtureModulePath, pathToFileURL(fixtureModulePath).href),
      ).toBe(true);

      const imported = await import(`${pathToFileURL(fixtureModulePath).href}?autostart=1`);
      const health = await fetch(`${imported.fixtureAnalysisStubInternal.baseUrl}/health`);
      expect(health.status).toBe(200);

      process.emit('SIGTERM');
      await vi.waitFor(() => {
        expect(exitSpy).toHaveBeenCalledWith(0);
      });
      await imported.stopFixtureAnalysisStub();
      expect(imported.fixtureAnalysisStubInternal.removeShutdownHandler).toBeTypeOf('function');
    } finally {
      process.argv[1] = priorArgv1;
      if (priorPort === undefined) {
        delete process.env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT;
      } else {
        process.env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT = priorPort;
      }
    }
  });

  it('covers shutdown after the server is already closed', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    const started = startFixtureAnalysisStub();
    const health = await fetch(`${fixtureAnalysisStubInternal.baseUrl}/health`);
    expect(health.status).toBe(200);
    await new Promise((resolve, reject) => {
      started.close((error) => (error ? reject(error) : resolve(undefined)));
    });
    process.emit('SIGINT');
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  it('covers close helper success and error branches', async () => {
    const okListener = {
      close(callback) {
        callback();
      },
    };
    await expect(fixtureAnalysisStubInternal.closeListeningServer(okListener)).resolves.toBeUndefined();

    const failure = new Error('close failed');
    const badListener = {
      close(callback) {
        callback(failure);
      },
    };
    await expect(fixtureAnalysisStubInternal.closeListeningServer(badListener)).rejects.toThrow('close failed');
  });

  it('covers stop without active listener', async () => {
    await stopFixtureAnalysisStub();
    fixtureAnalysisStubInternal.removeShutdownHandler();
    expect(true).toBe(true);
  });
});
