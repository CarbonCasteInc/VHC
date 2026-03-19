import path from 'node:path';

export const PUBLIC_SEMANTIC_SOAK_POSTURE = Object.freeze({
  lane: 'public_semantic_soak',
  evidenceTier: 'smoke_only',
  blocking: false,
  canonicalSourceBasis: 'unchanged',
  biasTableBasis: 'unchanged',
});

export const HEADLINE_SOAK_TREND_INDEX_SCHEMA_VERSION = Object.freeze(
  'daemon-feed-headline-soak-trend-index-v1',
);

export function buildStoryClusterCorrectnessGate(repoRoot = process.cwd()) {
  return {
    gateId: 'storycluster-primary-correctness-gate-v1',
    role: 'primary_correctness_proof',
    blocking: true,
    proofMode: 'deterministic_corpus_plus_daemon_first_semantic_gate',
    authoritativeInputs: {
      fixtureCorpusPath: path.join(
        repoRoot,
        'services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts',
      ),
      replayCorpusPath: path.join(
        repoRoot,
        'services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts',
      ),
      servedSemanticGateSpecPath: path.join(
        repoRoot,
        'packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts',
      ),
    },
    commands: {
      deterministicCorpusCommand:
        'pnpm --filter @vh/storycluster-engine exec vitest run src/benchmarkCorpusKnownEventOngoingFixtures.test.ts src/storyclusterKnownEventOngoingReplay.test.ts src/storyclusterQualityGate.test.ts --config ./vitest.config.ts',
      servedSemanticGateCommand:
        'pnpm --filter @vh/e2e test:live:daemon-feed:semantic-gate',
      combinedGateCommand:
        'pnpm test:storycluster:correctness',
    },
  };
}

export function buildPublicSemanticSoakSecondaryTelemetry() {
  return {
    role: 'secondary_distribution_telemetry',
    interpretation: 'non_blocking_public_supply_signal',
    ...PUBLIC_SEMANTIC_SOAK_POSTURE,
  };
}

export const PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA = Object.freeze({
  minimumRuns: 5,
  minimumPassRate: 1,
  minimumAverageSampleFillRate: 0.75,
  minimumAverageAuditedPairsPerSampledStory: 1,
  maximumSemanticContaminationRuns: 0,
  maximumSupplyFailureRuns: 0,
});

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function average(values) {
  const observed = values.filter(isFiniteNumber);
  if (observed.length === 0) {
    return null;
  }
  return observed.reduce((sum, value) => sum + value, 0) / observed.length;
}

function sum(values) {
  return values.filter(isFiniteNumber).reduce((total, value) => total + value, 0);
}

function ratio(numerator, denominator) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function canonicalSourceCount(bundle) {
  if (isFiniteNumber(bundle?.canonical_source_count)) {
    return bundle.canonical_source_count;
  }

  if (Array.isArray(bundle?.canonical_sources)) {
    return bundle.canonical_sources.length;
  }

  if (Array.isArray(bundle?.sources)) {
    return bundle.sources.length;
  }

  return null;
}

export function summarizeLabelCounts(report) {
  const counts = {
    duplicate: 0,
    same_incident: 0,
    same_developing_episode: 0,
    related_topic_only: 0,
  };

  for (const bundle of report?.bundles ?? []) {
    for (const pair of bundle?.pairs ?? []) {
      if (pair?.label && pair.label in counts) {
        counts[pair.label] += 1;
      }
    }
  }

  return counts;
}

export function summarizeBundleComposition(report) {
  const bundles = Array.isArray(report?.bundles) ? report.bundles : [];
  const canonicalSourceCounts = [];
  const uniqueSourceIds = new Set();
  let corroboratedBundleCount = 0;
  let singletonBundleCount = 0;

  for (const bundle of bundles) {
    const nextCanonicalSourceCount = canonicalSourceCount(bundle);
    if (isFiniteNumber(nextCanonicalSourceCount)) {
      canonicalSourceCounts.push(nextCanonicalSourceCount);
      if (nextCanonicalSourceCount > 1) {
        corroboratedBundleCount += 1;
      } else if (nextCanonicalSourceCount === 1) {
        singletonBundleCount += 1;
      }
    }

    for (const source of bundle?.canonical_sources ?? bundle?.sources ?? []) {
      if (typeof source?.source_id === 'string' && source.source_id.trim()) {
        uniqueSourceIds.add(source.source_id.trim());
      }
    }
  }

  return {
    bundledStoryCount: bundles.length,
    corroboratedBundleCount,
    singletonBundleCount,
    corroboratedBundleRate: ratio(corroboratedBundleCount, bundles.length),
    averageCanonicalSourceCount: average(canonicalSourceCounts),
    maxCanonicalSourceCount: canonicalSourceCounts.length === 0 ? null : Math.max(...canonicalSourceCounts),
    uniqueSourceCount: uniqueSourceIds.size,
    uniqueSourceIds: [...uniqueSourceIds].sort(),
  };
}

