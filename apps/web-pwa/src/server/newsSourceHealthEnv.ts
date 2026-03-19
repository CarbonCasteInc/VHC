import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface NewsSourceHealthEnvResolution {
  readonly reportJson: string | null;
  readonly reportPath: string | null;
  readonly reportSource: string | null;
  readonly autoloaded: boolean;
}

interface ResolveNewsSourceHealthEnvOptions {
  readonly appRoot: string;
  readonly env?: Record<string, string | undefined>;
}

type NewsSourceHealthReportStaleAction = 'warn' | 'fail';

const DEFAULT_NEWS_SOURCE_HEALTH_REPORT_MAX_AGE_HOURS = 24;

function normalizeNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = normalizeNonEmpty(value)?.toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const normalized = normalizeNonEmpty(value);
  if (!normalized) {
    return fallback;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStaleAction(
  value: string | undefined,
  fallback: NewsSourceHealthReportStaleAction,
): NewsSourceHealthReportStaleAction {
  const normalized = normalizeNonEmpty(value)?.toLowerCase();
  return normalized === 'fail' || normalized === 'warn' ? normalized : fallback;
}

export function resolveNewsSourceHealthArtifactRoot(appRoot: string): string {
  return path.resolve(appRoot, '../../services/news-aggregator/.tmp/news-source-admission');
}

function resolveNewsSourceHealthArtifactTimestamp(
  reportValue: unknown,
  reportPath: string,
): {
  readonly timestampMs: number | null;
  readonly timestampSource: 'generatedAt' | 'mtime' | 'unavailable';
} {
  if (isRecord(reportValue) && typeof reportValue.generatedAt === 'string') {
    const generatedAtMs = Date.parse(reportValue.generatedAt);
    if (Number.isFinite(generatedAtMs)) {
      return {
        timestampMs: generatedAtMs,
        timestampSource: 'generatedAt',
      };
    }
  }

  try {
    const stats = statSync(reportPath);
    if (Number.isFinite(stats.mtimeMs)) {
      return {
        timestampMs: stats.mtimeMs,
        timestampSource: 'mtime',
      };
    }
  } catch {
    // Fall through to unavailable.
  }

  return {
    timestampMs: null,
    timestampSource: 'unavailable',
  };
}

function formatNewsSourceHealthArtifactStaleMessage(
  reportPath: string,
  ageMs: number | null,
  maxAgeHours: number,
  timestampSource: 'generatedAt' | 'mtime' | 'unavailable',
): string {
  const ageHours =
    ageMs === null ? 'unknown' : `${(ageMs / 3_600_000).toFixed(2)}h`;
  return [
    'stale-news-source-health-report',
    `path=${reportPath}`,
    `age=${ageHours}`,
    `max_age=${maxAgeHours}h`,
    `timestamp_source=${timestampSource}`,
  ].join(' ');
}

function enforceFreshNewsSourceHealthArtifact(
  reportValue: unknown,
  reportPath: string,
  env: Record<string, string | undefined>,
): boolean {
  const maxAgeHours = parsePositiveNumber(
    env.VITE_NEWS_SOURCE_HEALTH_REPORT_MAX_AGE_HOURS,
    DEFAULT_NEWS_SOURCE_HEALTH_REPORT_MAX_AGE_HOURS,
  );
  const staleAction = parseStaleAction(
    env.VITE_NEWS_SOURCE_HEALTH_REPORT_STALE_ACTION,
    'warn',
  );
  const { timestampMs, timestampSource } =
    resolveNewsSourceHealthArtifactTimestamp(reportValue, reportPath);
  const ageMs =
    timestampMs === null
      ? null
      : Math.max(0, Date.now() - timestampMs);
  const isStale =
    ageMs === null
    || ageMs > maxAgeHours * 3_600_000;

  if (!isStale) {
    return true;
  }

  const message = formatNewsSourceHealthArtifactStaleMessage(
    reportPath,
    ageMs,
    maxAgeHours,
    timestampSource,
  );
  if (staleAction === 'fail') {
    throw new Error(message);
  }
  console.warn(message);
  return false;
}

export function findLatestNewsSourceHealthReportPath(
  options: ResolveNewsSourceHealthEnvOptions,
): string | null {
  const env = options.env ?? process.env;
  const explicitPath = normalizeNonEmpty(env.VITE_NEWS_SOURCE_HEALTH_REPORT_PATH);
  if (explicitPath) {
    const resolvedPath = path.resolve(options.appRoot, explicitPath);
    return existsSync(resolvedPath) ? resolvedPath : null;
  }

  const artifactRoot = resolveNewsSourceHealthArtifactRoot(options.appRoot);
  const latestPath = path.join(artifactRoot, 'latest', 'source-health-report.json');
  if (existsSync(latestPath)) {
    return latestPath;
  }

  if (!existsSync(artifactRoot)) {
    return null;
  }

  const candidates = readdirSync(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => ({
      runId: Number(entry.name),
      reportPath: path.join(artifactRoot, entry.name, 'source-health-report.json'),
    }))
    .filter((entry) => existsSync(entry.reportPath))
    .sort((left, right) => right.runId - left.runId);

  return candidates[0]?.reportPath ?? null;
}

export function resolveNewsSourceHealthEnv(
  options: ResolveNewsSourceHealthEnvOptions,
): NewsSourceHealthEnvResolution {
  const env = options.env ?? process.env;
  const explicitJson = normalizeNonEmpty(env.VITE_NEWS_SOURCE_HEALTH_REPORT_JSON);
  if (explicitJson) {
    return {
      reportJson: explicitJson,
      reportPath: null,
      reportSource:
        normalizeNonEmpty(env.VITE_NEWS_SOURCE_HEALTH_REPORT_SOURCE)
        ?? 'env:VITE_NEWS_SOURCE_HEALTH_REPORT_JSON',
      autoloaded: false,
    };
  }

  if (!parseBoolean(env.VITE_NEWS_SOURCE_HEALTH_REPORT_AUTOLOAD, true)) {
    return {
      reportJson: null,
      reportPath: null,
      reportSource: null,
      autoloaded: false,
    };
  }

  const reportPath = findLatestNewsSourceHealthReportPath(options);
  if (!reportPath) {
    return {
      reportJson: null,
      reportPath: null,
      reportSource: null,
      autoloaded: false,
    };
  }

  let reportJson: string | null = null;
  let reportValue: unknown;
  try {
    reportJson = normalizeNonEmpty(readFileSync(reportPath, 'utf8'));
    if (!reportJson) {
      return {
        reportJson: null,
        reportPath: null,
        reportSource: null,
        autoloaded: false,
      };
    }
    reportValue = JSON.parse(reportJson) as unknown;
  } catch {
    return {
      reportJson: null,
      reportPath: null,
      reportSource: null,
      autoloaded: false,
    };
  }

  if (!enforceFreshNewsSourceHealthArtifact(reportValue, reportPath, env)) {
    return {
      reportJson: null,
      reportPath: null,
      reportSource: null,
      autoloaded: false,
    };
  }

  return {
    reportJson,
    reportPath,
    reportSource: `artifact:${reportPath}`,
    autoloaded: true,
  };
}

export function applyNewsSourceHealthEnv(
  options: ResolveNewsSourceHealthEnvOptions,
): NewsSourceHealthEnvResolution {
  const env = options.env ?? process.env;
  const resolution = resolveNewsSourceHealthEnv(options);
  if (!resolution.reportJson) {
    return resolution;
  }

  env.VITE_NEWS_SOURCE_HEALTH_REPORT_JSON ??= resolution.reportJson;
  if (resolution.reportSource) {
    env.VITE_NEWS_SOURCE_HEALTH_REPORT_SOURCE ??= resolution.reportSource;
  }

  return resolution;
}

export const newsSourceHealthEnvInternal = {
  normalizeNonEmpty,
  parseBoolean,
  parsePositiveNumber,
  parseStaleAction,
  resolveNewsSourceHealthArtifactTimestamp,
  formatNewsSourceHealthArtifactStaleMessage,
  enforceFreshNewsSourceHealthArtifact,
};
