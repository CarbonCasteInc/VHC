export const REQUIRED_SAMPLE_FLOOR_BLOCKER_ID = 'required-write-class-sample-floors';
export const REQUIRED_SAMPLE_FLOOR_BLOCKER_COMMAND = 'pnpm check:mesh:production-readiness';

const EXPLICIT_RELEASE_SCOPE_SKIP_STATUSES = new Set(['skipped', 'out_of_scope', 'not_applicable']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasExplicitReleaseScopeSkip(row) {
  return EXPLICIT_RELEASE_SCOPE_SKIP_STATUSES.has(row?.status) && nonEmptyString(row?.reason);
}

function rowName(row, field) {
  if (field === 'write_class_slos') {
    return row?.write_class || row?.class || row?.operation || 'unknown write class';
  }
  return row?.resource || row?.class || row?.operation || 'unknown resource';
}

function sourceName({ sourceId, sourceRunId }) {
  return [sourceId, sourceRunId].filter(nonEmptyString).join('/') || 'aggregate';
}

export function formatSampleFloorIssue(issue) {
  return `${issue.field}:${issue.source}/${issue.name}`;
}

function issuesForRows(rows, { field, sourceId, sourceRunId }) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.status === 'insufficient_samples')
    .map((row) => ({
      field,
      source: sourceName({ sourceId, sourceRunId }),
      name: rowName(row, field),
      row,
    }));
}

export function requiredSampleFloorIssuesForReport(report, { sourceId = null, sourceRunId = null } = {}) {
  return [
    ...issuesForRows(report?.write_class_slos, { field: 'write_class_slos', sourceId, sourceRunId }),
    ...issuesForRows(report?.resource_slos, { field: 'resource_slos', sourceId, sourceRunId }),
  ];
}

export function requiredSampleFloorIssuesForSources(sources) {
  return sources.flatMap((source) =>
    requiredSampleFloorIssuesForReport(source.report, {
      sourceId: source.id,
      sourceRunId: source.report?.run_id || null,
    }),
  );
}

export function sampleFloorValidationFailuresForReport(report) {
  return requiredSampleFloorIssuesForReport(report).map(
    (issue) => `required ${issue.field} row ${issue.name} is insufficient_samples`,
  );
}

export function requiredSampleFloorBlockerForIssues(issues) {
  const uniqueLabels = [...new Set(issues.map(formatSampleFloorIssue))].sort();
  if (uniqueLabels.length === 0) return null;
  return {
    id: REQUIRED_SAMPLE_FLOOR_BLOCKER_ID,
    command: REQUIRED_SAMPLE_FLOOR_BLOCKER_COMMAND,
    reason: `required write/resource SLO sample floors are insufficient_samples: ${uniqueLabels.join(', ')}`,
  };
}

function readinessFailuresForRows(rows, { field, sourceId, sourceRunId }) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (row?.status === 'pass' || hasExplicitReleaseScopeSkip(row)) return [];

    const label = `${field}:${sourceName({ sourceId, sourceRunId })}/${rowName(row, field)}`;
    if (row?.status === 'insufficient_samples') {
      return [`${label} is insufficient_samples`];
    }
    if (EXPLICIT_RELEASE_SCOPE_SKIP_STATUSES.has(row?.status)) {
      return [`${label} is ${row.status} without an explicit reason`];
    }
    return [`${label} is ${row?.status || 'missing_status'}`];
  });
}

export function requiredSloReadinessFailuresForReport(report, { sourceId = null, sourceRunId = null } = {}) {
  return [
    ...readinessFailuresForRows(report?.write_class_slos, { field: 'write_class_slos', sourceId, sourceRunId }),
    ...readinessFailuresForRows(report?.resource_slos, { field: 'resource_slos', sourceId, sourceRunId }),
  ];
}