export function classifySoakRun(result) {
  if (result.pass) {
    return 'pass';
  }
  if ((result.relatedTopicOnlyPairCount ?? 0) > 0) {
    return 'semantic_contamination';
  }
  if (typeof result.failureAuditableCount === 'number') {
    return result.failureAuditableCount > 0 ? 'insufficient_auditable_supply' : 'bundle_starvation';
  }
  if (typeof result.auditError === 'string' && result.auditError.includes('attachment missing')) {
    return 'artifact_missing';
  }
  if (typeof result.reportParseError === 'string' && result.reportParseError.length > 0) {
    return 'report_parse_error';
  }
  return 'runner_failure';
}

export function buildRunArtifactPaths(result) {
  return {
    reportPath: result.reportPath ?? null,
    auditPath: result.auditPath ?? null,
    failureSnapshotPath: result.failureSnapshotPath ?? null,
    runtimeLogsPath: result.runtimeLogsPath ?? null,
  };
}

export function summarizeSoakDensity(result) {
  const requestedSampleCount = result.requestedSampleCount ?? null;
  const sampledStoryCount = result.sampledStoryCount ?? null;
  const auditedPairCount = result.auditedPairCount ?? null;
  const relatedTopicOnlyPairCount = result.relatedTopicOnlyPairCount ?? null;
  const failureStoryCount = result.failureStoryCount ?? null;
  const failureAuditableCount = result.failureAuditableCount ?? null;

  return {
    requestedSampleCount,
    sampledStoryCount,
    sampleFillRate: ratio(sampledStoryCount, requestedSampleCount),
    sampleShortfall: isFiniteNumber(requestedSampleCount) && isFiniteNumber(sampledStoryCount)
      ? Math.max(requestedSampleCount - sampledStoryCount, 0)
      : null,
    auditedPairCount,
    auditedPairsPerSampledStory: ratio(auditedPairCount, sampledStoryCount),
    relatedTopicOnlyPairCount,
    relatedTopicOnlyRate: ratio(relatedTopicOnlyPairCount, auditedPairCount),
    failureStoryCount,
    failureAuditableCount,
    failureAuditableDensity: ratio(failureAuditableCount, failureStoryCount),
  };
}

export function accumulateStoryCoverage(results) {
  const byStory = new Map();

  for (const result of results) {
    for (const storyId of result.storyIds ?? []) {
      const existing = byStory.get(storyId) ?? { story_id: storyId, run_count: 0, runs: [] };
      existing.run_count += 1;
      existing.runs.push(result.run);
      byStory.set(storyId, existing);
    }
  }

  return [...byStory.values()].sort((left, right) => right.run_count - left.run_count);
}

export function assessPromotionReadiness(trend) {
  const criteria = PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA;
  const blockingReasons = [];

  if ((trend?.totalRuns ?? 0) < criteria.minimumRuns) {
    blockingReasons.push('insufficient_run_count');
  }
  if ((trend?.passRate ?? 0) < criteria.minimumPassRate) {
    blockingReasons.push('pass_rate_below_threshold');
  }
  if ((trend?.classifications?.semantic_contamination ?? 0) > criteria.maximumSemanticContaminationRuns) {
    blockingReasons.push('semantic_contamination_present');
  }

  const supplyFailureRuns = (trend?.classifications?.bundle_starvation ?? 0)
    + (trend?.classifications?.insufficient_auditable_supply ?? 0);
  if (supplyFailureRuns > criteria.maximumSupplyFailureRuns) {
    blockingReasons.push('supply_failures_present');
  }
  if ((trend?.density?.averageSampleFillRate ?? 0) < criteria.minimumAverageSampleFillRate) {
    blockingReasons.push('insufficient_sample_fill_rate');
  }
  if ((trend?.density?.averageAuditedPairsPerSampledStory ?? 0) < criteria.minimumAverageAuditedPairsPerSampledStory) {
    blockingReasons.push('insufficient_audited_pair_density');
  }

  return {
    promotable: blockingReasons.length === 0,
    status: blockingReasons.length === 0 ? 'promotable' : 'not_ready',
    criteria,
    blockingReasons,
  };
}

