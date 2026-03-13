import { describe, expect, it, vi } from 'vitest';
import {
  artifactRootFromEnv,
  collectSpecs,
  decodeAttachment,
  findPrimaryResult,
  formatErrorMessage,
  logDaemonFeedSemanticSoakFatal,
  readNonNegativeInt,
  readPositiveInt,
  sleep,
  summarizeRun,
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

  it('resolves artifact roots and sleep promises', async () => {
    expect(artifactRootFromEnv({ VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/tmp/out' }, '/repo')).toBe('/tmp/out');
    expect(artifactRootFromEnv({}, '/repo').startsWith('/repo/.tmp/daemon-feed-semantic-soak/')).toBe(true);
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it('formats error objects and non-errors consistently', () => {
    expect(formatErrorMessage(new Error('boom'))).toBe('boom');
    expect(formatErrorMessage('plain-text')).toBe('plain-text');
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
