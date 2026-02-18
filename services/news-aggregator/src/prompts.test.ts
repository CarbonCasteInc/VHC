import { describe, expect, it } from 'vitest';
import {
  type ArticleAnalysisResult,
  PromptParseError,
  generateArticleAnalysisPrompt,
  generateBundleSynthesisPrompt,
  parseArticleAnalysisResponse,
  parseBundleSynthesisResponse,
} from './prompts';

const meta = {
  article_id: 'article-1',
  source_id: 'source-1',
  url: 'https://example.com/a1',
  url_hash: 'hash-1',
  engine: 'engine-test',
};

function analysis(overrides: Partial<ArticleAnalysisResult> = {}): ArticleAnalysisResult {
  return {
    article_id: 'article-1',
    source_id: 'source-1',
    url: 'https://example.com/a1',
    url_hash: 'hash-1',
    summary: 'A summary',
    bias_claim_quote: ['quoted claim'],
    justify_bias_claim: ['justification'],
    biases: ['framing bias'],
    counterpoints: ['counterpoint'],
    confidence: 0.8,
    perspectives: [{ frame: 'frame-a', reframe: 'reframe-a' }],
    analyzed_at: 1700000000000,
    engine: 'engine-test',
    ...overrides,
  };
}

describe('generateArticleAnalysisPrompt', () => {
  it('includes article text, metadata, and required markers', () => {
    const prompt = generateArticleAnalysisPrompt('Body text here.', {
      publisher: 'Publisher A',
      title: 'Title A',
      url: 'https://example.com/story',
    });

    expect(prompt).toContain('Publisher: Publisher A');
    expect(prompt).toContain('Title: Title A');
    expect(prompt).toContain('URL: https://example.com/story');
    expect(prompt).toContain('--- ARTICLE START ---');
    expect(prompt).toContain('Body text here.');
    expect(prompt).toContain('--- ARTICLE END ---');
  });
});

describe('parseArticleAnalysisResponse', () => {
  const valid = {
    summary: 'summary text',
    bias_claim_quote: ['quote 1'],
    justify_bias_claim: ['reason 1'],
    biases: ['bias 1'],
    counterpoints: ['counterpoint 1'],
    confidence: 0.7,
    perspectives: [{ frame: 'frame 1', reframe: 'reframe 1' }],
  };

  it('parses valid JSON', () => {
    const result = parseArticleAnalysisResponse(JSON.stringify(valid), meta);
    expect(result.article_id).toBe(meta.article_id);
    expect(result.source_id).toBe(meta.source_id);
    expect(result.url_hash).toBe(meta.url_hash);
    expect(result.summary).toBe(valid.summary);
    expect(result.biases).toEqual(valid.biases);
    expect(result.analyzed_at).toBeTypeOf('number');
  });

  it('parses markdown-fenced JSON', () => {
    const raw = `\`\`\`json\n${JSON.stringify(valid, null, 2)}\n\`\`\``;
    const result = parseArticleAnalysisResponse(raw, meta);
    expect(result.summary).toBe(valid.summary);
    expect(result.justify_bias_claim).toEqual(valid.justify_bias_claim);
  });

  it('throws PromptParseError for garbage input', () => {
    expect(() => parseArticleAnalysisResponse('not json', meta)).toThrow(PromptParseError);
  });

  it('throws PromptParseError when required fields are missing', () => {
    expect(() => parseArticleAnalysisResponse(JSON.stringify({ summary: 'only summary' }), meta)).toThrow(
      PromptParseError,
    );
  });
});

describe('generateBundleSynthesisPrompt', () => {
  it('mentions no eligible sources when empty', () => {
    const prompt = generateBundleSynthesisPrompt({
      storyId: 'story-0',
      headline: 'headline 0',
      articleAnalyses: [],
    });
    expect(prompt).toContain('No eligible full-text sources');
    expect(prompt).toContain('no-eligible-sources');
  });

  it('mentions single-source warning for one analysis', () => {
    const prompt = generateBundleSynthesisPrompt({
      storyId: 'story-1',
      headline: 'headline 1',
      articleAnalyses: [{ publisher: 'Publisher A', title: 'Title A', analysis: analysis() }],
    });
    expect(prompt).toContain('single-source-only');
    expect(prompt).toContain('Publisher A');
  });

  it('enumerates both publishers for 2+ analyses', () => {
    const prompt = generateBundleSynthesisPrompt({
      storyId: 'story-2',
      headline: 'headline 2',
      articleAnalyses: [
        { publisher: 'Publisher A', title: 'Title A', analysis: analysis() },
        { publisher: 'Publisher B', title: 'Title B', analysis: analysis({ summary: 'B summary' }) },
      ],
    });

    expect(prompt).toContain('Publisher A');
    expect(prompt).toContain('Publisher B');
    expect(prompt).toContain('Eligible sources: 2');
  });
});

describe('parseBundleSynthesisResponse', () => {
  it('parses valid JSON for multi-source input', () => {
    const raw = JSON.stringify({
      summary: 'combined summary',
      frame_reframe_table: [{ frame: 'f1', reframe: 'r1' }],
      warnings: [],
      synthesis_ready: true,
    });

    const result = parseBundleSynthesisResponse(raw, 2);
    expect(result.synthesis_ready).toBe(true);
    expect(result.source_count).toBe(2);
    expect(result.frame_reframe_table).toEqual([{ frame: 'f1', reframe: 'r1' }]);
  });

  it('defaults warnings and synthesis_ready when omitted', () => {
    const raw = JSON.stringify({
      summary: 'combined summary',
      frame_reframe_table: [{ frame: 'f1', reframe: 'r1' }],
    });

    const result = parseBundleSynthesisResponse(raw, 2);
    expect(result.warnings).toEqual([]);
    expect(result.synthesis_ready).toBe(true);
  });

  it('forces no-eligible-sources result when sourceCount=0', () => {
    const result = parseBundleSynthesisResponse('anything', 0);
    expect(result.synthesis_ready).toBe(false);
    expect(result.synthesis_unavailable_reason).toBe('no-eligible-sources');
    expect(result.source_count).toBe(0);
  });

  it('adds single-source-only warning when sourceCount=1', () => {
    const raw = JSON.stringify({
      summary: 'single summary',
      frame_reframe_table: [{ frame: 'f1', reframe: 'r1' }],
      warnings: [],
      synthesis_ready: true,
    });

    const result = parseBundleSynthesisResponse(raw, 1);
    expect(result.warnings).toContain('single-source-only');
  });

  it('throws PromptParseError for malformed synthesis payload', () => {
    expect(() => parseBundleSynthesisResponse(JSON.stringify({ summary: 'x' }), 2)).toThrow(PromptParseError);
  });

  it('throws PromptParseError for non-object synthesis payload', () => {
    expect(() => parseBundleSynthesisResponse(JSON.stringify('bad payload'), 2)).toThrow(PromptParseError);
  });
});
