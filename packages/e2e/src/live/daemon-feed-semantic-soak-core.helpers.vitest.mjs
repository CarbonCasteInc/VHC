import { describe, expect, it, vi } from 'vitest';
import {
  artifactRootFromEnv,
  buildPortPreclearCommand,
  collectSpecs,
  decodeAttachment,
  findPrimaryResult,
  formatDaemonFeedSemanticSoakRunState,
  formatErrorMessage,
  logDaemonFeedSemanticSoakFatal,
  preclearDaemonFirstFeedPorts,
  readNonNegativeInt,
  readPositiveInt,
  resolveDaemonFirstFeedPortSet,
  sleep,
  stablePort,
  summarizeRun,
  extractPort,
} from './daemon-feed-semantic-soak-core.mjs';

function makeAttachment(name, body) {
  return { name, body: Buffer.from(JSON.stringify(body)).toString('base64') };
}

function makePrimaryResult(attachments = []) {
  return { attachments };
}

function makeReport(overrides = {}) {
  return {
    requested_sample_count: 2,
    sampled_story_count: 2,
    visible_story_ids: ['story-1', 'story-2'],
    bundles: [{
      story_id: 'story-1',
      topic_id: 'topic-1',
      headline: 'Headline',
      pairs: [{ label: 'related_topic_only' }],
      has_related_topic_only_pair: true,
    }],
    overall: {
      audited_pair_count: 1,
      related_topic_only_pair_count: 1,
      sample_fill_rate: 1,
      sample_shortfall: 0,
      pass: false,
    },
    ...overrides,
  };
}

