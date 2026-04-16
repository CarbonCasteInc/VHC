import { z } from 'zod';

const AnalysisPerspectiveSchema = z.object({
  id: z.string().min(1).optional(),
  frame: z.string().min(1),
  reframe: z.string().min(1),
});

export const AnalysisProviderSchema = z.object({
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  kind: z.enum(['local', 'remote']).optional(),
});

export const AnalysisResultSchema = z.object({
  summary: z.string(),
  bias_claim_quote: z.array(z.string()),
  justify_bias_claim: z.array(z.string()),
  biases: z.array(z.string()),
  counterpoints: z.array(z.string()),
  sentimentScore: z.number().min(-1).max(1).optional(),
  confidence: z.number().optional(),
  perspectives: z.array(AnalysisPerspectiveSchema).optional(),
  provider_id: z.string().min(1).optional(),
  model_id: z.string().min(1).optional(),
  provider: AnalysisProviderSchema.optional(),
});

export function isPlaceholderPerspectiveText(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!]+$/g, '');
  return normalized === 'n/a'
    || normalized === 'na'
    || normalized === 'n.a'
    || normalized === 'not applicable'
    || normalized === 'no clear bias detected';
}

const GeneratedPerspectiveTextSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: 'Generated perspective text must be non-empty after trimming',
  })
  .refine((value) => !isPlaceholderPerspectiveText(value), {
    message: 'Generated perspective text cannot be a placeholder',
  });

const GeneratedAnalysisPerspectiveSchema = AnalysisPerspectiveSchema.extend({
  frame: GeneratedPerspectiveTextSchema,
  reframe: GeneratedPerspectiveTextSchema,
});

export const GeneratedAnalysisResultSchema = AnalysisResultSchema.extend({
  perspectives: z.array(GeneratedAnalysisPerspectiveSchema).min(1),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type GeneratedAnalysisResult = z.infer<typeof GeneratedAnalysisResultSchema>;

export enum AnalysisParseError {
  NO_JSON_OBJECT_FOUND = 'NO_JSON_OBJECT_FOUND',
  JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
  SCHEMA_VALIDATION_ERROR = 'SCHEMA_VALIDATION_ERROR',
}

function parseAnalysisResponseWithSchema<T>(
  raw: string,
  schema: z.ZodType<T>,
): T {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(AnalysisParseError.NO_JSON_OBJECT_FOUND);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const payload = parsed.final_refined || parsed;
    return schema.parse(payload);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(AnalysisParseError.SCHEMA_VALIDATION_ERROR);
    }
    throw new Error(AnalysisParseError.JSON_PARSE_ERROR);
  }
}

export function parseAnalysisResponse(raw: string): AnalysisResult {
  return parseAnalysisResponseWithSchema(raw, AnalysisResultSchema);
}

export function parseGeneratedAnalysisResponse(raw: string): GeneratedAnalysisResult {
  return parseAnalysisResponseWithSchema(raw, GeneratedAnalysisResultSchema);
}
