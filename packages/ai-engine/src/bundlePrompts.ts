/**
 * Multi-source StoryBundle synthesis prompts.
 *
 * Generates summary + frame/reframe table from verified bundles.
 * Kept separate from prompts.ts to respect the 350 LOC cap.
 */

import { GOALS_AND_GUIDELINES } from './prompts';
import type { StoryBundleInputCandidate } from './newsTypes';

/**
 * Deterministic output shape for UI consumption.
 * The AI must return exactly this JSON structure.
 */
export interface BundleSynthesisResult {
  /** 2-4 sentence neutral summary synthesizing across all sources. */
  summary: string;
  /** 2-4 frame/reframe pairs representing cross-source disagreements. */
  frames: Array<{ frame: string; reframe: string }>;
  /** Number of distinct sources in the bundle. */
  source_count: number;
  /** Publisher names that contributed to the bundle. */
  source_publishers: string[];
  /** Verification confidence from the bundle verification record. */
  verification_confidence: number;
}

const BUNDLE_SYNTHESIS_OUTPUT_FORMAT = `
OUTPUT FORMAT:
Return exactly one JSON object with these keys and no extraneous text:

{
  "summary": "[2-4 sentence neutral summary synthesizing the story across all sources]",
  "frames": [
    { "frame": "[Concise perspective 1 from one editorial direction]", "reframe": "[Concise counter-perspective 1]" },
    { "frame": "[Concise perspective 2 from another editorial direction]", "reframe": "[Concise counter-perspective 2]" }
  ],
  "source_count": <number of sources>,
  "source_publishers": ["<publisher 1>", "<publisher 2>", ...],
  "verification_confidence": <0..1 confidence score>
}

Rules:
- "summary" must be 2-4 sentences, neutral, factual, covering what all sources agree on.
- "frames" must have 2-4 entries. Each frame states a perspective found in the coverage; each reframe provides a direct counter-perspective.
- Use terse, debate-style language for frames and reframes.
- Do NOT insert opinions or emotive language in the summary.
- Explicitly note where sources disagree in the frames section.
`.trim();

/**
 * Generate a multi-source bundle synthesis prompt.
 *
 * The prompt names all source publishers for transparency (CE requirement)
 * and produces a deterministic JSON output for UI consumption.
 */
export function generateBundleSynthesisPrompt(bundle: {
  headline: string;
  sources: Array<{ publisher: string; title: string; url: string }>;
  summary_hint?: string;
  verification_confidence?: number;
}): string {
  const sourceList = bundle.sources
    .map(
      (s, i) =>
        `  ${i + 1}. [${s.publisher}] "${s.title}" (${s.url})`,
    )
    .join('\n');

  const confidenceNote =
    typeof bundle.verification_confidence === 'number'
      ? `Verification confidence: ${(bundle.verification_confidence * 100).toFixed(0)}%`
      : 'Verification confidence: not available';

  const hintSection = bundle.summary_hint
    ? `\nSummary hint (from feed): ${bundle.summary_hint}\n`
    : '';

  return [
    'You are synthesizing a news story covered by multiple sources.',
    `This story is covered by ${bundle.sources.length} source${bundle.sources.length === 1 ? '' : 's'}:`,
    sourceList,
    '',
    `Headline: ${bundle.headline}`,
    hintSection,
    confidenceNote,
    '',
    GOALS_AND_GUIDELINES.trim(),
    '',
    BUNDLE_SYNTHESIS_OUTPUT_FORMAT,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

/**
 * Canonical entry point for building a bundle synthesis prompt
 * from a StoryBundleInputCandidate.
 */
export function buildBundlePrompt(
  candidate: StoryBundleInputCandidate,
  verificationConfidence?: number,
): string {
  return generateBundleSynthesisPrompt({
    headline: candidate.normalized_facts_text,
    sources: candidate.sources.map((s) => ({
      publisher: s.publisher,
      title: s.publisher,
      url: s.url,
    })),
    verification_confidence: verificationConfidence,
  });
}
