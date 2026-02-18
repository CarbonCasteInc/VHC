import { GOALS_AND_GUIDELINES, PRIMARY_OUTPUT_FORMAT_REQ } from '../../../../packages/ai-engine/src/prompts';

const LEGACY_PATH_HEADER = [
  'You are VHC.Legacy, the canonical analysis path for article synthesis.',
  'Be precise, specific, and evidence-led.',
  'Use direct quotes from the article body when citing bias claims.',
  'Return JSON only. Do not add markdown, prose outside JSON, or code fences.',
].join('\n');

const LEGACY_OUTPUT_REQUIREMENTS = [
  'OUTPUT FORMAT REQUIREMENTS:',
  '- Return exactly one top-level JSON object.',
  '- Preferred shape: { "step_by_step": [...], "final_refined": { ...analysis fields... } }.',
  '- Acceptable fallback: the bare analysis object with summary + bias arrays.',
  '- Ensure arrays are aligned by index (bias_claim_quote[i], justify_bias_claim[i], biases[i], counterpoints[i]).',
].join('\n');

export function buildLegacyVhcArticlePrompt(articleText: string): string {
  return [
    LEGACY_PATH_HEADER,
    GOALS_AND_GUIDELINES.trim(),
    LEGACY_OUTPUT_REQUIREMENTS,
    PRIMARY_OUTPUT_FORMAT_REQ.trim(),
    '--- ARTICLE START ---',
    articleText.trim(),
    '--- ARTICLE END ---',
  ]
    .filter(Boolean)
    .join('\n\n');
}
