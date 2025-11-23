import { describe, expect, it, vi } from 'vitest';
import { getOrGenerate, hashUrl, type AnalysisStore, type CanonicalAnalysis } from './analysis';

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
      url,
      urlHash,
      summary: 'cached',
      biases: ['b1'],
      counterpoints: ['c1'],
      sentimentScore: 0,
      bias_claim_quote: [],
      justify_bias_claim: [],
      confidence: 0.5,
      timestamp: Date.now() - 1000
    };
    await store.save(existing);
    const generate = vi.fn();

    const { analysis, reused } = await getOrGenerate(url, store, generate as any);

    expect(reused).toBe(true);
    expect(analysis).toEqual(existing);
    expect(generate).not.toHaveBeenCalled();
  });

  it('saves new analysis when missing', async () => {
    const store = new MemoryStore();
    const url = 'https://new.com/article';
    const generate = vi.fn().mockResolvedValue({
      summary: 'new',
      biases: ['b'],
      counterpoints: ['c'],
      sentimentScore: 0.1,
      bias_claim_quote: [],
      justify_bias_claim: [],
      confidence: 0.8
    });

    const { analysis, reused } = await getOrGenerate(url, store, generate);

    expect(reused).toBe(false);
    expect(analysis.url).toBe(url);
    expect(analysis.urlHash).toBe(hashUrl(url));
    expect(await store.getByHash(hashUrl(url))).toEqual(analysis);
  });
});
