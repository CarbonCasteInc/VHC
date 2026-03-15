const DEFAULT_PUBLIC_SMOKE_SOURCE_PROFILES = Object.freeze([
  'abc-politics,pbs-politics',
  'ap-politics,cnn-politics',
  'cbs-politics,guardian-us',
  'bbc-us-canada,nbc-politics,pbs-politics',
]);
const DEFAULT_PUBLIC_SMOKE_MAX_ITEMS_PER_SOURCE = '4';
const DEFAULT_PUBLIC_SMOKE_MAX_ITEMS_TOTAL = '20';

function uniqueValues(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function splitProfiles(raw) {
  return raw
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function bundleKey(bundle) {
  if (typeof bundle?.topic_id === 'string' && bundle.topic_id.trim().length > 0) {
    return bundle.topic_id.trim();
  }
  if (typeof bundle?.story_id === 'string' && bundle.story_id.trim().length > 0) {
    return bundle.story_id.trim();
  }
  return null;
}

function bundleScore(bundle) {
  return (bundle?.canonical_source_count ?? bundle?.canonical_sources?.length ?? bundle?.pairs?.length ?? 0);
}

function pairCount(bundle) {
  return Array.isArray(bundle?.pairs) ? bundle.pairs.length : 0;
}

function buildSubrunSummary(subrun) {
  return {
    profileIndex: subrun.profileIndex,
    sourceIds: subrun.sourceIds,
    status: subrun.procStatus,
    reportPath: subrun.reportPath,
    auditPath: subrun.auditPath,
    failureSnapshotPath: subrun.failureSnapshotPath,
    runtimeLogsPath: subrun.runtimeLogsPath,
    reportParseError: subrun.reportParseError,
    auditError: subrun.auditError,
    sampledStoryCount: subrun.audit?.sampled_story_count ?? null,
    auditableCount: subrun.failureSnapshot?.auditable_count ?? subrun.audit?.supply?.auditable_count ?? null,
  };
}

function aggregateBundles(subruns) {
  const byKey = new Map();

  for (const subrun of subruns) {
    for (const bundle of subrun.audit?.bundles ?? []) {
      const key = bundleKey(bundle);
      if (!key) {
        continue;
      }
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { bundle, profileIndex: subrun.profileIndex });
        continue;
      }

      const existingScore = bundleScore(existing.bundle);
      const nextScore = bundleScore(bundle);
      if (nextScore > existingScore || (nextScore === existingScore && pairCount(bundle) > pairCount(existing.bundle))) {
        byKey.set(key, { bundle, profileIndex: subrun.profileIndex });
      }
    }
  }

  return [...byKey.values()];
}

export function resolvePublicSemanticSoakProfiles(env = process.env) {
  if (env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true') {
    return [];
  }

  const explicitSourceIds = env.VH_LIVE_DEV_FEED_SOURCE_IDS?.trim();
  if (explicitSourceIds) {
    return [explicitSourceIds];
  }

  const explicitProfiles = env.VH_PUBLIC_SEMANTIC_SOAK_SOURCE_PROFILES?.trim();
  if (explicitProfiles) {
    return splitProfiles(explicitProfiles);
  }

  return [...DEFAULT_PUBLIC_SMOKE_SOURCE_PROFILES];
}

export function resolvePublicSemanticSoakSpawnEnv(
  env,
  runId,
  sampleCount,
  sampleTimeoutMs,
  sourceIds,
) {
  const nextEnv = {
    ...env,
    VH_RUN_DAEMON_FIRST_FEED: 'true',
    VH_DAEMON_FEED_RUN_ID: runId,
    VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT: String(sampleCount),
    VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS: String(sampleTimeoutMs),
  };

  if (env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true') {
    return nextEnv;
  }

  nextEnv.VH_LIVE_DEV_FEED_SOURCE_IDS = sourceIds?.trim()
    || env.VH_LIVE_DEV_FEED_SOURCE_IDS?.trim()
    || DEFAULT_PUBLIC_SMOKE_SOURCE_PROFILES[0];
  nextEnv.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE = env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE?.trim()
    || DEFAULT_PUBLIC_SMOKE_MAX_ITEMS_PER_SOURCE;
  nextEnv.VH_DAEMON_FEED_MAX_ITEMS_TOTAL = env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL?.trim()
    || DEFAULT_PUBLIC_SMOKE_MAX_ITEMS_TOTAL;

  return nextEnv;
}

