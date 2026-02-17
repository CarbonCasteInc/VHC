import {
  ArticleTextCache,
  type CachedArticleText,
  type CachedExtractionFailure,
} from './articleTextCache';
import {
  BACKOFF_BASE_MS,
  assessQuality,
  backoffForAttempt,
  countSentences,
  countWords,
  defaultFallbackExtractor,
  defaultPrimaryExtractor,
  defaultSleep,
  extractTitle,
  isRetryableStatus,
  normalizeWhitespace,
  stripNonContentTags,
  type ArticleTextQualityMetrics,
} from './articleTextExtractors';
import { canonicalizeUrl, urlHash } from './normalize';
import { RemovalLedger } from './removalLedger';
import { SourceLifecycleTracker } from './sourceLifecycle';
import {
  getStarterSourceDomainAllowlist,
  isSourceDomainAllowed,
} from './sourceRegistry';

export type ArticleTextQuality = ArticleTextQualityMetrics;

export interface ArticleTextResult {
  readonly url: string;
  readonly urlHash: string;
  readonly contentHash: string;
  readonly sourceDomain: string;
  readonly title: string;
  readonly text: string;
  readonly extractionMethod: 'article-extractor' | 'html-fallback';
  readonly cacheHit: 'none' | 'urlHash' | 'contentHash';
  readonly attempts: number;
  readonly fetchedAt: number;
  readonly quality: ArticleTextQuality;
}

export type ArticleTextServiceErrorCode =
  | 'invalid-url'
  | 'domain-not-allowed'
  | 'removed'
  | 'fetch-failed'
  | 'quality-too-low';

export class ArticleTextServiceError extends Error {
  readonly code: ArticleTextServiceErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;

  constructor(
    code: ArticleTextServiceErrorCode,
    message: string,
    statusCode: number,
    retryable: boolean,
  ) {
    super(message);
    this.name = 'ArticleTextServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export interface ArticleTextServiceOptions {
  readonly allowlist?: ReadonlySet<string>;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly minCharCount?: number;
  readonly minWordCount?: number;
  readonly minSentenceCount?: number;
  readonly minQualityScore?: number;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly cache?: ArticleTextCache;
  readonly lifecycle?: SourceLifecycleTracker;
  readonly removalLedger?: RemovalLedger;
  readonly primaryExtractor?: (url: string, html: string) => Promise<{ title: string; text: string } | null>;
  readonly fallbackExtractor?: (url: string, html: string) => { title: string; text: string } | null;
}

export const FETCH_TIMEOUT_MS = 12_000;
export const MAX_ATTEMPTS = 3;
export const MIN_CHAR_COUNT = 800;
export const MIN_WORD_COUNT = 160;
export const MIN_SENTENCE_COUNT = 4;
export const MIN_QUALITY_SCORE = 0.7;
export { BACKOFF_BASE_MS };

function toCachedFailure(
  error: ArticleTextServiceError,
  url: string,
  hashedUrl: string,
  failedAt: number,
): CachedExtractionFailure {
  return {
    url,
    urlHash: hashedUrl,
    code: error.code,
    message: error.message,
    statusCode: error.statusCode,
    retryable: error.retryable,
    failedAt,
  };
}

export class ArticleTextService {
  private readonly allowlist: ReadonlySet<string>;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly minCharCount: number;
  private readonly minWordCount: number;
  private readonly minSentenceCount: number;
  private readonly minQualityScore: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache: ArticleTextCache;
  private readonly lifecycle: SourceLifecycleTracker;
  private readonly removalLedger: RemovalLedger;
  private readonly primaryExtractor: (url: string, html: string) => Promise<{ title: string; text: string } | null>;
  private readonly fallbackExtractor: (url: string, html: string) => { title: string; text: string } | null;

  constructor(options: ArticleTextServiceOptions = {}) {
    this.allowlist = options.allowlist ?? getStarterSourceDomainAllowlist();
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.minCharCount = options.minCharCount ?? MIN_CHAR_COUNT;
    this.minWordCount = options.minWordCount ?? MIN_WORD_COUNT;
    this.minSentenceCount = options.minSentenceCount ?? MIN_SENTENCE_COUNT;
    this.minQualityScore = options.minQualityScore ?? MIN_QUALITY_SCORE;
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.cache = options.cache ?? new ArticleTextCache();
    this.lifecycle = options.lifecycle ?? new SourceLifecycleTracker();
    this.removalLedger = options.removalLedger ?? new RemovalLedger();
    this.primaryExtractor = options.primaryExtractor ?? defaultPrimaryExtractor;
    this.fallbackExtractor = options.fallbackExtractor ?? defaultFallbackExtractor;
  }

