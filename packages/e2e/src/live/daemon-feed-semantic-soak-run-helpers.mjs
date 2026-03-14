import { summarizeLabelCounts } from './daemon-feed-semantic-soak-report.mjs';

export function summarizeRun(
  report,
  failureSnapshot,
  runtimeLogs,
  procStatus,
  reportPath,
  reportParseError,
  auditPath,
  auditError,
  failureSnapshotPath,
  runtimeLogsPath,
) {
  const labelCounts = summarizeLabelCounts(report);
  const failingBundles = (report?.bundles ?? [])
    .filter((bundle) => bundle?.has_related_topic_only_pair)
    .map((bundle) => ({
      story_id: bundle.story_id,
      topic_id: bundle.topic_id,
      headline: bundle.headline,
      related_topic_only_pair_count: (bundle.pairs ?? []).filter((pair) => pair.label === 'related_topic_only').length,
    }));

  const pass = Boolean(
    procStatus === 0
      && report
      && report.overall?.pass === true
      && report.overall?.related_topic_only_pair_count === 0
      && Number.isFinite(report.sampled_story_count)
      && report.sampled_story_count >= report.requested_sample_count,
  );

  return {
    status: procStatus,
    pass,
    reportPath,
    reportParseError,
    auditPath,
    auditError,
    failureSnapshotPath,
    runtimeLogsPath,
    requestedSampleCount: report?.requested_sample_count ?? null,
    sampledStoryCount: report?.sampled_story_count ?? null,
    sampleFillRate: report?.overall?.sample_fill_rate ?? null,
    sampleShortfall: report?.overall?.sample_shortfall ?? null,
    visibleStoryCount: Array.isArray(report?.visible_story_ids) ? report.visible_story_ids.length : null,
    auditedPairCount: report?.overall?.audited_pair_count ?? null,
    relatedTopicOnlyPairCount: report?.overall?.related_topic_only_pair_count ?? null,
    failureStoryCount: failureSnapshot?.story_count ?? report?.supply?.story_count ?? null,
    failureAuditableCount: failureSnapshot?.auditable_count ?? report?.supply?.auditable_count ?? null,
    failureTopStoryIds: failureSnapshot?.top_story_ids ?? report?.supply?.top_story_ids ?? [],
    failureTopAuditableStoryIds: failureSnapshot?.top_auditable_story_ids ?? report?.supply?.top_auditable_story_ids ?? [],
    runtimeLogCount: Array.isArray(runtimeLogs?.browserLogs)
      ? runtimeLogs.browserLogs.length
      : null,
    labelCounts,
    failingBundles,
    storyIds: (report?.bundles ?? []).map((bundle) => bundle.story_id),
  };
}

export function formatDaemonFeedSemanticSoakRunState(result) {
  const detail = result.failureAuditableCount !== null
    ? `, storeStories=${result.failureStoryCount}, storeAuditable=${result.failureAuditableCount}`
    : '';
  const sampleDetail = result.requestedSampleCount === null
    ? `${result.sampledStoryCount ?? 'n/a'}`
    : `${result.sampledStoryCount ?? 'n/a'}/${result.requestedSampleCount}`;
  const fillDetail = result.sampleFillRate === null ? 'n/a' : result.sampleFillRate;

  if (result.pass) {
    return `PASS (stories=${sampleDetail}, pairs=${result.auditedPairCount}, fill=${fillDetail})`;
  }

  return `FAIL (stories=${sampleDetail}, related_topic_only=${result.relatedTopicOnlyPairCount ?? 'n/a'}, fill=${fillDetail}${detail})`;
}
