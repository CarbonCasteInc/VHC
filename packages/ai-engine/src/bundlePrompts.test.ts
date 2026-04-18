import { describe, expect, it } from 'vitest';
import {
  BundleSynthesisParseError,
  buildBundlePrompt,
  buildBundlePromptFromStoryBundle,
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
    const storyBundle: StoryBundle = {
      schemaVersion: 'story-bundle-v0',
      story_id: 'story-1',
      topic_id: 'topic-markets',
      headline: 'Markets rally after policy announcement',
      summary_hint: 'A policy announcement triggered market rallies worldwide.',
      cluster_window_start: 1700000000000,
      cluster_window_end: 1700003600000,
      sources: [
        {
          source_id: 'fox-latest',
          publisher: 'Fox News',
          title: 'Markets surge on policy news',
          url: 'https://example.com/fox',
          url_hash: 'hash-1',
          published_at: 1700000001000,
        },
        {
          source_id: 'bbc-general',
          publisher: 'BBC News',
          title: 'Global markets up on policy shift',
          url: 'https://example.com/bbc',
          url_hash: 'hash-2',
          published_at: 1700000002000,
        },
      ],
      cluster_features: {
        entity_keys: ['markets', 'policy'],
        time_bucket: '2026-04-17T21',
        semantic_signature: 'sig-markets',
        confidence_score: 0.82,
      },
      provenance_hash: 'prov-1',
      created_at: 1700000003000,
    };

    it('preserves source titles and uses bundle confidence by default', () => {
      const prompt = buildBundlePromptFromStoryBundle(storyBundle);

      expect(prompt).toContain('Markets surge on policy news');
      expect(prompt).toContain('Global markets up on policy shift');
      expect(prompt).toContain('Summary hint (from feed):');
      expect(prompt).toContain('Verification confidence: 82%');
    });

    it('uses primary_sources when present', () => {
      const prompt = buildBundlePromptFromStoryBundle({
        ...storyBundle,
        primary_sources: [storyBundle.sources[1]!],
      });

      expect(prompt).toContain('Global markets up on policy shift');
      expect(prompt).not.toContain('Markets surge on policy news');
    });

    it('omits hint and confidence when neither is available', () => {
      const prompt = buildBundlePromptFromStoryBundle({
        ...storyBundle,
        summary_hint: undefined,
        cluster_features: {
          ...storyBundle.cluster_features,
          confidence_score: undefined,
        },
      });

      expect(prompt).not.toContain('Summary hint (from feed):');
      expect(prompt).toContain('Verification confidence: not available');
    });

    it('lets explicit verification confidence override bundle confidence', () => {
      const prompt = buildBundlePromptFromStoryBundle(storyBundle, {
        verificationConfidence: 0.91,
      });

      expect(prompt).toContain('Verification confidence: 91%');
    });
  });

  describe('parseGeneratedBundleSynthesis', () => {
    const validPayload = {
      summary: 'Markets rallied after a major policy announcement.',
      frames: [
        {
          frame: 'The policy will boost economic growth.',
          reframe: 'Short-term gains may mask structural issues.',
        },
        {
          frame: 'Officials should move quickly to preserve momentum.',
          reframe: 'Officials should slow down until safeguards are clear.',
        },
      ],
      source_count: 3,
      source_publishers: ['Fox News', 'The Guardian', 'BBC News'],
      verification_confidence: 0.85,
    };

    it('parses valid JSON and trims persisted text fields', () => {
      const result = parseGeneratedBundleSynthesis(
        JSON.stringify({
          ...validPayload,
          summary: `  ${validPayload.summary}  `,
          frames: [
            {
              frame: `  ${validPayload.frames[0]!.frame}  `,
              reframe: validPayload.frames[0]!.reframe,
            },
            {
              frame: validPayload.frames[1]!.frame,
              reframe: `  ${validPayload.frames[1]!.reframe}  `,
            },
          ],
          source_publishers: ['  Fox News  ', 'The Guardian', 'BBC News'],
        }),
      );

      expect(result.summary).toBe(validPayload.summary);
      expect(result.frames[0]!.frame).toBe(validPayload.frames[0]!.frame);
      expect(result.frames[1]!.reframe).toBe(validPayload.frames[1]!.reframe);
      expect(result.source_publishers[0]).toBe('Fox News');
    });

    it('unwraps final_refined payloads', () => {
      expect(
        parseGeneratedBundleSynthesis(JSON.stringify({ final_refined: validPayload })),
      ).toEqual(validPayload);
    });

    it('handles fenced JSON and leading prose', () => {
      expect(parseGeneratedBundleSynthesis(`\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\``)).toEqual(
        validPayload,
      );
      expect(parseGeneratedBundleSynthesis(`Here it is:\n${JSON.stringify(validPayload)}`)).toEqual(
        validPayload,
      );
    });

    it('rejects blank, too few, too many, placeholder, and invalid-shape payloads', () => {
      expect(() =>
        parseGeneratedBundleSynthesis(JSON.stringify({ ...validPayload, summary: '   ' })),
      ).toThrow(BundleSynthesisParseError.SCHEMA_VALIDATION_ERROR);

      expect(() =>
        parseGeneratedBundleSynthesis(JSON.stringify({ ...validPayload, frames: [validPayload.frames[0]] })),
      ).toThrow(BundleSynthesisParseError.SCHEMA_VALIDATION_ERROR);

      expect(() =>
        parseGeneratedBundleSynthesis(
          JSON.stringify({
            ...validPayload,
            frames: [
              ...validPayload.frames,
              { frame: 'Frame three is valid.', reframe: 'Reframe three is valid.' },
              { frame: 'Frame four is valid.', reframe: 'Reframe four is valid.' },
              { frame: 'Frame five is invalid.', reframe: 'Reframe five is invalid.' },
            ],
          }),
        ),
      ).toThrow(BundleSynthesisParseError.SCHEMA_VALIDATION_ERROR);

      for (const placeholder of ['N/A', 'No clear bias detected', 'Frame unavailable.']) {
        expect(() =>
          parseGeneratedBundleSynthesis(
            JSON.stringify({
              ...validPayload,
              frames: [
                { frame: placeholder, reframe: validPayload.frames[0]!.reframe },
                validPayload.frames[1],
              ],
            }),
          ),
        ).toThrow(BundleSynthesisParseError.SCHEMA_VALIDATION_ERROR);
      }

      expect(() =>
        parseGeneratedBundleSynthesis(
          JSON.stringify({
            ...validPayload,
            frames: [
              validPayload.frames[0],
              { frame: validPayload.frames[1]!.frame, reframe: '  N/A  ' },
            ],
          }),
        ),
      ).toThrow(BundleSynthesisParseError.SCHEMA_VALIDATION_ERROR);

      expect(() =>
        parseGeneratedBundleSynthesis(JSON.stringify({ ...validPayload, source_count: -1 })),
      ).toThrow(BundleSynthesisParseError.SCHEMA_VALIDATION_ERROR);
    });

    it('classifies no-json and malformed-json failures', () => {
      expect(() => parseGeneratedBundleSynthesis('no json here')).toThrow(
        BundleSynthesisParseError.NO_JSON_OBJECT_FOUND,
      );
      expect(() => parseGeneratedBundleSynthesis('{ "summary": }')).toThrow(
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
