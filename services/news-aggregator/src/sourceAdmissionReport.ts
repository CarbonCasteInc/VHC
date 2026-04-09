import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverHtmlFeedUrls,
  FeedSourceSchema,
  STARTER_FEED_SOURCES,
  isLikelyVideoSourceEntry,
  parseApNewsHtmlFeedLinks,
  type FeedSource,
} from '@vh/ai-engine';
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
const REPLACEMENT_SAMPLE_BUFFER = 4;
const MAX_HTML_FEED_DISCOVERY_DEPTH = 2;

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

export type SourceAdmissionFeedReadErrorCode =
  | 'feed_http_error'
  | 'feed_fetch_error'
  | 'feed_fetch_timeout'
  | 'feed_non_xml_payload'
  | 'feed_empty_payload'
  | null;

export interface SourceAdmissionFeedReadDiagnostics {
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  readonly bodyLength: number | null;
  readonly resolvedFeedUrl: string | null;
  readonly payloadKind: 'xml' | 'html_feed' | 'non_xml' | 'empty' | 'unavailable';
  readonly errorCode: SourceAdmissionFeedReadErrorCode;
  readonly errorMessage: string | null;
  readonly attemptCount: number;
  readonly itemFragmentCount: number;
  readonly entryFragmentCount: number;
  readonly extractedLinkCount: number;
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
  readonly skippedVideoUrls?: readonly string[];
  readonly samples: readonly SourceAdmissionSampleResult[];
  readonly lifecycle: readonly SourceLifecycleState[];
  readonly feedRead: SourceAdmissionFeedReadDiagnostics;
}

function countFeedEntryFragments(xml: string): {
  readonly itemFragmentCount: number;
  readonly entryFragmentCount: number;
} {
  return {
    itemFragmentCount: Array.from(xml.matchAll(RSS_ITEM_REGEX)).length,
    entryFragmentCount: Array.from(xml.matchAll(ATOM_ENTRY_REGEX)).length,
  };
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
  readonly feedReadAttemptCount?: number;
  readonly feedReadRetryDelayMs?: number;
  readonly articleTextServiceOptions?: Omit<
    ArticleTextServiceOptions,
    'allowlist' | 'fetchFn' | 'lifecycle' | 'now'
  >;
}

export interface SourceAdmissionArtifactOptions extends SourceAdmissionAuditOptions {
  readonly artifactDir?: string;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
}

