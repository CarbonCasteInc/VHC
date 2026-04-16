import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import {
  __resetNewsCardAnalysisCacheForTests,
  newsCardAnalysisInternal,
  synthesizeStoryFromAnalysisPipeline,
} from './newsCardAnalysis';
import type { AnalysisResult } from '../../../../../packages/ai-engine/src/schema';
import * as DevModelPickerModule from '../dev/DevModelPicker';

const NOW = 1_700_000_000_000;

function makeStoryBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-analysis-1',
    topic_id: 'topic-news',
    headline: 'Transit overhaul advances in committee vote',
    summary_hint: 'Committee approved a phased transit overhaul.',
    cluster_window_start: NOW - 60_000,
    cluster_window_end: NOW,
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Publisher One',
        url: 'https://example.com/1',
        url_hash: 'hash-1',
        published_at: NOW - 3_000,
        title: 'Transit overhaul clears first hurdle',
      },
      {
        source_id: 'source-2',
        publisher: 'Publisher Two',
        url: 'https://example.com/2',
        url_hash: 'hash-2',
        published_at: NOW - 2_000,
        title: 'Lawmakers split on transit rollout speed',
      },
      {
        source_id: 'source-3',
        publisher: 'Publisher Three',
        url: 'https://example.com/3',
        url_hash: 'hash-3',
        published_at: NOW - 1_000,
        title: 'Transit package debated over costs',
      },
      {
        source_id: 'source-4',
        publisher: 'Publisher Four',
        url: 'https://example.com/4',
        url_hash: 'hash-4',
        published_at: NOW - 500,
        title: 'Transit bill enters final committee stage',
      },
    ],
    cluster_features: {
      entity_keys: ['transit', 'committee'],
      time_bucket: '2026-02-16T14',
      semantic_signature: 'sig-news',
    },
    provenance_hash: 'prov-analysis-1',
    created_at: NOW,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<{
  summary: string;
  biases: string[];
  counterpoints: string[];
  perspectives: Array<{ frame: string; reframe: string }>;
}> = {}) {
  return {
    summary: 'A concise factual summary. Another sentence.',
    bias_claim_quote: ['quote'],
    justify_bias_claim: ['justification'],
    biases: ['Bias statement'],
    counterpoints: ['Counterpoint statement'],
    perspectives: [],
    sentimentScore: 0.1,
    confidence: 0.8,
    ...overrides,
  };
}

