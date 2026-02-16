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

const perspectiveSchema = z
  .object({
    frame: z.string().min(1),
    reframe: z.string().min(1),
  })
  .strict();

const articleAnalysisPayloadSchema = z
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

const bundleSynthesisPayloadSchema = z
  .object({
    summary: z.string(),
    frame_reframe_table: z.array(perspectiveSchema),
    warnings: z.array(z.string()).optional(),
    synthesis_ready: z.boolean().optional(),
    synthesis_unavailable_reason: z.string().optional(),
  })
  .strict();

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new PromptParseError('invalid-json', 'Response is not valid JSON.');
  }
}

function zodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '(root)' : issue.path.join('.');
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
    'You are a media-bias analysis engine.',
    'Analyze the article text and return STRICT JSON only (no markdown, no prose outside JSON).',
    '',
    `Publisher: ${metadata.publisher}`,
    `Title: ${metadata.title}`,
    `URL: ${metadata.url}`,
    '',
    'Return EXACT JSON shape:',
    JSON.stringify(
      {
        summary: 'string',
        bias_claim_quote: ['string'],
        justify_bias_claim: ['string'],
        biases: ['string'],
        counterpoints: ['string'],
        confidence: 0.0,
        perspectives: [{ frame: 'string', reframe: 'string' }],
      },
      null,
      2,
    ),
    '',
    'Rules:',
    '- Use direct evidence from the article for bias_claim_quote and justify_bias_claim.',
    '- Keep confidence between 0 and 1.',
    '- perspectives must include concrete frame/reframe pairs.',
    '',
    'ARTICLE_TEXT_START',
    articleText,
    'ARTICLE_TEXT_END',
  ].join('\n');
}

/** Parse raw LLM response into structured ArticleAnalysisResult (throws on malformed). */
export function parseArticleAnalysisResponse(
  raw: string,
  meta: {
    article_id: string;
    source_id: string;
    url: string;
    url_hash: string;
    engine: string;
  },
): ArticleAnalysisResult {
  const parsed = parseJson(raw);
  const validated = articleAnalysisPayloadSchema.safeParse(parsed);
  if (!validated.success) {
    throw new PromptParseError('invalid-shape', zodIssues(validated.error));
  }

  return {
    article_id: meta.article_id,
    source_id: meta.source_id,
    url: meta.url,
    url_hash: meta.url_hash,
    summary: validated.data.summary,
    bias_claim_quote: validated.data.bias_claim_quote,
    justify_bias_claim: validated.data.justify_bias_claim,
    biases: validated.data.biases,
    counterpoints: validated.data.counterpoints,
    confidence: validated.data.confidence,
    perspectives: validated.data.perspectives,
    analyzed_at: Date.now(),
    engine: meta.engine,
  };
}

/** Generate multi-source synthesis prompt from N per-article analyses. */
export function generateBundleSynthesisPrompt(input: BundleSynthesisInput): string {
  const count = input.articleAnalyses.length;

  if (count === 0) {
    return [
      'No eligible full-text sources are available for synthesis.',
      'Return STRICT JSON only:',
      JSON.stringify(
        {
          summary: '',
          frame_reframe_table: [],
          warnings: [],
          synthesis_ready: false,
          synthesis_unavailable_reason: 'no-eligible-sources',
        },
        null,
        2,
      ),
    ].join('\n');
  }

  const sourceLines = input.articleAnalyses
    .map((entry, index) => {
      const analysis = entry.analysis;
      return [
        `Source ${index + 1}:`,
        `- publisher: ${entry.publisher}`,
        `- title: ${entry.title}`,
        `- summary: ${analysis.summary}`,
        `- biases: ${JSON.stringify(analysis.biases)}`,
        `- counterpoints: ${JSON.stringify(analysis.counterpoints)}`,
        `- perspectives: ${JSON.stringify(analysis.perspectives)}`,
      ].join('\n');
    })
    .join('\n\n');

  const guidance =
    count === 1
      ? "Only one source is available. Preserve uncertainty and include warning 'single-source-only'."
      : 'Compare and synthesize across sources. Highlight agreements, conflicts, and framing differences.';

  return [
    'You are a cross-source synthesis engine.',
    `Story ID: ${input.storyId}`,
    `Headline: ${input.headline}`,
    `Eligible sources: ${count}`,
    guidance,
    '',
    'Per-article analyses:',
    sourceLines,
    '',
    'Return STRICT JSON only with shape:',
    JSON.stringify(
      {
        summary: 'string',
        frame_reframe_table: [{ frame: 'string', reframe: 'string' }],
        warnings: ['string'],
        synthesis_ready: true,
      },
      null,
      2,
    ),
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

  if (sourceCount < 0) {
    throw new PromptParseError('invalid-shape', 'sourceCount cannot be negative.');
  }

  const parsed = parseJson(raw);
  const validated = bundleSynthesisPayloadSchema.safeParse(parsed);
  if (!validated.success) {
    throw new PromptParseError('invalid-shape', zodIssues(validated.error));
  }

  const warnings = [...(validated.data.warnings ?? [])];
  if (sourceCount === 1 && !warnings.includes('single-source-only')) {
    warnings.push('single-source-only');
  }

  return {
    summary: validated.data.summary,
    frame_reframe_table: validated.data.frame_reframe_table,
    source_count: sourceCount,
    warnings,
    synthesis_ready: validated.data.synthesis_ready ?? true,
    synthesis_unavailable_reason: validated.data.synthesis_unavailable_reason,
  };
}
