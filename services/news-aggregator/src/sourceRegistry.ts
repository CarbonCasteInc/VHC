import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  STARTER_FEED_SOURCES,
  applySourceHealthReportToFeedSources,
  parseSourceHealthReportObject,
  type AppliedSourceHealthPolicySummary,
  type FeedSource,
  type ParsedSourceHealthReport,
} from '@vh/ai-engine';

/**
 * Starter-source domains for extraction allowlisting.
 *
 * Derives directly from the runtime starter slate so source admission does not
 * drift away from the feed surface actually being used by the app/runtime.
 */

export const STARTER_FEED_URLS = Object.freeze(
  STARTER_FEED_SOURCES.map((source) => source.rssUrl),
) as readonly string[];

const DOMAIN_ALIASES: Record<string, readonly string[]> = {
  'moxie.foxnews.com': ['foxnews.com', 'www.foxnews.com'],
  'nypost.com': ['www.nypost.com'],
  'thefederalist.com': ['www.thefederalist.com'],
  'www.theguardian.com': ['theguardian.com'],
  'www.huffpost.com': ['huffpost.com', 'chaski.huffpost.com'],
  'www.cbsnews.com': ['cbsnews.com'],
  'feeds.bbci.co.uk': ['bbc.com', 'www.bbc.com', 'bbc.co.uk', 'www.bbc.co.uk'],
  'news.yahoo.com': ['yahoo.com', 'www.yahoo.com'],
};

function toBaseDomain(hostname: string): string {
  const normalized = hostname.toLowerCase();
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }

  if (normalized.endsWith('.co.uk') && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

function parseDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.includes('://')) {
    return /^[a-z0-9.-]+$/.test(trimmed) ? trimmed : null;
  }

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
}

type FeedSourceLike = Pick<FeedSource, 'rssUrl'> | string;

export interface ResolvedStarterFeedSources {
  readonly feedSources: readonly FeedSource[];
  readonly sourceHealth: {
    readonly reportSource: string | null;
    readonly reportPath: string | null;
    readonly report: ParsedSourceHealthReport | null;
    readonly summary: AppliedSourceHealthPolicySummary | null;
  };
}

interface ResolveStarterFeedSourcesOptions {
  readonly feedSources?: readonly FeedSource[];
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
}

