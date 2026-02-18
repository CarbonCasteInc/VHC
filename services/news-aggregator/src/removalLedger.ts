import { canonicalizeUrl, urlHash } from './normalize';

export interface RemovalLedgerEntry {
  readonly urlHash: string;
  readonly canonicalUrl: string;
  readonly removedAt: number;
  readonly reason: string;
  readonly removedBy: string | null;
  readonly note: string | null;
}

export interface RemovalLedgerStore {
  get(path: string): Promise<unknown>;
  put(path: string, value: unknown): Promise<void>;
}

export interface RemovalLedgerOptions {
  readonly store?: RemovalLedgerStore;
  readonly now?: () => number;
}

const DEFAULT_REASON = 'removed-by-policy';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function normalizeUrl(inputUrl: string): { canonicalUrl: string; hashedUrl: string } | null {
  const canonicalUrl = canonicalizeUrl(inputUrl);
  if (!canonicalUrl) {
    return null;
  }

  return {
    canonicalUrl,
    hashedUrl: urlHash(canonicalUrl),
  };
}

function parseEntry(value: unknown): RemovalLedgerEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.urlHash !== 'string' ||
    typeof value.canonicalUrl !== 'string' ||
    typeof value.removedAt !== 'number' ||
    typeof value.reason !== 'string'
  ) {
    return null;
  }

  return {
    urlHash: value.urlHash,
    canonicalUrl: value.canonicalUrl,
    removedAt: value.removedAt,
    reason: value.reason,
    removedBy: typeof value.removedBy === 'string' ? value.removedBy : null,
    note: typeof value.note === 'string' ? value.note : null,
  };
}

export function removalLedgerPath(urlHashValue: string): string {
  return `vh/news/removed/${urlHashValue}`;
}

export class InMemoryRemovalLedgerStore implements RemovalLedgerStore {
  private readonly records = new Map<string, unknown>();

  async get(path: string): Promise<unknown> {
    return this.records.get(path) ?? null;
  }

  async put(path: string, value: unknown): Promise<void> {
    this.records.set(path, value);
  }
}

export class RemovalLedger {
  private readonly store: RemovalLedgerStore;
  private readonly now: () => number;

  constructor(options: RemovalLedgerOptions = {}) {
    this.store = options.store ?? new InMemoryRemovalLedgerStore();
    this.now = options.now ?? Date.now;
  }

  async write(
    inputUrl: string,
    reason: string = DEFAULT_REASON,
    metadata: { removedBy?: string; note?: string } = {},
  ): Promise<RemovalLedgerEntry> {
    const normalized = normalizeUrl(inputUrl);
    if (!normalized) {
      throw new Error('Invalid URL for removal ledger');
    }

    const entry: RemovalLedgerEntry = {
      urlHash: normalized.hashedUrl,
      canonicalUrl: normalized.canonicalUrl,
      removedAt: this.now(),
      reason: reason.trim() || DEFAULT_REASON,
      removedBy: metadata.removedBy?.trim() || null,
      note: metadata.note?.trim() || null,
    };

    await this.store.put(removalLedgerPath(entry.urlHash), entry);
    return entry;
  }

  async readByUrlHash(urlHashValue: string): Promise<RemovalLedgerEntry | null> {
    if (!urlHashValue.trim()) {
      return null;
    }

    return parseEntry(await this.store.get(removalLedgerPath(urlHashValue)));
  }

  async readByUrl(inputUrl: string): Promise<RemovalLedgerEntry | null> {
    const normalized = normalizeUrl(inputUrl);
    if (!normalized) {
      return null;
    }

    return this.readByUrlHash(normalized.hashedUrl);
  }

  async isRemoved(inputUrl: string): Promise<boolean> {
    return (await this.readByUrl(inputUrl)) !== null;
  }
}

export const removalLedgerInternal = {
  normalizeUrl,
  parseEntry,
};
