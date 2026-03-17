import type { FeedSource } from './newsTypes';

export type SourceHealthEnforcementMode = 'enabled' | 'disabled';

export interface SourceHealthRuntimePolicy {
  readonly enabledSourceIds: readonly string[];
  readonly watchSourceIds: readonly string[];
  readonly removeSourceIds: readonly string[];
}

export interface ParsedSourceHealthReport {
  readonly readinessStatus: string | null;
  readonly recommendedAction: string | null;
  readonly reportSource: string | null;
  readonly runtimePolicy: SourceHealthRuntimePolicy;
}

export interface AppliedSourceHealthPolicySummary {
  readonly enforcement: SourceHealthEnforcementMode;
  readonly readinessStatus: string | null;
  readonly recommendedAction: string | null;
  readonly reportSource: string | null;
  readonly retainedSourceIds: readonly string[];
  readonly watchSourceIds: readonly string[];
  readonly removedConfiguredSourceIds: readonly string[];
  readonly unclassifiedSourceIds: readonly string[];
}

export interface AppliedSourceHealthPolicyResult {
  readonly feedSources: FeedSource[];
  readonly summary: AppliedSourceHealthPolicySummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const valid: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    valid.push(trimmed);
  }
  return valid.sort();
}

export function parseSourceHealthReportObject(
  value: unknown,
  options: {
    readonly reportSource?: string | null;
  } = {},
): ParsedSourceHealthReport | null {
  if (!isRecord(value)) {
    return null;
  }

  const runtimePolicyNode = isRecord(value.runtimePolicy) ? value.runtimePolicy : value;
  const watchSourceIds = normalizeStringArray(runtimePolicyNode.watchSourceIds ?? value.watchSourceIds);
  const removeSourceIds = normalizeStringArray(runtimePolicyNode.removeSourceIds ?? value.removeSourceIds);
  const explicitEnabledSourceIds = normalizeStringArray(
    runtimePolicyNode.enabledSourceIds ?? value.enabledSourceIds,
  );
  const keepSourceIds = normalizeStringArray(value.keepSourceIds);
  const enabledSourceIds =
    explicitEnabledSourceIds.length > 0
      ? explicitEnabledSourceIds
      : Array.from(new Set([...keepSourceIds, ...watchSourceIds])).sort();

  if (
    enabledSourceIds.length === 0
    && watchSourceIds.length === 0
    && removeSourceIds.length === 0
  ) {
    return null;
  }

  return {
    readinessStatus: typeof value.readinessStatus === 'string' ? value.readinessStatus : null,
    recommendedAction:
      typeof value.recommendedAction === 'string' ? value.recommendedAction : null,
    reportSource: options.reportSource ?? null,
    runtimePolicy: {
      enabledSourceIds,
      watchSourceIds,
      removeSourceIds,
    },
  };
}

export function applySourceHealthReportToFeedSources(
  feedSources: readonly FeedSource[],
  report: ParsedSourceHealthReport,
  options: {
    readonly enforcement?: SourceHealthEnforcementMode;
  } = {},
): AppliedSourceHealthPolicyResult {
  const enforcement = options.enforcement ?? 'enabled';
  const enabledSet = new Set(report.runtimePolicy.enabledSourceIds);
  const watchSet = new Set(report.runtimePolicy.watchSourceIds);
  const removeSet = new Set(report.runtimePolicy.removeSourceIds);
  const removedConfiguredSourceIds: string[] = [];

  const retainedSources =
    enforcement === 'enabled'
      ? feedSources.filter((source) => {
          if (removeSet.has(source.id)) {
            removedConfiguredSourceIds.push(source.id);
            return false;
          }
          return true;
        })
      : [...feedSources];

  const retainedSourceIds = retainedSources.map((source) => source.id);
  const unclassifiedSourceIds = retainedSourceIds.filter(
    (sourceId) => !enabledSet.has(sourceId) && !watchSet.has(sourceId),
  );

  return {
    feedSources: retainedSources,
    summary: {
      enforcement,
      readinessStatus: report.readinessStatus,
      recommendedAction: report.recommendedAction,
      reportSource: report.reportSource,
      retainedSourceIds,
      watchSourceIds: retainedSourceIds.filter((sourceId) => watchSet.has(sourceId)),
      removedConfiguredSourceIds,
      unclassifiedSourceIds,
    },
  };
}

export const sourceHealthPolicyInternal = {
  isRecord,
  normalizeStringArray,
};
