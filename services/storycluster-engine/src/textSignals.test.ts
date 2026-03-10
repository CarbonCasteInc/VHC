import { describe, expect, it } from 'vitest';
import {
  buildWordShingles,
  cosineSimilarity,
  createHashedVector,
  ensureSentence,
  jaccardSimilarity,
  minhashSignature,
  normalizeText,
  overlapRatio,
  signatureSimilarity,
  splitSentences,
  tokenizeWords,
} from './textSignals';

describe('textSignals', () => {
  it('normalizes and tokenizes text', () => {
    expect(normalizeText('  Héllo, WORLD!  ')).toBe('hello world');
    expect(tokenizeWords('The market is in flux today')).toEqual(['market', 'flux', 'today']);
    expect(tokenizeWords('a b', 2)).toEqual([]);
  });

  it('splits and ensures sentences', () => {
    expect(splitSentences('One. Two? Three!')).toEqual(['One.', 'Two?', 'Three!']);
    expect(ensureSentence('hello world')).toBe('hello world.');
    expect(ensureSentence('')).toBe('Story update available.');
    expect(ensureSentence('Already done.')).toBe('Already done.');
  });

  it('builds shingles and minhash signatures', () => {
    expect(buildWordShingles('Alpha beta gamma')).toEqual(['alpha beta gamma']);
    expect(buildWordShingles('Alpha beta gamma delta epsilon', 2)).toEqual([
      'alpha beta',
      'beta gamma',
      'gamma delta',
      'delta epsilon',
    ]);

    const emptySignature = minhashSignature('', 4);
    const textSignature = minhashSignature('Alpha beta gamma delta', 4);
    expect(emptySignature).toHaveLength(4);
    expect(textSignature).toHaveLength(4);
    expect(signatureSimilarity(textSignature, textSignature)).toBe(1);
    expect(signatureSimilarity([], textSignature)).toBe(0);
  });

  it('creates deterministic vectors and similarity scores', () => {
    const empty = createHashedVector('', 8);
    const tiny = createHashedVector('abc', 8);
    const alpha = createHashedVector('alpha beta gamma', 8);
    const alphaAgain = createHashedVector('alpha beta gamma', 8);
    const beta = createHashedVector('different words entirely', 8);

    expect(empty).toEqual(new Array(8).fill(0));
    expect(tiny).toHaveLength(8);
    expect(alpha).toEqual(alphaAgain);
    expect(cosineSimilarity(alpha, alphaAgain)).toBeCloseTo(1, 6);
    expect(cosineSimilarity(alpha, beta)).toBeLessThan(1);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity(empty, alpha)).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBeGreaterThan(0);
    expect(cosineSimilarity([1], [1, 2])).toBeGreaterThan(0);
  });

  it('computes set overlap metrics', () => {
    expect(jaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 6);
    expect(jaccardSimilarity([], ['b'])).toBe(0);
    expect(overlapRatio(['a', 'b'], ['b'])).toBe(1);
    expect(overlapRatio([], ['b'])).toBe(0);
  });
});