export function aggregatePublicSemanticSoakSubruns({
  sampleCount,
  sourceProfiles,
  subruns,
}) {
  const bundleEntries = aggregateBundles(subruns);
  const bundles = bundleEntries.slice(0, Math.max(sampleCount, bundleEntries.length)).map((entry) => entry.bundle);
  const selectedBundles = bundles.slice(0, sampleCount);
  const visibleStoryIds = uniqueValues(subruns.flatMap(
    (subrun) => subrun.failureSnapshot?.visible_story_ids ?? subrun.audit?.visible_story_ids ?? [],
  ));
  const topStoryIds = uniqueValues(subruns.flatMap(
    (subrun) => subrun.failureSnapshot?.top_story_ids ?? subrun.audit?.supply?.top_story_ids ?? [],
  )).slice(0, 5);
  const topAuditableStoryIds = bundles.slice(0, 5).map((bundle) => bundle.story_id);
  const relatedTopicOnlyPairCount = selectedBundles.reduce(
    (sum, bundle) => sum + (bundle.pairs ?? []).filter((pair) => pair.label === 'related_topic_only').length,
    0,
  );
  const auditedPairCount = selectedBundles.reduce((sum, bundle) => sum + (bundle.pairs ?? []).length, 0);
  const sampleFillRate = sampleCount > 0 ? selectedBundles.length / sampleCount : null;
  const sampleShortfall = sampleCount > selectedBundles.length ? sampleCount - selectedBundles.length : 0;
  const reportParseErrors = uniqueValues(subruns.map((subrun) => subrun.reportParseError).filter(Boolean));
  const auditErrors = uniqueValues(subruns.map((subrun) => subrun.auditError).filter(Boolean));
  const browserLogs = uniqueValues(subruns.flatMap((subrun) => subrun.runtimeLogs?.browserLogs ?? []));
  const overallPass = selectedBundles.length >= sampleCount
    && relatedTopicOnlyPairCount === 0
    && reportParseErrors.length === 0
    && auditErrors.length === 0;

  return {
    report: {
      schemaVersion: 'daemon-feed-semantic-soak-profile-aggregate-v1',
      source_profiles: sourceProfiles,
      subruns: subruns.map(buildSubrunSummary),
    },
    audit: {
      schemaVersion: 'daemon-feed-semantic-soak-profile-aggregate-audit-v1',
      requested_sample_count: sampleCount,
      sampled_story_count: selectedBundles.length,
      visible_story_ids: visibleStoryIds,
      supply: {
        status: selectedBundles.length >= sampleCount ? 'full' : selectedBundles.length > 0 ? 'partial' : 'empty',
        story_count: visibleStoryIds.length,
        auditable_count: bundles.length,
        visible_story_ids: visibleStoryIds,
        top_story_ids: topStoryIds,
        top_auditable_story_ids: topAuditableStoryIds,
        sample_fill_rate: sampleFillRate,
        sample_shortfall: sampleShortfall,
      },
      bundles: selectedBundles,
      overall: {
        audited_pair_count: auditedPairCount,
        related_topic_only_pair_count: relatedTopicOnlyPairCount,
        sample_fill_rate: sampleFillRate,
        sample_shortfall: sampleShortfall,
        pass: overallPass,
      },
      source_profiles: sourceProfiles,
      subruns: subruns.map(buildSubrunSummary),
    },
    failureSnapshot: {
      story_count: visibleStoryIds.length,
      auditable_count: bundles.length,
      visible_story_ids: visibleStoryIds,
      top_story_ids: topStoryIds,
      top_auditable_story_ids: topAuditableStoryIds,
    },
    runtimeLogs: {
      browserLogs,
      subruns: subruns.map(buildSubrunSummary),
    },
    reportParseError: reportParseErrors.length > 0 ? reportParseErrors.join('; ') : null,
    auditError: auditErrors.length > 0 ? auditErrors.join('; ') : null,
    status: overallPass ? 0 : 1,
  };
}
