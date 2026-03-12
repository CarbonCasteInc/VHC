import { describe, expect, it } from 'vitest';
import {
  accumulateStoryCoverage,
  buildRunArtifactPaths,
  classifySoakRun,
  summarizeLabelCounts,
  summarizeSoakDensity,
} from './daemon-feed-semantic-soak-report.mjs';

function makeResult(overrides = {}) {
  return {
    run: 1,
    pass: false,
    requestedSampleCount: 8,
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

  it('builds coherent artifact paths with null fallbacks', () => {
    expect(buildRunArtifactPaths(makeResult({
      reportPath: '/tmp/run-1.playwright.json',
      auditPath: undefined,
      failureSnapshotPath: '/tmp/run-1.failure.json',
      runtimeLogsPath: null,
    }))).toEqual({
      reportPath: '/tmp/run-1.playwright.json',
      auditPath: null,
      failureSnapshotPath: '/tmp/run-1.failure.json',
      runtimeLogsPath: null,
    });

    expect(buildRunArtifactPaths(makeResult({
      reportPath: undefined,
      auditPath: '/tmp/run-2.audit.json',
      failureSnapshotPath: undefined,
      runtimeLogsPath: '/tmp/run-2.logs.json',
    }))).toEqual({
      reportPath: null,
      auditPath: '/tmp/run-2.audit.json',
      failureSnapshotPath: null,
      runtimeLogsPath: '/tmp/run-2.logs.json',
    });
  });

  it('summarizes per-run density metrics and guards invalid ratios', () => {
    expect(summarizeSoakDensity(makeResult({
      requestedSampleCount: 8,
      sampledStoryCount: 6,
      auditedPairCount: 12,
      relatedTopicOnlyPairCount: 3,
      failureStoryCount: 10,
      failureAuditableCount: 2,
    }))).toEqual({
      requestedSampleCount: 8,
      sampledStoryCount: 6,
      sampleFillRate: 0.75,
      sampleShortfall: 2,
      auditedPairCount: 12,
      auditedPairsPerSampledStory: 2,
      relatedTopicOnlyPairCount: 3,
      relatedTopicOnlyRate: 0.25,
      failureStoryCount: 10,
      failureAuditableCount: 2,
      failureAuditableDensity: 0.2,
    });

    expect(summarizeSoakDensity(makeResult({
      requestedSampleCount: 0,
      sampledStoryCount: 0,
      auditedPairCount: 0,
      relatedTopicOnlyPairCount: 1,
      failureStoryCount: 0,
      failureAuditableCount: 0,
    }))).toEqual({
      requestedSampleCount: 0,
      sampledStoryCount: 0,
      sampleFillRate: null,
      sampleShortfall: 0,
      auditedPairCount: 0,
      auditedPairsPerSampledStory: null,
      relatedTopicOnlyPairCount: 1,
      relatedTopicOnlyRate: null,
      failureStoryCount: 0,
      failureAuditableCount: 0,
      failureAuditableDensity: null,
    });

    expect(summarizeSoakDensity(makeResult({
      requestedSampleCount: undefined,
      sampledStoryCount: undefined,
      auditedPairCount: undefined,
      relatedTopicOnlyPairCount: undefined,
    }))).toEqual({
      requestedSampleCount: null,
      sampledStoryCount: null,
      sampleFillRate: null,
      sampleShortfall: null,
      auditedPairCount: null,
      auditedPairsPerSampledStory: null,
      relatedTopicOnlyPairCount: null,
      relatedTopicOnlyRate: null,
      failureStoryCount: null,
      failureAuditableCount: null,
      failureAuditableDensity: null,
    });
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
});
