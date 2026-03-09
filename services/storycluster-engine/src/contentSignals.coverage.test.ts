import { describe, expect, it } from 'vitest';
import { extractTrigger } from './contentSignals';

describe('contentSignals coverage', () => {
  it('returns null for empty trigger candidates and detects exercise phrases', () => {
    expect(extractTrigger('   ')).toBeNull();
    expect(extractTrigger('City agencies run emergency exercises overnight.')).toBe('exercise');
  });
});
