/**
 * Multi-source StoryBundle synthesis prompts.
 *
 * Generates summary + frame/reframe table from verified bundles.
 * Kept separate from prompts.ts to respect the 350 LOC cap.
 */

import { GOALS_AND_GUIDELINES } from './prompts';
import { isPlaceholderPerspectiveText } from './schema';
import type { StoryBundle, StoryBundleInputCandidate } from './newsTypes';
import { z } from 'zod';

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

const GeneratedBundleFrameSchema = z
  .object({
    frame: z.string().trim().min(1),
    reframe: z.string().trim().min(1),
  })
  .strict()
  .refine((row) => !isPlaceholderPerspectiveText(row.frame), {
    message: 'Bundle synthesis frame cannot be a placeholder',
    path: ['frame'],
  })
  .refine((row) => !isPlaceholderPerspectiveText(row.reframe), {
    message: 'Bundle synthesis reframe cannot be a placeholder',
    path: ['reframe'],
  });

export const GeneratedBundleSynthesisResultSchema = z
  .object({
    summary: z.string().trim().min(1),
    frames: z.array(GeneratedBundleFrameSchema).min(1).max(4),
    source_count: z.number().int().positive(),
    source_publishers: z.array(z.string().trim().min(1)).min(1),
    verification_confidence: z.number().min(0).max(1),
  })
  .strict();

export type GeneratedBundleSynthesisResult = z.infer<
  typeof GeneratedBundleSynthesisResultSchema
>;

export enum BundleSynthesisParseError {
  NO_JSON_OBJECT_FOUND = 'NO_JSON_OBJECT_FOUND',
  JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
  SCHEMA_VALIDATION_ERROR = 'SCHEMA_VALIDATION_ERROR',
}

export function parseGeneratedBundleSynthesis(raw: string): GeneratedBundleSynthesisResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(BundleSynthesisParseError.NO_JSON_OBJECT_FOUND);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    const payload = (parsed as { final_refined?: unknown }).final_refined ?? parsed;
    return GeneratedBundleSynthesisResultSchema.parse(payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(BundleSynthesisParseError.SCHEMA_VALIDATION_ERROR);
    }
    throw new Error(BundleSynthesisParseError.JSON_PARSE_ERROR);
  }
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
- "frames" must have 2-4 entries. Never return an empty frames array.
- Each frame must be a standalone, affirmative, debate-style claim from one public, political, institutional, or stakeholder side of the story.
- Each reframe must be a direct, standalone, affirmative counterclaim that challenges the paired frame.
- If explicit outlet bias or source disagreement is sparse, infer common sides around the issue: political divides, public opinion splits, stakeholder tradeoffs, rights/safety tensions, cost/risk disputes, or accountability arguments.
- Frames are issue-side claims, not publication summaries. Do not prefix frames with publisher names unless the publisher itself is materially part of the dispute.
- Never use "N/A" or "No clear bias detected" as a frame or reframe.
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

export function buildBundlePromptFromStoryBundle(
  bundle: Pick<
    StoryBundle,
    | 'headline'
    | 'summary_hint'
    | 'sources'
    | 'primary_sources'
    | 'cluster_features'
  >,
): string {
  const analysisSources = bundle.primary_sources ?? bundle.sources;
  return generateBundleSynthesisPrompt({
    headline: bundle.headline,
    summary_hint: bundle.summary_hint,
    sources: analysisSources.map((source) => ({
      publisher: source.publisher,
      title: source.title,
      url: source.url,
    })),
    verification_confidence: bundle.cluster_features.confidence_score,
  });
}