describe('newsCardAnalysis', () => {
  beforeEach(() => {
    __resetNewsCardAnalysisCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('analyzes at most 3 sources and synthesizes summary + frame rows', async () => {
    const story = makeStoryBundle();
    const runAnalysis = async (articleText: string) => {
      if (articleText.includes('ARTICLE BODY 1')) {
        return {
          analysis: makeAnalysis({
            summary: 'Publisher One says rollout should move fast. More context.',
            biases: ['Urgency justifies immediate funding.'],
            counterpoints: ['Fiscal safeguards should gate spending.'],
          }),
        };
      }

      if (articleText.includes('ARTICLE BODY 2')) {
        return {
          analysis: makeAnalysis({
            summary: 'Publisher Two focuses on budget risk.',
            biases: ['Costs are spiraling beyond control.'],
            counterpoints: ['Phasing can cap exposure while expanding service.'],
          }),
        };
      }

      return {
        analysis: makeAnalysis({
          summary: 'Publisher Three emphasizes implementation details.',
          biases: ['Operational complexity will stall delivery.'],
          counterpoints: ['Existing transit authority can absorb phased changes.'],
        }),
      };
    };

    const runSpyCalls: string[] = [];
    const wrappedRunAnalysis = async (articleText: string) => {
      runSpyCalls.push(articleText);
      return runAnalysis(articleText);
    };

    const fetchArticleTextCalls: string[] = [];
    const fetchArticleText = async (url: string) => {
      fetchArticleTextCalls.push(url);
      if (url.endsWith('/1')) {
        return 'ARTICLE BODY 1';
      }
      if (url.endsWith('/2')) {
        return 'ARTICLE BODY 2';
      }
      return 'ARTICLE BODY 3';
    };

    const result = await synthesizeStoryFromAnalysisPipeline(story, {
      runAnalysis: wrappedRunAnalysis,
      fetchArticleText,
    });

    expect(fetchArticleTextCalls).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ]);
    expect(runSpyCalls).toHaveLength(3);
    expect(runSpyCalls[0]).toContain('ARTICLE BODY 1');
    expect(runSpyCalls[1]).toContain('ARTICLE BODY 2');
    expect(runSpyCalls[2]).toContain('ARTICLE BODY 3');
    expect(result.summary).toContain('Rollout should move fast.');
    expect(result.summary).toContain('Budget risk.');
    expect(result.summary).toContain('Implementation details.');
    expect(result.summary).not.toContain('Publisher One:');
    expect(result.summary).not.toContain('Publisher Two:');
    expect(result.summary).not.toContain('Publisher Three:');
    expect(result.relatedLinks).toEqual([]);

    expect(result.frames).toEqual([
      {
        frame: 'Publisher One: Urgency justifies immediate funding.',
        reframe: 'Fiscal safeguards should gate spending.',
      },
      {
        frame: 'Publisher Two: Costs are spiraling beyond control.',
        reframe: 'Phasing can cap exposure while expanding service.',
      },
      {
        frame: 'Publisher Three: Operational complexity will stall delivery.',
        reframe: 'Existing transit authority can absorb phased changes.',
      },
    ]);
  });

  it('keeps synthesized summaries publication-neutral', () => {
    const summary = newsCardAnalysisInternal.synthesizeSummary([
      {
        source_id: 'source-1',
        publisher: 'Publisher One',
        url: 'https://example.com/1',
        summary: 'Publisher One: Officials approved the pilot.',
        biases: [],
        counterpoints: [],
        biasClaimQuotes: [],
        justifyBiasClaims: [],
      },
      {
        source_id: 'source-2',
        publisher: 'Publisher Two',
        url: 'https://example.com/2',
        summary: 'Publisher Two reports transit crews will add weekend service.',
        biases: [],
        counterpoints: [],
        biasClaimQuotes: [],
        justifyBiasClaims: [],
      },
    ]);

    expect(summary).toBe('Officials approved the pilot. Transit crews will add weekend service.');
    expect(summary).not.toContain('Publisher One:');
    expect(summary).not.toContain('Publisher Two reports');
    expect(newsCardAnalysisInternal.sanitizePublicationNeutralSummary(
      'cbs-politics: Emergency talks began. guardian-us: Mediators convened.',
      ['cbs-politics', 'guardian-us'],
    )).toBe('Emergency talks began. Mediators convened.');
    expect(newsCardAnalysisInternal.sanitizePublicationNeutralSummary(
      'COVID-19: health officials updated school guidance.',
      ['cbs-politics'],
    )).toBe('COVID-19: health officials updated school guidance.');
  });

  it('uses model-scoped cache key derivation', () => {
    const story = makeStoryBundle();

    const modelOverrideSpy = vi
      .spyOn(DevModelPickerModule, 'getDevModelOverride')
      .mockReturnValue(null);

    const defaultScope = newsCardAnalysisInternal.getAnalysisModelScopeKey();
    const defaultKey = newsCardAnalysisInternal.toStoryCacheKey(story);

    modelOverrideSpy.mockReturnValue('gpt-4o');
    const overriddenScope = newsCardAnalysisInternal.getAnalysisModelScopeKey();
    const overriddenKey = newsCardAnalysisInternal.toStoryCacheKey(story);

    expect(defaultScope).toBe('model:default');
    expect(overriddenScope).toBe('model:gpt-4o');
    expect(defaultKey).not.toBe(overriddenKey);
  });

  it('limits relay runtime analysis fan-out by default and honors valid override', () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');

    expect(newsCardAnalysisInternal.getRuntimeMaxSourceAnalyses()).toBe(1);

    vi.stubEnv('VITE_VH_ANALYSIS_MAX_SOURCE_ANALYSES', '2');
    expect(newsCardAnalysisInternal.getRuntimeMaxSourceAnalyses()).toBe(2);

    vi.stubEnv('VITE_VH_ANALYSIS_MAX_SOURCE_ANALYSES', '99');
    expect(newsCardAnalysisInternal.getRuntimeMaxSourceAnalyses()).toBe(3);

    vi.stubEnv('VITE_VH_ANALYSIS_MAX_SOURCE_ANALYSES', 'not-a-number');
    expect(newsCardAnalysisInternal.getRuntimeMaxSourceAnalyses()).toBe(1);
  });

  it('keeps full source fan-out when relay pipeline is disabled', () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'false');
    vi.stubEnv('VITE_VH_ANALYSIS_MAX_SOURCE_ANALYSES', '1');

    expect(newsCardAnalysisInternal.getRuntimeMaxSourceAnalyses()).toBe(3);
  });

  it('includes source/article metadata in analysis input payload', () => {
    const story = makeStoryBundle();
    const input = newsCardAnalysisInternal.buildAnalysisInput(
      story,
      story.sources[0]!,
      'FULL ARTICLE TEXT',
    );

    expect(input).toContain('Publisher: Publisher One');
    expect(input).toContain('Article title: Transit overhaul clears first hurdle');
    expect(input).toContain('Article URL: https://example.com/1');
    expect(input).toContain('Story headline: Transit overhaul advances in committee vote');
    expect(input).toContain('Bundle summary hint: Committee approved a phased transit overhaul.');
    expect(input).toContain('ARTICLE BODY:');
    expect(input).toContain('FULL ARTICLE TEXT');
  });

  it('skips sources whose article text cannot be fetched', async () => {
    const baseStory = makeStoryBundle();
    const story = makeStoryBundle({
      sources: [baseStory.sources[0]!, baseStory.sources[1]!],
    });

    const analysisInputs: string[] = [];

    const result = await synthesizeStoryFromAnalysisPipeline(story, {
      fetchArticleText: async (url: string) => {
        if (url.endsWith('/1')) {
          throw new Error('fetch blocked');
        }
        return 'ARTICLE BODY 2';
      },
      runAnalysis: async (articleText: string) => {
        analysisInputs.push(articleText);
        return {
          analysis: makeAnalysis({
            summary: 'Only fetched article text is analyzed.',
            biases: ['No clear bias detected'],
            counterpoints: ['N/A'],
          }),
        };
      },
    });

    expect(analysisInputs).toHaveLength(1);
    expect(analysisInputs[0]).toContain('ARTICLE BODY 2');
    expect(result.summary).toContain('Only fetched article text is analyzed.');
    expect(result.summary).not.toContain('Publisher One');
    expect(result.relatedLinks).toEqual([
      {
        source_id: 'source-1',
        publisher: 'Publisher One',
        url: 'https://example.com/1',
        url_hash: 'hash-1',
        title: 'Transit overhaul clears first hurdle',
      },
    ]);
  });

  it('does not run source analysis when article-text fetching is disabled', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_SKIP_ARTICLE_TEXT', 'true');
    const story = makeStoryBundle({
      sources: [makeStoryBundle().sources[0]!],
    });
    const fetchArticleText = vi.fn(async () => 'UNUSED ARTICLE TEXT');
    const runAnalysis = vi.fn(async (_articleText: string) => ({
      analysis: makeAnalysis({
        summary: 'Should not run.',
        biases: ['Metadata bias'],
        counterpoints: ['Metadata counterpoint'],
      }),
    }));

    await expect(synthesizeStoryFromAnalysisPipeline(story, {
      fetchArticleText,
      runAnalysis,
    })).rejects.toThrow('Analysis pipeline unavailable for all story sources');

    expect(newsCardAnalysisInternal.shouldSkipArticleTextFetch()).toBe(true);
    expect(fetchArticleText).not.toHaveBeenCalled();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it('throws when all source analyses fail', async () => {
    const story = makeStoryBundle();

    await expect(
      synthesizeStoryFromAnalysisPipeline(story, {
        fetchArticleText: async () => {
          throw new Error('fetch blocked');
        },
        runAnalysis: async () => {
          throw new Error('engine offline');
        },
      }),
    ).rejects.toThrow('Analysis pipeline unavailable for all story sources');
  });

  it('threads biasClaimQuotes and justifyBiasClaims from analysis result', async () => {
    const story = makeStoryBundle({
      sources: [makeStoryBundle().sources[0]!],
    });

    const result = await synthesizeStoryFromAnalysisPipeline(story, {
      fetchArticleText: async () => 'ARTICLE TEXT',
      runAnalysis: async () => ({
        analysis: makeAnalysis({
          summary: 'Summary with claim quotes.',
          biases: ['Bias A'],
          counterpoints: ['Counter A'],
        }),
      }),
    });

    expect(result.analyses).toHaveLength(1);
    expect(result.analyses[0]!.biasClaimQuotes).toEqual(['quote']);
    expect(result.analyses[0]!.justifyBiasClaims).toEqual(['justification']);
  });

  it('prefers explicit perspective rows over legacy bias fallback rows', () => {
    const rows = newsCardAnalysisInternal.toFrameRows([
      {
        source_id: 'source-1',
        publisher: 'Publisher One',
        url: 'https://example.com/1',
        summary: 'Summary.',
        biases: ['No clear bias detected'],
        counterpoints: ['N/A'],
        biasClaimQuotes: ['N/A'],
        justifyBiasClaims: ['N/A'],
        perspectives: [
          {
            frame: 'Public safety requires faster intervention.',
            reframe: 'Civil liberties require stricter limits on intervention.',
          },
          {
            frame: 'Institutional accountability depends on transparent enforcement.',
            reframe: 'Operational flexibility depends on limiting premature disclosure.',
          },
        ],
      },
    ]);

    expect(rows).toEqual([
      {
        frame: 'Public safety requires faster intervention.',
        reframe: 'Civil liberties require stricter limits on intervention.',
      },
      {
        frame: 'Institutional accountability depends on transparent enforcement.',
        reframe: 'Operational flexibility depends on limiting premature disclosure.',
      },
    ]);
    expect(rows[0]!.frame).not.toContain('Publisher One');
    expect(rows[0]!.frame).not.toContain('No clear bias detected');
  });

  it('falls back to legacy bias rows when explicit perspectives are unavailable', () => {
    const rows = newsCardAnalysisInternal.toFrameRows([
      {
        source_id: 'source-1',
        publisher: 'Publisher One',
        url: 'https://example.com/1',
        summary: 'Summary.',
        biases: ['Urgency justifies immediate action.'],
        counterpoints: ['Verification should precede irreversible action.'],
        biasClaimQuotes: ['quote'],
        justifyBiasClaims: ['reason'],
      },
    ]);

    expect(rows).toEqual([
      {
        frame: 'Publisher One: Urgency justifies immediate action.',
        reframe: 'Verification should precede irreversible action.',
      },
    ]);
  });

  it('toSourceAnalysis maps bias_claim_quote and justify_bias_claim', () => {
    const source = makeStoryBundle().sources[0]!;
    const analysis: AnalysisResult = {
      summary: 'Test summary.',
      bias_claim_quote: ['quote-1', 'quote-2'],
      justify_bias_claim: ['just-1'],
      biases: ['B1'],
      counterpoints: ['C1'],
      perspectives: [{ frame: 'F1', reframe: 'R1' }],
    };

    const mapped = newsCardAnalysisInternal.toSourceAnalysis(source, analysis);
    expect(mapped.biasClaimQuotes).toEqual(['quote-1', 'quote-2']);
    expect(mapped.justifyBiasClaims).toEqual(['just-1']);
    expect(mapped.biases).toEqual(['B1']);
    expect(mapped.counterpoints).toEqual(['C1']);
    expect(mapped.perspectives).toEqual([{ frame: 'F1', reframe: 'R1' }]);
  });

  describe('runAnalysisViaRelay model threading', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          analysis: makeAnalysis({ summary: 'Relay result.' }),
        }),
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('includes model in request body when dev override is set', async () => {
      vi.spyOn(DevModelPickerModule, 'getDevModelOverride').mockReturnValue('gpt-4o');
      await newsCardAnalysisInternal.runAnalysisViaRelay('test text');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('gpt-4o');
      expect(body.articleText).toBe('test text');
    });

    it('omits model field when no dev override is set', async () => {
      vi.spyOn(DevModelPickerModule, 'getDevModelOverride').mockReturnValue(null);
      await newsCardAnalysisInternal.runAnalysisViaRelay('test text');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body).not.toHaveProperty('model');
      expect(body.articleText).toBe('test text');
    });
  });
});
