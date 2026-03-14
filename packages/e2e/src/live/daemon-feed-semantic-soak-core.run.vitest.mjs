import { describe, expect, it, vi } from 'vitest';
import {
  resolvePublicSemanticSoakSpawnEnv,
  runDaemonFeedSemanticSoak,
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

describe('runDaemonFeedSemanticSoak', () => {
  it('injects the smoke-only public source profile and limits when unset', () => {
    const env = resolvePublicSemanticSoakSpawnEnv({}, 'run-1', 4, 180000);

    expect(env.VH_RUN_DAEMON_FIRST_FEED).toBe('true');
    expect(env.VH_DAEMON_FEED_RUN_ID).toBe('run-1');
    expect(env.VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT).toBe('4');
    expect(env.VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS).toBe('180000');
    expect(env.VH_LIVE_DEV_FEED_SOURCE_IDS).toBe(
      'guardian-us,cbs-politics,ap-politics,cnn-politics,abc-politics,nbc-politics,pbs-politics',
    );
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE).toBe('4');
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL).toBe('28');
  });

  it('preserves explicit feed source and limit overrides', () => {
    const env = resolvePublicSemanticSoakSpawnEnv({
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,fox-latest',
      VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE: '2',
      VH_DAEMON_FEED_MAX_ITEMS_TOTAL: '8',
    }, 'run-2', 2, 1000);

    expect(env.VH_LIVE_DEV_FEED_SOURCE_IDS).toBe('guardian-us,fox-latest');
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE).toBe('2');
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL).toBe('8');
  });

  it('does not inject smoke-only source defaults for fixture runs', () => {
    const env = resolvePublicSemanticSoakSpawnEnv({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
    }, 'run-3', 2, 1000);

    expect(env.VH_LIVE_DEV_FEED_SOURCE_IDS).toBeUndefined();
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE).toBeUndefined();
    expect(env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL).toBeUndefined();
  });

  it('injects the run id and persists summary, trend, and artifact index', async () => {
    const writes = new Map();
    const logs = [];
    const stderrWrites = [];
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    const runAudit = {
      requested_sample_count: 2,
      sampled_story_count: 1,
      visible_story_ids: ['story-1'],
      supply: {
        story_count: 3,
        auditable_count: 1,
        visible_story_ids: ['story-1'],
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
        sample_fill_rate: 0.5,
        sample_shortfall: 1,
      },
      bundles: [{
        story_id: 'story-1',
        topic_id: 'topic-1',
        headline: 'Headline',
        pairs: [],
        has_related_topic_only_pair: false,
      }],
      overall: {
        audited_pair_count: 0,
        related_topic_only_pair_count: 0,
        sample_fill_rate: 0.5,
        sample_shortfall: 1,
        pass: false,
      },
    };
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', runAudit),
      makeAttachment('daemon-first-feed-runtime-logs', { browserLogs: ['log-1'] }),
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };

    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: JSON.stringify(playwrightReport), stderr: 'warn' });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '2',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
          VH_DAEMON_FEED_SOAK_SUMMARY_PATH: '/repo/.tmp/out/custom-summary.json',
          VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,cbs-politics',
        },
        spawn,
        mkdir: vi.fn(),
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        log: (message) => logs.push(message),
        sleepImpl: vi.fn(),
      })).rejects.toThrow();
    } finally {
      process.stderr.write = originalStderrWrite;
    }

    expect(spawn).toHaveBeenNthCalledWith(2, 'pnpm', expect.arrayContaining(['exec', 'playwright', 'test']), expect.objectContaining({
      env: expect.objectContaining({
        VH_RUN_DAEMON_FIRST_FEED: 'true',
        VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT: '2',
        VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS: '10',
        VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,cbs-politics',
      }),
    }));
    expect(spawn.mock.calls[1][2].env.VH_DAEMON_FEED_RUN_ID).toMatch(/^semantic-soak-/);
    expect(stderrWrites).toContain('warn');
    expect(writes.get('/repo/.tmp/out/custom-summary.json')).toContain('"sampleFillRate": 0.5');
    expect(writes.get('/repo/.tmp/out/custom-summary.json')).toContain('"readinessStatus": "not_ready"');
    expect(writes.get('/repo/.tmp/out/custom-summary.json')).toContain('"promotionBlockingReasons"');
    expect(writes.get('/repo/.tmp/out/semantic-soak-trend.json')).toContain('"sampleFillRate": 0.5');
    expect(writes.get('/repo/.tmp/out/release-artifact-index.json')).toContain('"promotionAssessment"');
    expect(logs.some((message) => message.includes('artifact-index'))).toBe(true);
  });

  it('fails fast when the build step fails', async () => {
    const spawn = vi.fn().mockReturnValueOnce({ status: 2, stdout: '', stderr: 'boom' });
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = (() => true);

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
          VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,cbs-politics',
        },
        spawn,
        mkdir: vi.fn(),
        writeFile: vi.fn(),
      })).rejects.toThrow('daemon-feed-build-failed:2');
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });

  it('returns a passing summary, persists attachments, and sleeps between successful runs', async () => {
    const writes = new Map();
    const sleepImpl = vi.fn();
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', makeReport({
        requested_sample_count: 1,
        sampled_story_count: 1,
        overall: {
          audited_pair_count: 1,
          related_topic_only_pair_count: 0,
          sample_fill_rate: 1,
          sample_shortfall: 0,
          pass: true,
        },
        supply: {
          story_count: 4,
          auditable_count: 2,
          visible_story_ids: ['story-1'],
          top_story_ids: ['story-1'],
          top_auditable_story_ids: ['story-1'],
          sample_fill_rate: 1,
          sample_shortfall: 0,
        },
        bundles: [{
          story_id: 'story-1',
          topic_id: 'topic-1',
          headline: 'Headline',
          pairs: [{ label: 'same_incident' }],
          has_related_topic_only_pair: false,
        }],
      })),
      makeAttachment('daemon-first-feed-semantic-audit-failure-snapshot', {
        story_count: 4,
        auditable_count: 2,
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
      }),
      makeAttachment('daemon-first-feed-runtime-logs', { browserLogs: ['browser-log'] }),
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(playwrightReport), stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(playwrightReport), stderr: '' });

    const result = await runDaemonFeedSemanticSoak({
      cwd: '/repo',
      env: {
        VH_DAEMON_FEED_SOAK_RUNS: '2',
        VH_DAEMON_FEED_SOAK_PAUSE_MS: '5',
        VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
        VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
        VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
        VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,cbs-politics',
      },
      spawn,
      mkdir: vi.fn(),
      readFile: (target) => writes.get(target),
      writeFile: (target, content) => writes.set(target, String(content)),
      log: vi.fn(),
      sleepImpl,
    });

    expect(result.summary.strictSoakPass).toBe(true);
    expect(result.summary.readinessStatus).toBe('not_ready');
    expect(result.summary.promotionAssessment.blockingReasons).toContain('insufficient_run_count');
    expect(result.summary.repeatedStoryCount).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(sleepImpl).toHaveBeenCalledWith(5);
    expect(writes.get('/repo/.tmp/out/run-1.semantic-audit.json')).toContain('"requested_sample_count": 1');
    expect(writes.get('/repo/.tmp/out/run-1.semantic-audit-failure-snapshot.json')).toContain('"story_count": 2');
    expect(writes.get('/repo/.tmp/out/run-1.runtime-logs.json')).toContain('browser-log');
  });

  it('records parse and attachment failures before exiting the failing soak run', async () => {
    const writes = new Map();
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '{bad json', stderr: '' });
    const originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`exit:${code}`);
    });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
          VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,cbs-politics',
        },
        spawn,
        mkdir: vi.fn(),
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    expect(writes.get('/repo/.tmp/out/semantic-soak-summary.json')).toContain('"reportParseError":');
    expect(writes.get('/repo/.tmp/out/semantic-soak-summary.json')).toContain('attachment missing');
  });

  it('records invalid failure/runtime attachments without overwriting an existing audit error', async () => {
    const writes = new Map();
    const primaryResult = makePrimaryResult([
      { name: 'daemon-first-feed-semantic-audit', body: Buffer.from('not-json').toString('base64') },
      { name: 'daemon-first-feed-semantic-audit-failure-snapshot', body: Buffer.from('still-not-json').toString('base64') },
      { name: 'daemon-first-feed-runtime-logs', body: Buffer.from('also-not-json').toString('base64') },
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: JSON.stringify(playwrightReport), stderr: '' });
    const originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`exit:${code}`);
    });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_PAUSE_MS: '0',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
          VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,cbs-politics',
        },
        spawn,
        mkdir: vi.fn(),
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    const summary = writes.get('/repo/.tmp/out/semantic-soak-summary.json');
    expect(summary).toContain('Unexpected token');
    expect(summary).not.toContain('also-not-json');
    expect(summary).not.toContain('still-not-json');
  });

  it('records failure snapshot decode errors when the audit attachment is otherwise valid', async () => {
    const writes = new Map();
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', makeReport()),
      { name: 'daemon-first-feed-semantic-audit-failure-snapshot', body: Buffer.from('still-not-json').toString('base64') },
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: JSON.stringify(playwrightReport), stderr: '' });
    const originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`exit:${code}`);
    });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '2',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
          VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,cbs-politics',
        },
        spawn,
        mkdir: vi.fn(),
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    expect(writes.get('/repo/.tmp/out/semantic-soak-summary.json')).toContain('Unexpected token');
  });

  it('records runtime log decode errors when the audit attachment is otherwise valid', async () => {
    const writes = new Map();
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', makeReport()),
      { name: 'daemon-first-feed-runtime-logs', body: Buffer.from('still-not-json').toString('base64') },
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: JSON.stringify(playwrightReport), stderr: '' });
    const originalExit = process.exit;
    process.exit = vi.fn((code) => {
      throw new Error(`exit:${code}`);
    });

    try {
      await expect(runDaemonFeedSemanticSoak({
        cwd: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '2',
          VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
          VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,cbs-politics',
        },
        spawn,
        mkdir: vi.fn(),
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    expect(writes.get('/repo/.tmp/out/semantic-soak-summary.json')).toContain('Unexpected token');
  });

  it('aggregates multiple public smoke profiles into a passing run once the sample fills', async () => {
    const writes = new Map();
    const makeAudit = (storyId) => ({
      requested_sample_count: 4,
      sampled_story_count: 1,
      visible_story_ids: [storyId],
      supply: {
        story_count: 1,
        auditable_count: 1,
        visible_story_ids: [storyId],
        top_story_ids: [storyId],
        top_auditable_story_ids: [storyId],
        sample_fill_rate: 0.25,
        sample_shortfall: 3,
      },
      bundles: [{
        story_id: storyId,
        topic_id: `${storyId}-topic`,
        headline: storyId,
        pairs: [{ label: 'same_incident' }],
        has_related_topic_only_pair: false,
      }],
      overall: {
        audited_pair_count: 1,
        related_topic_only_pair_count: 0,
        sample_fill_rate: 0.25,
        sample_shortfall: 3,
        pass: false,
      },
    });
    const makePlaywrightReport = (storyId) => ({
      suites: [{
        specs: [{
          tests: [{
            results: [makePrimaryResult([
              makeAttachment('daemon-first-feed-semantic-audit', makeAudit(storyId)),
              makeAttachment('daemon-first-feed-semantic-audit-failure-snapshot', {
                story_count: 1,
                auditable_count: 1,
                visible_story_ids: [storyId],
                top_story_ids: [storyId],
                top_auditable_story_ids: [storyId],
              }),
              makeAttachment('daemon-first-feed-runtime-logs', { browserLogs: [`${storyId}-log`] }),
            ])],
          }],
        }],
      }],
    });
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: JSON.stringify(makePlaywrightReport('story-1')), stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: JSON.stringify(makePlaywrightReport('story-2')), stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: JSON.stringify(makePlaywrightReport('story-3')), stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: JSON.stringify(makePlaywrightReport('story-4')), stderr: '' });

    const result = await runDaemonFeedSemanticSoak({
      cwd: '/repo',
      env: {
        VH_DAEMON_FEED_SOAK_RUNS: '1',
        VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '4',
        VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
        VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
        VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES: 'a,b;c,d;e,f;g,h',
      },
      spawn,
      mkdir: vi.fn(),
      readFile: (target) => writes.get(target),
      writeFile: (target, content) => writes.set(target, String(content)),
      log: vi.fn(),
      sleepImpl: vi.fn(),
    });

    expect(result.summary.strictSoakPass).toBe(true);
    expect(result.summary.totalSampledStories).toBe(4);
    expect(result.summary.totalAuditedPairs).toBe(4);
    expect(result.results[0].storyIds).toEqual(['story-1', 'story-2', 'story-3', 'story-4']);
    expect(spawn).toHaveBeenCalledTimes(5);
    expect(spawn.mock.calls[1][2].env.VH_LIVE_DEV_FEED_SOURCE_IDS).toBe('a,b');
    expect(spawn.mock.calls[4][2].env.VH_LIVE_DEV_FEED_SOURCE_IDS).toBe('g,h');
  });

  it('falls back to a single fixture-profile subrun and writes empty build/stdout defaults', async () => {
    const writes = new Map();
    const audit = makeReport({
      requested_sample_count: 1,
      sampled_story_count: 1,
      visible_story_ids: ['story-1'],
      supply: {
        story_count: 1,
        auditable_count: 1,
        visible_story_ids: ['story-1'],
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
        sample_fill_rate: 1,
        sample_shortfall: 0,
      },
      bundles: [{
        story_id: 'story-1',
        topic_id: 'topic-1',
        headline: 'Headline',
        pairs: [{ label: 'duplicate' }],
        has_related_topic_only_pair: false,
      }],
      overall: {
        audited_pair_count: 1,
        related_topic_only_pair_count: 0,
        sample_fill_rate: 1,
        sample_shortfall: 0,
        pass: true,
      },
    });
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', audit),
      makeAttachment('daemon-first-feed-runtime-logs', { browserLogs: ['fixture-log'] }),
    ]);
    const playwrightReport = {
      suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }],
    };
    const reportPath = '/repo/.tmp/out/run-1.profile-1.playwright.json';
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: undefined, stderr: undefined })
      .mockReturnValueOnce({ status: 0, stdout: undefined, stderr: undefined });

    const result = await runDaemonFeedSemanticSoak({
      cwd: '/repo',
      env: {
        VH_DAEMON_FEED_SOAK_RUNS: '1',
        VH_DAEMON_FEED_SOAK_SAMPLE_COUNT: '1',
        VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS: '10',
        VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
        VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      },
      spawn,
      mkdir: vi.fn(),
      readFile: (target) => {
        if (target === reportPath) {
          return JSON.stringify(playwrightReport);
        }
        return writes.get(target);
      },
      writeFile: (target, content) => writes.set(target, String(content)),
      log: vi.fn(),
      sleepImpl: vi.fn(),
    });

    expect(result.summary.strictSoakPass).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][2].env.VH_LIVE_DEV_FEED_SOURCE_IDS).toBeUndefined();
    expect(writes.get('/repo/.tmp/out/build.stdout.log')).toBe('');
    expect(writes.get('/repo/.tmp/out/build.stderr.log')).toBe('');
    expect(writes.get('/repo/.tmp/out/run-1.profile-1.playwright.json')).toBe('');
  });

});
