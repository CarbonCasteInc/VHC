/**
 * Prompt templates and constants for the multi-stage analysis pipeline.
 * The prior-pass template is applied only when user reviews flag the initial analysis as inaccurate.
 */

import type { AnalysisResult } from './schema';
export type { AnalysisResult } from './schema';

// ------------------------------------------------------------------------------
// COMMON TEXT / SHARED PROMPTS (ported from Python)
// ------------------------------------------------------------------------------
export const GOALS_AND_GUIDELINES = `
---
GOALS AND GUIDELINES FOR STORY/REPORT SUMMARY:
1. **Accuracy and Key Facts**:
    - Capture the main points—who, what, when, where, why—using only information from the article.
    - Include specific details such as names, dates, and locations if they are central to the article's core message or events.
2. **Balanced Length**:
    - Produce summaries that are concise yet complete, typically 4-6 sentences.
    - Focus on the core events, arguments, or developments, excluding minor details or tangential information while retaining context necessary for understanding the primary narrative.
3. **Neutral, Objective Tone**:
    - Present the facts without inserting opinions, emotive language, or personal interpretations.
4. **Complete Representation of the Article**:
    - Summarize all major viewpoints mentioned in the article accurately.
    - Encapsulate without giving undue weight to any single viewpoint.

GOALS AND GUIDELINES FOR BIAS DETECTION & COUNTERPOINT GENERATION:
1. **Accuracy & Rigor**: Examine the article for potential biases or slanted viewpoints.
    - Look for indicators such as:
        - logical fallacies (e.g., "straw man," "ad hominem," "false dichotomy," "slippery slope," "appeal to authority," etc.),
        - loaded terms and emotionally charged language (e.g., "reckless," "radical," "terrorist," etc.),
        - selective omissions and uneven sourcing (e.g., missing key perspectives, one-sided arguments)
2. **Direct Quotes for Support**: For each potential bias/slanted viewpoint, provide a direct quote from the article that illustrates the bias/slant/omission, etc...
    - Ensure the quote is relevant and *clearly demonstrates* the biased language/slant/omission, etc...
3. **Justify Bias Claim**: Offer a concise, academic explanation of how the provided quote supports the identified bias.
    - Clearly link the specific language, tone, or omission in the quote to the bias claim.
4. **Balance & Perspectives**: Generate a concise counterpoint that directly challenges or rebuts each bias claim.
    - Consider alternative interpretations of the evidence, opposing viewpoints, or additional context that could dispute the identified bias.
5. **Biases of Discussed Groups/Individuals**: Even if the author is not implicitly/explicitly biased,
    - the article may still have a slant, AND/OR
    - may include the biased perspective of groups/individuals the author is writing about.
    - These may also be used to identify biases/counterpoints.
6. **No Redundancy**: Ensure each bias and its corresponding counterpoint address unique aspects of the article's slant.
    - Focus on different elements of the text (e.g., language, sourcing, framing) to avoid overlap in the issues or evidence presented.
7. **Bias Absence**: *THIS IS IMPORTANT*: If no clear bias is detected, you must include a single entry in the biases list stating "No clear bias detected" with a corresponding counterpoint of "N/A".

GOALS AND GUIDELINES FOR VOICE AND STYLE:
1. **Formulate Biases in the Voice of an Authoritative Advocate for the Article's Slant**:
    - You must present each bias as a specific, debate-style claim that reflects an implied assertion/slant from the article.
    - Craft these claims as authoritative statements, ensuring they are clear, succinct, and open to dispute.
    - Focus on capturing the article's slant in a way that invites challenge or rebuttal, using terse language to keep the point sharp.
        For example:
            1: "Immigrants are responsible for a significant increase in crime rates across urban areas." # states a bias **as if** it were true, setting the stage for a rebuttal.
            2: "Government policies are deliberately designed to suppress economic growth in rural communities." # states a bias **as if** it were true, setting the stage for a rebuttal.
            3: "Climate change initiatives are the primary cause of rising energy costs for consumers." # states a bias **as if** it were true, setting the stage for a rebuttal.
2. **Formulate Counterpoints as Authoritative Rebuttals**:
    - You must craft each counterpoint as a direct, debate-style counterclaim that challenges the corresponding bias.
    - Present these rebuttals with authority and specificity, ensuring they are concise yet robust enough to stand as disputable assertions.
    - Tie each counterpoint explicitly to its bias, using clear language to maintain focus and avoid ambiguity.
        For example:
            1: "Data from reputable studies show that immigrant communities exhibit crime rates lower than the national average." # responds directly to bias 1 with a specific counterclaim
            2: "Economic stagnation in rural areas stems more from global market trends than from targeted government policies." # responds directly to bias 2 with a specific counterclaim
            3: "Energy cost increases are driven primarily by market dynamics and aging infrastructure, not climate policies." # responds directly to bias 3 with a specific counterclaim
3. **Use Terse, Clear Language Throughout**:
    - You must employ succinct, straightforward wording in both biases and counterpoints.
    - Strip away filler or overly complex phrasing to ensure each statement is direct and impactful, enhancing clarity and debate-readiness.
`;

