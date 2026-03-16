import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTER_FEED_SOURCES, type FeedSource } from '@vh/ai-engine';
import {
  ArticleTextService,
  ArticleTextServiceError,
  type ArticleTextServiceOptions,
  type ArticleTextResult,
} from './articleTextService';
import {
  SourceLifecycleTracker,
  type SourceLifecycleState,
} from './sourceLifecycle';
import { buildSourceDomainAllowlist } from './sourceRegistry';

const RSS_ITEM_REGEX = /<item\b[\s\S]*?<\/item>/gi;
const ATOM_ENTRY_REGEX = /<entry\b[\s\S]*?<\/entry>/gi;
const DEFAULT_SAMPLE_SIZE = 4;
const DEFAULT_MIN_SUCCESS_COUNT = 2;
const DEFAULT_MIN_SUCCESS_RATE = 0.75;

export const SOURCE_ADMISSION_REPORT_SCHEMA_VERSION =
  'news-source-admission-report-v1';

export type SourceAdmissionStatus = 'admitted' | 'rejected' | 'inconclusive';

export interface SourceAdmissionCriteria {
  readonly sampleSize: number;
  readonly minimumSuccessCount: number;
  readonly minimumSuccessRate: number;
}

export interface SourceAdmissionSampleResult {
  readonly url: string;
  readonly outcome: 'passed' | 'failed';
  readonly title?: string;
  readonly extractionMethod?: ArticleTextResult['extractionMethod'];
  readonly qualityScore?: number;
  readonly textLength?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly retryable?: boolean;
}

export interface SourceAdmissionSourceReport {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly rssUrl: string;
  readonly status: SourceAdmissionStatus;
  readonly admitted: boolean;
  readonly sampleLinkCount: number;
  readonly readableSampleCount: number;
  readonly readableSampleRate: number | null;
  readonly reasons: string[];
  readonly sampledUrls: readonly string[];
  readonly samples: readonly SourceAdmissionSampleResult[];
  readonly lifecycle: readonly SourceLifecycleState[];
}

export interface SourceAdmissionReport {
  readonly schemaVersion: typeof SOURCE_ADMISSION_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly criteria: SourceAdmissionCriteria;
  readonly sourceCount: number;
  readonly admittedSourceIds: readonly string[];
  readonly rejectedSourceIds: readonly string[];
  readonly inconclusiveSourceIds: readonly string[];
  readonly sources: readonly SourceAdmissionSourceReport[];
}

export interface SourceAdmissionAuditOptions {
  readonly feedSources?: readonly FeedSource[];
  readonly sampleSize?: number;
  readonly minimumSuccessCount?: number;
  readonly minimumSuccessRate?: number;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  readonly articleTextServiceOptions?: Omit<
    ArticleTextServiceOptions,
    'allowlist' | 'fetchFn' | 'lifecycle' | 'now'
  >;
}

export interface SourceAdmissionArtifactOptions extends SourceAdmissionAuditOptions {
  readonly artifactDir?: string;
  readonly cwd?: string;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseRate(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return fallback;
  }

