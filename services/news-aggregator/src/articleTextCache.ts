import { createHash } from 'node:crypto';

export interface CachedArticleText {
  readonly url: string;
  readonly urlHash: string;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly extractionMethod: 'article-extractor' | 'html-fallback';
  readonly fetchedAt: number;
  readonly quality: {
    readonly charCount: number;
    readonly wordCount: number;
    readonly sentenceCount: number;
    readonly score: number;
  };
  readonly sourceDomain: string;
}

export interface CachedExtractionFailure {
  readonly url: string;
  readonly urlHash: string;
  readonly code:
    | 'invalid-url'
    | 'domain-not-allowed'
    | 'removed'
    | 'fetch-failed'
    | 'quality-too-low';
  readonly message: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly failedAt: number;
}

export type ArticleTextCacheEntry =
  | { readonly kind: 'success'; readonly value: CachedArticleText }
  | { readonly kind: 'failure'; readonly value: CachedExtractionFailure };

export type ArticleTextCacheHit = {
  readonly keyType: 'urlHash' | 'contentHash';
  readonly entry: ArticleTextCacheEntry;
};

export interface ArticleTextCacheOptions {
  readonly now?: () => number;
  readonly successTtlMs?: number;
  readonly failureTtlMs?: number;
}

interface CacheRecord {
  readonly expiresAt: number;
  readonly entry: ArticleTextCacheEntry;
}

export const SUCCESS_TTL_MS = 10 * 60 * 1000;
export const FAILURE_TTL_MS = 90 * 1000;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export class ArticleTextCache {
  private readonly now: () => number;
  private readonly successTtlMs: number;
  private readonly failureTtlMs: number;
  private readonly byUrlHash = new Map<string, CacheRecord>();
  private readonly byContentHash = new Map<string, CacheRecord>();

  constructor(options: ArticleTextCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.successTtlMs = options.successTtlMs ?? SUCCESS_TTL_MS;
    this.failureTtlMs = options.failureTtlMs ?? FAILURE_TTL_MS;
  }

  hashContent(content: string): string {
    return sha256Hex(content);
  }

  get(urlHash: string, contentHash?: string): ArticleTextCacheHit | null {
    const byUrl = this.readRecord(this.byUrlHash, urlHash);
    if (byUrl) {
      return { keyType: 'urlHash', entry: byUrl.entry };
    }

    if (!contentHash) {
      return null;
    }

    const byContent = this.readRecord(this.byContentHash, contentHash);
    if (!byContent) {
      return null;
    }

    return { keyType: 'contentHash', entry: byContent.entry };
  }

  rememberSuccess(value: CachedArticleText): void {
    const record: CacheRecord = {
      expiresAt: this.now() + this.successTtlMs,
      entry: { kind: 'success', value },
    };

    this.byUrlHash.set(value.urlHash, record);
    this.byContentHash.set(value.contentHash, record);
  }

  rememberFailure(value: CachedExtractionFailure): void {
    const record: CacheRecord = {
      expiresAt: this.now() + this.failureTtlMs,
      entry: { kind: 'failure', value },
    };

    this.byUrlHash.set(value.urlHash, record);
  }

  linkUrlToContent(urlHash: string, contentHash: string): boolean {
    const record = this.readRecord(this.byContentHash, contentHash);
    if (!record || record.entry.kind !== 'success') {
      return false;
    }

    this.byUrlHash.set(urlHash, record);
    return true;
  }

  snapshotSizes(): { readonly urlEntries: number; readonly contentEntries: number } {
    this.clearExpired();
    return {
      urlEntries: this.byUrlHash.size,
      contentEntries: this.byContentHash.size,
    };
  }

  clearExpired(): void {
    for (const [key, value] of this.byUrlHash.entries()) {
      if (value.expiresAt <= this.now()) {
        this.byUrlHash.delete(key);
      }
    }

    for (const [key, value] of this.byContentHash.entries()) {
      if (value.expiresAt <= this.now()) {
        this.byContentHash.delete(key);
      }
    }
  }

  private readRecord(map: Map<string, CacheRecord>, key: string): CacheRecord | null {
    const record = map.get(key);
    if (!record) {
      return null;
    }

    if (record.expiresAt <= this.now()) {
      map.delete(key);
      return null;
    }

    return record;
  }
}

export const articleTextCacheInternal = {
  sha256Hex,
};
