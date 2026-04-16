import { describe, expect, it } from 'vitest';
import {
  generateAnalysisPrompt,
  generateFrameReframePrompt,
  generateOutputFormatReq,
  shouldUsePreviousPassTemplate
} from './prompts';

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
    expect(prompt).toContain('"perspectives"');
    expect(prompt).toContain('Always Produce Debate Rows');
    expect(prompt).toContain('Never leave perspectives empty');
    expect(prompt).toContain('commonly held disagreements around the issue');
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

  it('builds frame/reframe prompt with required sections', () => {
    const text = 'Frame and Reframe body';
    const prompt = generateFrameReframePrompt(text);
    expect(prompt).toContain('Frame and Reframe');
    expect(prompt).toContain('"frame"');
    expect(prompt).toContain('"reframe"');
    expect(prompt).toContain('Produce 2-4 frame/reframe pairs');
    expect(prompt).toContain('Never return N/A');
    expect(prompt).toContain(text);
  });
});