  return parsed;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTagText(xmlFragment: string, tagName: string): string | undefined {
  const escapedTagName = tagName.replace(':', '\\:');
  const regex = new RegExp(`<${escapedTagName}[^>]*>([\\s\\S]*?)<\\/${escapedTagName}>`, 'i');
  const match = regex.exec(xmlFragment);
  if (!match?.[1]) {
    return undefined;
  }

  return decodeXmlEntities(
    match[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function extractLink(xmlFragment: string): string | undefined {
  const hrefMatch =
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i.exec(xmlFragment);
  if (hrefMatch?.[1]) {
    return decodeXmlEntities(hrefMatch[1].trim());
  }

  const textLink = extractTagText(xmlFragment, 'link');
  return textLink?.trim();
}

export function parseFeedLinks(xml: string, sampleSize: number): string[] {
  const fragments = [
    ...Array.from(xml.matchAll(RSS_ITEM_REGEX), (match) => match[0]),
    ...Array.from(xml.matchAll(ATOM_ENTRY_REGEX), (match) => match[0]),
  ];

  const links: string[] = [];
  const seen = new Set<string>();

  for (const fragment of fragments) {
    const link = extractLink(fragment);
    if (!link || !/^https?:\/\//i.test(link)) {
      continue;
    }
    if (seen.has(link)) {
      continue;
    }
    seen.add(link);
    links.push(link);
    if (links.length >= sampleSize) {
      break;
    }
  }

  return links;
}

async function readFeedXml(
  fetchFn: typeof fetch,
  source: FeedSource,
): Promise<string | null> {
  try {
    const response = await fetchFn(source.rssUrl);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

function buildCriteria(options: SourceAdmissionAuditOptions): SourceAdmissionCriteria {
  return {
    sampleSize:
      options.sampleSize
      ?? parsePositiveInt(
        process.env.VH_NEWS_SOURCE_ADMISSION_SAMPLE_SIZE,
        DEFAULT_SAMPLE_SIZE,
      ),
    minimumSuccessCount:
      options.minimumSuccessCount
      ?? parsePositiveInt(
        process.env.VH_NEWS_SOURCE_ADMISSION_MIN_SUCCESS_COUNT,
        DEFAULT_MIN_SUCCESS_COUNT,
      ),
    minimumSuccessRate:
      options.minimumSuccessRate
      ?? parseRate(
        process.env.VH_NEWS_SOURCE_ADMISSION_MIN_SUCCESS_RATE,
        DEFAULT_MIN_SUCCESS_RATE,
      ),
  };
}

function passSample(result: ArticleTextResult): SourceAdmissionSampleResult {
  return {
    url: result.url,
    outcome: 'passed',
    title: result.title,
    extractionMethod: result.extractionMethod,
    qualityScore: result.quality.score,
    textLength: result.text.length,
  };
}

function failSample(
  url: string,
  error: unknown,
): SourceAdmissionSampleResult {
  if (error instanceof ArticleTextServiceError) {
    return {
      url,
      outcome: 'failed',
      errorCode: error.code,
      errorMessage: error.message,
      retryable: error.retryable,
    };
  }

  return {
    url,
    outcome: 'failed',
    errorCode: 'unexpected-error',
    errorMessage: error instanceof Error ? error.message : 'Unexpected source admission failure',
    retryable: false,
  };
}

function classifySource(
  source: FeedSource,
  criteria: SourceAdmissionCriteria,
  sampledUrls: readonly string[],
  samples: readonly SourceAdmissionSampleResult[],
  lifecycle: readonly SourceLifecycleState[],
): SourceAdmissionSourceReport {
  const readableSampleCount = samples.filter((sample) => sample.outcome === 'passed').length;
  const readableSampleRate =
    sampledUrls.length > 0 ? readableSampleCount / sampledUrls.length : null;

  const reasons: string[] = [];
  let status: SourceAdmissionStatus = 'rejected';

  if (sampledUrls.length === 0) {
    status = 'inconclusive';
    reasons.push('feed_links_unavailable');
  } else if (
    readableSampleCount >= criteria.minimumSuccessCount &&
    readableSampleCount / sampledUrls.length >= criteria.minimumSuccessRate
  ) {
    status = 'admitted';
  } else {
    const failureCodes = new Set(
      samples
        .filter((sample) => sample.outcome === 'failed')
        .map((sample) => sample.errorCode)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    );

    if (failureCodes.size === 0) {
      reasons.push('readable_sample_threshold_not_met');
    } else {
      reasons.push(...Array.from(failureCodes).sort());
    }
  }

  return {
    sourceId: source.id,
    sourceName: source.name,
    rssUrl: source.rssUrl,
    status,
    admitted: status === 'admitted',
    sampleLinkCount: sampledUrls.length,
    readableSampleCount,
    readableSampleRate,
    reasons,
    sampledUrls,
    samples,
    lifecycle,
  };
}

export async function auditFeedSourceAdmission(
  source: FeedSource,
  options: SourceAdmissionAuditOptions = {},
): Promise<SourceAdmissionSourceReport> {
  const criteria = buildCriteria(options);
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const lifecycle = new SourceLifecycleTracker({ now });
  const service = new ArticleTextService({
    ...options.articleTextServiceOptions,
    allowlist: buildSourceDomainAllowlist([source]),
    fetchFn,
    lifecycle,
    now,
  });

  const xml = await readFeedXml(fetchFn, source);
  const sampledUrls = xml ? parseFeedLinks(xml, criteria.sampleSize) : [];
  const samples: SourceAdmissionSampleResult[] = [];

  for (const url of sampledUrls) {
    try {
      const result = await service.extract(url);
      samples.push(passSample(result));
    } catch (error) {
      samples.push(failSample(url, error));
    }
  }

  return classifySource(
    source,
    criteria,
    sampledUrls,
    samples,
    lifecycle.snapshot(),
  );
}

export async function buildSourceAdmissionReport(
  options: SourceAdmissionAuditOptions = {},
): Promise<SourceAdmissionReport> {
  const feedSources = options.feedSources ?? STARTER_FEED_SOURCES;
  const criteria = buildCriteria(options);
  const sources: SourceAdmissionSourceReport[] = [];

  for (const source of feedSources) {
    sources.push(await auditFeedSourceAdmission(source, options));
  }

  return {
    schemaVersion: SOURCE_ADMISSION_REPORT_SCHEMA_VERSION,
    generatedAt: new Date((options.now ?? Date.now)()).toISOString(),
    criteria,
    sourceCount: sources.length,
    admittedSourceIds: sources.filter((source) => source.status === 'admitted').map((source) => source.sourceId),
    rejectedSourceIds: sources.filter((source) => source.status === 'rejected').map((source) => source.sourceId),
    inconclusiveSourceIds: sources.filter((source) => source.status === 'inconclusive').map((source) => source.sourceId),
    sources,
  };
}

export async function writeSourceAdmissionArtifact(
  options: SourceAdmissionArtifactOptions = {},
): Promise<{ artifactDir: string; reportPath: string; report: SourceAdmissionReport }> {
  const cwd = options.cwd ?? process.cwd();
  const artifactDir =
    options.artifactDir
    ?? path.join(
      cwd,
      '.tmp',
      'news-source-admission',
      String((options.now ?? Date.now)()),
    );

  mkdirSync(artifactDir, { recursive: true });
  const report = await buildSourceAdmissionReport(options);
  const reportPath = path.join(artifactDir, 'source-admission-report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { artifactDir, reportPath, report };
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

/* c8 ignore next 11 */
async function main(): Promise<void> {
  const { artifactDir, reportPath, report } = await writeSourceAdmissionArtifact();
  console.info('[vh:news-source-admission] report written', {
    artifactDir,
    reportPath,
    admittedSourceIds: report.admittedSourceIds,
    rejectedSourceIds: report.rejectedSourceIds,
    inconclusiveSourceIds: report.inconclusiveSourceIds,
  });
}

/* c8 ignore next 3 */
if (isDirectExecution()) {
  await main();
}

export const sourceAdmissionReportInternal = {
  buildCriteria,
  classifySource,
  decodeXmlEntities,
  extractLink,
  extractTagText,
  failSample,
  isDirectExecution,
  parseFeedLinks,
  passSample,
  readFeedXml,
};
