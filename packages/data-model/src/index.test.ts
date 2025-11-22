import { describe, expect, it } from 'vitest';
import * as index from './index';

describe('data-model index exports', () => {
  it('exposes schemas', () => {
    expect(index.ProfileSchema).toBeDefined();
    expect(index.MessageSchema).toBeDefined();
    expect(index.AnalysisSchema).toBeDefined();
    expect(index.SignalSchema).toBeDefined();
  });
});
