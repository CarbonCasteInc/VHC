# canonical-analysis-v1 Contract

**Status:** Locked for Sprints 2–3  
**Owner:** VENN Engine / Data Model  
**Reference:** `System_Architecture.md` §6.3

## 1. Type definition

```typescript
import { z } from 'zod';

export type BiasEntry = {
  bias: string;        // Debate-style claim capturing article’s slant
  quote: string;       // Direct quote from the article supporting the claim
  explanation: string; // Why this quote evidences the bias (short, academic)
  counterpoint: string;// Direct rebuttal / alternative framing
};

export interface AnalysisResult {
  summary: string;
  bias_claim_quote: string[];
  justify_bias_claim: string[];
  biases: string[];
  counterpoints: string[];
  sentimentScore: number; // [-1, 1]
  confidence?: number;    // [0, 1]
  perspectives?: Array<{ frame: string; reframe: string }>;
}

export const AnalysisResultSchema = z
  .object({
    summary: z.string().min(1),
    bias_claim_quote: z.array(z.string()),
    justify_bias_claim: z.array(z.string()),
    biases: z.array(z.string()),
    counterpoints: z.array(z.string()),
    sentimentScore: z.number().gte(-1).lte(1),
    confidence: z.number().gte(0).lte(1).optional(),
    perspectives: z
      .array(z.object({ frame: z.string(), reframe: z.string() }))
      .optional()
  })
  .strict()
  .refine(
    (val) =>
      val.bias_claim_quote.length === val.justify_bias_claim.length &&
      val.justify_bias_claim.length === val.biases.length &&
      val.biases.length === val.counterpoints.length,
    { message: 'bias arrays must be equal length' }
  );

export interface CanonicalAnalysisV1 {
  schemaVersion: 'canonical-analysis-v1';
  url: string;
  urlHash: string; // Stable hash of normalized URL
  summary: string; // 4–6 sentence neutral summary
  bias_claim_quote: string[];
  justify_bias_claim: string[];
  biases: string[];
  counterpoints: string[];
  perspectives?: Array<{ frame: string; reframe: string }>;
  sentimentScore: number; // [-1, 1]
  confidence?: number;    // [0, 1]
  timestamp: number;      // ms since epoch (first write)
}

export const CanonicalAnalysisSchema = z
  .object({
    schemaVersion: z.literal('canonical-analysis-v1'),
    url: z.string().url(),
    urlHash: z.string().min(1),
    summary: z.string().min(1),
    bias_claim_quote: z.array(z.string()),
    justify_bias_claim: z.array(z.string()),
    biases: z.array(z.string()),
    counterpoints: z.array(z.string()),
    perspectives: z.array(z.object({ frame: z.string(), reframe: z.string() })).optional(),
    sentimentScore: z.number().gte(-1).lte(1),
    confidence: z.number().gte(0).lte(1).optional(),
    timestamp: z.number().int().nonnegative()
  })
  .strict()
  .refine(
    (val) =>
      val.bias_claim_quote.length === val.justify_bias_claim.length &&
      val.justify_bias_claim.length === val.biases.length &&
      val.biases.length === val.counterpoints.length,
    { message: 'bias arrays must be equal length' }
  );
```

## 2. LLM contract

- Model returns a single JSON object shaped as:

```json
{
  "step_by_step": ["..."],
  "final_refined": {
    "summary": "...",
    "bias_claim_quote": ["..."],
    "justify_bias_claim": ["..."],
    "biases": ["..."],
    "counterpoints": ["..."],
    "sentimentScore": 0.0,
    "confidence": 0.0
  }
}
```

- Worker behavior:
  - Parses `rawContent` to extract the outermost JSON object.
  - If `{ step_by_step, final_refined }` is present, it treats `final_refined` as `AnalysisResult`.
  - Back-compat: if the top-level JSON already matches `AnalysisResult`, use it directly.
  - Validate the model payload with `AnalysisResultSchema` (not `CanonicalAnalysisSchema`).
  - `getOrGenerate(url, store, generate)` computes `urlHash`, calls `generate(url) → AnalysisResult`, builds:

```typescript
const canonical: CanonicalAnalysisV1 = {
  schemaVersion: 'canonical-analysis-v1',
  url,
  urlHash,
  timestamp: Date.now(),
  ...analysisResult
};
```

  - Validate with `CanonicalAnalysisSchema.parse(canonical)` before persisting.

## 3. Invariants

- Equal-length bias arrays (enforced via `refine`).
- Fact-only summaries/biases: no entities, dates, locations, or quantities absent from the source article.
- Deterministic JSON shape: stable field names; no extra keys.
- `schemaVersion` is required and immutable once stored.

## 4. First-to-file semantics

- `getOrGenerate(url, store, generate)` checks `store` by `urlHash`.
- If found: return `{ reused: true, analysis }`.
- If missing: call `generate()`, validate, persist, return `{ reused: false, analysis }`.
- v1 forbids overwriting existing canonical records. Amendments are future schema versions or separate signals.

## 5. Testing requirements

- Zod schema unit tests (valid payload passes; mismatched array lengths fail).
- Worker contract tests: wrapped vs raw responses; validation + caching path.
- Fact-only checks: reject summaries/biases that introduce unseen named entities.
- Fuzz tests: truncating article text must not yield longer/more specific summaries than the available text.
- Snapshot example payload to ensure deterministic JSON shape.
