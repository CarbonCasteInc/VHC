import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const HEADLINE_SOAK_CONTINUITY_ANALYSIS_SCHEMA_VERSION =
  'daemon-feed-headline-soak-continuity-analysis-v1';
export const HEADLINE_SOAK_CONTINUITY_TREND_INDEX_SCHEMA_VERSION =
  'daemon-feed-headline-soak-continuity-trend-index-v1';

const AUDIT_FILE_RE = /^run-(\d+)\.semantic-audit\.json$/;
const FAILURE_SNAPSHOT_FILE_RE = /^run-(\d+)\.semantic-audit-failure-snapshot\.json$/;

function normalizeNonEmpty(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
}

function average(values) {
  const observed = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (observed.length === 0) {
    return null;
  }
  return observed.reduce((sum, value) => sum + value, 0) / observed.length;
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function mergeCoverageScope(existing, next) {
  if (!existing) return next;
  if (!next || existing === next) return existing;
  return 'mixed';
}

function mergeSourceIdentityFidelity(existing, next) {
  if (!existing) return next;
  if (!next || existing === next) return existing;
  return 'mixed';
}

function ensureTopicAccumulator(topicsById, topicId) {
  const normalizedTopicId = normalizeNonEmpty(topicId);
  if (!normalizedTopicId) {
    return null;
  }

  const existing = topicsById.get(normalizedTopicId);
  if (existing) {
    return existing;
  }

  const next = {
    topic_id: normalizedTopicId,
    story_ids: new Set(),
    headline: null,
    exact_source_ids: new Set(),
    max_source_count: 0,
    is_auditable: false,
    coverageScope: null,
    sourceIdentityFidelity: null,
    observationKinds: new Set(),
  };
  topicsById.set(normalizedTopicId, next);
  return next;
}

function absorbAuditBundle(topicsById, bundle) {
  const topic = ensureTopicAccumulator(topicsById, bundle?.topic_id);
  if (!topic) {
    return;
  }

  const storyId = normalizeNonEmpty(bundle?.story_id);
  if (storyId) {
    topic.story_ids.add(storyId);
  }
  const headline = normalizeNonEmpty(bundle?.headline);
  if (headline) {
    topic.headline = headline;
  }

  const sourceIds = Array.isArray(bundle?.canonical_sources)
    ? bundle.canonical_sources
      .map((source) => normalizeNonEmpty(source?.source_id))
      .filter(Boolean)
    : [];
  for (const sourceId of sourceIds) {
    topic.exact_source_ids.add(sourceId);
  }

  const canonicalSourceCount = Number.isFinite(bundle?.canonical_source_count)
    ? bundle.canonical_source_count
    : sourceIds.length;
  topic.max_source_count = Math.max(topic.max_source_count, canonicalSourceCount, topic.exact_source_ids.size);
  topic.is_auditable = topic.is_auditable || canonicalSourceCount >= 2;
  topic.coverageScope = mergeCoverageScope(topic.coverageScope, 'audited_sample');
  topic.sourceIdentityFidelity = mergeSourceIdentityFidelity(topic.sourceIdentityFidelity, 'exact');
  topic.observationKinds.add('audit');
}

function absorbFailureSnapshotStory(topicsById, story) {
  const topic = ensureTopicAccumulator(topicsById, story?.topic_id);
  if (!topic) {
    return;
  }

  const storyId = normalizeNonEmpty(story?.story_id);
  if (storyId) {
    topic.story_ids.add(storyId);
  }
  const headline = normalizeNonEmpty(story?.headline);
  if (headline) {
    topic.headline = headline;
  }

  const sourceCount = Number.isFinite(story?.source_count) ? story.source_count : 0;
  topic.max_source_count = Math.max(topic.max_source_count, sourceCount, topic.exact_source_ids.size);
  topic.is_auditable = topic.is_auditable || story?.is_auditable === true || sourceCount >= 2;
  topic.coverageScope = mergeCoverageScope(topic.coverageScope, 'store_snapshot');
  topic.sourceIdentityFidelity = mergeSourceIdentityFidelity(topic.sourceIdentityFidelity, 'count_only');
  topic.observationKinds.add('failure_snapshot');
}

function finalizeTopic(accumulator) {
  const source_ids = [...accumulator.exact_source_ids].sort();
  const source_count = Math.max(accumulator.max_source_count, source_ids.length);
  const sourceIdentityFidelity = accumulator.sourceIdentityFidelity ?? (
    source_ids.length > 0 ? 'exact' : 'count_only'
  );

  return {
    topic_id: accumulator.topic_id,
    story_ids: [...accumulator.story_ids].sort(),
    headline: accumulator.headline,
    source_ids,
    source_count,
    is_auditable: accumulator.is_auditable || source_count >= 2,
    coverageScope: accumulator.coverageScope ?? 'audited_sample',
    sourceIdentityFidelity,
    observationKinds: [...accumulator.observationKinds].sort(),
  };
}

function summarizeTopics(topics) {
  const counts = {
    exact: 0,
    count_only: 0,
    mixed: 0,
  };
  const scopeCounts = {
    audited_sample: 0,
    store_snapshot: 0,
    mixed: 0,
  };

  for (const topic of topics) {
    counts[topic.sourceIdentityFidelity] += 1;
    scopeCounts[topic.coverageScope] += 1;
  }

  return {
    topicCount: topics.length,
    auditableTopicCount: topics.filter((topic) => topic.is_auditable).length,
    sourceIdentityFidelityCounts: counts,
    coverageScopeCounts: scopeCounts,
  };
}

function resolveGeneratedAt(artifactDir, { exists = existsSync, readFile = readFileSync, stat = statSync } = {}) {
  const summaryPath = path.join(artifactDir, 'semantic-soak-summary.json');
  if (exists(summaryPath)) {
    try {
      const summary = readJson(summaryPath, readFile);
      const generatedAt = normalizeNonEmpty(summary?.generatedAt);
      if (generatedAt) {
        const timestampMs = Date.parse(generatedAt);
        if (Number.isFinite(timestampMs)) {
          return { generatedAt, timestampMs, timestampSource: 'summary.generatedAt' };
        }
      }
    } catch {
      // fall through to mtime
    }
  }

  try {
    const mtimeMs = stat(artifactDir).mtimeMs;
    return {
      generatedAt: new Date(mtimeMs).toISOString(),
      timestampMs: mtimeMs,
      timestampSource: 'artifactDir.mtime',
    };
  } catch {
    return {
      generatedAt: null,
      timestampMs: null,
      timestampSource: 'unavailable',
    };
  }
}

export function readExecutionBundleSnapshot(
  artifactDir,
  {
    exists = existsSync,
    readFile = readFileSync,
    readdir = readdirSync,
    stat = statSync,
  } = {},
) {
  let entries = [];
  try {
    entries = readdir(artifactDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const auditsByRun = new Map();
  const failureSnapshotsByRun = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const auditMatch = entry.name.match(AUDIT_FILE_RE);
    if (auditMatch) {
      auditsByRun.set(Number.parseInt(auditMatch[1], 10), path.join(artifactDir, entry.name));
      continue;
    }

    const failureMatch = entry.name.match(FAILURE_SNAPSHOT_FILE_RE);
    if (failureMatch) {
      failureSnapshotsByRun.set(Number.parseInt(failureMatch[1], 10), path.join(artifactDir, entry.name));
    }
  }

  const runNumbers = [...new Set([...auditsByRun.keys(), ...failureSnapshotsByRun.keys()])]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (runNumbers.length === 0) {
    return null;
  }

  const topicsById = new Map();
  for (const runNumber of runNumbers) {
    const auditPath = auditsByRun.get(runNumber);
    if (auditPath && exists(auditPath)) {
      try {
        const audit = readJson(auditPath, readFile);
        for (const bundle of audit?.bundles ?? []) {
          absorbAuditBundle(topicsById, bundle);
        }
        continue;
      } catch {
        // fall through to failure snapshot if present
      }
    }

    const failureSnapshotPath = failureSnapshotsByRun.get(runNumber);
    if (failureSnapshotPath && exists(failureSnapshotPath)) {
      try {
        const snapshot = readJson(failureSnapshotPath, readFile);
        for (const story of snapshot?.stories ?? []) {
          absorbFailureSnapshotStory(topicsById, story);
        }
      } catch {
        // ignore malformed snapshot during historical scan
      }
    }
  }

  const topics = [...topicsById.values()]
    .map(finalizeTopic)
    .sort((left, right) => left.topic_id.localeCompare(right.topic_id));
  if (topics.length === 0) {
    return null;
  }

  const generatedAt = resolveGeneratedAt(artifactDir, { exists, readFile, stat });
  const summary = summarizeTopics(topics);
  const coverageScope = Object.entries(summary.coverageScopeCounts)
    .filter(([, count]) => count > 0)
    .map(([scope]) => scope);

  return {
    schemaVersion: 'daemon-feed-headline-soak-continuity-snapshot-v1',
    artifactDir,
    generatedAt: generatedAt.generatedAt,
    timestampMs: generatedAt.timestampMs,
    timestampSource: generatedAt.timestampSource,
    coverageScope: coverageScope.length === 1 ? coverageScope[0] : 'mixed',
    ...summary,
    topics,
  };
}

function aggregatePriorSnapshots(priorSnapshots) {
  const aggregatedTopics = new Map();
  let coverageScope = null;
  const artifactDirs = [];

  for (const snapshot of priorSnapshots) {
    if (!snapshot) continue;
    artifactDirs.push(snapshot.artifactDir);
    coverageScope = mergeCoverageScope(coverageScope, snapshot.coverageScope);
    for (const topic of snapshot.topics ?? []) {
      const accumulator = ensureTopicAccumulator(aggregatedTopics, topic.topic_id);
      if (!accumulator) continue;

      for (const storyId of topic.story_ids ?? []) {
        const normalizedStoryId = normalizeNonEmpty(storyId);
        if (normalizedStoryId) {
          accumulator.story_ids.add(normalizedStoryId);
        }
      }
      const headline = normalizeNonEmpty(topic.headline);
      if (headline) {
        accumulator.headline = headline;
      }
      for (const sourceId of topic.source_ids ?? []) {
        const normalizedSourceId = normalizeNonEmpty(sourceId);
        if (normalizedSourceId) {
          accumulator.exact_source_ids.add(normalizedSourceId);
        }
      }
      accumulator.max_source_count = Math.max(
        accumulator.max_source_count,
        Number.isFinite(topic.source_count) ? topic.source_count : 0,
        accumulator.exact_source_ids.size,
      );
      accumulator.is_auditable = accumulator.is_auditable || topic.is_auditable === true;
      accumulator.coverageScope = mergeCoverageScope(accumulator.coverageScope, topic.coverageScope);
      accumulator.sourceIdentityFidelity = mergeSourceIdentityFidelity(
        accumulator.sourceIdentityFidelity,
        topic.sourceIdentityFidelity,
      );
      for (const kind of topic.observationKinds ?? []) {
        accumulator.observationKinds.add(kind);
      }
    }
  }

  const topics = [...aggregatedTopics.values()]
    .map(finalizeTopic)
    .sort((left, right) => left.topic_id.localeCompare(right.topic_id));
  const summary = summarizeTopics(topics);

  return {
    snapshotCount: priorSnapshots.length,
    artifactDirs,
    coverageScope: coverageScope ?? null,
    ...summary,
    topics,
  };
}

function buildTopicMap(topics) {
  return new Map((topics ?? []).map((topic) => [topic.topic_id, topic]));
}

function canCompareExactSourceIdentity(topic) {
  return topic?.sourceIdentityFidelity === 'exact'
    && Array.isArray(topic?.source_ids)
    && topic.source_ids.length === topic.source_count;
}

export function buildContinuityAnalysis(currentSnapshot, priorSnapshots, { lookbackHours = 24 } = {}) {
  const normalizedPriorSnapshots = (Array.isArray(priorSnapshots) ? priorSnapshots : []).filter(Boolean);
  const priorBaseline = aggregatePriorSnapshots(normalizedPriorSnapshots);
  const currentTopics = currentSnapshot?.topics ?? [];
  const priorTopics = priorBaseline.topics ?? [];
  const currentByTopic = buildTopicMap(currentTopics);
  const priorByTopic = buildTopicMap(priorTopics);

  const retainedTopicIds = currentTopics
    .map((topic) => topic.topic_id)
    .filter((topicId) => priorByTopic.has(topicId));
  const newTopicIds = currentTopics
    .map((topic) => topic.topic_id)
    .filter((topicId) => !priorByTopic.has(topicId));
  const lostTopicIds = priorTopics
    .map((topic) => topic.topic_id)
    .filter((topicId) => !currentByTopic.has(topicId));

  const priorSingletonTopics = priorTopics.filter((topic) => topic.source_count === 1);
  const singletonToCorroboratedTopicIds = priorSingletonTopics
    .filter((topic) => (currentByTopic.get(topic.topic_id)?.source_count ?? 0) >= 2)
    .map((topic) => topic.topic_id);

  const bundleGrowthTopicIds = retainedTopicIds.filter((topicId) => {
    const currentTopic = currentByTopic.get(topicId);
    const priorTopic = priorByTopic.get(topicId);
    return (currentTopic?.source_count ?? 0) > (priorTopic?.source_count ?? 0);
  });

  const exactLaterAttachmentTopics = [];
  let laterAttachmentCount = 0;
  let laterAttachmentComparableTopicCount = 0;
  let laterAttachmentUnknownTopicCount = 0;
  const retainedTopicSourceGains = [];

  for (const topicId of retainedTopicIds) {
    const currentTopic = currentByTopic.get(topicId);
    const priorTopic = priorByTopic.get(topicId);
    const sourceGain = Math.max((currentTopic?.source_count ?? 0) - (priorTopic?.source_count ?? 0), 0);
    retainedTopicSourceGains.push(sourceGain);

    if (canCompareExactSourceIdentity(currentTopic) && canCompareExactSourceIdentity(priorTopic)) {
      laterAttachmentComparableTopicCount += 1;
      const priorSourceIds = new Set(priorTopic.source_ids);
      const nextSourceIds = currentTopic.source_ids.filter((sourceId) => !priorSourceIds.has(sourceId));
      if (nextSourceIds.length > 0) {
        laterAttachmentCount += nextSourceIds.length;
        exactLaterAttachmentTopics.push({
          topic_id: topicId,
          attached_source_ids: nextSourceIds,
          attached_source_count: nextSourceIds.length,
        });
      }
    } else {
      laterAttachmentUnknownTopicCount += 1;
    }
  }

  const metrics = {
    currentTopicCount: currentTopics.length,
    priorTopicCount: priorTopics.length,
    retainedTopicCount: retainedTopicIds.length,
    newTopicCount: newTopicIds.length,
    lostTopicCount: lostTopicIds.length,
    topicRetentionRate: ratio(retainedTopicIds.length, priorTopics.length),
    priorSingletonTopicCount: priorSingletonTopics.length,
    singletonToCorroboratedCount: singletonToCorroboratedTopicIds.length,
    singletonToCorroboratedRate: ratio(singletonToCorroboratedTopicIds.length, priorSingletonTopics.length),
    bundleGrowthCount: bundleGrowthTopicIds.length,
    bundleGrowthRate: ratio(bundleGrowthTopicIds.length, retainedTopicIds.length),
    laterAttachmentCount,
    laterAttachmentComparableTopicCount,
    laterAttachmentUnknownTopicCount,
    crossRunSourceDiversityGain: average(retainedTopicSourceGains),
  };

  return {
    schemaVersion: HEADLINE_SOAK_CONTINUITY_ANALYSIS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    artifactDir: currentSnapshot?.artifactDir ?? null,
    lookbackHours,
    currentSnapshot,
    priorBaseline: {
      snapshotCount: priorBaseline.snapshotCount,
      artifactDirs: priorBaseline.artifactDirs,
      coverageScope: priorBaseline.coverageScope,
      topicCount: priorBaseline.topicCount,
      auditableTopicCount: priorBaseline.auditableTopicCount,
      sourceIdentityFidelityCounts: priorBaseline.sourceIdentityFidelityCounts,
      coverageScopeCounts: priorBaseline.coverageScopeCounts,
    },
    ...metrics,
    metrics,
    transitions: {
      retainedTopicIds,
      newTopicIds,
      lostTopicIds,
      singletonToCorroboratedTopicIds,
      bundleGrowthTopicIds,
      exactLaterAttachmentTopics,
    },
  };
}

export function readHistoricalExecutionBundleSnapshots(
  artifactRoot,
  {
    currentArtifactDir = null,
    currentTimestampMs = null,
    lookbackHours = 24,
    lookbackExecutionCount = 20,
    exists = existsSync,
    readFile = readFileSync,
    readdir = readdirSync,
    stat = statSync,
  } = {},
) {
  let artifactDirs = [];
  try {
    artifactDirs = readdir(artifactRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const artifactDir = path.join(artifactRoot, entry.name);
        return { artifactDir, mtimeMs: stat(artifactDir).mtimeMs };
      })
      .sort((left, right) => left.mtimeMs - right.mtimeMs)
      .slice(-lookbackExecutionCount);
  } catch {
    return [];
  }

  const maxAgeMs = lookbackHours * 60 * 60 * 1000;
  return artifactDirs.flatMap(({ artifactDir }) => {
    if (artifactDir === currentArtifactDir) {
      return [];
    }
    const snapshot = readExecutionBundleSnapshot(artifactDir, {
      exists,
      readFile,
      readdir,
      stat,
    });
    if (!snapshot) {
      return [];
    }
    if (Number.isFinite(currentTimestampMs) && Number.isFinite(snapshot.timestampMs)) {
      if ((currentTimestampMs - snapshot.timestampMs) > maxAgeMs) {
        return [];
      }
    }
    return [snapshot];
  });
}

export function buildContinuityExecutionSummary(analysis) {
  const metrics = analysis?.metrics ?? {};
  return {
    artifactDir: analysis?.artifactDir ?? null,
    generatedAt: analysis?.generatedAt ?? null,
    currentCoverageScope: analysis?.currentSnapshot?.coverageScope ?? null,
    priorCoverageScope: analysis?.priorBaseline?.coverageScope ?? null,
    priorSnapshotCount: analysis?.priorBaseline?.snapshotCount ?? 0,
    currentTopicCount: analysis?.currentTopicCount ?? metrics.currentTopicCount ?? null,
    priorTopicCount: analysis?.priorTopicCount ?? metrics.priorTopicCount ?? null,
    retainedTopicCount: analysis?.retainedTopicCount ?? metrics.retainedTopicCount ?? null,
    newTopicCount: analysis?.newTopicCount ?? metrics.newTopicCount ?? null,
    lostTopicCount: analysis?.lostTopicCount ?? metrics.lostTopicCount ?? null,
    topicRetentionRate: analysis?.topicRetentionRate ?? metrics.topicRetentionRate ?? null,
    priorSingletonTopicCount:
      analysis?.priorSingletonTopicCount
      ?? metrics.priorSingletonTopicCount
      ?? null,
    singletonToCorroboratedCount:
      analysis?.singletonToCorroboratedCount
      ?? metrics.singletonToCorroboratedCount
      ?? null,
    singletonToCorroboratedRate:
      analysis?.singletonToCorroboratedRate
      ?? metrics.singletonToCorroboratedRate
      ?? null,
    bundleGrowthCount: analysis?.bundleGrowthCount ?? metrics.bundleGrowthCount ?? null,
    bundleGrowthRate: analysis?.bundleGrowthRate ?? metrics.bundleGrowthRate ?? null,
    laterAttachmentCount: analysis?.laterAttachmentCount ?? metrics.laterAttachmentCount ?? null,
    laterAttachmentComparableTopicCount:
      analysis?.laterAttachmentComparableTopicCount
      ?? metrics.laterAttachmentComparableTopicCount
      ?? null,
    laterAttachmentUnknownTopicCount:
      analysis?.laterAttachmentUnknownTopicCount
      ?? metrics.laterAttachmentUnknownTopicCount
      ?? null,
    crossRunSourceDiversityGain:
      analysis?.crossRunSourceDiversityGain
      ?? metrics.crossRunSourceDiversityGain
      ?? null,
    metrics: analysis?.metrics ?? null,
    transitions: {
      retainedTopicCount: analysis?.transitions?.retainedTopicIds?.length ?? 0,
      newTopicCount: analysis?.transitions?.newTopicIds?.length ?? 0,
      lostTopicCount: analysis?.transitions?.lostTopicIds?.length ?? 0,
      exactLaterAttachmentTopicCount: analysis?.transitions?.exactLaterAttachmentTopics?.length ?? 0,
    },
  };
}

export function buildContinuityTrendIndex(
  analyses,
  {
    artifactRoot = null,
    latestArtifactDir = null,
    lookbackExecutionCount = null,
    lookbackHours = null,
  } = {},
) {
  const recentAnalyses = Array.isArray(analyses) ? analyses.filter(Boolean) : [];
  const metric = (name) => recentAnalyses.map((analysis) => analysis?.metrics?.[name]);
  const currentCoverageScopes = recentAnalyses.map((analysis) => analysis?.currentSnapshot?.coverageScope).filter(Boolean);
  const priorCoverageScopes = recentAnalyses.map((analysis) => analysis?.priorBaseline?.coverageScope).filter(Boolean);

  const trendIndex = {
    schemaVersion: HEADLINE_SOAK_CONTINUITY_TREND_INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    artifactRoot,
    latestArtifactDir,
    lookbackExecutionCount,
    lookbackHours,
    analysisCount: recentAnalyses.length,
    latestAnalysis: recentAnalyses.length > 0
      ? buildContinuityExecutionSummary(recentAnalyses.at(-1))
      : null,
    averages: {
      topicRetentionRate: average(metric('topicRetentionRate')),
      singletonToCorroboratedRate: average(metric('singletonToCorroboratedRate')),
      bundleGrowthRate: average(metric('bundleGrowthRate')),
      crossRunSourceDiversityGain: average(metric('crossRunSourceDiversityGain')),
    },
    totals: {
      retainedTopicCount: recentAnalyses.reduce((sum, analysis) => sum + (analysis?.metrics?.retainedTopicCount ?? 0), 0),
      newTopicCount: recentAnalyses.reduce((sum, analysis) => sum + (analysis?.metrics?.newTopicCount ?? 0), 0),
      lostTopicCount: recentAnalyses.reduce((sum, analysis) => sum + (analysis?.metrics?.lostTopicCount ?? 0), 0),
      singletonToCorroboratedCount: recentAnalyses.reduce((sum, analysis) => sum + (analysis?.metrics?.singletonToCorroboratedCount ?? 0), 0),
      bundleGrowthCount: recentAnalyses.reduce((sum, analysis) => sum + (analysis?.metrics?.bundleGrowthCount ?? 0), 0),
      laterAttachmentCount: recentAnalyses.reduce((sum, analysis) => sum + (analysis?.metrics?.laterAttachmentCount ?? 0), 0),
    },
    coverage: {
      currentCoverageScopes,
      priorCoverageScopes,
      exactLaterAttachmentComparableAnalysisCount: recentAnalyses.filter(
        (analysis) => (analysis?.metrics?.laterAttachmentComparableTopicCount ?? 0) > 0,
      ).length,
    },
    analyses: recentAnalyses.map(buildContinuityExecutionSummary),
  };

  return trendIndex;
}

export function readHistoricalContinuityAnalyses(
  artifactRoot,
  {
    currentArtifactDir = null,
    lookbackExecutionCount = 20,
    exists = existsSync,
    readFile = readFileSync,
    readdir = readdirSync,
    stat = statSync,
  } = {},
) {
  let artifactDirs = [];
  try {
    artifactDirs = readdir(artifactRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const artifactDir = path.join(artifactRoot, entry.name);
        return { artifactDir, mtimeMs: stat(artifactDir).mtimeMs };
      })
      .sort((left, right) => left.mtimeMs - right.mtimeMs)
      .slice(-lookbackExecutionCount);
  } catch {
    return [];
  }

  return artifactDirs.flatMap(({ artifactDir }) => {
    if (artifactDir === currentArtifactDir) {
      return [];
    }
    const analysisPath = path.join(artifactDir, 'continuity-analysis.json');
    if (!exists(analysisPath)) {
      return [];
    }
    try {
      return [readJson(analysisPath, readFile)];
    } catch {
      return [];
    }
  });
}
