import { describe, expect, it } from 'vitest';
import {
  ArticleTextServiceError,
  type ArticleTextResult,
} from './articleTextService';
import {
  assessItemEligibilityFromError,
  assessItemEligibilityFromResult,
} from './itemEligibilityPolicy';

function makeResult(url: string): ArticleTextResult {
  return {
    url,
    urlHash: 'abcd1234',
    contentHash: 'content',
    sourceDomain: 'example.com',
    title: 'Readable article',
    text: 'Sentence one. Sentence two. Sentence three. Sentence four.',
    extractionMethod: 'article-extractor',
    cacheHit: 'none',
    attempts: 1,
    fetchedAt: 1,
    quality: {
      charCount: 1200,
      wordCount: 200,
      sentenceCount: 8,
      score: 0.95,
    },
  };
}

describe('itemEligibilityPolicy', () => {
  it('marks readable extraction results as analysis eligible', () => {
    expect(assessItemEligibilityFromResult(makeResult('https://example.com/a'))).toEqual({
      url: 'https://example.com/a',
      canonicalUrl: 'https://example.com/a',
      urlHash: 'abcd1234',
      state: 'analysis_eligible',
      reason: 'analysis_eligible',
      retryable: false,
      displayEligible: true,
    });
  });

  it('marks quality misses as link-only', () => {
    const result = assessItemEligibilityFromError(
      'https://example.com/short',
      new ArticleTextServiceError('quality-too-low', 'too short', 422, false),
    );

    expect(result).toMatchObject({
      state: 'link_only',
      reason: 'quality-too-low',
      displayEligible: true,
    });
  });

  it('marks access-denied failures as hard blocked', () => {
    const result = assessItemEligibilityFromError(
      'https://example.com/blocked',
      new ArticleTextServiceError('access-denied', 'blocked', 403, false),
    );

    expect(result).toMatchObject({
      state: 'hard_blocked',
      reason: 'access-denied',
      displayEligible: false,
    });
  });

  it('treats fetch failures as link-only rather than hard blocked', () => {
    const result = assessItemEligibilityFromError(
      'https://example.com/transient',
      new ArticleTextServiceError('fetch-failed', 'timeout', 502, true),
    );

    expect(result).toMatchObject({
      state: 'link_only',
      reason: 'fetch-failed',
      retryable: true,
      displayEligible: true,
    });
  });
});