interface FeedLinkParseResult {
  readonly links: readonly string[];
  readonly itemFragmentCount: number;
  readonly entryFragmentCount: number;
  readonly skippedVideoUrls: readonly string[];
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

function normalizeNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function parseFeedSourcesOverride(
  raw: string | undefined,
  sourceLabel = 'feed source override',
): FeedSource[] | null {
  const normalized = normalizeNonEmpty(raw);
  if (!normalized) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized) as unknown;
  } catch {
    throw new Error(`${sourceLabel} must be valid JSON`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${sourceLabel} must be a JSON array`);
  }

  const valid: FeedSource[] = [];
  for (const source of parsed) {
    const result = FeedSourceSchema.safeParse(source);
    if (result.success) {
      valid.push(result.data);
    }
  }

  if (valid.length === 0) {
    throw new Error(`${sourceLabel} must contain at least one valid feed source`);
  }

  return valid;
}

function resolveConfiguredFeedSources(
  options: SourceAdmissionAuditOptions & Pick<SourceAdmissionArtifactOptions, 'cwd' | 'env'> = {},
): readonly FeedSource[] {
  if (options.feedSources) {
    return options.feedSources;
  }

  const env = options.env ?? process.env;
  const jsonOverrideRaw = normalizeNonEmpty(env.VH_NEWS_SOURCE_ADMISSION_SOURCES_JSON);
  const jsonOverride = parseFeedSourcesOverride(
    jsonOverrideRaw ?? undefined,
    'VH_NEWS_SOURCE_ADMISSION_SOURCES_JSON',
  );
  if (jsonOverride) {
    return jsonOverride;
  }

  const fileOverride = normalizeNonEmpty(env.VH_NEWS_SOURCE_ADMISSION_SOURCES_FILE);
  if (fileOverride) {
    const cwd = options.cwd ?? process.cwd();
    const filePath = path.resolve(cwd, fileOverride);
    let fileContents: string;
    try {
      fileContents = readFileSync(filePath, 'utf8');
    } catch {
      throw new Error(`VH_NEWS_SOURCE_ADMISSION_SOURCES_FILE not found: ${filePath}`);
    }
    return (
      parseFeedSourcesOverride(
        fileContents,
        `VH_NEWS_SOURCE_ADMISSION_SOURCES_FILE (${filePath})`,
      )
      ?? STARTER_FEED_SOURCES
    );
  }

  return STARTER_FEED_SOURCES;
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

function isLikelyVideoFeedEntry(
  xmlFragment: string,
  url: string,
  title: string | undefined,
): boolean {
  if (
    /<enclosure\b[^>]*\btype=["']video\//i.test(xmlFragment)
    || /<media:content\b[^>]*\bmedium=["']video["']/i.test(xmlFragment)
    || /<media:player\b/i.test(xmlFragment)
  ) {
    return true;
  }

  return isLikelyVideoSourceEntry({ url, title });
}
function parseFeedLinksDetailed(
  xml: string,
  sampleSize: number,
  source?: FeedSource,
  responseUrl?: string,
): FeedLinkParseResult {
  const rssFragments = Array.from(xml.matchAll(RSS_ITEM_REGEX), (match) => match[0]);
  const atomFragments = Array.from(xml.matchAll(ATOM_ENTRY_REGEX), (match) => match[0]);
  const fragments = [...rssFragments, ...atomFragments];

  if (fragments.length === 0 && source) {
    const htmlLinks = parseApNewsHtmlFeedLinks(
      xml,
      responseUrl ?? source.rssUrl,
      sampleSize,
    ).map((entry) => entry.url);
    return {
      links: htmlLinks,
      itemFragmentCount: 0,
      entryFragmentCount: 0,
      skippedVideoUrls: [],
    };
  }

  const links: string[] = [];
  const skippedVideoUrls: string[] = [];
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

    if (isLikelyVideoFeedEntry(fragment, link, extractTagText(fragment, 'title'))) {
      skippedVideoUrls.push(link);
      continue;
    }

    links.push(link);
    if (links.length >= sampleSize) {
      break;
    }
  }

  return {
    links,
    itemFragmentCount: rssFragments.length,
    entryFragmentCount: atomFragments.length,
    skippedVideoUrls,
  };
}

export function parseFeedLinks(xml: string, sampleSize: number): string[] {
  return [...parseFeedLinksDetailed(xml, sampleSize).links];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isLikelyXmlPayload(
  contentType: string | null,
  body: string,
): boolean {
  const normalizedType = contentType?.toLowerCase() ?? '';
  if (
    normalizedType.includes('xml')
    || normalizedType.includes('rss')
    || normalizedType.includes('atom')
  ) {
    return true;
  }

  const trimmed = body.trimStart().toLowerCase();
  return (
    trimmed.startsWith('<?xml')
    || trimmed.startsWith('<rss')
    || trimmed.startsWith('<feed')
    || trimmed.startsWith('<rdf:rdf')
  );
}

function classifyFeedReadError(error: unknown): {
  readonly errorCode: Exclude<SourceAdmissionFeedReadErrorCode, 'feed_http_error' | null>;
  readonly errorMessage: string;
} {
  if (error instanceof Error) {
    const normalizedMessage = error.message.toLowerCase();
    if (error.name === 'AbortError' || normalizedMessage.includes('abort')) {
      return {
        errorCode: 'feed_fetch_timeout',
        errorMessage: error.message,
      };
    }

    return {
      errorCode: 'feed_fetch_error',
      errorMessage: error.message,
    };
  }

  return {
    errorCode: 'feed_fetch_error',
    errorMessage: 'Unexpected feed fetch failure',
  };
}

async function readFeedXml(
  fetchFn: typeof fetch,
  source: FeedSource,
  options: Pick<SourceAdmissionAuditOptions, 'feedReadAttemptCount' | 'feedReadRetryDelayMs'> = {},
): Promise<{
  readonly xml: string | null;
  readonly responseUrl: string | null;
  readonly diagnostics: Omit<
    SourceAdmissionFeedReadDiagnostics,
    'itemFragmentCount' | 'entryFragmentCount' | 'extractedLinkCount'
  >;
}> {
  const attemptCount = Math.max(1, options.feedReadAttemptCount ?? 2);
  const retryDelayMs = Math.max(0, options.feedReadRetryDelayMs ?? 250);

  async function resolveHtmlFeedPayload(
    payload: string,
    responseUrl: string,
    attempt: number,
    remainingDepth: number,
    seenUrls: Set<string> = new Set([responseUrl]),
  ): Promise<{
    readonly xml: string;
    readonly responseUrl: string;
    readonly diagnostics: Omit<
      SourceAdmissionFeedReadDiagnostics,
      'itemFragmentCount' | 'entryFragmentCount' | 'extractedLinkCount'
    >;
  } | null> {
    const htmlLinks = parseApNewsHtmlFeedLinks(payload, responseUrl, 1);
    if (htmlLinks.length > 0) {
      return {
        xml: payload,
        responseUrl,
        diagnostics: {
          ok: true,
          httpStatus: 200,
          contentType: 'text/html',
          bodyLength: payload.length,
          resolvedFeedUrl: responseUrl,
          payloadKind: 'html_feed',
          errorCode: null,
          errorMessage: null,
          attemptCount: attempt,
        },
      };
    }

    if (remainingDepth <= 0) {
      return null;
    }

    const discoveredFeedUrls = discoverHtmlFeedUrls(payload, responseUrl, 8)
      .filter((candidateUrl) => !seenUrls.has(candidateUrl));
    let emptyXmlCandidate: {
      readonly xml: string;
      readonly responseUrl: string;
      readonly diagnostics: Omit<
        SourceAdmissionFeedReadDiagnostics,
        'itemFragmentCount' | 'entryFragmentCount' | 'extractedLinkCount'
      >;
    } | null = null;

    for (const candidateUrl of discoveredFeedUrls) {
      seenUrls.add(candidateUrl);
      try {
        const response = await fetchFn(candidateUrl);
        const contentType = response.headers.get('content-type');
        if (!response.ok) {
          continue;
        }

        const body = await response.text();
        if (body.trim().length === 0) {
          continue;
        }

        if (isLikelyXmlPayload(contentType, body)) {
          const resolvedFeedUrl = response.url || candidateUrl;
          const fragmentCounts = countFeedEntryFragments(body);
          const diagnostics = {
            ok: true,
            httpStatus: response.status,
            contentType,
            bodyLength: body.length,
            resolvedFeedUrl,
            payloadKind: 'html_feed' as const,
            errorCode: null,
            errorMessage: null,
            attemptCount: attempt,
          };
          if (fragmentCounts.itemFragmentCount + fragmentCounts.entryFragmentCount === 0) {
            emptyXmlCandidate ??= {
              xml: body,
              responseUrl: resolvedFeedUrl,
              diagnostics,
            };
            continue;
          }
          return {
            xml: body,
            responseUrl: resolvedFeedUrl,
            diagnostics,
          };
        }

        const nested = await resolveHtmlFeedPayload(
          body,
          response.url || candidateUrl,
          attempt,
          remainingDepth - 1,
          seenUrls,
        );
        if (nested) {
          return nested;
        }
      } catch {
        continue;
      }
    }

    return emptyXmlCandidate;
  }

  let lastDiagnostics: Omit<
    SourceAdmissionFeedReadDiagnostics,
    'itemFragmentCount' | 'entryFragmentCount' | 'extractedLinkCount'
  > = {
    ok: false,
    httpStatus: null,
    contentType: null,
    bodyLength: null,
    resolvedFeedUrl: null,
    payloadKind: 'unavailable',
    errorCode: 'feed_fetch_error',
    errorMessage: 'Feed fetch did not complete',
    attemptCount: 0,
  };

  for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
    try {
      const response = await fetchFn(source.rssUrl);
      const contentType = response.headers.get('content-type');
      const responseUrl = response.url || source.rssUrl;
      if (!response.ok) {
        lastDiagnostics = {
          ok: false,
          httpStatus: response.status,
          contentType,
          bodyLength: null,
          resolvedFeedUrl: responseUrl,
          payloadKind: 'unavailable',
          errorCode: 'feed_http_error',
          errorMessage: `Feed request failed with status ${response.status}`,
          attemptCount: attempt,
        };
      } else {
        const body = await response.text();
        const bodyLength = body.length;
        if (body.trim().length === 0) {
          lastDiagnostics = {
            ok: false,
            httpStatus: response.status,
            contentType,
            bodyLength,
            resolvedFeedUrl: responseUrl,
            payloadKind: 'empty',
            errorCode: 'feed_empty_payload',
            errorMessage: 'Feed response body was empty',
            attemptCount: attempt,
          };
        } else if (!isLikelyXmlPayload(contentType, body)) {
          const resolvedHtmlFeed = await resolveHtmlFeedPayload(
            body,
            responseUrl,
            attempt,
            MAX_HTML_FEED_DISCOVERY_DEPTH,
          );
          if (resolvedHtmlFeed) {
            return {
              xml: resolvedHtmlFeed.xml,
              responseUrl: resolvedHtmlFeed.responseUrl,
              diagnostics: resolvedHtmlFeed.diagnostics,
            };
          }
          lastDiagnostics = {
            ok: false,
            httpStatus: response.status,
            contentType,
            bodyLength,
            resolvedFeedUrl: responseUrl,
            payloadKind: 'non_xml',
            errorCode: 'feed_non_xml_payload',
            errorMessage: 'Feed response was not parseable XML',
            attemptCount: attempt,
          };
        } else {
          return {
            xml: body,
            responseUrl,
            diagnostics: {
              ok: true,
              httpStatus: response.status,
              contentType,
              bodyLength,
              resolvedFeedUrl: responseUrl,
              payloadKind: 'xml',
              errorCode: null,
              errorMessage: null,
              attemptCount: attempt,
            },
          };
        }
      }
    } catch (error) {
      const classified = classifyFeedReadError(error);
      lastDiagnostics = {
        ok: false,
        httpStatus: null,
        contentType: null,
        bodyLength: null,
        resolvedFeedUrl: null,
        payloadKind: 'unavailable',
        errorCode: classified.errorCode,
        errorMessage: classified.errorMessage,
        attemptCount: attempt,
      };
    }

    if (attempt < attemptCount && retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }
  }

  return {
    xml: null,
    responseUrl: null,
    diagnostics: lastDiagnostics,
  };
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

function canReplaceSampleFailure(
  sample: SourceAdmissionSampleResult,
  remainingCandidateCount: number,
  remainingSampleSlots: number,
): boolean {
  return (
    sample.outcome === 'failed'
    && sample.errorCode === 'quality-too-low'
    && remainingCandidateCount >= remainingSampleSlots
  );
}

function classifySource(
  source: FeedSource,
  criteria: SourceAdmissionCriteria,
  feedRead: SourceAdmissionSourceReport['feedRead'],
  sampledUrls: readonly string[],
  skippedVideoUrls: readonly string[],
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
    if (feedRead.errorCode) {
      reasons.push(feedRead.errorCode);
    } else if (feedRead.payloadKind === 'xml') {
      if (feedRead.itemFragmentCount + feedRead.entryFragmentCount === 0) {
        reasons.push('feed_parse_no_entries');
      } else {
        reasons.push('feed_parse_no_links');
      }
    }
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
    skippedVideoUrls,
    samples,
    lifecycle,
    feedRead,
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

  const feedReadResult = await readFeedXml(fetchFn, source, {
    feedReadAttemptCount: options.feedReadAttemptCount,
    feedReadRetryDelayMs: options.feedReadRetryDelayMs,
  });
  const parseResult = feedReadResult.xml
    ? parseFeedLinksDetailed(
      feedReadResult.xml,
      criteria.sampleSize + REPLACEMENT_SAMPLE_BUFFER,
      source,
      feedReadResult.responseUrl ?? source.rssUrl,
    )
    : {
      links: [],
      itemFragmentCount: 0,
      entryFragmentCount: 0,
      skippedVideoUrls: [],
    };
  const candidateUrls = [...parseResult.links];
  const sampledUrls: string[] = [];
  const samples: SourceAdmissionSampleResult[] = [];

  for (const [index, url] of candidateUrls.entries()) {
    if (sampledUrls.length >= criteria.sampleSize) {
      break;
    }

    try {
      const result = await service.extract(url);
      sampledUrls.push(url);
      samples.push(passSample(result));
    } catch (error) {
      const failureSample = failSample(url, error);
      const remainingCandidateCount = candidateUrls.length - index - 1;
      const remainingSampleSlots = criteria.sampleSize - sampledUrls.length;
      if (canReplaceSampleFailure(failureSample, remainingCandidateCount, remainingSampleSlots)) {
        continue;
      }
      sampledUrls.push(url);
      samples.push(failureSample);
    }
  }

  return classifySource(
    source,
    criteria,
    {
      ...feedReadResult.diagnostics,
      itemFragmentCount: parseResult.itemFragmentCount,
      entryFragmentCount: parseResult.entryFragmentCount,
      extractedLinkCount: sampledUrls.length,
    },
    sampledUrls,
    parseResult.skippedVideoUrls,
    samples,
    lifecycle.snapshot(),
  );
}

export async function buildSourceAdmissionReport(
  options: SourceAdmissionAuditOptions & Pick<SourceAdmissionArtifactOptions, 'cwd' | 'env'> = {},
): Promise<SourceAdmissionReport> {
  const feedSources = resolveConfiguredFeedSources(options);
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
  classifyFeedReadError,
  decodeXmlEntities,
  extractLink,
  extractTagText,
  failSample,
  isLikelyXmlPayload,
  isDirectExecution,
  normalizeNonEmpty,
  parseFeedLinks,
  parseFeedLinksDetailed,
  parseFeedSourcesOverride,
  passSample,
  readFeedXml,
  resolveConfiguredFeedSources,
};