export function buildSoakTrend(results) {
  const classes = {
    pass: 0,
    semantic_contamination: 0,
    bundle_starvation: 0,
    insufficient_auditable_supply: 0,
    artifact_missing: 0,
    report_parse_error: 0,
    runner_failure: 0,
  };
  let currentFailureStreak = 0;
  let longestFailureStreak = 0;
  let currentStarvationStreak = 0;
  let longestStarvationStreak = 0;

  const runs = results.map((result) => {
    const classification = classifySoakRun(result);
    const artifactPaths = buildRunArtifactPaths(result);
    const density = summarizeSoakDensity(result);
    classes[classification] += 1;
    if (classification === 'pass') {
      currentFailureStreak = 0;
      currentStarvationStreak = 0;
    } else {
      currentFailureStreak += 1;
      longestFailureStreak = Math.max(longestFailureStreak, currentFailureStreak);
      if (classification === 'bundle_starvation' || classification === 'insufficient_auditable_supply') {
        currentStarvationStreak += 1;
        longestStarvationStreak = Math.max(longestStarvationStreak, currentStarvationStreak);
      } else {
        currentStarvationStreak = 0;
      }
    }

    return {
      run: result.run,
      pass: result.pass,
      classification,
      requestedSampleCount: density.requestedSampleCount,
      sampledStoryCount: density.sampledStoryCount,
      auditedPairCount: density.auditedPairCount,
      relatedTopicOnlyPairCount: density.relatedTopicOnlyPairCount,
      failureStoryCount: density.failureStoryCount,
      failureAuditableCount: density.failureAuditableCount,
      reportPath: artifactPaths.reportPath,
      auditPath: artifactPaths.auditPath,
      failureSnapshotPath: artifactPaths.failureSnapshotPath,
      runtimeLogsPath: artifactPaths.runtimeLogsPath,
      artifactPaths,
      density,
      bundleComposition: result.bundleComposition ?? null,
      repeatedStoryCount: result.repeatedStoryCount ?? null,
    };
  });

  const failureRuns = runs.filter((run) => !run.pass);
  const artifactCoverage = {
    reportCount: runs.filter((run) => run.artifactPaths.reportPath).length,
    auditCount: runs.filter((run) => run.artifactPaths.auditPath).length,
    failureSnapshotCount: runs.filter((run) => run.artifactPaths.failureSnapshotPath).length,
    runtimeLogsCount: runs.filter((run) => run.artifactPaths.runtimeLogsPath).length,
  };
  const sampleShortfalls = runs.map((run) => run.density.sampleShortfall).filter(isFiniteNumber);
  const sampleFillRates = runs.map((run) => run.density.sampleFillRate);
  const failureAuditableDensities = runs.map((run) => run.density.failureAuditableDensity);
  const corroboratedBundleRates = runs.map((run) => run.bundleComposition?.corroboratedBundleRate);
  const uniqueSourceCounts = runs.map((run) => run.bundleComposition?.uniqueSourceCount);

  const trend = {
    schemaVersion: 'daemon-feed-semantic-soak-trend-v2',
    generatedAt: new Date().toISOString(),
    executionPosture: PUBLIC_SEMANTIC_SOAK_POSTURE,
    totalRuns: results.length,
    passRate: ratio(classes.pass, results.length),
    failureRate: ratio(results.length - classes.pass, results.length),
    classifications: classes,
    artifactCoverage,
    density: {
      requestedSampleTotal: sum(runs.map((run) => run.density.requestedSampleCount)),
      sampledStoryTotal: sum(runs.map((run) => run.density.sampledStoryCount)),
      auditedPairTotal: sum(runs.map((run) => run.density.auditedPairCount)),
      relatedTopicOnlyPairTotal: sum(runs.map((run) => run.density.relatedTopicOnlyPairCount)),
      averageSampleFillRate: average(sampleFillRates),
      observedSampleFillRuns: sampleFillRates.filter(isFiniteNumber).length,
      maxSampleShortfall: sampleShortfalls.length === 0 ? null : Math.max(...sampleShortfalls),
      averageAuditedPairsPerSampledStory: average(
        runs.map((run) => run.density.auditedPairsPerSampledStory),
      ),
      averageRelatedTopicOnlyRate: average(runs.map((run) => run.density.relatedTopicOnlyRate)),
      averageFailureAuditableDensity: average(failureAuditableDensities),
      observedFailureDensityRuns: failureAuditableDensities.filter(isFiniteNumber).length,
      observedFailureSnapshotRuns: artifactCoverage.failureSnapshotCount,
    },
    usefulness: {
      bundledStoryTotal: sum(runs.map((run) => run.bundleComposition?.bundledStoryCount)),
      corroboratedBundleTotal: sum(runs.map((run) => run.bundleComposition?.corroboratedBundleCount)),
      singletonBundleTotal: sum(runs.map((run) => run.bundleComposition?.singletonBundleCount)),
      averageCorroboratedBundleRate: average(corroboratedBundleRates),
      observedBundleRuns: runs.filter((run) => isFiniteNumber(run.bundleComposition?.bundledStoryCount)).length,
      averageUniqueSourceCount: average(uniqueSourceCounts),
      maxUniqueSourceCount: uniqueSourceCounts.filter(isFiniteNumber).length === 0
        ? null
        : Math.max(...uniqueSourceCounts.filter(isFiniteNumber)),
      averageRepeatedStoryCount: average(runs.map((run) => run.repeatedStoryCount)),
    },
    longestFailureStreak,
    longestSupplyFailureStreak: longestStarvationStreak,
    latestFailure: failureRuns.at(-1) ?? null,
    latestFailureWithDiagnostics: [...failureRuns]
      .reverse()
      .find((run) => run.artifactPaths.failureSnapshotPath || run.artifactPaths.runtimeLogsPath) ?? null,
    averageFailureStoryCount: average(failureRuns.map((run) => run.failureStoryCount)),
    averageFailureAuditableCount: average(failureRuns.map((run) => run.failureAuditableCount)),
    runs,
  };

  return {
    ...trend,
    promotionAssessment: assessPromotionReadiness(trend),
  };
}

