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
      sampledStoryCount: result.sampledStoryCount,
      auditedPairCount: result.auditedPairCount,
      relatedTopicOnlyPairCount: result.relatedTopicOnlyPairCount,
      failureStoryCount: result.failureStoryCount,
      failureAuditableCount: result.failureAuditableCount,
      failureSnapshotPath: result.failureSnapshotPath,
      runtimeLogsPath: result.runtimeLogsPath,
    };
  });

  const failureRuns = runs.filter((run) => !run.pass);
  const densityRuns = failureRuns.filter((run) => typeof run.failureStoryCount === 'number');
  const average = (values) => (values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length);

  return {
    generatedAt: new Date().toISOString(),
    totalRuns: results.length,
    classifications: classes,
    longestFailureStreak,
    longestSupplyFailureStreak: longestStarvationStreak,
    latestFailure: failureRuns.at(-1) ?? null,
    averageFailureStoryCount: average(densityRuns.map((run) => run.failureStoryCount)),
    averageFailureAuditableCount: average(
      densityRuns
        .map((run) => run.failureAuditableCount)
        .filter((value) => typeof value === 'number'),
    ),
    runs,
  };
}

export function buildReleaseArtifactIndex(artifactDir, summaryPath, trendPath, results) {
  return {
    generatedAt: new Date().toISOString(),
    artifactDir,
    summaryPath,
    trendPath,
    build: {
      stdoutPath: `${artifactDir}/build.stdout.log`,
      stderrPath: `${artifactDir}/build.stderr.log`,
    },
    runs: results.map((result) => ({
      run: result.run,
      pass: result.pass,
      classification: classifySoakRun(result),
      reportPath: result.reportPath,
      auditPath: result.auditPath,
      failureSnapshotPath: result.failureSnapshotPath,
      runtimeLogsPath: result.runtimeLogsPath,
    })),
  };
}
