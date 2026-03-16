import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

export function resolveNewsSourceHealthArtifactRoot(appRoot: string): string {
  return path.resolve(appRoot, '../../services/news-aggregator/.tmp/news-source-admission');
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

  const reportJson = normalizeNonEmpty(readFileSync(reportPath, 'utf8'));
  if (!reportJson) {
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