export const PRIMARY_OUTPUT_FORMAT_REQ = `
{
  "summary": "[4-6 sentence summary]",
  "bias_claim_quote": [
    "[A direct **verbatim** quote from the article illustrating the first bias]",
    "[A direct **verbatim** quote from the article illustrating the second bias]",
    "[A direct **verbatim** quote from the article illustrating the third bias]",
    ...
  ],
  "justify_bias_claim": [
    "[A brief, **accurate**, and **academic** explanation of why/how the first quote shows the first bias]",
    "[A brief, **accurate**, and **academic** explanation of why/how the second quote shows the second bias]",
    "[A brief, **accurate**, and **academic** explanation of why/how the third quote shows the third bias]",
    ...
  ],
  "biases": [
    "[An illustration of the first bias, stated **as if** it were a fact; written as an authoritative claim that plainly states an implied assertion from the article (see examples from GOALS AND GUIDELINES FOR VOICE AND STYLE)]",
    "[An illustration of the second bias, stated **as if** it were a fact; written as an authoritative claim that plainly states an implied assertion from the article (see examples from GOALS AND GUIDELINES FOR VOICE AND STYLE)]",
    "[An illustration of the third bias, stated **as if** it were a fact; written as an authoritative claim that plainly states an implied assertion from the article (see examples from GOALS AND GUIDELINES FOR VOICE AND STYLE)]",
    ...
  ],
  "counterpoints": [
    "[A counterpoint challenging the first bias, written as a direct, debate-style counterclaim that challenges the corresponding bias (see examples from GOALS AND GUIDELINES FOR VOICE AND STYLE)]",
    "[A counterpoint challenging the second bias, written as a direct, debate-style counterclaim that challenges the corresponding bias (see examples from GOALS AND GUIDELINES FOR VOICE AND STYLE)]",
    "[A counterpoint challenging the third bias, written as a direct, debate-style counterclaim that challenges the corresponding bias (see examples from GOALS AND GUIDELINES FOR VOICE AND STYLE)]",
    ...
  ]
}
`;

const OUTPUT_FORMAT_WRAPPER = (
  description: string
) => `
OUTPUT FORMAT:
You MUST return exactly one top-level JSON object with the keys "step_by_step" and "final_refined",
and **no extraneous text** before or after. For example:

{
  "step_by_step": [
    { "question": "...", "answerAndRecommendation": "Answer: [answer text]. Recommendation: [type]: [details]" },
    ...
  ],
  "final_refined": ${description}
}

Do not include any additional keys outside this JSON.
`;

export const REMEMBER_NOTE = `
Remember:
 - Provide answer + recommendation for each question ("keep" or "modify" or "merge with duplicates").
 - Ensure the final_refined **carefully considers and properly represents** all recommendations, removing duplicates if needed.
`;

