import { describe, expect, it } from 'vitest';
import {
  buildBundlePrompt,
  generateBundleSynthesisPrompt,
  type BundleSynthesisResult,
} from './bundlePrompts';
import type { StoryBundleInputCandidate } from './newsTypes';

describe('bundlePrompts', () => {
  const sampleBundle = {
    headline: 'Markets rally after policy announcement',
    sources: [
      {
        publisher: 'Fox News',
        title: 'Markets surge on policy news',
        url: 'https://example.com/fox',
      },
      {
        publisher: 'The Guardian',
        title: 'Policy drives market gains',
        url: 'https://example.com/guardian',
      },
      {
        publisher: 'BBC News',
        title: 'Global markets up on policy shift',
        url: 'https://example.com/bbc',
      },
    ],
    summary_hint: 'A policy announcement triggered market rallies worldwide.',
    verification_confidence: 0.85,
  };

  describe('generateBundleSynthesisPrompt', () => {
    it('returns a non-empty prompt string', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('includes all source publishers', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt).toContain('Fox News');
      expect(prompt).toContain('The Guardian');
      expect(prompt).toContain('BBC News');
    });

    it('includes source URLs for transparency', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt).toContain('https://example.com/fox');
      expect(prompt).toContain('https://example.com/guardian');
      expect(prompt).toContain('https://example.com/bbc');
    });

    it('includes the headline', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt).toContain('Markets rally after policy announcement');
    });

    it('includes verification confidence percentage', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt).toContain('Verification confidence: 85%');
    });

    it('handles missing verification confidence', () => {
      const prompt = generateBundleSynthesisPrompt({
        ...sampleBundle,
        verification_confidence: undefined,
      });
      expect(prompt).toContain('Verification confidence: not available');
    });

    it('includes summary hint when provided', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt).toContain('Summary hint (from feed):');
      expect(prompt).toContain(
        'A policy announcement triggered market rallies worldwide.',
      );
    });

    it('omits summary hint section when not provided', () => {
      const prompt = generateBundleSynthesisPrompt({
        ...sampleBundle,
        summary_hint: undefined,
      });
      expect(prompt).not.toContain('Summary hint (from feed):');
    });

    it('includes source count in prompt text', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt).toContain('covered by 3 sources');
    });

    it('handles single source correctly', () => {
      const single = {
        ...sampleBundle,
        sources: [sampleBundle.sources[0]!],
      };
      const prompt = generateBundleSynthesisPrompt(single);
      expect(prompt).toContain('covered by 1 source');
    });

    it('includes output format instructions', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt).toContain('OUTPUT FORMAT:');
      expect(prompt).toContain('"summary"');
      expect(prompt).toContain('"frames"');
      expect(prompt).toContain('"source_count"');
      expect(prompt).toContain('"source_publishers"');
      expect(prompt).toContain('"verification_confidence"');
    });

    it('includes GOALS_AND_GUIDELINES content', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt).toContain('GOALS AND GUIDELINES');
    });
  });

  describe('buildBundlePrompt', () => {
    const candidate: StoryBundleInputCandidate = {
      story_id: 'story-abc',
      topic_id: 'topic-markets',
      sources: [
        {
          source_id: 'fox-latest',
          url: 'https://example.com/fox',
          publisher: 'Fox News',
          published_at: 1000,
          url_hash: 'hash-1',
        },
        {
          source_id: 'bbc-general',
          url: 'https://example.com/bbc',
          publisher: 'BBC News',
          published_at: 1001,
          url_hash: 'hash-2',
        },
      ],
      normalized_facts_text: 'Markets rally worldwide',
    };

    it('returns a non-empty prompt', () => {
      const prompt = buildBundlePrompt(candidate);
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('uses normalized_facts_text as headline', () => {
      const prompt = buildBundlePrompt(candidate);
      expect(prompt).toContain('Markets rally worldwide');
    });

    it('includes publishers from candidate sources', () => {
      const prompt = buildBundlePrompt(candidate);
      expect(prompt).toContain('Fox News');
      expect(prompt).toContain('BBC News');
    });

    it('includes verification confidence when provided', () => {
      const prompt = buildBundlePrompt(candidate, 0.92);
      expect(prompt).toContain('Verification confidence: 92%');
    });

    it('handles missing verification confidence', () => {
      const prompt = buildBundlePrompt(candidate);
      expect(prompt).toContain('Verification confidence: not available');
    });
  });

  describe('BundleSynthesisResult type', () => {
    it('type-checks a valid result', () => {
      const result: BundleSynthesisResult = {
        summary: 'Markets rallied after a major policy announcement.',
        frames: [
          {
            frame: 'The policy will boost economic growth.',
            reframe: 'Short-term gains may mask structural issues.',
          },
        ],
        source_count: 3,
        source_publishers: ['Fox News', 'The Guardian', 'BBC News'],
        verification_confidence: 0.85,
      };

      expect(result.summary).toBeTruthy();
      expect(result.frames).toHaveLength(1);
      expect(result.source_count).toBe(3);
      expect(result.source_publishers).toHaveLength(3);
      expect(result.verification_confidence).toBe(0.85);
    });
  });
});
