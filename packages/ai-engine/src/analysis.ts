import type { AnalysisResult } from './schema';

export interface EngineMetadata {
  id: string;
  kind: 'remote' | 'local';
  modelName: string;
}

export interface CanonicalAnalysis extends AnalysisResult {
  schemaVersion: 'canonical-analysis-v1';
  url: string;
  urlHash: string;
  timestamp: number;
  engine?: EngineMetadata;
  warnings?: string[];
}

export interface GenerateResult {
  analysis: AnalysisResult;
  engine?: EngineMetadata;
  warnings?: string[];
}

export interface AnalysisStore {
  getByHash(urlHash: string): Promise<CanonicalAnalysis | null>;
  save(record: CanonicalAnalysis): Promise<void>;
  listRecent(limit?: number): Promise<CanonicalAnalysis[]>;
}

const textEncoder = new TextEncoder();
const URL_WITH_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeUrlForHash(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  const candidate = URL_WITH_SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
  const hadExplicitDefaultPort = /^https?:\/\/[^/?#]+:(?:80|443)(?=[/?#]|$)/i.test(candidate);

  try {
    const parsed = new URL(candidate);
    parsed.hash = '';
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    if (hadExplicitDefaultPort && (parsed.protocol === 'https:' || parsed.protocol === 'http:')) {
      parsed.port = '';
    }

    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    }

    const sortedEntries = Array.from(parsed.searchParams.entries()).sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey === bKey) {
        return aValue.localeCompare(bValue);
      }
      return aKey.localeCompare(bKey);
    });

    parsed.search = '';
    if (sortedEntries.length > 0) {
      const sortedParams = new URLSearchParams(sortedEntries);
      parsed.search = `?${sortedParams.toString()}`;
    }

    return parsed.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Canonical analysis key for URL-based first-to-file flow.
 *
 * 2026-02-21 migration: switched from 32-bit FNV-1a to SHA-256 (16 hex prefix)
 * for significantly lower collision risk.
 */
export async function hashUrl(url: string): Promise<string> {
  const normalized = normalizeUrlForHash(url);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('SubtleCrypto is unavailable for URL hashing');
  }

  const digest = await subtle.digest('SHA-256', textEncoder.encode(normalized));
  return toHex(digest).slice(0, 16);
}

export async function getOrGenerate(
  url: string,
  store: AnalysisStore,
  generate: (url: string) => Promise<GenerateResult>
): Promise<{ analysis: CanonicalAnalysis; reused: boolean }> {
  const urlHash = await hashUrl(url);
  const existing = await store.getByHash(urlHash);
  if (existing) {
    return { analysis: existing, reused: true };
  }

  const result = await generate(url);
  const canonical: CanonicalAnalysis = {
    ...result.analysis,
    schemaVersion: 'canonical-analysis-v1',
    url,
    urlHash,
    timestamp: Date.now(),
    ...(result.engine ? { engine: result.engine } : {}),
    ...(result.warnings ? { warnings: result.warnings } : {})
  };

  await store.save(canonical);
  return { analysis: canonical, reused: false };
}

export const analysisInternal = {
  normalizeUrlForHash,
};
