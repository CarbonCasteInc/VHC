import { describe, expect, it } from 'vitest';
import {
  accumulateStoryCoverage,
  buildReleaseArtifactIndex,
  buildSoakTrend,
  classifySoakRun,
  summarizeLabelCounts,
} from './daemon-feed-semantic-soak-report.mjs';

function makeResult(overrides = {}) {
  return {
    run: 1,
    pass: false,
    sampledStoryCount: 0,
    auditedPairCount: 0,
    relatedTopicOnlyPairCount: 0,
    failureStoryCount: null,
    failureAuditableCount: null,
    failureSnapshotPath: null,
    runtimeLogsPath: null,
    reportPath: '/tmp/report.json',
    auditPath: '/tmp/audit.json',
    auditError: null,
    reportParseError: null,
    storyIds: [],
    ...overrides,
  };
}

describe('daemon-feed-semantic-soak-report', () => {
  it('summarizes label counts across bundles', () => {
    expect(summarizeLabelCounts({
      bundles: [
        { pairs: [{ label: 'duplicate' }, { label: 'same_incident' }, {}] },
        { pairs: [{ label: 'same_developing_episode' }, { label: 'related_topic_only' }, { label: 'ignored' }] },
      ],
    })).toEqual({
      duplicate: 1,
      same_incident: 1,
      same_developing_episode: 1,
      related_topic_only: 1,
    });
  });

  it('handles missing reports, missing pair arrays, and nullish counters', () => {
    expect(summarizeLabelCounts()).toEqual({
      duplicate: 0,
      same_incident: 0,
      same_developing_episode: 0,
      related_topic_only: 0,
    });
    expect(summarizeLabelCounts({ bundles: [{}] })).toEqual({
      duplicate: 0,
      same_incident: 0,
      same_developing_episode: 0,
      related_topic_only: 0,
    });
    expect(classifySoakRun(makeResult({
      relatedTopicOnlyPairCount: undefined,
      failureAuditableCount: null,
      auditError: 'other failure',
    }))).toBe('runner_failure');
  });

  it('classifies soak outcomes across all supported failure shapes', () => {
    expect(classifySoakRun(makeResult({ pass: true }))).toBe('pass');
    expect(classifySoakRun(makeResult({ relatedTopicOnlyPairCount: 2 }))).toBe('semantic_contamination');
    expect(classifySoakRun(makeResult({ failureAuditableCount: 0 }))).toBe('bundle_starvation');
    expect(classifySoakRun(makeResult({ failureAuditableCount: 1 }))).toBe('insufficient_auditable_supply');
    expect(classifySoakRun(makeResult({ auditError: 'daemon-first-feed-semantic-audit attachment missing' }))).toBe('artifact_missing');
    expect(classifySoakRun(makeResult({ reportParseError: 'bad json' }))).toBe('report_parse_error');
    expect(classifySoakRun(makeResult({ auditError: 'other failure' }))).toBe('runner_failure');
  });

  it('accumulates repeated story coverage across runs', () => {
    expect(accumulateStoryCoverage([
      makeResult({ run: 1, storyIds: ['story-a', 'story-b'] }),
      makeResult({ run: 2, storyIds: undefined }),
      makeResult({ run: 3, storyIds: ['story-a'] }),
    ])).toEqual([
      { story_id: 'story-a', run_count: 2, runs: [1, 3] },
      { story_id: 'story-b', run_count: 1, runs: [1] },
    ]);
  });

  it('builds a trend summary with classifications and streaks', () => {
    const trend = buildSoakTrend([
      makeResult({ run: 1, pass: true }),
      makeResult({ run: 2, failureAuditableCount: 0, failureStoryCount: 12 }),
      makeResult({ run: 3, failureAuditableCount: 1, failureStoryCount: 14 }),
      makeResult({
        run: 4,
        relatedTopicOnlyPairCount: 1,
        failureSnapshotPath: '/tmp/failure.json',
        runtimeLogsPath: '/tmp/runtime.json',
      }),
    ]);

    expect(trend.classifications).toEqual({
      pass: 1,
      semantic_contamination: 1,
      bundle_starvation: 1,
      insufficient_auditable_supply: 1,
      artifact_missing: 0,
      report_parse_error: 0,
      runner_failure: 0,
    });
    expect(trend.longestFailureStreak).toBe(3);
    expect(trend.longestSupplyFailureStreak).toBe(2);
    expect(trend.latestFailure).toEqual({
      run: 4,
      pass: false,
      classification: 'semantic_contamination',
      sampledStoryCount: 0,
      auditedPairCount: 0,
      relatedTopicOnlyPairCount: 1,
      failureStoryCount: null,
      failureAuditableCount: null,
      failureSnapshotPath: '/tmp/failure.json',
      runtimeLogsPath: '/tmp/runtime.json',
    });
    expect(trend.averageFailureStoryCount).toBe(13);
    expect(trend.averageFailureAuditableCount).toBe(0.5);
  });

  it('handles an empty trend window without density observations', () => {
    const trend = buildSoakTrend([]);

    expect(trend.totalRuns).toBe(0);
    expect(trend.latestFailure).toBeNull();
    expect(trend.averageFailureStoryCount).toBeNull();
    expect(trend.averageFailureAuditableCount).toBeNull();
    expect(trend.runs).toEqual([]);
  });

  it('builds a release artifact index with trend path and classifications', () => {
    expect(buildReleaseArtifactIndex('/tmp/artifacts', '/tmp/summary.json', '/tmp/trend.json', [
      makeResult({ run: 1, pass: true }),
      makeResult({ run: 2, failureAuditableCount: 0 }),
    ])).toMatchObject({
      artifactDir: '/tmp/artifacts',
      summaryPath: '/tmp/summary.json',
      trendPath: '/tmp/trend.json',
      build: {
        stdoutPath: '/tmp/artifacts/build.stdout.log',
        stderrPath: '/tmp/artifacts/build.stderr.log',
      },
      runs: [
        { run: 1, pass: true, classification: 'pass' },
        { run: 2, pass: false, classification: 'bundle_starvation' },
      ],
    });
  });
});
