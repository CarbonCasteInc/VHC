import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildFixtureAnalysis,
  buildFixtureBundleSynthesis,
  buildFixturePairLabelResponse,
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
    expect(analysis.key_facts[0]).toContain('Emergency ceasefire talks began in Geneva');
    expect(analysis.bias_claim_quote[0]).toContain('Emergency ceasefire talks began in Geneva');
    expect(analysis.perspectives[0]?.frame).toContain('emergency geneva talks begin');
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
    expect(analysis.key_facts).toEqual(['Atlantic port strike enters second day, delaying container traffic']);
    expect(analysis.biases[0]).toContain('urgent action');
  });

  it('builds bundle-synthesis responses with frame/reframe point material', () => {
    const synthesis = buildFixtureBundleSynthesis([
      'You are synthesizing a news story covered by multiple sources.',
      'This story is covered by 2 sources:',
      '  1. [CBS News] "City budget deal advances" (https://example.test/a)',
      '  2. [The Guardian] "City budget deal advances" (https://example.test/b)',
      '',
      'Headline: City budget deal advances after overnight negotiations',
      '',
      'OUTPUT FORMAT:',
      'Return exactly one JSON object with these keys and no extraneous text:',
      '"source_count": <number of sources>',
      '"frame_reframe_table": [{"frame":"string","reframe":"string"}]',
      '"synthesis_ready": true',
    ].join('\n'));

    expect(synthesis.summary).toContain('City budget deal advances');
    expect(synthesis.key_facts[0]).toContain('City budget deal advances');
    expect(synthesis.frame_reframe_table).toHaveLength(2);
    expect(synthesis.source_count).toBe(2);
    expect(synthesis.warnings).toEqual([]);
    expect(synthesis.synthesis_ready).toBe(true);
  });

  it('builds deterministic pair-label responses for semantic-audit prompts', () => {
    const response = buildFixturePairLabelResponse(JSON.stringify({
      pair_labels: [
        {
          pair_id: 'pair-same',
          story_headline: 'Emergency Geneva talks begin after overnight missile strike hits fuel depots',
          left: {
            title: 'Emergency Geneva talks begin after overnight missile strike hits fuel depots',
            text: 'Emergency ceasefire talks began in Geneva after an overnight missile strike hit fuel depots and forced negotiators back to the table.',
          },
          right: {
            title: 'Emergency talks begin in Geneva after missile strike hits fuel depots',
            text: 'Negotiators returned to Geneva after an overnight missile strike hit fuel depots and triggered emergency ceasefire talks.',
          },
        },
        {
          pair_id: 'pair-topic-only',
          story_headline: 'Trump-backed flag-burning crackdown meets legal blowback',
          left: {
            title: 'Feds move to dismiss charges against Army veteran who burned American flag near White House',
            text: 'Federal prosecutors moved to dismiss charges tied to the White House flag-burning case.',
          },
          right: {
            title: 'Trump seeks to replace White House visitor screening center with underground facility',
            text: 'The White House plans a new visitor screening facility and underground entrance upgrades.',
          },
        },
      ],
    }));

    expect(response).toEqual({
      pair_labels: [
        expect.objectContaining({
          pair_id: 'pair-same',
          label: 'same_incident',
        }),
        expect.objectContaining({
          pair_id: 'pair-topic-only',
          label: 'related_topic_only',
        }),
      ],
    });
  });

  it('covers parsing helpers and server endpoints', async () => {
    expect(fixtureAnalysisStubInternal.normalizeWords('Geneva talks begin after missile strike'))
      .toEqual(['geneva', 'talks', 'missile', 'strike']);
    expect(fixtureAnalysisStubInternal.jaccardOverlap(['alpha', 'beta'], ['beta', 'gamma'])).toBe(1 / 3);
    expect(fixtureAnalysisStubInternal.readPairLabelRequests('not json')).toBeNull();
    expect(
      fixtureAnalysisStubInternal.readPairLabelRequests(
        'system instructions here\n{"pair_labels":[{"pair_id":"pair-same"}]}',
      ),
    ).toEqual([{ pair_id: 'pair-same' }]);
    expect(fixtureAnalysisStubInternal.classifyPairLabel({
      story_headline: 'Emergency Geneva talks begin after overnight missile strike hits fuel depots',
      left: {
        title: 'Emergency Geneva talks begin after overnight missile strike hits fuel depots',
        text: 'Emergency ceasefire talks began in Geneva after an overnight missile strike hit fuel depots and forced negotiators back to the table.',
      },
      right: {
        title: 'Emergency talks begin in Geneva after missile strike hits fuel depots',
        text: 'Negotiators returned to Geneva after an overnight missile strike hit fuel depots and triggered emergency ceasefire talks.',
      },
    }).label).toBe('same_incident');

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
    expect(fixtureAnalysisStubInternal.readBundleHeadline('Headline: Bundle title')).toBe('Bundle title');
    expect(fixtureAnalysisStubInternal.readBundlePublishers('  1. [CBS News] "A"\n- publisher: BBC')).toEqual([
      'CBS News',
      'BBC',
    ]);
    expect(
      fixtureAnalysisStubInternal.isBundleSynthesisPrompt(
        'OUTPUT FORMAT:\nReturn exactly one JSON object\n"source_count"\n"source_publishers"\n"verification_confidence"',
      ),
    ).toBe(true);
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
    expect(fallbackAnalysis.bias_claim_quote[0]).toBe('Fixture analysis summary.');
    expect(fallbackAnalysis.key_facts).toEqual(['Fixture analysis summary.']);

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

    const pairCompletion = await fetch(`${fixtureAnalysisStubInternal.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'fixture-analysis-stub',
        messages: [{
          role: 'user',
          content: JSON.stringify({
            pair_labels: [{
              pair_id: 'pair-same',
              story_headline: 'Emergency Geneva talks begin after overnight missile strike hits fuel depots',
              left: {
                title: 'Emergency Geneva talks begin after overnight missile strike hits fuel depots',
                text: 'Emergency ceasefire talks began in Geneva after an overnight missile strike hit fuel depots and forced negotiators back to the table.',
              },
              right: {
                title: 'Emergency talks begin in Geneva after missile strike hits fuel depots',
                text: 'Negotiators returned to Geneva after an overnight missile strike hit fuel depots and triggered emergency ceasefire talks.',
              },
            }],
          }),
        }],
      }),
    });
    expect(pairCompletion.status).toBe(200);
    const pairPayload = await pairCompletion.json();
    const pairContent = JSON.parse(pairPayload.choices?.[0]?.message?.content ?? '{}');
    expect(pairContent.pair_labels?.[0]?.label).toBe('same_incident');

    const bundleCompletion = await fetch(`${fixtureAnalysisStubInternal.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'fixture-analysis-stub',
        messages: [{
          role: 'user',
          content: [
            'You are synthesizing a news story covered by multiple sources.',
            '  1. [CBS News] "City budget deal advances" (https://example.test/a)',
            '  2. [The Guardian] "City budget deal advances" (https://example.test/b)',
            'Headline: City budget deal advances after overnight negotiations',
            'OUTPUT FORMAT:',
            'Return exactly one JSON object with these keys and no extraneous text:',
            '"source_count"',
            '"frame_reframe_table"',
            '"synthesis_ready"',
          ].join('\n'),
        }],
      }),
    });
    expect(bundleCompletion.status).toBe(200);
    const bundlePayload = await bundleCompletion.json();
    const bundleContent = JSON.parse(bundlePayload.choices?.[0]?.message?.content ?? '{}');
    expect(bundleContent.frame_reframe_table).toHaveLength(2);
    expect(bundleContent.source_count).toBe(2);
    expect(bundleContent.synthesis_ready).toBe(true);
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
