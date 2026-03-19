import { describe, expect, it } from 'vitest';
import {
  accumulateStoryCoverage,
  assessPromotionReadiness,
  buildStoryClusterCorrectnessGate,
  buildRunArtifactPaths,
  classifySoakRun,
  PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
  summarizeBundleComposition,
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
  it('defaults correctness-gate paths to the workspace root', () => {
    expect(buildStoryClusterCorrectnessGate()).toMatchObject({
      authoritativeInputs: {
        fixtureCorpusPath: '/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts',
        replayCorpusPath: '/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts',
        servedSemanticGateSpecPath: '/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts',
      },
    });
  });

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
    expect(classifySoakRun(makeResult({ auditArtifactState: 'crash_before_attachment' }))).toBe('artifact_missing');
    expect(classifySoakRun(makeResult({ auditArtifactState: 'audit_attachment_missing_with_auxiliary_attachments' }))).toBe('artifact_missing');
    expect(classifySoakRun(makeResult({ auditArtifactState: 'attachment_path_mismatch' }))).toBe('artifact_missing');
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

  it('summarizes bundle composition and source diversity across audited bundles', () => {
    expect(summarizeBundleComposition({
      bundles: [
        {
          canonical_source_count: 2,
          canonical_sources: [
            { source_id: 'guardian-us' },
            { source_id: 'cbs-politics' },
          ],
        },
        {
          canonical_source_count: 1,
          canonical_sources: [
            { source_id: 'guardian-us' },
          ],
        },
        {
          canonical_sources: [
            { source_id: 'nbc-politics' },
            { source_id: 'pbs-politics' },
            { source_id: 'guardian-us' },
          ],
        },
      ],
    })).toEqual({
      bundledStoryCount: 3,
      corroboratedBundleCount: 2,
      singletonBundleCount: 1,
      corroboratedBundleRate: 2 / 3,
      averageCanonicalSourceCount: 2,
      maxCanonicalSourceCount: 3,
      uniqueSourceCount: 4,
      uniqueSourceIds: ['cbs-politics', 'guardian-us', 'nbc-politics', 'pbs-politics'],
    });
  });

  it('falls back to generic bundle sources and null counts when canonical fields are missing', () => {
    expect(summarizeBundleComposition({
      bundles: [
        {
          sources: [
            { source_id: 'abc-politics' },
            { source_id: 'nbc-politics' },
          ],
        },
        {},
      ],
    })).toEqual({
      bundledStoryCount: 2,
      corroboratedBundleCount: 1,
      singletonBundleCount: 0,
      corroboratedBundleRate: 0.5,
      averageCanonicalSourceCount: 2,
      maxCanonicalSourceCount: 2,
      uniqueSourceCount: 2,
      uniqueSourceIds: ['abc-politics', 'nbc-politics'],
    });
  });

  it('marks public soak as not promotable when density or pass criteria fail', () => {
    expect(assessPromotionReadiness({
      totalRuns: 4,
      passRate: 0.5,
      classifications: {
        semantic_contamination: 1,
        bundle_starvation: 1,
        insufficient_auditable_supply: 1,
      },
      density: {
        averageSampleFillRate: 0.5,
        averageAuditedPairsPerSampledStory: 0.5,
      },
    })).toEqual({
      promotable: false,
      status: 'not_ready',
      criteria: PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
      blockingReasons: [
        'insufficient_run_count',
        'pass_rate_below_threshold',
        'semantic_contamination_present',
        'supply_failures_present',
        'insufficient_sample_fill_rate',
        'insufficient_audited_pair_density',
      ],
    });
  });

  it('marks public soak as promotable only when all criteria pass', () => {
    expect(assessPromotionReadiness({
      totalRuns: 5,
      passRate: 1,
      classifications: {
        semantic_contamination: 0,
        bundle_starvation: 0,
        insufficient_auditable_supply: 0,
      },
      density: {
        averageSampleFillRate: 0.9,
        averageAuditedPairsPerSampledStory: 1.5,
      },
    })).toEqual({
      promotable: true,
      status: 'promotable',
      criteria: PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
      blockingReasons: [],
    });
  });

  it('handles missing classifications and density fields when assessing promotion readiness', () => {
    expect(assessPromotionReadiness({
      totalRuns: 1,
      passRate: null,
      classifications: undefined,
      density: undefined,
    })).toEqual({
      promotable: false,
      status: 'not_ready',
      criteria: PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
      blockingReasons: [
        'insufficient_run_count',
        'pass_rate_below_threshold',
        'insufficient_sample_fill_rate',
        'insufficient_audited_pair_density',
      ],
    });
  });

  it('treats an entirely missing trend as not ready for promotion', () => {
    expect(assessPromotionReadiness()).toEqual({
      promotable: false,
      status: 'not_ready',
      criteria: PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
      blockingReasons: [
        'insufficient_run_count',
        'pass_rate_below_threshold',
        'insufficient_sample_fill_rate',
        'insufficient_audited_pair_density',
      ],
    });
  });
});