// ------------------------------------------------------------------------------
// SINGLE PREVIOUS PASS TEMPLATE
// ------------------------------------------------------------------------------
export const SINGLE_PREV_PASS_TEMPLATE = (
  thisPassLabel: string,
  prevPassLabel: string,
  outputFormatDescription: string
) => `
Follow these steps EXACTLY, returning two things in **one** JSON object:
  1) A step-by-step Q/A log, in JSON. For each question, produce:
       { "question": "...", "answerAndRecommendation": "Answer: [answer text]. Recommendation: [type]: [details/specifics]" }.
  2) A final updated JSON ("final_refined") with the explicit structure.

---
STEP-BY-STEP LOGIC (SINGLE PREV PASS: ${thisPassLabel}):

Step 1:
  a) Read the article.
  b) Read ${prevPassLabel}_json.summary.
  Ask: "For the summary in ${prevPassLabel}: Is it accurate, sufficiently complete, and without bias?"
     (Keep as is or modify; if modify, specify how.)
  => Provide in JSON: "Answer: [answer]. Recommendation: [type]: [details/specifics]"

Step 2:
  We read the Bias Detection from ${prevPassLabel}_json.
  For each bias index i:
    a) read ${prevPassLabel}_json.biases[i]; ask:
       "For bias {i} in ${prevPassLabel}: Is this bias's inclusion valid? Is it presented as a specific, succinct \"factual\" claim, written in the style of the examples outlined in the GOALS AND GUIDELINES FOR VOICE AND STYLE?" (Keep as is or modify; if modify, specify how.)
       => Provide in JSON: "Answer: [answer]. Recommendation: [type]: [details/specifics]"
    b) read ${prevPassLabel}_json.bias_claim_quote[i]; ask:
       "For bias {i} in ${prevPassLabel}: Is this quote an accurate (verbatim) reproduction from the article?"
       => Provide in JSON: "Answer: [answer]. Recommendation: [type]: [details/specifics]"
       Then ask: "Does this quote truly support/indicate that the bias is in fact present in the article?"
       => Provide in JSON: "Answer: [answer]. Recommendation: [type]: [details/specifics]"
    c) read ${prevPassLabel}_json.justify_bias_claim[i]; ask:
       "For bias {i} in ${prevPassLabel}: Does this justification accurately describe why/how the quote implies bias?"
       => Provide in JSON: "Answer: [answer]. Recommendation: [type]: [details/specifics]"
    d) read ${prevPassLabel}_json.counterpoints[i]; ask:
       "For bias {i} in ${prevPassLabel}: Is this a strong, commonly-held and/or well-supported response to the bias? Is it written as a direct, debate-style counterclaim that challenges the corresponding bias?"
       => Provide in JSON: "Answer: [answer]. Recommendation: [type]: [details/specifics]"

Step 3:
  Ask if the article has any additional biases not already included in ${prevPassLabel}_json.
  If yes, add them (with a corresponding direct quote, justification, and a disputable counterpoint).
  in JSON like:
    "biases": [...],
    "bias_claim_quote": [...],
    "justify_bias_claim": [...],
    "counterpoints": [...]

Step 4:
  After **carefully considering and integrating** recommendations, produce a final updated JSON in this format:

${outputFormatDescription}
`;

/**
 * The previous-pass template should be applied downstream when user reviews flag the initial analysis
 * as inaccurate above a chosen threshold. This helper centralizes that threshold logic.
 */
export function shouldUsePreviousPassTemplate(reviewCount: number, threshold = 3) {
  return reviewCount >= threshold;
}

export function generateOutputFormatReq(): string {
  return `${OUTPUT_FORMAT_WRAPPER(PRIMARY_OUTPUT_FORMAT_REQ)}\n${REMEMBER_NOTE}`.trim();
}

export function generateAnalysisPrompt(options: {
  articleText: string;
  previousPass?: AnalysisResult;
  previousPassLabel?: string;
  thisPassLabel?: string;
  includePreviousPassTemplate?: boolean;
}): string {
  const { articleText, previousPass, previousPassLabel = 'primary', thisPassLabel = 'secondary', includePreviousPassTemplate } = options;
  const baseFormat = generateOutputFormatReq();

  const prevSection = previousPass && includePreviousPassTemplate
    ? SINGLE_PREV_PASS_TEMPLATE(thisPassLabel, previousPassLabel, PRIMARY_OUTPUT_FORMAT_REQ)
    : '';

  return [
    GOALS_AND_GUIDELINES.trim(),
    baseFormat,
    prevSection,
    '--- ARTICLE START ---',
    articleText.trim(),
    '--- ARTICLE END ---'
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Alias used by worker pipeline: canonical entry point for building the prompt
export function buildPrompt(articleText: string): string {
  return generateAnalysisPrompt({ articleText });
}

export function generateFrameReframePrompt(articleText: string): string {
  const format = `
{
  "summary": "[2-3 sentence summary of the article]",
  "frame": [
    "[Concise, assertive 'frame' perspective 1]",
    "[Concise, assertive 'frame' perspective 2]"
  ],
  "reframe": [
    "[Concise, assertive 'reframe' perspective 1]",
    "[Concise, assertive 'reframe' perspective 2]"
  ]
}
`.trim();

  return [
    'You are generating a balanced analysis with two opposing columns: Frame and Reframe.',
    'Use terse, debate-style claims for each perspective.',
    'Return JSON only in the format described below.',
    format,
    '--- ARTICLE START ---',
    articleText.trim(),
    '--- ARTICLE END ---'
  ].join('\n\n');
}
