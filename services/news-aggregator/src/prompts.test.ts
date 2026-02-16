import { describe, expect, it } from 'vitest';
import {
  type ArticleAnalysisResult,
  PromptParseError,
  generateArticleAnalysisPrompt,
  generateBundleSynthesisPrompt,
  parseArticleAnalysisResponse,
  parseBundleSynthesisResponse,
} from './prompts';

function makeArticleAnalysis(overrides: Partial<ArticleAnalysisResult> = {}): ArticleAnalysisResult {
  return {
    article_id: 'article-1',
    source_id: 'source-1',
    url: 'https://example.com/a1',
    url_hash: 'hash-1',
    summary: 'Summary from source one',
    bias_claim_quote: ['quote a'],
    justify_bias_claim: ['reason a'],
    biases: ['selection bias'],
    counterpoints: ['counterpoint a'],
    confidence: 0.75,
    perspectives: [{ frame: 'conflict frame', reframe: 'cooperation frame' }],
    analyzed_at: 1700000000000,
    engine: 'test-engine',
    ...overrides,
  };
}

describe('generateArticleAnalysisPrompt', () => {
  it('includes full article text and metadata', () => {
    const prompt = generateArticleAnalysisPrompt(
      'Full article body text goes here.',
      {
        publisher: 'Example News',
        title: 'Example Title',
        url: 'https://example.com/story',
      },
    );

    expect(prompt).toContain('Full article body text goes here.');
    expect(prompt).toContain('Publisher: Example News');
    expect(prompt).toContain('Title: Example Title');
    expect(prompt).toContain('URL: https://example.com/story');
    expect(prompt).toContain('STRICT JSON only');
  });
});

describe('parseArticleAnalysisResponse', () => {
  it('parses valid JSON into ArticleAnalysisResult', () => {
    const raw = JSON.stringify({
      summary: 'This is a summary.',
      bias_claim_quote: ['claim quote'],
      justify_bias_claim: ['because x'],
      biases: ['framing bias'],
      counterpoints: ['counterpoint 1'],
      confidence: 0.9,
      perspectives: [{ frame: 'frame 1', reframe: 'reframe 1' }],
    });

    const result = parseArticleAnalysisResponse(raw, {
      article_id: 'article-9',
      source_id: 'source-9',
      url: 'https://example.com/9',
      url_hash: 'hash-9',
      engine: 'engine-x',
    });

    expect(result.article_id).toBe('article-9');
    expect(result.source_id).toBe('source-9');
    expect(result.url).toBe('https://example.com/9');
    expect(result.url_hash).toBe('hash-9');
    expect(result.summary).toBe('This is a summary.');
    expect(result.confidence).toBe(0.9);
    expect(result.perspectives).toEqual([{ frame: 'frame 1', reframe: 'reframe 1' }]);
    expect(result.engine).toBe('engine-x');
    expect(result.analyzed_at).toBeTypeOf('number');
  });

  it('throws typed error for malformed JSON', () => {
    expect(() =>
      parseArticleAnalysisResponse('{ this is not json', {
        article_id: 'a',
        source_id: 's',
        url: 'https://example.com',
        url_hash: 'h',
        engine: 'e',
      }),
    ).toThrow(PromptParseError);

    try {
      parseArticleAnalysisResponse('{ this is not json', {
        article_id: 'a',
        source_id: 's',
        url: 'https://example.com',
        url_hash: 'h',
        engine: 'e',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PromptParseError);
      expect((error as PromptParseError).kind).toBe('invalid-json');
    }
  });

  it('throws typed error when required fields are missing', () => {
    const raw = JSON.stringify({
      summary: 'missing all arrays and confidence/perspectives',
    });

    expect(() =>
      parseArticleAnalysisResponse(raw, {
        article_id: 'a',
        source_id: 's',
        url: 'https://example.com',
        url_hash: 'h',
        engine: 'e',
      }),
    ).toThrow(PromptParseError);
  });
});

describe('generateBundleSynthesisPrompt', () => {
  it('with 0 analyses includes unavailable instruction', () => {
    const prompt = generateBundleSynthesisPrompt({
      storyId: 'story-0',
      headline: 'No sources headline',
      articleAnalyses: [],
    });

    expect(prompt).toContain('No eligible full-text sources are available for synthesis');
    expect(prompt).toContain('no-eligible-sources');
    expect(prompt).toContain('synthesis_ready');
  });

  it('with 1 analysis includes single-source warning instruction', () => {
    const prompt = generateBundleSynthesisPrompt({
      storyId: 'story-1',
      headline: 'Single source headline',
      articleAnalyses: [
        {
          publisher: 'Only Publisher',
          title: 'Only Title',
          analysis: makeArticleAnalysis(),
        },
      ],
    });

    expect(prompt).toContain('Eligible sources: 1');
    expect(prompt).toContain('single-source-only');
    expect(prompt).toContain('Only Publisher');
  });

  it('with 2+ analyses enumerates all publishers', () => {
    const prompt = generateBundleSynthesisPrompt({
      storyId: 'story-2',
      headline: 'Multi-source headline',
      articleAnalyses: [
        {
          publisher: 'Publisher A',
          title: 'Title A',
          analysis: makeArticleAnalysis({ article_id: 'a1' }),
        },
        {
          publisher: 'Publisher B',
          title: 'Title B',
          analysis: makeArticleAnalysis({ article_id: 'a2', summary: 'Second summary' }),
        },
      ],
    });

    expect(prompt).toContain('Eligible sources: 2');
    expect(prompt).toContain('Publisher A');
    expect(prompt).toContain('Publisher B');
    expect(prompt).toContain('Compare and synthesize across sources');
  });
});

describe('parseBundleSynthesisResponse', () => {
  it('parses valid JSON result with synthesis_ready=true', () => {
    const raw = JSON.stringify({
      summary: 'Combined summary',
      frame_reframe_table: [{ frame: 'frame', reframe: 'reframe' }],
      warnings: [],
      synthesis_ready: true,
    });

    const result = parseBundleSynthesisResponse(raw, 2);

    expect(result.summary).toBe('Combined summary');
    expect(result.frame_reframe_table).toEqual([{ frame: 'frame', reframe: 'reframe' }]);
    expect(result.source_count).toBe(2);
    expect(result.synthesis_ready).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('returns synthesis_ready=false for zero sources', () => {
    const result = parseBundleSynthesisResponse('not-used', 0);

    expect(result.synthesis_ready).toBe(false);
    expect(result.synthesis_unavailable_reason).toBe('no-eligible-sources');
    expect(result.source_count).toBe(0);
    expect(result.frame_reframe_table).toEqual([]);
  });
});