  async extract(inputUrl: string): Promise<ArticleTextResult> {
    const canonicalUrl = canonicalizeUrl(inputUrl);
    if (!canonicalUrl) {
      throw new ArticleTextServiceError('invalid-url', 'Only valid http/https URLs are supported', 400, false);
    }

    const domain = new URL(canonicalUrl).hostname.toLowerCase();
    if (!isSourceDomainAllowed(domain, this.allowlist)) {
      throw new ArticleTextServiceError('domain-not-allowed', `Domain is not allowlisted: ${domain}`, 403, false);
    }

    const hashedUrl = urlHash(canonicalUrl);
    if (await this.removalLedger.readByUrlHash(hashedUrl)) {
      throw new ArticleTextServiceError('removed', 'Article has been removed from extraction', 410, false);
    }

    const directHit = this.cache.get(hashedUrl);
    if (directHit?.entry.kind === 'success') {
      return { ...directHit.entry.value, cacheHit: 'urlHash', attempts: 0 };
    }

    if (directHit?.entry.kind === 'failure') {
      const failure = directHit.entry.value;
      throw new ArticleTextServiceError(failure.code, failure.message, failure.statusCode, failure.retryable);
    }

    let terminalError: ArticleTextServiceError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      this.lifecycle.recordAttempt(domain);

      try {
        const html = await this.fetchHtml(canonicalUrl);
        const contentHash = this.cache.hashContent(html);

        const contentHit = this.cache.get(hashedUrl, contentHash);
        if (contentHit?.entry.kind === 'success') {
          this.cache.linkUrlToContent(hashedUrl, contentHash);
          this.lifecycle.recordSuccess(domain);
          return {
            ...contentHit.entry.value,
            url: canonicalUrl,
            urlHash: hashedUrl,
            sourceDomain: domain,
            cacheHit: 'contentHash',
            attempts: attempt,
          };
        }

        const extracted = await this.extractWithFallback(canonicalUrl, html);
        const success: CachedArticleText = {
          url: canonicalUrl,
          urlHash: hashedUrl,
          contentHash,
          title: extracted.title,
          text: extracted.text,
          extractionMethod: extracted.method,
          sourceDomain: domain,
          fetchedAt: this.now(),
          quality: extracted.quality,
        };

        this.cache.rememberSuccess(success);
        this.lifecycle.recordSuccess(domain);

        return {
          ...success,
          cacheHit: 'none',
          attempts: attempt,
        };
      } catch (error) {
        const serviceError =
          error instanceof ArticleTextServiceError
            ? error
            : new ArticleTextServiceError(
                'fetch-failed',
                error instanceof Error ? error.message : 'Article fetch failed',
                502,
                true,
              );

        if (serviceError.retryable && attempt < this.maxAttempts) {
          this.lifecycle.recordRetry(domain, serviceError, attempt);
          await this.sleep(backoffForAttempt(attempt));
          continue;
        }

        this.lifecycle.recordFailure(domain, serviceError);
        this.cache.rememberFailure(toCachedFailure(serviceError, canonicalUrl, hashedUrl, this.now()));
        terminalError = serviceError;
        break;
      }
    }

    throw terminalError ?? new ArticleTextServiceError('fetch-failed', 'Article extraction failed', 502, true);
  }

  private async extractWithFallback(url: string, html: string): Promise<{
    method: 'article-extractor' | 'html-fallback';
    title: string;
    text: string;
    quality: ArticleTextQuality;
  }> {
    const primary = await this.primaryExtractor(url, html);
    if (primary) {
      const quality = assessQuality(primary.text, this.minCharCount, this.minWordCount, this.minSentenceCount);
      if (quality.score >= this.minQualityScore) {
        return { method: 'article-extractor', title: primary.title, text: primary.text, quality };
      }
    }

    const fallback = this.fallbackExtractor(url, html);
    if (!fallback) {
      throw new ArticleTextServiceError('quality-too-low', 'Unable to extract readable article text', 422, false);
    }

    const quality = assessQuality(fallback.text, this.minCharCount, this.minWordCount, this.minSentenceCount);
    if (quality.score < this.minQualityScore) {
      throw new ArticleTextServiceError(
        'quality-too-low',
        'Extracted text did not meet strict full-text quality thresholds',
        422,
        false,
      );
    }

    return { method: 'html-fallback', title: fallback.title, text: fallback.text, quality };
  }

  private async fetchHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(url, { signal: controller.signal });
      if (!response.ok) {
        throw new ArticleTextServiceError(
          'fetch-failed',
          `HTTP ${response.status} while fetching article`,
          502,
          isRetryableStatus(response.status),
        );
      }

      return await response.text();
    } catch (error) {
      if (error instanceof ArticleTextServiceError) {
        throw error;
      }

      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      throw new ArticleTextServiceError(
        'fetch-failed',
        isAbort ? 'Article fetch timed out' : error instanceof Error ? error.message : 'Article fetch failed',
        502,
        true,
      );
    /* v8 ignore next 3 */
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const articleTextServiceInternal = {
  assessQuality,
  backoffForAttempt,
  countSentences,
  countWords,
  defaultFallbackExtractor,
  defaultPrimaryExtractor,
  defaultSleep,
  extractTitle,
  isRetryableStatus,
  normalizeWhitespace,
  stripNonContentTags,
};
