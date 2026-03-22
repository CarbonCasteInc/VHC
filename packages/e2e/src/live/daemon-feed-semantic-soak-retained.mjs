import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const GHOST_RETAINED_MESH_REPORT_SCHEMA_VERSION =
  'daemon-feed-ghost-retained-mesh-report-v1';
export const GHOST_RETAINED_MESH_TREND_INDEX_SCHEMA_VERSION =
  'daemon-feed-ghost-retained-mesh-trend-index-v1';

const RETAINED_SOURCE_EVIDENCE_FILE_RE = /^run-(\d+)\.retained-source-evidence\.json$/;
const SEMANTIC_SOAK_SUMMARY_FILE = 'semantic-soak-summary.json';

function normalizeNonEmpty(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeInteger(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function normalizeBoolean(value) {
  return value === true;
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

function ageHours(scoreTimestampMs, targetTimestampMs) {
  if (!Number.isFinite(scoreTimestampMs) || !Number.isFinite(targetTimestampMs)) {
    return null;
  }
  return (scoreTimestampMs - targetTimestampMs) / (60 * 60 * 1000);
}

function retainedEvidenceKey(source) {
  const sourceId = normalizeNonEmpty(source?.source_id);
  const urlHash = normalizeNonEmpty(source?.url_hash);
  if (!sourceId || !urlHash) {
    return null;
  }
  return `${sourceId}::${urlHash}`;
}

function normalizeSourceRoles(roles) {
  const normalized = Array.isArray(roles)
    ? roles.map((role) => normalizeNonEmpty(role)).filter(Boolean)
    : [];
  return [...new Set(normalized)].sort();
}

function resolveExecutionGeneratedAt(artifactDir, { exists = existsSync, readFile = readFileSync, stat = statSync } = {}) {
  const summaryPath = path.join(artifactDir, SEMANTIC_SOAK_SUMMARY_FILE);
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

function chooseObservationTimestamp(snapshotGeneratedAt, executionTimestampMs) {
  const snapshotTimestampMs = Date.parse(snapshotGeneratedAt ?? '');
  return Number.isFinite(snapshotTimestampMs) ? snapshotTimestampMs : executionTimestampMs;
}

function mergeStringField(existing, next) {
  return normalizeNonEmpty(next) ?? existing ?? null;
}

function mergePublishedAt(existing, next) {
  const normalized = normalizeInteger(next);
  return normalized ?? existing ?? null;
}

function updateLatestObservation(accumulator, candidate) {
  if (!candidate) {
    return;
  }
  if (!accumulator.latestObservation) {
    accumulator.latestObservation = candidate;
    return;
  }

  if ((candidate.timestampMs ?? -Infinity) > (accumulator.latestObservation.timestampMs ?? -Infinity)) {
    accumulator.latestObservation = candidate;
    return;
  }

  if (
    (candidate.timestampMs ?? -Infinity) === (accumulator.latestObservation.timestampMs ?? -Infinity)
    && (candidate.run ?? -Infinity) > (accumulator.latestObservation.run ?? -Infinity)
  ) {
    accumulator.latestObservation = candidate;
  }
}

function buildTopicMesh(evidenceItems, scoreTimestampMs) {
  const topicsById = new Map();

  for (const evidence of evidenceItems) {
    const topicId = normalizeNonEmpty(evidence?.latestTopicId);
    if (!topicId) {
      continue;
    }

    const existing = topicsById.get(topicId) ?? {
      topic_id: topicId,
      evidenceKeys: new Set(),
      canonicalEvidenceKeys: new Set(),
      secondaryOnlyEvidenceKeys: new Set(),
      sourceIds: new Set(),
      canonicalSourceIds: new Set(),
      secondaryOnlySourceIds: new Set(),
      storyIds: new Set(),
      currentEvidenceCount: 0,
      priorEvidenceCount: 0,
      topicDriftedEvidenceCount: 0,
      storyDriftedEvidenceCount: 0,
      evidenceFirstSeenAges: [],
      evidenceLastSeenAges: [],
      firstSeenTimestampMs: null,
      lastSeenTimestampMs: null,
    };

    existing.evidenceKeys.add(evidence.evidence_key);
    existing.sourceIds.add(evidence.source_id);
    if (normalizeNonEmpty(evidence.latestStoryId)) {
      existing.storyIds.add(evidence.latestStoryId);
    }
    if (evidence.seenInCurrent) {
      existing.currentEvidenceCount += 1;
    }
    if (evidence.seenInPrior) {
      existing.priorEvidenceCount += 1;
    }
    if (evidence.topicDrifted) {
      existing.topicDriftedEvidenceCount += 1;
    }
    if (evidence.storyDrifted) {
      existing.storyDriftedEvidenceCount += 1;
    }

    if (evidence.isCanonicalEvidence) {
      existing.canonicalEvidenceKeys.add(evidence.evidence_key);
      existing.canonicalSourceIds.add(evidence.source_id);
    } else {
      existing.secondaryOnlyEvidenceKeys.add(evidence.evidence_key);
      existing.secondaryOnlySourceIds.add(evidence.source_id);
    }

    const firstSeenAge = ageHours(scoreTimestampMs, evidence.firstSeenTimestampMs);
    if (Number.isFinite(firstSeenAge)) {
      existing.evidenceFirstSeenAges.push(firstSeenAge);
    }
    const lastSeenAge = ageHours(scoreTimestampMs, evidence.lastSeenTimestampMs);
    if (Number.isFinite(lastSeenAge)) {
      existing.evidenceLastSeenAges.push(lastSeenAge);
    }

    existing.firstSeenTimestampMs = existing.firstSeenTimestampMs === null
      ? evidence.firstSeenTimestampMs
      : Math.min(existing.firstSeenTimestampMs, evidence.firstSeenTimestampMs ?? existing.firstSeenTimestampMs);
    existing.lastSeenTimestampMs = existing.lastSeenTimestampMs === null
      ? evidence.lastSeenTimestampMs
      : Math.max(existing.lastSeenTimestampMs, evidence.lastSeenTimestampMs ?? existing.lastSeenTimestampMs);

    topicsById.set(topicId, existing);
  }

  return [...topicsById.values()]
    .map((topic) => ({
      topic_id: topic.topic_id,
      evidence_count: topic.evidenceKeys.size,
      canonical_evidence_count: topic.canonicalEvidenceKeys.size,
      secondary_only_evidence_count: topic.secondaryOnlyEvidenceKeys.size,
      source_count: topic.sourceIds.size,
      canonical_source_count: topic.canonicalSourceIds.size,
      secondary_only_source_count: topic.secondaryOnlySourceIds.size,
      source_ids: [...topic.sourceIds].sort(),
      canonical_source_ids: [...topic.canonicalSourceIds].sort(),
      secondary_only_source_ids: [...topic.secondaryOnlySourceIds].sort(),
      story_ids: [...topic.storyIds].sort(),
      currentEvidenceCount: topic.currentEvidenceCount,
      priorEvidenceCount: topic.priorEvidenceCount,
      is_auditable: topic.canonicalSourceIds.size >= 2,
      topicDriftedEvidenceCount: topic.topicDriftedEvidenceCount,
      storyDriftedEvidenceCount: topic.storyDriftedEvidenceCount,
      averageFirstSeenAgeHours: average(topic.evidenceFirstSeenAges),
      averageLastSeenAgeHours: average(topic.evidenceLastSeenAges),
      firstSeenAt: Number.isFinite(topic.firstSeenTimestampMs)
        ? new Date(topic.firstSeenTimestampMs).toISOString()
        : null,
      lastSeenAt: Number.isFinite(topic.lastSeenTimestampMs)
        ? new Date(topic.lastSeenTimestampMs).toISOString()
        : null,
    }))
    .sort((left, right) => left.topic_id.localeCompare(right.topic_id));
}

function summarizeMesh(label, evidenceItems, topics, scoreTimestampMs) {
  const canonicalEvidenceItems = evidenceItems.filter((item) => item.isCanonicalEvidence);
  const firstSeenAges = evidenceItems.map((item) => ageHours(scoreTimestampMs, item.firstSeenTimestampMs));
  const lastSeenAges = evidenceItems.map((item) => ageHours(scoreTimestampMs, item.lastSeenTimestampMs));
  const uniqueCanonicalSourceIds = new Set();
  const uniqueAllSourceIds = new Set();
  for (const evidence of evidenceItems) {
    uniqueAllSourceIds.add(evidence.source_id);
    if (evidence.isCanonicalEvidence) {
      uniqueCanonicalSourceIds.add(evidence.source_id);
    }
  }

  const topicSourceCounts = topics.map((topic) => topic.canonical_source_count);
  const topicEvidenceCounts = topics.map((topic) => topic.evidence_count);
  const topicDriftCounts = topics.map((topic) => topic.topicDriftedEvidenceCount);
  const storyDriftCounts = topics.map((topic) => topic.storyDriftedEvidenceCount);

  return {
    label,
    evidenceCount: evidenceItems.length,
    canonicalEvidenceCount: canonicalEvidenceItems.length,
    secondaryOnlyEvidenceCount: evidenceItems.length - canonicalEvidenceItems.length,
    topicCount: topics.length,
    auditableTopicCount: topics.filter((topic) => topic.is_auditable).length,
    singletonTopicCount: topics.filter((topic) => topic.canonical_source_count === 1).length,
    nonCanonicalTopicCount: topics.filter((topic) => topic.canonical_source_count === 0).length,
    corroboratedTopicRate: ratio(
      topics.filter((topic) => topic.is_auditable).length,
      topics.length,
    ),
    averageCanonicalSourceCount: average(topicSourceCounts),
    maxCanonicalSourceCount: topicSourceCounts.length > 0 ? Math.max(...topicSourceCounts) : null,
    averageEvidencePerTopic: average(topicEvidenceCounts),
    uniqueCanonicalSourceCount: uniqueCanonicalSourceIds.size,
    uniqueCanonicalSourceIds: [...uniqueCanonicalSourceIds].sort(),
    uniqueSourceCount: uniqueAllSourceIds.size,
    uniqueSourceIds: [...uniqueAllSourceIds].sort(),
    evidenceSeenInCurrentCount: evidenceItems.filter((item) => item.seenInCurrent).length,
    evidenceSeenOnlyInPriorCount: evidenceItems.filter((item) => !item.seenInCurrent && item.seenInPrior).length,
    topicDriftedEvidenceCount: evidenceItems.filter((item) => item.topicDrifted).length,
    storyDriftedEvidenceCount: evidenceItems.filter((item) => item.storyDrifted).length,
    topicDriftRate: ratio(
      evidenceItems.filter((item) => item.topicDrifted).length,
      evidenceItems.length,
    ),
    storyDriftRate: ratio(
      evidenceItems.filter((item) => item.storyDrifted).length,
      evidenceItems.length,
    ),
    averageFirstSeenAgeHours: average(firstSeenAges),
    averageLastSeenAgeHours: average(lastSeenAges),
    maxFirstSeenAgeHours: firstSeenAges.filter(Number.isFinite).length > 0
      ? Math.max(...firstSeenAges.filter(Number.isFinite))
      : null,
    maxLastSeenAgeHours: lastSeenAges.filter(Number.isFinite).length > 0
      ? Math.max(...lastSeenAges.filter(Number.isFinite))
      : null,
    averageTopicDriftedEvidenceCountPerTopic: average(topicDriftCounts),
    averageStoryDriftedEvidenceCountPerTopic: average(storyDriftCounts),
  };
}

function finalizeEvidenceAccumulator(accumulator) {
  const latestObservation = accumulator.latestObservation;
  const latestSourceRoles = latestObservation ? normalizeSourceRoles(latestObservation.source_roles) : [];
  const allSourceRoles = [...accumulator.allSourceRoles].sort();
  const observations = accumulator.observations
    .map((observation) => ({
      generatedAt: observation.generatedAt,
      run: observation.run,
      story_id: observation.story_id,
      topic_id: observation.topic_id,
      headline: observation.headline,
      source_count: observation.source_count,
      primary_source_count: observation.primary_source_count,
      secondary_asset_count: observation.secondary_asset_count,
      is_auditable: observation.is_auditable,
      is_dom_visible: observation.is_dom_visible,
      source_roles: observation.source_roles,
    }))
    .sort((left, right) =>
      Date.parse(left.generatedAt ?? '') - Date.parse(right.generatedAt ?? '')
      || left.run - right.run
      || left.story_id.localeCompare(right.story_id));

  return {
    evidence_key: accumulator.evidence_key,
    source_id: accumulator.source_id,
    publisher: accumulator.publisher,
    url: accumulator.url,
    url_hash: accumulator.url_hash,
    published_at: accumulator.published_at,
    title: accumulator.title,
    firstSeenAt: Number.isFinite(accumulator.firstSeenTimestampMs)
      ? new Date(accumulator.firstSeenTimestampMs).toISOString()
      : null,
    firstSeenTimestampMs: accumulator.firstSeenTimestampMs,
    lastSeenAt: Number.isFinite(accumulator.lastSeenTimestampMs)
      ? new Date(accumulator.lastSeenTimestampMs).toISOString()
      : null,
    lastSeenTimestampMs: accumulator.lastSeenTimestampMs,
    latestTopicId: latestObservation?.topic_id ?? null,
    latestStoryId: latestObservation?.story_id ?? null,
    latestHeadline: latestObservation?.headline ?? null,
    latestSourceRoles,
    allSourceRoles,
    latestSourceCount: latestObservation?.source_count ?? null,
    latestPrimarySourceCount: latestObservation?.primary_source_count ?? null,
    latestSecondaryAssetCount: latestObservation?.secondary_asset_count ?? null,
    latestIsAuditable: latestObservation?.is_auditable ?? null,
    latestIsDomVisible: latestObservation?.is_dom_visible ?? null,
    maxSourceCount: accumulator.maxSourceCount,
    maxPrimarySourceCount: accumulator.maxPrimarySourceCount,
    maxSecondaryAssetCount: accumulator.maxSecondaryAssetCount,
    observationCount: observations.length,
    runNumbers: [...accumulator.runNumbers].sort((left, right) => left - right),
    observedTopicIds: [...accumulator.observedTopicIds].sort(),
    observedStoryIds: [...accumulator.observedStoryIds].sort(),
    topicDrifted: accumulator.observedTopicIds.size > 1,
    storyDrifted: accumulator.observedStoryIds.size > 1,
    seenInCurrent: accumulator.seenInCurrent,
    seenInPrior: accumulator.seenInPrior,
    isCanonicalEvidence: latestSourceRoles.includes('source') || latestSourceRoles.includes('primary_source'),
    observations,
  };
}

function mergeRetainedEvidenceSnapshots(
  snapshots,
  {
    currentArtifactDir = null,
  } = {},
) {
  const evidenceByKey = new Map();

  for (const snapshot of snapshots) {
    const isCurrent = snapshot?.artifactDir === currentArtifactDir;
    for (const source of snapshot?.sources ?? []) {
      const evidenceKey = retainedEvidenceKey(source);
      if (!evidenceKey) {
        continue;
      }

      const accumulator = evidenceByKey.get(evidenceKey) ?? {
        evidence_key: evidenceKey,
        source_id: normalizeNonEmpty(source.source_id),
        publisher: normalizeNonEmpty(source.publisher),
        url: normalizeNonEmpty(source.url),
        url_hash: normalizeNonEmpty(source.url_hash),
        published_at: normalizeInteger(source.published_at),
        title: normalizeNonEmpty(source.title),
        firstSeenTimestampMs: null,
        lastSeenTimestampMs: null,
        maxSourceCount: 0,
        maxPrimarySourceCount: 0,
        maxSecondaryAssetCount: 0,
        observedTopicIds: new Set(),
        observedStoryIds: new Set(),
        runNumbers: new Set(),
        allSourceRoles: new Set(),
        seenInCurrent: false,
        seenInPrior: false,
        latestObservation: null,
        observations: [],
      };

      accumulator.publisher = mergeStringField(accumulator.publisher, source.publisher);
      accumulator.url = mergeStringField(accumulator.url, source.url);
      accumulator.title = mergeStringField(accumulator.title, source.title);
      accumulator.published_at = mergePublishedAt(accumulator.published_at, source.published_at);
      accumulator.seenInCurrent = accumulator.seenInCurrent || isCurrent;
      accumulator.seenInPrior = accumulator.seenInPrior || !isCurrent;

      for (const observation of source?.observations ?? []) {
        const timestampMs = chooseObservationTimestamp(snapshot.generatedAt, snapshot.timestampMs);
        const generatedAt = Number.isFinite(timestampMs)
          ? new Date(timestampMs).toISOString()
          : snapshot.generatedAt;
        const normalizedObservation = {
          generatedAt,
          timestampMs,
          run: observation.run ?? null,
          story_id: normalizeNonEmpty(observation.story_id),
          topic_id: normalizeNonEmpty(observation.topic_id),
          headline: normalizeNonEmpty(observation.headline),
          source_count: normalizeInteger(observation.source_count) ?? 0,
          primary_source_count: normalizeInteger(observation.primary_source_count) ?? 0,
          secondary_asset_count: normalizeInteger(observation.secondary_asset_count) ?? 0,
          is_auditable: normalizeBoolean(observation.is_auditable),
          is_dom_visible: normalizeBoolean(observation.is_dom_visible),
          source_roles: normalizeSourceRoles(observation.source_roles),
        };

        accumulator.observations.push(normalizedObservation);
        accumulator.maxSourceCount = Math.max(accumulator.maxSourceCount, normalizedObservation.source_count);
        accumulator.maxPrimarySourceCount = Math.max(accumulator.maxPrimarySourceCount, normalizedObservation.primary_source_count);
        accumulator.maxSecondaryAssetCount = Math.max(accumulator.maxSecondaryAssetCount, normalizedObservation.secondary_asset_count);
        if (normalizedObservation.story_id) {
          accumulator.observedStoryIds.add(normalizedObservation.story_id);
        }
        if (normalizedObservation.topic_id) {
          accumulator.observedTopicIds.add(normalizedObservation.topic_id);
        }
        if (Number.isFinite(timestampMs)) {
          accumulator.firstSeenTimestampMs = accumulator.firstSeenTimestampMs === null
            ? timestampMs
            : Math.min(accumulator.firstSeenTimestampMs, timestampMs);
          accumulator.lastSeenTimestampMs = accumulator.lastSeenTimestampMs === null
            ? timestampMs
            : Math.max(accumulator.lastSeenTimestampMs, timestampMs);
        }
        if (Number.isFinite(normalizedObservation.run)) {
          accumulator.runNumbers.add(normalizedObservation.run);
        }
        for (const role of normalizedObservation.source_roles) {
          accumulator.allSourceRoles.add(role);
        }
        updateLatestObservation(accumulator, normalizedObservation);
      }

      evidenceByKey.set(evidenceKey, accumulator);
    }
  }

  return [...evidenceByKey.values()]
    .map(finalizeEvidenceAccumulator)
    .sort((left, right) => left.evidence_key.localeCompare(right.evidence_key));
}

function mergeExecutionSnapshotEvidence(
  snapshots,
  {
    currentArtifactDir = null,
  } = {},
) {
  const evidenceByKey = new Map();

  for (const snapshot of snapshots) {
    const isCurrent = snapshot?.artifactDir === currentArtifactDir;
    for (const evidence of snapshot?.evidence ?? []) {
      const evidenceKey = normalizeNonEmpty(evidence?.evidence_key);
      if (!evidenceKey) {
        continue;
      }

      const accumulator = evidenceByKey.get(evidenceKey) ?? {
        evidence_key: evidenceKey,
        source_id: normalizeNonEmpty(evidence.source_id),
        publisher: normalizeNonEmpty(evidence.publisher),
        url: normalizeNonEmpty(evidence.url),
        url_hash: normalizeNonEmpty(evidence.url_hash),
        published_at: normalizeInteger(evidence.published_at),
        title: normalizeNonEmpty(evidence.title),
        firstSeenTimestampMs: null,
        lastSeenTimestampMs: null,
        maxSourceCount: 0,
        maxPrimarySourceCount: 0,
        maxSecondaryAssetCount: 0,
        observedTopicIds: new Set(),
        observedStoryIds: new Set(),
        runNumbers: new Set(),
        allSourceRoles: new Set(),
        seenInCurrent: false,
        seenInPrior: false,
        latestObservation: null,
        observations: [],
      };

      accumulator.publisher = mergeStringField(accumulator.publisher, evidence.publisher);
      accumulator.url = mergeStringField(accumulator.url, evidence.url);
      accumulator.title = mergeStringField(accumulator.title, evidence.title);
      accumulator.published_at = mergePublishedAt(accumulator.published_at, evidence.published_at);
      accumulator.seenInCurrent = accumulator.seenInCurrent || isCurrent;
      accumulator.seenInPrior = accumulator.seenInPrior || !isCurrent;

      if (Number.isFinite(evidence.firstSeenTimestampMs)) {
        accumulator.firstSeenTimestampMs = accumulator.firstSeenTimestampMs === null
          ? evidence.firstSeenTimestampMs
          : Math.min(accumulator.firstSeenTimestampMs, evidence.firstSeenTimestampMs);
      }
      if (Number.isFinite(evidence.lastSeenTimestampMs)) {
        accumulator.lastSeenTimestampMs = accumulator.lastSeenTimestampMs === null
          ? evidence.lastSeenTimestampMs
          : Math.max(accumulator.lastSeenTimestampMs, evidence.lastSeenTimestampMs);
      }

      accumulator.maxSourceCount = Math.max(accumulator.maxSourceCount, normalizeInteger(evidence.maxSourceCount) ?? 0);
      accumulator.maxPrimarySourceCount = Math.max(
        accumulator.maxPrimarySourceCount,
        normalizeInteger(evidence.maxPrimarySourceCount) ?? 0,
      );
      accumulator.maxSecondaryAssetCount = Math.max(
        accumulator.maxSecondaryAssetCount,
        normalizeInteger(evidence.maxSecondaryAssetCount) ?? 0,
      );

      for (const topicId of evidence?.observedTopicIds ?? []) {
        const normalized = normalizeNonEmpty(topicId);
        if (normalized) {
          accumulator.observedTopicIds.add(normalized);
        }
      }
      for (const storyId of evidence?.observedStoryIds ?? []) {
        const normalized = normalizeNonEmpty(storyId);
        if (normalized) {
          accumulator.observedStoryIds.add(normalized);
        }
      }
      for (const runNumber of evidence?.runNumbers ?? []) {
        if (Number.isFinite(runNumber)) {
          accumulator.runNumbers.add(runNumber);
        }
      }
      for (const role of evidence?.allSourceRoles ?? []) {
        const normalized = normalizeNonEmpty(role);
        if (normalized) {
          accumulator.allSourceRoles.add(normalized);
        }
      }

      for (const observation of evidence?.observations ?? []) {
        const normalizedObservation = {
          generatedAt: normalizeNonEmpty(observation.generatedAt),
          timestampMs: chooseObservationTimestamp(observation.generatedAt, snapshot.timestampMs),
          run: normalizeInteger(observation.run),
          story_id: normalizeNonEmpty(observation.story_id),
          topic_id: normalizeNonEmpty(observation.topic_id),
          headline: normalizeNonEmpty(observation.headline),
          source_count: normalizeInteger(observation.source_count) ?? 0,
          primary_source_count: normalizeInteger(observation.primary_source_count) ?? 0,
          secondary_asset_count: normalizeInteger(observation.secondary_asset_count) ?? 0,
          is_auditable: normalizeBoolean(observation.is_auditable),
          is_dom_visible: normalizeBoolean(observation.is_dom_visible),
          source_roles: normalizeSourceRoles(observation.source_roles),
        };
        accumulator.observations.push(normalizedObservation);
        updateLatestObservation(accumulator, normalizedObservation);
      }

      if (accumulator.observations.length === 0) {
        updateLatestObservation(accumulator, {
          generatedAt: evidence.lastSeenAt ?? snapshot.generatedAt,
          timestampMs: evidence.lastSeenTimestampMs ?? snapshot.timestampMs,
          run: normalizeInteger((evidence.runNumbers ?? []).at(-1)),
          story_id: normalizeNonEmpty(evidence.latestStoryId),
          topic_id: normalizeNonEmpty(evidence.latestTopicId),
          headline: normalizeNonEmpty(evidence.latestHeadline),
          source_count: normalizeInteger(evidence.latestSourceCount) ?? 0,
          primary_source_count: normalizeInteger(evidence.latestPrimarySourceCount) ?? 0,
          secondary_asset_count: normalizeInteger(evidence.latestSecondaryAssetCount) ?? 0,
          is_auditable: normalizeBoolean(evidence.latestIsAuditable),
          is_dom_visible: normalizeBoolean(evidence.latestIsDomVisible),
          source_roles: normalizeSourceRoles(evidence.latestSourceRoles),
        });
      }

      evidenceByKey.set(evidenceKey, accumulator);
    }
  }

  return [...evidenceByKey.values()]
    .map(finalizeEvidenceAccumulator)
    .sort((left, right) => left.evidence_key.localeCompare(right.evidence_key));
}

function summarizeSnapshotRuns(runSnapshots) {
  const visibleStoryIds = new Set();
  const topStoryIds = new Set();
  const topAuditableStoryIds = new Set();
  let storyCount = 0;
  let auditableCount = 0;

  for (const snapshot of runSnapshots) {
    storyCount = Math.max(storyCount, normalizeInteger(snapshot?.story_count) ?? 0);
    auditableCount = Math.max(auditableCount, normalizeInteger(snapshot?.auditable_count) ?? 0);
    for (const storyId of snapshot?.visible_story_ids ?? []) {
      const normalized = normalizeNonEmpty(storyId);
      if (normalized) {
        visibleStoryIds.add(normalized);
      }
    }
    for (const storyId of snapshot?.top_story_ids ?? []) {
      const normalized = normalizeNonEmpty(storyId);
      if (normalized) {
        topStoryIds.add(normalized);
      }
    }
    for (const storyId of snapshot?.top_auditable_story_ids ?? []) {
      const normalized = normalizeNonEmpty(storyId);
      if (normalized) {
        topAuditableStoryIds.add(normalized);
      }
    }
  }

  return {
    storyCount,
    auditableCount,
    visibleStoryIds: [...visibleStoryIds].sort(),
    topStoryIds: [...topStoryIds].sort(),
    topAuditableStoryIds: [...topAuditableStoryIds].sort(),
  };
}

export function readExecutionRetainedSourceEvidenceSnapshot(
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

  const retainedEvidenceByRun = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(RETAINED_SOURCE_EVIDENCE_FILE_RE);
    if (!match) continue;
    retainedEvidenceByRun.set(Number.parseInt(match[1], 10), path.join(artifactDir, entry.name));
  }

  const runNumbers = [...retainedEvidenceByRun.keys()]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (runNumbers.length === 0) {
    return null;
  }

  const { generatedAt, timestampMs, timestampSource } = resolveExecutionGeneratedAt(artifactDir, {
    exists,
    readFile,
    stat,
  });
  const runSnapshots = [];

  for (const runNumber of runNumbers) {
    const filePath = retainedEvidenceByRun.get(runNumber);
    if (!filePath || !exists(filePath)) {
      continue;
    }

    try {
      const snapshot = readJson(filePath, readFile);
      runSnapshots.push({
        artifactDir,
        run: runNumber,
        generatedAt: normalizeNonEmpty(snapshot?.generatedAt) ?? generatedAt,
        timestampMs: chooseObservationTimestamp(snapshot?.generatedAt, timestampMs),
        story_count: normalizeInteger(snapshot?.story_count) ?? 0,
        auditable_count: normalizeInteger(snapshot?.auditable_count) ?? 0,
        visible_story_ids: snapshot?.visible_story_ids ?? [],
        top_story_ids: snapshot?.top_story_ids ?? [],
        top_auditable_story_ids: snapshot?.top_auditable_story_ids ?? [],
        sources: Array.isArray(snapshot?.sources)
          ? snapshot.sources.map((source) => ({
            ...source,
            observations: Array.isArray(source?.observations)
              ? source.observations.map((observation) => ({ ...observation, run: runNumber }))
              : [],
          }))
          : [],
      });
    } catch {
      // skip malformed run artifact
    }
  }

  if (runSnapshots.length === 0) {
    return null;
  }

  const evidence = mergeRetainedEvidenceSnapshots(runSnapshots, {
    currentArtifactDir: artifactDir,
  });
  const topics = buildTopicMesh(evidence, timestampMs);
  const storySummary = summarizeSnapshotRuns(runSnapshots);

  return {
    artifactDir,
    generatedAt,
    timestampMs,
    timestampSource,
    runCount: runSnapshots.length,
    storyCount: storySummary.storyCount,
    auditableStoryCount: storySummary.auditableCount,
    visibleStoryIds: storySummary.visibleStoryIds,
    topStoryIds: storySummary.topStoryIds,
    topAuditableStoryIds: storySummary.topAuditableStoryIds,
    sourceCount: evidence.length,
    evidence,
    topicCount: topics.length,
    auditableTopicCount: topics.filter((topic) => topic.is_auditable).length,
    topics,
  };
}

function compareTopicSets(currentTopics, priorTopics, retainedTopics) {
  const currentById = new Map(currentTopics.map((topic) => [topic.topic_id, topic]));
  const priorById = new Map(priorTopics.map((topic) => [topic.topic_id, topic]));
  const retainedById = new Map(retainedTopics.map((topic) => [topic.topic_id, topic]));

  const retainedTopicIds = [...currentById.keys()].filter((topicId) => priorById.has(topicId)).sort();
  const newTopicIds = [...currentById.keys()].filter((topicId) => !priorById.has(topicId)).sort();
  const lostTopicIds = [...priorById.keys()].filter((topicId) => !currentById.has(topicId)).sort();

  let singletonToAuditableCount = 0;
  const singletonToAuditableTopicIds = [];
  let growingTopicCount = 0;
  const growingTopicIds = [];
  const sourceDiversityGains = [];

  for (const topicId of priorById.keys()) {
    const priorTopic = priorById.get(topicId);
    const retainedTopic = retainedById.get(topicId);
    if (!priorTopic || !retainedTopic) {
      continue;
    }

    const gain = retainedTopic.canonical_source_count - priorTopic.canonical_source_count;
    if (Number.isFinite(gain)) {
      sourceDiversityGains.push(gain);
    }
    if (gain > 0) {
      growingTopicCount += 1;
      growingTopicIds.push(topicId);
    }
    if (priorTopic.canonical_source_count === 1 && retainedTopic.canonical_source_count >= 2) {
      singletonToAuditableCount += 1;
      singletonToAuditableTopicIds.push(topicId);
    }
  }

  return {
    retainedTopicIds,
    newTopicIds,
    lostTopicIds,
    singletonToAuditableCount,
    singletonToAuditableTopicIds,
    growingTopicCount,
    growingTopicIds,
    averageSourceDiversityGain: average(sourceDiversityGains),
  };
}

function buildFreshContributionMetrics(
  currentSnapshot,
  priorSummary,
  retainedSummary,
  priorTopics,
  retainedTopics,
  priorEvidence,
) {
  const priorTopicIds = new Set(priorTopics.map((topic) => topic.topic_id));
  const priorEvidenceKeys = new Set((priorEvidence ?? []).map((evidence) => evidence.evidence_key));
  const laterAttachmentEvidence = currentSnapshot.evidence.filter((evidence) =>
    !priorEvidenceKeys.has(evidence.evidence_key)
    && priorTopicIds.has(evidence.latestTopicId));

  const comparisons = compareTopicSets(currentSnapshot.topics, priorTopics, retainedTopics);
  const currentSummary = summarizeMesh('current_execution', currentSnapshot.evidence, currentSnapshot.topics, currentSnapshot.timestampMs);

  return {
    priorSnapshotCount: priorSummary.snapshotCount,
    retainedTopicCount: comparisons.retainedTopicIds.length,
    newTopicCount: comparisons.newTopicIds.length,
    lostTopicCount: comparisons.lostTopicIds.length,
    topicRetentionRate: ratio(comparisons.retainedTopicIds.length, priorTopics.length),
    laterAttachmentCount: laterAttachmentEvidence.length,
    laterAttachmentEvidenceKeys: laterAttachmentEvidence.map((evidence) => evidence.evidence_key).sort(),
    laterAttachmentTopicIds: [...new Set(laterAttachmentEvidence.map((evidence) => evidence.latestTopicId).filter(Boolean))].sort(),
    singletonToAuditableCount: comparisons.singletonToAuditableCount,
    singletonToAuditableTopicIds: comparisons.singletonToAuditableTopicIds,
    growingTopicCount: comparisons.growingTopicCount,
    growingTopicIds: comparisons.growingTopicIds,
    averageSourceDiversityGain: comparisons.averageSourceDiversityGain,
    currentVsRetainedAuditableTopicCountDelta:
      (retainedSummary.auditableTopicCount ?? 0) - (currentSnapshot.auditableTopicCount ?? 0),
    currentVsRetainedCorroboratedTopicRateDelta:
      (retainedSummary.corroboratedTopicRate ?? 0) - (currentSummary.corroboratedTopicRate ?? 0),
  };
}

export function buildGhostRetainedMeshReport(
  currentSnapshot,
  priorSnapshots,
  {
    lookbackHours = 24,
  } = {},
) {
  if (!currentSnapshot) {
    return null;
  }

  const scoreTimestampMs = currentSnapshot.timestampMs;
  const normalizedPriorSnapshots = Array.isArray(priorSnapshots) ? priorSnapshots.filter(Boolean) : [];
  const priorEvidence = mergeExecutionSnapshotEvidence(normalizedPriorSnapshots, {
    currentArtifactDir: currentSnapshot.artifactDir,
  });
  const retainedEvidence = mergeExecutionSnapshotEvidence(
    [...normalizedPriorSnapshots, currentSnapshot],
    { currentArtifactDir: currentSnapshot.artifactDir },
  );

  const priorTopics = buildTopicMesh(priorEvidence, scoreTimestampMs);
  const retainedTopics = buildTopicMesh(retainedEvidence, scoreTimestampMs);
  const currentSummary = summarizeMesh('current_execution', currentSnapshot.evidence, currentSnapshot.topics, scoreTimestampMs);
  const priorSummary = {
    snapshotCount: normalizedPriorSnapshots.length,
    ...summarizeMesh('prior_window', priorEvidence, priorTopics, scoreTimestampMs),
  };
  const retainedSummary = summarizeMesh('retained_mesh', retainedEvidence, retainedTopics, scoreTimestampMs);
  const freshContribution = buildFreshContributionMetrics(
    currentSnapshot,
    priorSummary,
    retainedSummary,
    priorTopics,
    retainedTopics,
    priorEvidence,
  );

  const oldestRetainedEvidenceTimestampMs = retainedEvidence.length > 0
    ? retainedEvidence.reduce((oldest, evidence) => {
      if (!Number.isFinite(evidence.firstSeenTimestampMs)) return oldest;
      if (!Number.isFinite(oldest)) return evidence.firstSeenTimestampMs;
      return Math.min(oldest, evidence.firstSeenTimestampMs);
    }, null)
    : null;

  return {
    schemaVersion: GHOST_RETAINED_MESH_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    artifactDir: currentSnapshot.artifactDir,
    lookbackHours,
    scoring: {
      scoreGeneratedAt: currentSnapshot.generatedAt,
      scoreTimestampMs,
      currentArtifactDir: currentSnapshot.artifactDir,
      currentTopicIdRegime: 'post-entity-key-stability-tiebreak',
      contaminationAssessment: {
        status: 'not_available',
        reason: 'retained_source_evidence_snapshot_omits_pair_text_and_pair_labels',
      },
    },
    executionWindow: {
      currentGeneratedAt: currentSnapshot.generatedAt,
      currentTimestampMs: currentSnapshot.timestampMs,
      oldestRetainedEvidenceAt: Number.isFinite(oldestRetainedEvidenceTimestampMs)
        ? new Date(oldestRetainedEvidenceTimestampMs).toISOString()
        : null,
      oldestRetainedEvidenceAgeHours: ageHours(scoreTimestampMs, oldestRetainedEvidenceTimestampMs),
      retainedSnapshotCount: normalizedPriorSnapshots.length + 1,
      priorSnapshotCount: normalizedPriorSnapshots.length,
    },
    currentExecution: {
      artifactDir: currentSnapshot.artifactDir,
      generatedAt: currentSnapshot.generatedAt,
      runCount: currentSnapshot.runCount,
      storyCount: currentSnapshot.storyCount,
      auditableStoryCount: currentSnapshot.auditableStoryCount,
      visibleStoryIds: currentSnapshot.visibleStoryIds,
      topStoryIds: currentSnapshot.topStoryIds,
      topAuditableStoryIds: currentSnapshot.topAuditableStoryIds,
      ...currentSummary,
      topics: currentSnapshot.topics,
    },
    priorWindow: {
      snapshotCount: normalizedPriorSnapshots.length,
      artifactDirs: normalizedPriorSnapshots.map((snapshot) => snapshot.artifactDir),
      ...priorSummary,
      topics: priorTopics,
    },
    retainedMesh: {
      ...retainedSummary,
      topics: retainedTopics,
      evidence: retainedEvidence,
    },
    freshContribution,
    deltas: {
      auditableTopicCountDelta:
        (retainedSummary.auditableTopicCount ?? 0) - (currentSummary.auditableTopicCount ?? 0),
      corroboratedTopicRateDelta:
        (retainedSummary.corroboratedTopicRate ?? 0) - (currentSummary.corroboratedTopicRate ?? 0),
      uniqueCanonicalSourceCountDelta:
        (retainedSummary.uniqueCanonicalSourceCount ?? 0) - (currentSummary.uniqueCanonicalSourceCount ?? 0),
      topicCountDelta:
        (retainedSummary.topicCount ?? 0) - (currentSummary.topicCount ?? 0),
    },
  };
}

function buildGhostRetainedMeshExecutionSummary(report) {
  return {
    artifactDir: report?.artifactDir ?? null,
    generatedAt: report?.generatedAt ?? null,
    lookbackHours: report?.lookbackHours ?? null,
    currentExecution: {
      topicCount: report?.currentExecution?.topicCount ?? null,
      auditableTopicCount: report?.currentExecution?.auditableTopicCount ?? null,
      corroboratedTopicRate: report?.currentExecution?.corroboratedTopicRate ?? null,
      uniqueCanonicalSourceCount: report?.currentExecution?.uniqueCanonicalSourceCount ?? null,
    },
    priorWindow: {
      snapshotCount: report?.priorWindow?.snapshotCount ?? 0,
      topicCount: report?.priorWindow?.topicCount ?? null,
      auditableTopicCount: report?.priorWindow?.auditableTopicCount ?? null,
      corroboratedTopicRate: report?.priorWindow?.corroboratedTopicRate ?? null,
    },
    retainedMesh: {
      topicCount: report?.retainedMesh?.topicCount ?? null,
      auditableTopicCount: report?.retainedMesh?.auditableTopicCount ?? null,
      corroboratedTopicRate: report?.retainedMesh?.corroboratedTopicRate ?? null,
      uniqueCanonicalSourceCount: report?.retainedMesh?.uniqueCanonicalSourceCount ?? null,
      averageLastSeenAgeHours: report?.retainedMesh?.averageLastSeenAgeHours ?? null,
      topicDriftRate: report?.retainedMesh?.topicDriftRate ?? null,
      storyDriftRate: report?.retainedMesh?.storyDriftRate ?? null,
    },
    freshContribution: {
      priorSnapshotCount: report?.freshContribution?.priorSnapshotCount ?? 0,
      retainedTopicCount: report?.freshContribution?.retainedTopicCount ?? null,
      newTopicCount: report?.freshContribution?.newTopicCount ?? null,
      lostTopicCount: report?.freshContribution?.lostTopicCount ?? null,
      topicRetentionRate: report?.freshContribution?.topicRetentionRate ?? null,
      laterAttachmentCount: report?.freshContribution?.laterAttachmentCount ?? null,
      singletonToAuditableCount: report?.freshContribution?.singletonToAuditableCount ?? null,
      growingTopicCount: report?.freshContribution?.growingTopicCount ?? null,
      averageSourceDiversityGain: report?.freshContribution?.averageSourceDiversityGain ?? null,
    },
    deltas: report?.deltas ?? null,
  };
}

export function buildGhostRetainedMeshTrendIndex(
  reports,
  {
    artifactRoot = null,
    latestArtifactDir = null,
    lookbackExecutionCount = null,
    lookbackHours = null,
  } = {},
) {
  const recentReports = Array.isArray(reports) ? reports.filter(Boolean) : [];
  const metric = (selector) => recentReports.map((report) => selector(report)).filter((value) => value !== undefined);

  return {
    schemaVersion: GHOST_RETAINED_MESH_TREND_INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    artifactRoot,
    latestArtifactDir,
    lookbackExecutionCount,
    lookbackHours,
    reportCount: recentReports.length,
    latestReport: recentReports.length > 0
      ? buildGhostRetainedMeshExecutionSummary(recentReports.at(-1))
      : null,
    averages: {
      retainedCorroboratedTopicRate: average(metric((report) => report?.retainedMesh?.corroboratedTopicRate)),
      currentCorroboratedTopicRate: average(metric((report) => report?.currentExecution?.corroboratedTopicRate)),
      corroboratedTopicRateDelta: average(metric((report) => report?.deltas?.corroboratedTopicRateDelta)),
      retainedUniqueCanonicalSourceCount: average(metric((report) => report?.retainedMesh?.uniqueCanonicalSourceCount)),
      uniqueCanonicalSourceCountDelta: average(metric((report) => report?.deltas?.uniqueCanonicalSourceCountDelta)),
      retainedAverageLastSeenAgeHours: average(metric((report) => report?.retainedMesh?.averageLastSeenAgeHours)),
      topicRetentionRate: average(metric((report) => report?.freshContribution?.topicRetentionRate)),
      laterAttachmentCount: average(metric((report) => report?.freshContribution?.laterAttachmentCount)),
      singletonToAuditableCount: average(metric((report) => report?.freshContribution?.singletonToAuditableCount)),
      averageSourceDiversityGain: average(metric((report) => report?.freshContribution?.averageSourceDiversityGain)),
      retainedTopicDriftRate: average(metric((report) => report?.retainedMesh?.topicDriftRate)),
      retainedStoryDriftRate: average(metric((report) => report?.retainedMesh?.storyDriftRate)),
    },
    totals: {
      retainedEvidenceCount: recentReports.reduce((sum, report) => sum + (report?.retainedMesh?.evidenceCount ?? 0), 0),
      retainedTopicCount: recentReports.reduce((sum, report) => sum + (report?.retainedMesh?.topicCount ?? 0), 0),
      retainedAuditableTopicCount: recentReports.reduce((sum, report) => sum + (report?.retainedMesh?.auditableTopicCount ?? 0), 0),
      laterAttachmentCount: recentReports.reduce((sum, report) => sum + (report?.freshContribution?.laterAttachmentCount ?? 0), 0),
      singletonToAuditableCount: recentReports.reduce((sum, report) => sum + (report?.freshContribution?.singletonToAuditableCount ?? 0), 0),
      growingTopicCount: recentReports.reduce((sum, report) => sum + (report?.freshContribution?.growingTopicCount ?? 0), 0),
    },
    reports: recentReports.map(buildGhostRetainedMeshExecutionSummary),
  };
}

export function readHistoricalExecutionRetainedSourceEvidenceSnapshots(
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
        const nextArtifactDir = path.join(artifactRoot, entry.name);
        return { artifactDir: nextArtifactDir, mtimeMs: stat(nextArtifactDir).mtimeMs };
      })
      .sort((left, right) => left.mtimeMs - right.mtimeMs)
      .slice(-lookbackExecutionCount);
  } catch {
    return [];
  }

  const maxAgeMs = Number.isFinite(lookbackHours) ? lookbackHours * 60 * 60 * 1000 : null;
  return artifactDirs.flatMap(({ artifactDir }) => {
    if (artifactDir === currentArtifactDir) {
      return [];
    }
    const snapshot = readExecutionRetainedSourceEvidenceSnapshot(artifactDir, {
      exists,
      readFile,
      readdir,
      stat,
    });
    if (!snapshot) {
      return [];
    }
    if (Number.isFinite(currentTimestampMs) && Number.isFinite(snapshot.timestampMs) && Number.isFinite(maxAgeMs)) {
      if ((currentTimestampMs - snapshot.timestampMs) > maxAgeMs) {
        return [];
      }
    }
    return [snapshot];
  });
}

export function readHistoricalGhostRetainedMeshReports(
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
        const nextArtifactDir = path.join(artifactRoot, entry.name);
        return { artifactDir: nextArtifactDir, mtimeMs: stat(nextArtifactDir).mtimeMs };
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
    const reportPath = path.join(artifactDir, 'ghost-retained-mesh-report.json');
    if (!exists(reportPath)) {
      return [];
    }
    try {
      return [readJson(reportPath, readFile)];
    } catch {
      return [];
    }
  });
}
