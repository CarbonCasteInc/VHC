import { describe, expect, it } from 'vitest';
import { generateAnalysisPrompt, generateOutputFormatReq, shouldUsePreviousPassTemplate } from './prompts';

describe('prompts', () => {
  it('generates output format requirement block', () => {
    const text = generateOutputFormatReq();
    expect(text).toContain('"step_by_step"');
    expect(text).toContain('"final_refined"');
  });

  it('builds analysis prompt with article text', () => {
    const prompt = generateAnalysisPrompt({ articleText: 'Hello world' });
    expect(prompt).toContain('GOALS AND GUIDELINES');
    expect(prompt).toContain('Hello world');
    expect(prompt).not.toContain('SINGLE PREV PASS');
  });

  it('includes previous pass template when requested', () => {
    const prompt = generateAnalysisPrompt({
      articleText: 'Hello world',
      previousPass: {
        summary: 's',
        bias_claim_quote: [],
        justify_bias_claim: [],
        biases: [],
        counterpoints: []
      },
      includePreviousPassTemplate: true,
      previousPassLabel: 'primary',
      thisPassLabel: 'secondary'
    });
    expect(prompt).toContain('SINGLE PREV PASS: secondary');
    expect(prompt).toContain('primary_json.summary');
  });

  it('applies review threshold helper', () => {
    expect(shouldUsePreviousPassTemplate(2, 3)).toBe(false);
    expect(shouldUsePreviousPassTemplate(3, 3)).toBe(true);
  });
});
