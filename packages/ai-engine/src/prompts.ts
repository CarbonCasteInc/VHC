export interface AnalysisResult {
  summary: string;
  biases: string[];
  confidence: number; // 0.0 - 1.0
  previousPassNotes?: string;
}

export const GOALS_AND_GUIDELINES = `
You are the Canonical Bias Engine for TRINITY. Your job is to surface bias, missing context, and manipulation patterns while preserving facts.

Core directives:
- Local-first: operate only on the provided text; do not invent sources.
- Bias radar: highlight framing, omissions, adversarial wording, and evidence gaps.
- Civic tone: be concise, non-inflammatory, and actionable.
- Receipts: whenever possible, quote short spans from the text that illustrate the bias.
`;

export const PRIMARY_OUTPUT_FORMAT_REQ = `
Return structured JSON with the following keys:
  summary: one-sentence neutral summary.
  biases: array of bias findings, each a short clause.
  confidence: number between 0 and 1 for overall assessment.
`;

export const SINGLE_PREV_PASS_TEMPLATE = `
Previous pass notes:
{{previous_summary}}
Confidence: {{previous_confidence}}
`; 

export function generateOutputFormatReq(previous?: AnalysisResult): string {
  if (!previous) return PRIMARY_OUTPUT_FORMAT_REQ;
  const notes = SINGLE_PREV_PASS_TEMPLATE
    .replace('{{previous_summary}}', previous.summary)
    .replace('{{previous_confidence}}', previous.confidence.toFixed(2));
  return `${PRIMARY_OUTPUT_FORMAT_REQ}\n${notes}`;
}

export function generateAnalysisPrompt(articleText: string, previousPass?: AnalysisResult): string {
  const format = generateOutputFormatReq(previousPass);
  const prevBlock = previousPass ? `Prior analysis bias list: ${previousPass.biases.join('; ')}` : '';

  return [
    GOALS_AND_GUIDELINES.trim(),
    format.trim(),
    prevBlock,
    '--- ARTICLE START ---',
    articleText.trim(),
    '--- ARTICLE END ---'
  ]
    .filter(Boolean)
    .join('\n\n');
}
