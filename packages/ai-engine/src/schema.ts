import { z } from 'zod';

export const AnalysisResultSchema = z.object({
    summary: z.string(),
    bias_claim_quote: z.array(z.string()),
    justify_bias_claim: z.array(z.string()),
    biases: z.array(z.string()),
    counterpoints: z.array(z.string()),
    confidence: z.number().optional(),
    perspectives: z.array(z.object({
      frame: z.string(),
      reframe: z.string(),
    })).optional(),
    provider_id: z.string().optional(),
    model_id: z.string().optional(),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export enum AnalysisParseError {
    NO_JSON_OBJECT_FOUND = 'NO_JSON_OBJECT_FOUND',
    JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
    SCHEMA_VALIDATION_ERROR = 'SCHEMA_VALIDATION_ERROR'
}

export function parseAnalysisResponse(raw: string): AnalysisResult {
    // 1. Extract JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error(AnalysisParseError.NO_JSON_OBJECT_FOUND);
    }

    try {
        const parsed = JSON.parse(jsonMatch[0]);

        // 2. Unwrap if wrapped
        const payload = parsed.final_refined || parsed;

        // 3. Validate
        return AnalysisResultSchema.parse(payload);
    } catch (err) {
        if (err instanceof z.ZodError) {
            throw new Error(AnalysisParseError.SCHEMA_VALIDATION_ERROR);
        }
        throw new Error(AnalysisParseError.JSON_PARSE_ERROR);
    }
}