export function buildHeadlineSoakExecutionSummary({
  artifactDir,
  summary,
  trend,
  index,
}) {
  const runCount = summary?.runCount ?? trend?.totalRuns ?? 0;
  const passCount = summary?.passCount ?? trend?.classifications?.pass ?? 0;
  const failCount = summary?.failCount ?? (
    isFiniteNumber(runCount) && isFiniteNumber(passCount)
      ? Math.max(runCount - passCount, 0)
      : 0
  );

  return {
    artifactDir,
    generatedAt: summary?.generatedAt ?? trend?.generatedAt ?? index?.generatedAt ?? null,
    strictSoakPass: summary?.strictSoakPass === true,
    readinessStatus:
      summary?.readinessStatus
      ?? trend?.promotionAssessment?.status
      ?? index?.promotionAssessment?.status
      ?? 'not_ready',
    promotionBlockingReasons:
      summary?.promotionBlockingReasons
      ?? trend?.promotionAssessment?.blockingReasons
      ?? index?.promotionAssessment?.blockingReasons
      ?? [],
    runCount,
    passCount,
    failCount,
    totalSampledStories: summary?.totalSampledStories ?? trend?.density?.sampledStoryTotal ?? 0,
    totalAuditedPairs: summary?.totalAuditedPairs ?? trend?.density?.auditedPairTotal ?? 0,
    totalRelatedTopicOnlyPairs:
      summary?.totalRelatedTopicOnlyPairs
      ?? trend?.density?.relatedTopicOnlyPairTotal
      ?? 0,
    repeatedStoryCount: summary?.repeatedStoryCount ?? null,
    totalBundledStories: summary?.totalBundledStories ?? trend?.usefulness?.bundledStoryTotal ?? 0,
    totalCorroboratedBundles:
      summary?.totalCorroboratedBundles
      ?? trend?.usefulness?.corroboratedBundleTotal
      ?? 0,
    totalSingletonBundles:
      summary?.totalSingletonBundles
      ?? trend?.usefulness?.singletonBundleTotal
      ?? 0,
    averageSampleFillRate: trend?.density?.averageSampleFillRate ?? null,
    averageAuditedPairsPerSampledStory:
      trend?.density?.averageAuditedPairsPerSampledStory
      ?? null,
    averageCorroboratedBundleRate: trend?.usefulness?.averageCorroboratedBundleRate ?? null,
    averageUniqueSourceCount: trend?.usefulness?.averageUniqueSourceCount ?? null,
    maxUniqueSourceCount: trend?.usefulness?.maxUniqueSourceCount ?? null,
    classifications: trend?.classifications ?? null,
    artifactPaths: {
      summaryPath:
        index?.summaryPath
        ?? path.join(artifactDir, 'semantic-soak-summary.json'),
      trendPath:
        index?.trendPath
        ?? path.join(artifactDir, 'semantic-soak-trend.json'),
      indexPath:
        index?.artifactPaths?.indexPath
        ?? path.join(artifactDir, 'release-artifact-index.json'),
    },
  };
}

