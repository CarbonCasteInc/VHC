import { canonicalizeUrl, urlHash } from './normalize';
import type {
  ItemEligibilityAssessment,
  ItemEligibilityReason,
  ItemEligibilityState,
} from './itemEligibilityPolicy';

export interface ItemEligibilityLedgerEntry {
  readonly urlHash: string;
  readonly canonicalUrl: string;
  readonly state: ItemEligibilityState;
  readonly reason: ItemEligibilityReason;
  readonly analysisEligible: boolean;
  readonly displayEligible: boolean;
  readonly recoverable: boolean;
  readonly observationCount: number;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly observedBy: string | null;
  readonly note: string | null;
}

export interface ItemEligibilityLedgerStore {
  get(path: string): Promise<unknown>;
  put(path: string, value: unknown): Promise<void>;
}

export interface ItemEligibilityLedgerOptions {
  readonly store?: ItemEligibilityLedgerStore;
  readonly now?: () => number;
}

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

function parseEntry(value: unknown): ItemEligibilityLedgerEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.urlHash !== 'string'
    || typeof value.canonicalUrl !== 'string'
    || typeof value.state !== 'string'
    || typeof value.reason !== 'string'
    || typeof value.analysisEligible !== 'boolean'
    || typeof value.displayEligible !== 'boolean'
    || typeof value.recoverable !== 'boolean'
    || typeof value.observationCount !== 'number'
    || typeof value.firstSeenAt !== 'number'
    || typeof value.lastSeenAt !== 'number'
  ) {
    return null;
  }

  return {
    urlHash: value.urlHash,
    canonicalUrl: value.canonicalUrl,
    state: value.state as ItemEligibilityState,
    reason: value.reason as ItemEligibilityReason,
    analysisEligible: value.analysisEligible,
    displayEligible: value.displayEligible,
    recoverable: value.recoverable,
    observationCount: value.observationCount,
    firstSeenAt: value.firstSeenAt,
    lastSeenAt: value.lastSeenAt,
    observedBy: typeof value.observedBy === 'string' ? value.observedBy : null,
    note: typeof value.note === 'string' ? value.note : null,
  };
}

export function itemEligibilityLedgerPath(urlHashValue: string): string {
  return `vh/news/item-eligibility/${urlHashValue}`;
}

export class InMemoryItemEligibilityLedgerStore implements ItemEligibilityLedgerStore {
  private readonly records = new Map<string, unknown>();

  async get(path: string): Promise<unknown> {
    return this.records.get(path) ?? null;
  }

  async put(path: string, value: unknown): Promise<void> {
    this.records.set(path, value);
  }
}

export class ItemEligibilityLedger {
  private readonly store: ItemEligibilityLedgerStore;
  private readonly now: () => number;

  constructor(options: ItemEligibilityLedgerOptions = {}) {
    this.store = options.store ?? new InMemoryItemEligibilityLedgerStore();
    this.now = options.now ?? Date.now;
  }

  async writeAssessment(
    assessment: ItemEligibilityAssessment,
    metadata: { observedBy?: string; note?: string } = {},
  ): Promise<ItemEligibilityLedgerEntry | null> {
    if (!assessment.canonicalUrl || !assessment.urlHash) {
      return null;
    }

    const existing = await this.readByUrlHash(assessment.urlHash);
    const observedAt = this.now();
    const entry: ItemEligibilityLedgerEntry = {
      urlHash: assessment.urlHash,
      canonicalUrl: assessment.canonicalUrl,
      state: assessment.state,
      reason: assessment.reason,
      analysisEligible: assessment.state === 'analysis_eligible',
      displayEligible: assessment.displayEligible,
      recoverable: assessment.state === 'link_only',
      observationCount: (existing?.observationCount ?? 0) + 1,
      firstSeenAt: existing?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
      observedBy: metadata.observedBy?.trim() || null,
      note: metadata.note?.trim() || null,
    };

    await this.store.put(itemEligibilityLedgerPath(entry.urlHash), entry);
    return entry;
  }

  async readByUrlHash(urlHashValue: string): Promise<ItemEligibilityLedgerEntry | null> {
    if (!urlHashValue.trim()) {
      return null;
    }

    return parseEntry(await this.store.get(itemEligibilityLedgerPath(urlHashValue)));
  }

  async readByUrl(inputUrl: string): Promise<ItemEligibilityLedgerEntry | null> {
    const normalized = normalizeUrl(inputUrl);
    if (!normalized) {
      return null;
    }

    return this.readByUrlHash(normalized.hashedUrl);
  }
}

export const itemEligibilityLedgerInternal = {
  normalizeUrl,
  parseEntry,
};