function toFeedUrl(source: FeedSourceLike): string {
  return typeof source === 'string' ? source : source.rssUrl;
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

function readHealthEnv(
  env: Record<string, string | undefined>,
  suffix: string,
): string | undefined {
  return env[`VH_${suffix}`] ?? env[`VITE_${suffix}`];
}

function resolveSourceHealthArtifactRoot(cwd: string): string {
  return path.resolve(cwd, '.tmp/news-source-admission');
}

export function findLatestSourceHealthReportPath(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicitPath = normalizeNonEmpty(readHealthEnv(env, 'NEWS_SOURCE_HEALTH_REPORT_PATH'));
  if (explicitPath) {
    const resolvedPath = path.resolve(cwd, explicitPath);
    return existsSync(resolvedPath) ? resolvedPath : null;
  }

  const artifactRoot = resolveSourceHealthArtifactRoot(cwd);
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

export function resolveSourceHealthReport(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): {
  readonly reportSource: string | null;
  readonly reportPath: string | null;
  readonly report: ParsedSourceHealthReport | null;
} {
  const explicitJson = normalizeNonEmpty(readHealthEnv(env, 'NEWS_SOURCE_HEALTH_REPORT_JSON'));
  if (explicitJson) {
    try {
      return {
        reportSource:
          normalizeNonEmpty(readHealthEnv(env, 'NEWS_SOURCE_HEALTH_REPORT_SOURCE'))
          ?? 'env:NEWS_SOURCE_HEALTH_REPORT_JSON',
        reportPath: null,
        report:
          parseSourceHealthReportObject(JSON.parse(explicitJson) as unknown, {
            reportSource:
              normalizeNonEmpty(readHealthEnv(env, 'NEWS_SOURCE_HEALTH_REPORT_SOURCE'))
              ?? 'env:NEWS_SOURCE_HEALTH_REPORT_JSON',
          }),
      };
    } catch {
      return {
        reportSource: null,
        reportPath: null,
        report: null,
      };
    }
  }

  if (!parseBoolean(readHealthEnv(env, 'NEWS_SOURCE_HEALTH_REPORT_AUTOLOAD'), true)) {
    return {
      reportSource: null,
      reportPath: null,
      report: null,
    };
  }

  const reportPath = findLatestSourceHealthReportPath(cwd, env);
  if (!reportPath) {
    return {
      reportSource: null,
      reportPath: null,
      report: null,
    };
  }

  try {
    const reportSource = `artifact:${reportPath}`;
    return {
      reportSource,
      reportPath,
      report:
        parseSourceHealthReportObject(JSON.parse(readFileSync(reportPath, 'utf8')) as unknown, {
          reportSource,
        }),
    };
  } catch {
    return {
      reportSource: null,
      reportPath: null,
      report: null,
    };
  }
}

export function resolveStarterFeedSources(
  options: ResolveStarterFeedSourcesOptions = {},
): ResolvedStarterFeedSources {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const baseSources = options.feedSources ? [...options.feedSources] : [...STARTER_FEED_SOURCES];
  const reportResolution = resolveSourceHealthReport(cwd, env);

  if (!reportResolution.report) {
    return {
      feedSources: baseSources,
      sourceHealth: {
        reportSource: reportResolution.reportSource,
        reportPath: reportResolution.reportPath,
        report: null,
        summary: null,
      },
    };
  }

  const enforcement = parseBoolean(
    readHealthEnv(env, 'NEWS_SOURCE_HEALTH_ENFORCEMENT'),
    true,
  )
    ? 'enabled'
    : 'disabled';
  const applied = applySourceHealthReportToFeedSources(baseSources, reportResolution.report, {
    enforcement,
  });

  return {
    feedSources: applied.feedSources,
    sourceHealth: {
      reportSource: reportResolution.reportSource,
      reportPath: reportResolution.reportPath,
      report: reportResolution.report,
      summary: applied.summary,
    },
  };
}

export function buildSourceDomainAllowlist(
  feedSources: readonly FeedSourceLike[] = STARTER_FEED_URLS,
): ReadonlySet<string> {
  const set = new Set<string>();

  for (const source of feedSources) {
    const url = toFeedUrl(source);
    const host = new URL(url).hostname.toLowerCase();
    set.add(host);
    set.add(toBaseDomain(host));

    const aliases = DOMAIN_ALIASES[host];
    if (aliases) {
      for (const alias of aliases) {
        set.add(alias.toLowerCase());
      }
    }
  }

  return set;
}

const STARTER_SOURCE_DOMAIN_SET = buildSourceDomainAllowlist();

export const STARTER_SOURCE_DOMAINS: readonly string[] = Object.freeze(
  Array.from(STARTER_SOURCE_DOMAIN_SET).sort(),
);

export function getStarterSourceDomainAllowlist(): ReadonlySet<string> {
  return buildSourceDomainAllowlist(resolveStarterFeedSources().feedSources);
}

export function isSourceDomainAllowed(
  urlOrDomain: string,
  allowlist: ReadonlySet<string> = STARTER_SOURCE_DOMAIN_SET,
): boolean {
  const hostname = parseDomain(urlOrDomain);
  if (!hostname) {
    return false;
  }

  if (allowlist.has(hostname)) {
    return true;
  }

  return allowlist.has(toBaseDomain(hostname));
}

export const sourceRegistryInternal = {
  findLatestSourceHealthReportPath,
  normalizeNonEmpty,
  parseBoolean,
  toFeedUrl,
  parseDomain,
  readHealthEnv,
  resolveSourceHealthArtifactRoot,
  resolveSourceHealthReport,
  toBaseDomain,
};
