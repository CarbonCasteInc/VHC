export const PUBLIC_SEMANTIC_SOAK_POSTURE = Object.freeze({
  lane: 'public_semantic_soak',
  evidenceTier: 'smoke_only',
  blocking: false,
  canonicalSourceBasis: 'unchanged',
  biasTableBasis: 'unchanged',
});

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

export function buildReleaseArtifactIndex(artifactDir, summaryPath, trendPath, results) {
  const trend = buildSoakTrend(results);

  const build = {
    stdoutPath: `${artifactDir}/build.stdout.log`,
    stderrPath: `${artifactDir}/build.stderr.log`,
  };

  return {
    schemaVersion: 'daemon-feed-semantic-soak-release-artifact-index-v2',
    generatedAt: new Date().toISOString(),
    executionPosture: PUBLIC_SEMANTIC_SOAK_POSTURE,
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
