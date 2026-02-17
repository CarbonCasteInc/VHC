import { z } from 'zod';

export interface ArticleAnalysisResult {
  article_id: string;
  source_id: string;
  url: string;
  url_hash: string;
  summary: string;
  bias_claim_quote: string[];
  justify_bias_claim: string[];
  biases: string[];
  counterpoints: string[];
  confidence: number;
  perspectives: Array<{ frame: string; reframe: string }>;
  analyzed_at: number;
  engine: string;
}

export interface BundleSynthesisInput {
  storyId: string;
  headline: string;
  articleAnalyses: Array<{
    publisher: string;
    title: string;
    analysis: ArticleAnalysisResult;
  }>;
}

export interface BundleSynthesisResult {
  summary: string;
  frame_reframe_table: Array<{ frame: string; reframe: string }>;
  source_count: number;
  warnings: string[];
  synthesis_ready: boolean;
  synthesis_unavailable_reason?: string;
}

export class PromptParseError extends Error {
  constructor(
    public readonly kind: 'invalid-json' | 'invalid-shape',
    message: string,
  ) {
    super(message);
    this.name = 'PromptParseError';
  }
}

const perspectiveSchema = z.object({ frame: z.string().min(1), reframe: z.string().min(1) }).strict();

const articlePayloadSchema = z
  .object({
    summary: z.string().min(1),
    bias_claim_quote: z.array(z.string()),
    justify_bias_claim: z.array(z.string()),
    biases: z.array(z.string()),
    counterpoints: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    perspectives: z.array(perspectiveSchema),
  })
  .strict();

const bundlePayloadSchema = z
  .object({
    summary: z.string(),
    frame_reframe_table: z.array(perspectiveSchema),
    warnings: z.array(z.string()).optional(),
    synthesis_ready: z.boolean().optional(),
    synthesis_unavailable_reason: z.string().optional(),
  })
  .strict();

function unwrapJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(unwrapJson(raw));
  } catch {
    throw new PromptParseError('invalid-json', 'Response is not valid JSON.');
  }
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/** Generate structured analysis prompt for a single full-text article. */
export function generateArticleAnalysisPrompt(
  articleText: string,
  metadata: { publisher: string; title: string; url: string },
): string {
  return [
    'You are a media-analysis engine. Return STRICT JSON only.',
    `Publisher: ${metadata.publisher}`,
    `Title: ${metadata.title}`,
    `URL: ${metadata.url}`,
    '',
    'Output schema (meta fields are added by the caller):',
    '{"summary":"string","bias_claim_quote":["string"],"justify_bias_claim":["string"],"biases":["string"],"counterpoints":["string"],"confidence":0.0,"perspectives":[{"frame":"string","reframe":"string"}]}',
    'Instructions:',
    '- Summarize core claims neutrally.',
    '- Identify biases with direct supporting quotes.',
    '- Provide counterpoints and at least one frame/reframe perspective pair.',
    '',
    '--- ARTICLE START ---',
    articleText,
    '--- ARTICLE END ---',
  ].join('\n');
}

/** Parse raw LLM response into structured ArticleAnalysisResult (throws on malformed). */
export function parseArticleAnalysisResponse(
  raw: string,
  meta: { article_id: string; source_id: string; url: string; url_hash: string; engine: string },
): ArticleAnalysisResult {
  const payload = articlePayloadSchema.safeParse(parseJson(raw));
  if (!payload.success) {
    throw new PromptParseError('invalid-shape', issueText(payload.error));
  }

  return {
    article_id: meta.article_id,
    source_id: meta.source_id,
    url: meta.url,
    url_hash: meta.url_hash,
    summary: payload.data.summary,
    bias_claim_quote: payload.data.bias_claim_quote,
    justify_bias_claim: payload.data.justify_bias_claim,
    biases: payload.data.biases,
    counterpoints: payload.data.counterpoints,
    confidence: payload.data.confidence,
    perspectives: payload.data.perspectives,
    analyzed_at: Date.now(),
    engine: meta.engine,
  };
}

/** Generate multi-source synthesis prompt from N per-article analyses. */
export function generateBundleSynthesisPrompt(input: BundleSynthesisInput): string {
  const count = input.articleAnalyses.length;

  if (count === 0) {
    return [
      'No eligible full-text sources are available for this story.',
      'Return JSON with synthesis_ready=false and synthesis_unavailable_reason="no-eligible-sources".',
      `Story ID: ${input.storyId}`,
      `Headline: ${input.headline}`,
    ].join('\n');
  }

  const sourceList = input.articleAnalyses
    .map((entry, index) => {
      return [
        `Source ${index + 1}:`,
        `- publisher: ${entry.publisher}`,
        `- title: ${entry.title}`,
        `- summary: ${entry.analysis.summary}`,
        `- biases: ${JSON.stringify(entry.analysis.biases)}`,
      ].join('\n');
    })
    .join('\n\n');

  const modeInstruction =
    count === 1
      ? "Only one source is available. Include warning 'single-source-only'."
      : 'Cross-synthesize agreements, conflicts, and frame/reframe differences across sources.';

  return [
    'You are a cross-source synthesis engine. Return STRICT JSON only.',
    `Story ID: ${input.storyId}`,
    `Headline: ${input.headline}`,
    `Eligible sources: ${count}`,
    modeInstruction,
    '',
    sourceList,
    '',
    'Output schema: {"summary":"string","frame_reframe_table":[{"frame":"string","reframe":"string"}],"warnings":["string"],"synthesis_ready":true}',
  ].join('\n');
}

/** Parse raw LLM response into BundleSynthesisResult. */
export function parseBundleSynthesisResponse(raw: string, sourceCount: number): BundleSynthesisResult {
  if (sourceCount === 0) {
    return {
      summary: '',
      frame_reframe_table: [],
      source_count: 0,
      warnings: [],
      synthesis_ready: false,
      synthesis_unavailable_reason: 'no-eligible-sources',
    };
  }

  const payload = bundlePayloadSchema.safeParse(parseJson(raw));
  if (!payload.success) {
    throw new PromptParseError('invalid-shape', issueText(payload.error));
  }

  const warnings = [...(payload.data.warnings ?? [])];
  if (sourceCount === 1 && !warnings.includes('single-source-only')) {
    warnings.push('single-source-only');
  }

  return {
    summary: payload.data.summary,
    frame_reframe_table: payload.data.frame_reframe_table,
    source_count: sourceCount,
    warnings,
    synthesis_ready: payload.data.synthesis_ready ?? true,
    synthesis_unavailable_reason: payload.data.synthesis_unavailable_reason,
  };
}
