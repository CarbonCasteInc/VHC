import { describe, expect, it, vi } from 'vitest';
import { runDaemonFeedSemanticSoak } from './daemon-feed-semantic-soak-core.mjs';

function makeAttachment(name, body) {
  return { name, body: Buffer.from(JSON.stringify(body)).toString('base64') };
}

function makePrimaryResult(attachments = []) {
  return { attachments };
}

function makeReport(overrides = {}) {
  return {
    requested_sample_count: 1,
    sampled_story_count: 1,
    visible_story_ids: ['story-1'],
    bundles: [],
    overall: {
      audited_pair_count: 0,
      related_topic_only_pair_count: 0,
      sample_fill_rate: 1,
      sample_shortfall: 0,
      pass: true,
    },
    supply: {
      story_count: 1,
      auditable_count: 1,
      visible_story_ids: ['story-1'],
      top_story_ids: ['story-1'],
      top_auditable_story_ids: ['story-1'],
      sample_fill_rate: 1,
      sample_shortfall: 0,
    },
    ...overrides,
  };
}

describe('runDaemonFeedSemanticSoak attachment error branches', () => {
  it('records invalid failure-snapshot attachments when auditError is still empty', async () => {
    const writes = new Map();
    const originalExit = process.exit;
    process.exit = vi.fn();
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', makeReport()),
      { name: 'daemon-first-feed-semantic-audit-failure-snapshot', body: Buffer.from('bad-json').toString('base64') },
    ]);
    const playwrightReport = { suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }] };
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(playwrightReport), stderr: '' });

    try {
      const result = await runDaemonFeedSemanticSoak({
        cwd: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
          VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,pbs-politics',
        },
        spawn,
        mkdir: vi.fn(),
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        log: vi.fn(),
        sleepImpl: vi.fn(),
      });

      expect(result.results[0].auditError).toContain('Unexpected token');
      expect(result.results[0].failureSnapshotPath).toBe('/repo/.tmp/out/run-1.semantic-audit-failure-snapshot.json');
      expect(process.exit).toHaveBeenCalledWith(1);
    } finally {
      process.exit = originalExit;
    }
  });

  it('records invalid runtime-log attachments when auditError is still empty', async () => {
    const writes = new Map();
    const originalExit = process.exit;
    process.exit = vi.fn();
    const primaryResult = makePrimaryResult([
      makeAttachment('daemon-first-feed-semantic-audit', makeReport()),
      makeAttachment('daemon-first-feed-semantic-audit-failure-snapshot', {
        story_count: 1,
        auditable_count: 1,
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
      }),
      { name: 'daemon-first-feed-runtime-logs', body: Buffer.from('bad-json').toString('base64') },
    ]);
    const playwrightReport = { suites: [{ specs: [{ tests: [{ results: [primaryResult] }] }] }] };
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: 'build ok', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify(playwrightReport), stderr: '' });

    try {
      const result = await runDaemonFeedSemanticSoak({
        cwd: '/repo',
        env: {
          VH_DAEMON_FEED_SOAK_RUNS: '1',
          VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/out',
          VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,pbs-politics',
        },
        spawn,
        mkdir: vi.fn(),
        readFile: (target) => writes.get(target),
        writeFile: (target, content) => writes.set(target, String(content)),
        log: vi.fn(),
        sleepImpl: vi.fn(),
      });

      expect(result.results[0].auditError).toContain('Unexpected token');
      expect(result.results[0].runtimeLogsPath).toBe('/repo/.tmp/out/run-1.runtime-logs.json');
      expect(process.exit).toHaveBeenCalledWith(1);
    } finally {
      process.exit = originalExit;
    }
  });

  it('records non-Error report read failures and tolerates undefined stdout/stderr buffers', async () => {
    const writes = new Map();
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: undefined, stderr: undefined })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: undefined, stderr: undefined });
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
          VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,pbs-politics',
        },
        spawn,
        mkdir: vi.fn(),
        readFile: () => {
          throw 'read-failed';
        },
        writeFile: (target, content) => writes.set(target, String(content)),
        log: vi.fn(),
        sleepImpl: vi.fn(),
      })).rejects.toThrow('exit:1');
    } finally {
      process.exit = originalExit;
    }

    expect(writes.get('/repo/.tmp/out/build.stdout.log')).toBe('');
    expect(writes.get('/repo/.tmp/out/build.stderr.log')).toBe('');
    expect(writes.get('/repo/.tmp/out/run-1.profile-1.playwright.json')).toBe('');
    expect(writes.get('/repo/.tmp/out/run-1.playwright.json')).toContain('"source_profiles"');
    expect(writes.get('/repo/.tmp/out/semantic-soak-summary.json')).toContain('"reportParseError": "read-failed"');
  });
});