export function buildHeadlineSoakTrendIndex(
  runs,
  {
    artifactRoot = null,
    latestArtifactDir = null,
    lookbackExecutionCount = null,
  } = {},
) {
  const recentRuns = Array.isArray(runs) ? runs : [];
  const latestExecution = recentRuns.at(-1) ?? null;
  const promotableExecutionCount = recentRuns.filter((run) => run.readinessStatus === 'promotable').length;
  const strictSoakPassCount = recentRuns.filter((run) => run.strictSoakPass).length;
  const strictSoakFailCount = recentRuns.length - strictSoakPassCount;
  const sampleFillRates = recentRuns.map((run) => run.averageSampleFillRate);
  const auditedPairDensities = recentRuns.map((run) => run.averageAuditedPairsPerSampledStory);
  const corroboratedBundleRates = recentRuns.map((run) => run.averageCorroboratedBundleRate);
  const uniqueSourceCounts = recentRuns.map((run) => run.averageUniqueSourceCount);
  const repeatedStoryCounts = recentRuns.map((run) => run.repeatedStoryCount);

  return {
    schemaVersion: HEADLINE_SOAK_TREND_INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    artifactRoot,
    latestArtifactDir,
    lookbackExecutionCount,
    executionCount: recentRuns.length,
    promotableExecutionCount,
    notReadyExecutionCount: recentRuns.length - promotableExecutionCount,
    strictSoakPassCount,
    strictSoakFailCount,
    latestExecution,
    latestPromotableExecution: [...recentRuns].reverse().find((run) => run.readinessStatus === 'promotable') ?? null,
    latestStrictFailureExecution: [...recentRuns].reverse().find((run) => !run.strictSoakPass) ?? null,
    density: {
      averageSampleFillRate: average(sampleFillRates),
      averageAuditedPairsPerSampledStory: average(auditedPairDensities),
    },
    usefulness: {
      totalBundledStories: sum(recentRuns.map((run) => run.totalBundledStories)),
      totalCorroboratedBundles: sum(recentRuns.map((run) => run.totalCorroboratedBundles)),
      totalSingletonBundles: sum(recentRuns.map((run) => run.totalSingletonBundles)),
      averageCorroboratedBundleRate: average(corroboratedBundleRates),
      averageUniqueSourceCount: average(uniqueSourceCounts),
      maxUniqueSourceCount: uniqueSourceCounts.filter(isFiniteNumber).length === 0
        ? null
        : Math.max(...uniqueSourceCounts.filter(isFiniteNumber)),
      averageRepeatedStoryCount: average(repeatedStoryCounts),
    },
    runs: recentRuns,
  };
}

export function buildReleaseArtifactIndex(
  artifactDir,
  summaryPath,
  trendPath,
  results,
  repoRoot = process.cwd(),
  headlineSoakTrendIndexPath = `${artifactDir}/headline-soak-trend-index.json`,
) {
  const trend = buildSoakTrend(results);
  const authoritativeCorrectnessGate = buildStoryClusterCorrectnessGate(repoRoot);
  const secondaryDistributionTelemetry = buildPublicSemanticSoakSecondaryTelemetry();

  const build = {
    stdoutPath: `${artifactDir}/build.stdout.log`,
    stderrPath: `${artifactDir}/build.stderr.log`,
  };

  return {
    schemaVersion: 'daemon-feed-semantic-soak-release-artifact-index-v3',
    generatedAt: new Date().toISOString(),
    executionPosture: PUBLIC_SEMANTIC_SOAK_POSTURE,
    authoritativeCorrectnessGate,
    secondaryDistributionTelemetry,
    promotionAssessment: trend.promotionAssessment,
    artifactDir,
    summaryPath,
    trendPath,
    build,
    artifactPaths: {
      artifactDir,
      summaryPath,
      trendPath,
      indexPath: `${artifactDir}/release-artifact-index.json`,
      headlineSoakTrendIndexPath,
      build,
    },
    runs: results.map((result) => {
      const artifactPaths = buildRunArtifactPaths(result);
      return {
        run: result.run,
        pass: result.pass,
        classification: classifySoakRun(result),
        reportPath: artifactPaths.reportPath,
        auditPath: artifactPaths.auditPath,
        failureSnapshotPath: artifactPaths.failureSnapshotPath,
        runtimeLogsPath: artifactPaths.runtimeLogsPath,
        artifactPaths,
      };
    }),
  };
}