describe('daemon-feed-semantic-soak-core helpers', () => {
  it('parses bounded integers from the environment', () => {
    expect(readPositiveInt('RUNS', 3, { RUNS: '4' })).toBe(4);
    expect(readPositiveInt('RUNS', 3, {})).toBe(3);
    expect(() => readPositiveInt('RUNS', 3, { RUNS: '0' })).toThrow('RUNS must be a positive integer');

    expect(readNonNegativeInt('PAUSE', 30, { PAUSE: '0' })).toBe(0);
    expect(readNonNegativeInt('PAUSE', 30, {})).toBe(30);
    expect(() => readNonNegativeInt('PAUSE', 30, { PAUSE: '-1' })).toThrow('PAUSE must be a non-negative integer');
  });

  it('collects the first primary result and decodes attachments', () => {
    const primaryResult = makePrimaryResult([
      makeAttachment('audit', { ok: true }),
      { name: 'ignored', body: 123 },
    ]);
    const report = {
      suites: [{
        suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
      }],
    };

    expect(findPrimaryResult(report)).toEqual(primaryResult);
    expect(collectSpecs(report.suites)).toHaveLength(1);
    expect(decodeAttachment(primaryResult, 'audit')).toEqual({ ok: true });
    expect(decodeAttachment(primaryResult, 'missing')).toBeNull();
  });

  it('handles empty suites and missing primary results', () => {
    expect(collectSpecs(undefined)).toEqual([]);
    expect(findPrimaryResult({})).toBeNull();
  });

  it('summarizes fallback supply diagnostics from the report when snapshot data is absent', () => {
    const summarized = summarizeRun(
      makeReport({
        supply: {
          story_count: 10,
          auditable_count: 2,
          top_story_ids: ['story-1'],
          top_auditable_story_ids: ['story-1'],
        },
      }),
      null,
      { browserLogs: ['a', 'b'] },
      1,
      '/tmp/report.json',
      null,
      '/tmp/audit.json',
      'attachment missing',
      null,
      '/tmp/runtime.json',
    );

    expect(summarized).toMatchObject({
      pass: false,
      failureStoryCount: 10,
      failureAuditableCount: 2,
      failureTopStoryIds: ['story-1'],
      failureTopAuditableStoryIds: ['story-1'],
      runtimeLogCount: 2,
      labelCounts: {
        duplicate: 0,
        same_incident: 0,
        same_developing_episode: 0,
        related_topic_only: 1,
      },
      failingBundles: [{
        story_id: 'story-1',
        related_topic_only_pair_count: 1,
      }],
    });
  });

  it('tolerates failing bundles that omit pairs', () => {
    const summarized = summarizeRun(
      makeReport({
        bundles: [{
          story_id: 'story-1',
          topic_id: 'topic-1',
          headline: 'Headline',
          has_related_topic_only_pair: true,
        }],
      }),
      null,
      null,
      1,
      '/tmp/report.json',
      null,
      '/tmp/audit.json',
      null,
      null,
      null,
    );

    expect(summarized.failingBundles).toEqual([{
      story_id: 'story-1',
      topic_id: 'topic-1',
      headline: 'Headline',
      related_topic_only_pair_count: 0,
    }]);
  });

  it('returns empty/default diagnostics when the report is missing', () => {
    const summarized = summarizeRun(
      null,
      null,
      null,
      1,
      '/tmp/report.json',
      'parse-error',
      null,
      'audit-error',
      null,
      null,
    );

    expect(summarized).toMatchObject({
      pass: false,
      requestedSampleCount: null,
      sampledStoryCount: null,
      sampleFillRate: null,
      sampleShortfall: null,
      visibleStoryCount: null,
      auditedPairCount: null,
      relatedTopicOnlyPairCount: null,
      failureStoryCount: null,
      failureAuditableCount: null,
      storyIds: [],
      failingBundles: [],
    });
  });

  it('resolves artifact roots and sleep promises', async () => {
    expect(artifactRootFromEnv({ VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/tmp/out' }, '/repo')).toBe('/tmp/out');
    expect(artifactRootFromEnv({}, '/repo').startsWith('/repo/.tmp/daemon-feed-semantic-soak/')).toBe(true);
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it('derives the same daemon-first port set as the Playwright config defaults', () => {
    const ports = resolveDaemonFirstFeedPortSet({}, 'semantic-soak-1-1');

    expect(ports).toEqual({
      basePort: stablePort(2100, 200, 'semantic-soak-1-1'),
      gunPort: stablePort(8700, 200, 'semantic-soak-1-1'),
      storyclusterPort: stablePort(4300, 200, 'semantic-soak-1-1'),
      fixturePort: stablePort(8900, 100, 'semantic-soak-1-1'),
      qdrantPort: stablePort(6300, 100, 'semantic-soak-1-1'),
      analysisStubPort: stablePort(9100, 100, 'semantic-soak-1-1'),
    });
  });

  it('falls back cleanly when the port helper inputs are omitted or lack explicit ports', () => {
    expect(stablePort(2100, 200)).toBe(2100);
    expect(extractPort('http://127.0.0.1/', 2999)).toBe(2999);
    expect(resolveDaemonFirstFeedPortSet()).toEqual(expect.objectContaining({
      basePort: expect.any(Number),
      gunPort: expect.any(Number),
      storyclusterPort: expect.any(Number),
      fixturePort: expect.any(Number),
      qdrantPort: expect.any(Number),
      analysisStubPort: expect.any(Number),
    }));
  });

  it('honors explicit port overrides when resolving the daemon-first port set', () => {
    expect(resolveDaemonFirstFeedPortSet({
      VH_LIVE_BASE_URL: 'http://127.0.0.1:2455/',
      VH_DAEMON_FEED_GUN_PORT: '8755',
      VH_DAEMON_FEED_STORYCLUSTER_PORT: '4355',
      VH_DAEMON_FEED_FIXTURE_PORT: '8955',
      VH_DAEMON_FEED_QDRANT_PORT: '6355',
      VH_DAEMON_FEED_ANALYSIS_STUB_PORT: '9155',
    }, 'ignored')).toEqual({
      basePort: 2455,
      gunPort: 8755,
      storyclusterPort: 4355,
      fixturePort: 8955,
      qdrantPort: 6355,
      analysisStubPort: 9155,
    });
  });

  it('extracts ports from valid and invalid base urls', () => {
    expect(extractPort('http://127.0.0.1:2455/')).toBe(2455);
    expect(extractPort('not-a-url', 2999)).toBe(2999);
  });

  it('pre-clears the full daemon-first port set before a subrun starts', () => {
    const spawn = vi.fn(() => ({ status: 0 }));

    preclearDaemonFirstFeedPorts({
      cwd: '/repo',
      env: {},
      runId: 'semantic-soak-2-1',
      spawn,
    });

    const [[command, args, options]] = spawn.mock.calls;
    const ports = resolveDaemonFirstFeedPortSet({}, 'semantic-soak-2-1');

    expect(command).toBe('bash');
    expect(args.slice(0, 4)).toEqual(['-lc', buildPortPreclearCommand(), '--', String(ports.basePort)]);
    expect(args.slice(4)).toEqual([
      String(ports.gunPort),
      String(ports.storyclusterPort),
      String(ports.fixturePort),
      String(ports.qdrantPort),
      String(ports.analysisStubPort),
    ]);
    expect(options).toEqual(expect.objectContaining({
      cwd: '/repo',
      encoding: 'utf8',
    }));
    expect(args[1]).toContain('sleep 0.2');
    expect(args[1]).toContain('port-still-busy:$port');
  });

  it('avoids qdrant port collisions across a representative 5x3 multi-run matrix', () => {
    const seen = new Set();

    for (let run = 1; run <= 5; run += 1) {
      for (let profile = 1; profile <= 3; profile += 1) {
        const seed = `semantic-soak-series-${run}-${profile}`;
        const qdrantPort = resolveDaemonFirstFeedPortSet({}, seed).qdrantPort;
        expect(seen.has(qdrantPort)).toBe(false);
        seen.add(qdrantPort);
      }
    }
  });

  it('formats error objects and non-errors consistently', () => {
    expect(formatErrorMessage(new Error('boom'))).toBe('boom');
    expect(formatErrorMessage('plain-text')).toBe('plain-text');
  });

  it('formats soak run state for both passing and failing density outcomes', () => {
    expect(formatDaemonFeedSemanticSoakRunState({
      pass: true,
      requestedSampleCount: 2,
      sampledStoryCount: 2,
      auditedPairCount: 4,
      sampleFillRate: 1,
      failureAuditableCount: null,
      failureStoryCount: null,
      relatedTopicOnlyPairCount: 0,
    })).toBe('PASS (stories=2/2, pairs=4, fill=1)');

    expect(formatDaemonFeedSemanticSoakRunState({
      pass: false,
      requestedSampleCount: null,
      sampledStoryCount: null,
      auditedPairCount: 0,
      sampleFillRate: null,
      failureAuditableCount: 1,
      failureStoryCount: 5,
      relatedTopicOnlyPairCount: null,
    })).toBe('FAIL (stories=n/a, related_topic_only=n/a, fill=n/a, storeStories=5, storeAuditable=1)');

    expect(formatDaemonFeedSemanticSoakRunState({
      pass: false,
      requestedSampleCount: 3,
      sampledStoryCount: null,
      auditedPairCount: 0,
      sampleFillRate: 0,
      failureAuditableCount: null,
      failureStoryCount: null,
      relatedTopicOnlyPairCount: 0,
    })).toBe('FAIL (stories=n/a/3, related_topic_only=0, fill=0)');
  });

  it('formats fatal logs for both Error and non-Error inputs', () => {
    const errorLog = vi.fn();
    logDaemonFeedSemanticSoakFatal(new Error('boom'), errorLog);
    logDaemonFeedSemanticSoakFatal('plain-text', errorLog);

    expect(errorLog).toHaveBeenNthCalledWith(1, expect.stringContaining('[vh:daemon-soak] fatal: Error: boom'));
    expect(errorLog).toHaveBeenNthCalledWith(2, '[vh:daemon-soak] fatal: plain-text');
  });

  it('falls back to the formatted error message when an Error has no stack', () => {
    const errorLog = vi.fn();
    const error = new Error('boom');
    Object.defineProperty(error, 'stack', {
      configurable: true,
      value: undefined,
    });

    logDaemonFeedSemanticSoakFatal(error, errorLog);

    expect(errorLog).toHaveBeenCalledWith('[vh:daemon-soak] fatal: boom');
  });
});
