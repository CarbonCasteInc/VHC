import { describe, expect, it, vi } from 'vitest';
import {
  getOrGenerate,
  hashUrl,
  type AnalysisStore,
  type CanonicalAnalysis,
  type GenerateResult
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
      confidence: 0.8
    },
    ...overrides
  };
}

describe('analysis first-to-file', () => {
  it('hashes urls deterministically', () => {
    const a = hashUrl('https://Example.com/Path');
    const b = hashUrl('https://example.com/path');
    expect(a).toBe(b);
  });

  it('hashes empty/whitespace consistently', () => {
    expect(hashUrl('  ')).toBe(hashUrl(''));
  });

  it('returns existing analysis without regenerating', async () => {
    const store = new MemoryStore();
    const url = 'https://example.com/post';
    const urlHash = hashUrl(url);
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
      timestamp: Date.now() - 1000
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
    expect(analysis.urlHash).toBe(hashUrl(url));
    expect(analysis.schemaVersion).toBe('canonical-analysis-v1');
    expect(analysis.engine).toBeUndefined();
    expect(analysis.warnings).toBeUndefined();
    expect(await store.getByHash(hashUrl(url))).toEqual(analysis);
  });

  it('flows engine metadata and warnings into canonical record', async () => {
    const store = new MemoryStore();
    const url = 'https://meta.com/article';
    const generate = vi.fn().mockResolvedValue(
      buildGenerateResult({
        engine: { id: 'mock-local-engine', kind: 'local', modelName: 'mock-local-v1' },
        warnings: ['Summary mentions year 2099 not in source']
      })
    );

    const { analysis, reused } = await getOrGenerate(url, store, generate);

    expect(reused).toBe(false);
    expect(analysis.engine).toEqual({
      id: 'mock-local-engine',
      kind: 'local',
      modelName: 'mock-local-v1'
    });
    expect(analysis.warnings).toEqual(['Summary mentions year 2099 not in source']);
  });
});
