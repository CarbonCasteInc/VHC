import { describe, expect, it } from 'vitest';
import {
  buildBundlePrompt,
  buildBundlePromptFromStoryBundle,
  BundleSynthesisParseError,
  generateBundleSynthesisPrompt,
  parseGeneratedBundleSynthesis,
  type BundleSynthesisResult,
} from './bundlePrompts';
import type { StoryBundle, StoryBundleInputCandidate } from './newsTypes';

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

    it('requires issue-side frame rows even when explicit source disagreement is sparse', () => {
      const prompt = generateBundleSynthesisPrompt(sampleBundle);
      expect(prompt).toContain('Never return an empty frames array');
      expect(prompt).toContain('standalone, affirmative, debate-style claim');
      expect(prompt).toContain('If explicit outlet bias or source disagreement is sparse');
      expect(prompt).toContain('Never use "N/A" or "No clear bias detected"');
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

  describe('buildBundlePromptFromStoryBundle', () => {
    const bundle: StoryBundle = {
      schemaVersion: 'story-bundle-v0',
      story_id: 'story-abc',
      topic_id: 'topic-markets',
      headline: 'Markets rally after policy announcement',
      summary_hint: 'A policy announcement triggered market rallies worldwide.',
      cluster_window_start: 1700000000000,
      cluster_window_end: 1700000001000,
      sources: [
        {
          source_id: 'usable-1',
          publisher: 'BBC News',
          title: 'Markets up on policy shift',
          url: 'https://example.com/bbc',
          url_hash: 'hash-1',
          published_at: 1700000000000,
        },
        {
          source_id: 'link-only-1',
          publisher: 'Broken Publisher',
          title: 'Related but unreadable',
          url: 'https://example.com/broken',
          url_hash: 'hash-2',
          published_at: 1700000000001,
        },
      ],
      primary_sources: [
        {
          source_id: 'usable-1',
          publisher: 'BBC News',
          title: 'Markets up on policy shift',
          url: 'https://example.com/bbc',
          url_hash: 'hash-1',
          published_at: 1700000000000,
        },
      ],
      related_links: [
        {
          source_id: 'link-only-1',
          publisher: 'Broken Publisher',
          title: 'Related but unreadable',
          url: 'https://example.com/broken',
          url_hash: 'hash-2',
          published_at: 1700000000001,
        },
      ],
      cluster_features: {
        entity_keys: ['markets'],
        time_bucket: '2026-04-20T12',
        semantic_signature: 'abc123',
        confidence_score: 0.72,
      },
      provenance_hash: 'provhash',
      created_at: 1700000002000,
    };

    it('uses only primary analysis-eligible sources when present', () => {
      const prompt = buildBundlePromptFromStoryBundle(bundle);
      expect(prompt).toContain('BBC News');
      expect(prompt).toContain('https://example.com/bbc');
      expect(prompt).not.toContain('Broken Publisher');
      expect(prompt).not.toContain('https://example.com/broken');
      expect(prompt).toContain('Verification confidence: 72%');
    });

    it('falls back to all bundle sources when primary sources are absent', () => {
      const bundleWithoutPrimarySources = {
        ...bundle,
        primary_sources: undefined,
        related_links: undefined,
      };
      const prompt = buildBundlePromptFromStoryBundle(bundleWithoutPrimarySources);
      expect(prompt).toContain('BBC News');
      expect(prompt).toContain('Broken Publisher');
      expect(prompt).toContain('covered by 2 sources');
    });
  });

  describe('parseGeneratedBundleSynthesis', () => {
    it('parses strict generated bundle output', () => {
      const parsed = parseGeneratedBundleSynthesis(JSON.stringify({
        summary: 'Markets rallied after a major policy announcement. Sources agree the move affected investor expectations.',
        frames: [
          {
            frame: 'The policy will boost economic growth.',
            reframe: 'Short-term gains may mask structural risks.',
          },
        ],
        source_count: 3,
        source_publishers: ['Fox News', 'The Guardian', 'BBC News'],
        verification_confidence: 0.85,
      }));

      expect(parsed.source_count).toBe(3);
      expect(parsed.frames[0]?.frame).toContain('boost economic growth');
    });

    it('accepts final_refined wrapper responses', () => {
      const parsed = parseGeneratedBundleSynthesis(JSON.stringify({
        final_refined: {
          summary: 'Markets rallied after a policy announcement.',
          frames: [
            {
              frame: 'The policy supports near-term growth.',
              reframe: 'The benefits may not survive implementation risks.',
            },
          ],
          source_count: 2,
          source_publishers: ['A', 'B'],
          verification_confidence: 0.7,
        },
      }));

      expect(parsed.source_publishers).toEqual(['A', 'B']);
    });

    it('rejects placeholder frame text', () => {
      expect(() => parseGeneratedBundleSynthesis(JSON.stringify({
        summary: 'Summary.',
        frames: [{ frame: 'No clear bias detected.', reframe: 'Counterpoint.' }],
        source_count: 1,
        source_publishers: ['A'],
        verification_confidence: 0.5,
      }))).toThrow(BundleSynthesisParseError.SCHEMA_VALIDATION_ERROR);
    });

    it('reports missing and malformed JSON separately', () => {
      expect(() => parseGeneratedBundleSynthesis('plain text')).toThrow(
        BundleSynthesisParseError.NO_JSON_OBJECT_FOUND,
      );
      expect(() => parseGeneratedBundleSynthesis('{bad json')).toThrow(
        BundleSynthesisParseError.NO_JSON_OBJECT_FOUND,
      );
      expect(() => parseGeneratedBundleSynthesis('{bad json}')).toThrow(
        BundleSynthesisParseError.JSON_PARSE_ERROR,
      );
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
