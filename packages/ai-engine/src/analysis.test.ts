import { describe, expect, it, vi } from 'vitest';
import {
  analysisInternal,
  getOrGenerate,
  hashUrl,
  type AnalysisStore,
  type CanonicalAnalysis,
  type GenerateResult,
} from './analysis';

class MemoryStore implements AnalysisStore {
  private items = new Map<string, CanonicalAnalysis>();

  async getByHash(urlHash: string): Promise<CanonicalAnalysis | null> {
    return this.items.get(urlHash) ?? null;
  }

  async save(record: CanonicalAnalysis): Promise<void> {
    this.items.set(record.urlHash, record);
  }

  async listRecent(): Promise<CanonicalAnalysis[]> {
    return Array.from(this.items.values());
  }
}

function buildGenerateResult(overrides: Partial<GenerateResult> = {}): GenerateResult {
  return {
    analysis: {
      summary: 'generated',
      biases: ['bias-1'],
      counterpoints: ['counter-1'],
      bias_claim_quote: [],
      justify_bias_claim: [],
      confidence: 0.8,
    },
    ...overrides,
  };
}

describe('analysis first-to-file', () => {
  it('hashes urls deterministically with canonicalization', async () => {
    const a = await hashUrl('https://Example.com/Path/?b=2&a=1#fragment');
    const b = await hashUrl('https://example.com/Path?a=1&b=2');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });

  it('hashes empty/whitespace consistently', async () => {
    await expect(hashUrl('  ')).resolves.toBe(await hashUrl(''));
  });

  it('produces distinct hashes for near-identical URLs', async () => {
    const one = await hashUrl('https://example.com/article?id=1');
    const two = await hashUrl('https://example.com/article?id=2');
    expect(one).not.toBe(two);
  });

  it('normalizes default ports and duplicate query keys deterministically', async () => {
    const httpWithPort = await hashUrl('HTTP://Example.com:80/path?x=2&x=1');
    const httpWithoutPort = await hashUrl('http://example.com/path?x=1&x=2');
    expect(httpWithPort).toBe(httpWithoutPort);

    const httpsWithPort = await hashUrl('https://example.com:443/path?x=2&x=1');
    const httpsWithoutPort = await hashUrl('https://example.com/path?x=1&x=2');
    expect(httpsWithPort).toBe(httpsWithoutPort);
  });

  it('normalizes trailing multi-slash paths to root slash', async () => {
    const root = await hashUrl('https://example.com/');
    const multiSlash = await hashUrl('https://example.com////');
    expect(multiSlash).toBe(root);
  });

  it('falls back to lower-cased trimmed input when URL parsing fails', () => {
    expect(analysisInternal.normalizeUrlForHash('  %%%BAD%%%  ')).toBe('%%%bad%%%');
  });

  it('throws when SubtleCrypto is unavailable', async () => {
    const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: undefined },
      configurable: true,
    });

    try {
      await expect(hashUrl('https://example.com')).rejects.toThrow('SubtleCrypto is unavailable for URL hashing');
    } finally {
      if (originalCryptoDescriptor) {
        Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
      } else {
        delete (globalThis as { crypto?: unknown }).crypto;
      }
    }
  });

  it('returns existing analysis without regenerating', async () => {
    const store = new MemoryStore();
    const url = 'https://example.com/post';
    const urlHash = await hashUrl(url);
    const existing: CanonicalAnalysis = {
      schemaVersion: 'canonical-analysis-v1',
      url,
      urlHash,
      summary: 'cached',
      biases: ['b1'],
      counterpoints: ['c1'],
      bias_claim_quote: [],
      justify_bias_claim: [],
      confidence: 0.5,
      timestamp: Date.now() - 1000,
    };
    await store.save(existing);
    const generate = vi.fn(async (_targetUrl: string): Promise<GenerateResult> => buildGenerateResult());

    const { analysis, reused } = await getOrGenerate(url, store, generate);

    expect(reused).toBe(true);
    expect(analysis).toEqual(existing);
    expect(generate).not.toHaveBeenCalled();
  });

  it('saves new analysis with v1 schema version', async () => {
    const store = new MemoryStore();
    const url = 'https://new.com/article';
    const generate = vi.fn().mockResolvedValue(buildGenerateResult());

    const { analysis, reused } = await getOrGenerate(url, store, generate);

    expect(reused).toBe(false);
    expect(analysis.url).toBe(url);
    expect(analysis.urlHash).toBe(await hashUrl(url));
    expect(analysis.schemaVersion).toBe('canonical-analysis-v1');
    expect(analysis.engine).toBeUndefined();
    expect(analysis.warnings).toBeUndefined();
    expect(await store.getByHash(await hashUrl(url))).toEqual(analysis);
  });

  it('flows engine metadata and warnings into canonical record', async () => {
    const store = new MemoryStore();
    const url = 'https://meta.com/article';
    const generate = vi.fn().mockResolvedValue(
      buildGenerateResult({
        engine: { id: 'mock-local-engine', kind: 'local', modelName: 'mock-local-v1' },
        warnings: ['Summary mentions year 2099 not in source'],
      }),
    );

    const { analysis, reused } = await getOrGenerate(url, store, generate);

    expect(reused).toBe(false);
    expect(analysis.engine).toEqual({
      id: 'mock-local-engine',
      kind: 'local',
      modelName: 'mock-local-v1',
    });
    expect(analysis.warnings).toEqual(['Summary mentions year 2099 not in source']);
  });
});
