# Spec: Issue #120 — VENN De-Mock (Contract-True)

**Issue:** https://github.com/CarbonCasteInc/VHC/issues/120
**Baseline SHA:** `c423429`
**Author:** Chief (spec phase)
**Date:** 2026-02-08

## 1. Acceptance Criteria

1. `AnalysisFeed.tsx` no longer contains inline `setTimeout`/mock generation for analysis content.
2. Analysis generation in `AnalysisFeed` calls through `packages/ai-engine` pipeline: `buildPrompt → EngineRouter.generate → parseAnalysisResponse → validateAnalysisAgainstSource`.
3. `CanonicalAnalysis` type in `analysis.ts` includes `schemaVersion: 'canonical-analysis-v1'`, optional `engine?: { id: string; kind: 'remote' | 'local'; modelName: string }`, optional `warnings?: string[]`.
4. `getOrGenerate` constructs records with `schemaVersion: 'canonical-analysis-v1'` and optional `engine`/`warnings` fields.
5. Persisted canonical records validate against `data-model/schemas.ts:CanonicalAnalysisSchema`.
6. Default engine policy remains `local-only`.
7. If engine is unavailable or throws, error propagates before `consumeAction` — no budget consumption on failure.
8. All existing budget, TOCTOU, and share behavior is preserved exactly.
9. No identity/nullifier/constituency data appears in `CanonicalAnalysis` records.
10. 100% line + branch coverage on all touched files.

## 2. Edge Cases & Abuse Cases

| # | Case | Expected Behavior |
|---|------|-------------------|
| E1 | Engine throws (unavailable/crash) | Error propagates to `getOrGenerate` caller; `consumeAction` never called; user sees error message |
| E2 | Engine returns malformed JSON | `parseAnalysisResponse` throws `AnalysisParseError`; no budget consumption |
| E3 | Engine returns valid JSON but schema-invalid | `parseAnalysisResponse` throws `SCHEMA_VALIDATION_ERROR`; no budget consumption |
| E4 | Concurrent double-submit (TOCTOU) | `isRunningRef` guard prevents second invocation (existing behavior, preserved) |
| E5 | Budget denied before engine call | Short-circuit returns `createBudgetDeniedResult` (existing behavior, preserved) |
| E6 | Engine returns warnings from validation | Warnings attached to `CanonicalAnalysis.warnings`; record still persisted |
| E7 | Reused analysis from cache/mesh | No engine call, no budget consumption, existing canonical record returned as-is |
| E8 | No nullifier present | Analysis generated without budget check (existing behavior, preserved) |
| E9 | Analysis result has `sentimentScore` missing from `AnalysisResult` (prompts.ts type) | `parseAnalysisResponse` enforces `sentimentScore` via `AnalysisResultSchema` — schema validation error |
| E10 | Share concurrent double-click | `isSharingRef` guard prevents (existing behavior, preserved) |

## 3. Touched-File Plan

### Modified Files

| File | Changes | Current LOC | Est. New LOC |
|------|---------|-------------|--------------|
| `packages/ai-engine/src/analysis.ts` | Add `schemaVersion`, `engine?`, `warnings?` to `CanonicalAnalysis`. Add `GenerateResult` type for enriched generator return. Update `getOrGenerate` signature + body. | 49 | ~70 |
| `packages/ai-engine/src/worker.ts` | Remove hardcoded `mockEngine`. Accept engine via factory/injection. Export `createAnalysisPipeline` for direct (non-worker) use. | 66 | ~75 |
| `packages/ai-engine/src/engines.ts` | Add `EngineUnavailableError` typed error. Improve fallback logic for `local-first`/`remote-first`. Add `createDefaultEngine` factory exporting the mock engine. | 41 | ~65 |
| `apps/web-pwa/src/routes/AnalysisFeed.tsx` | Replace inline mock `generate` function with pipeline call via imported `createAnalysisPipeline`. | 331 | ~320 |
| `packages/ai-engine/src/analysis.test.ts` | Update tests for new `CanonicalAnalysis` shape, `GenerateResult`, engine/warnings. | 77 | ~130 |
| `packages/ai-engine/src/worker.test.ts` | Update for pipeline extraction, remove mock-engine hardcoding from test setup. | 119 | ~140 |
| `packages/ai-engine/src/engines.test.ts` | Add tests for `EngineUnavailableError`, `createDefaultEngine`, improved fallback. | 57 | ~90 |
| `apps/web-pwa/src/routes/AnalysisFeed.test.tsx` | Update mock generator to match pipeline return type. Add tests for engine failure → no budget consumption. | 1081 | ~1120 |

### New Files

| File | Purpose | Est. LOC |
|------|---------|----------|
| `packages/ai-engine/src/pipeline.ts` | Extract `createAnalysisPipeline(engine?)` — reusable pipeline function: prompt → engine → parse → validate → attach metadata. Used by both worker.ts and direct import. | ~60 |
| `packages/ai-engine/src/pipeline.test.ts` | Tests for pipeline: success, parse error, validation warnings, engine failure. | ~100 |

### Unchanged Files (verify no regression)

- `packages/ai-engine/src/schema.ts` — no changes needed
- `packages/ai-engine/src/validation.ts` — no changes needed
- `packages/ai-engine/src/prompts.ts` — no changes needed
- `packages/data-model/src/schemas.ts` — no changes needed (already has correct `CanonicalAnalysisSchema`)

## 4. Type Changes

### `packages/ai-engine/src/analysis.ts`

```typescript
// BEFORE
export interface CanonicalAnalysis extends AnalysisResult {
  url: string;
  urlHash: string;
  timestamp: number;
}

// AFTER
export interface CanonicalAnalysis extends AnalysisResult {
  schemaVersion: 'canonical-analysis-v1';
  url: string;
  urlHash: string;
  timestamp: number;
  engine?: {
    id: string;
    kind: 'remote' | 'local';
    modelName: string;
  };
  warnings?: string[];
}
```

### `packages/ai-engine/src/pipeline.ts` (new)

```typescript
export interface PipelineResult {
  analysis: AnalysisResult;
  engine: { id: string; kind: 'remote' | 'local'; modelName: string };
  warnings: string[];
}

export function createAnalysisPipeline(
  engine?: JsonCompletionEngine
): (articleText: string) => Promise<PipelineResult>;
```

### `packages/ai-engine/src/engines.ts`

```typescript
// NEW
export class EngineUnavailableError extends Error {
  constructor(policy: EnginePolicy) {
    super(`No engine available for policy: ${policy}`);
    this.name = 'EngineUnavailableError';
  }
}

export function createDefaultEngine(): JsonCompletionEngine;
```

### `packages/ai-engine/src/analysis.ts` (getOrGenerate update)

```typescript
// BEFORE
export async function getOrGenerate(
  url: string,
  store: AnalysisStore,
  generate: (url: string) => Promise<AnalysisResult>
): Promise<{ analysis: CanonicalAnalysis; reused: boolean }>

// AFTER — accepts enriched generator
export interface GenerateResult {
  analysis: AnalysisResult;
  engine?: { id: string; kind: 'remote' | 'local'; modelName: string };
  warnings?: string[];
}

export async function getOrGenerate(
  url: string,
  store: AnalysisStore,
  generate: (url: string) => Promise<GenerateResult>
): Promise<{ analysis: CanonicalAnalysis; reused: boolean }>
```

## 5. Test Plan

### New Tests

| Test File | Tests | Coverage Target |
|-----------|-------|-----------------|
| `pipeline.test.ts` | 1) Pipeline success: prompt built, engine called, parse succeeds, warnings attached | 100% |
| | 2) Pipeline parse error: engine returns malformed JSON → AnalysisParseError thrown |
| | 3) Pipeline schema validation error: engine returns JSON missing required fields |
| | 4) Pipeline engine failure: engine.generate throws → EngineUnavailableError or original error propagates |
| | 5) Pipeline validation warnings: engine returns valid analysis with hallucinated year → warnings populated |
| | 6) Pipeline engine metadata: returned PipelineResult includes engine name/kind |

### Updated Tests

| Test File | Updates |
|-----------|---------|
| `analysis.test.ts` | Update `CanonicalAnalysis` fixtures to include `schemaVersion`. Update `getOrGenerate` tests: generator now returns `GenerateResult`. Add test: engine metadata flows through to canonical record. Add test: warnings flow through. |
| `engines.test.ts` | Add test: `EngineUnavailableError` is thrown with correct message. Add test: `createDefaultEngine` returns functional engine. |
| `worker.test.ts` | Update to use pipeline import instead of hardcoded mock. Verify worker still posts SUCCESS/ERROR correctly. |
| `AnalysisFeed.test.tsx` | Update mock generator to return `GenerateResult` shape. Add test: engine failure → no `consumeAction` call. Add test: parse failure → no `consumeAction` call. Verify existing budget/TOCTOU/share tests still pass. |

### Coverage Gate

- `pnpm test:coverage` must report 100% line + branch for:
  - `packages/ai-engine/src/analysis.ts`
  - `packages/ai-engine/src/pipeline.ts`
  - `packages/ai-engine/src/engines.ts`
  - `packages/ai-engine/src/worker.ts`
  - `apps/web-pwa/src/routes/AnalysisFeed.tsx`

## 6. Open Questions

| # | Question | Resolution |
|---|----------|------------|
| Q1 | Should `sentimentScore` be added to `AnalysisResult` in `prompts.ts`? Currently the type there omits it, but `schema.ts:AnalysisResultSchema` requires it. | **Resolution:** Leave `prompts.ts` type as-is (it represents the prompt's expected shape). The `schema.ts` `AnalysisResult` (Zod-inferred) is the runtime authority. The mock engine in `engines.ts` must include `sentimentScore`. |
| Q2 | Should `CanonicalAnalysis` in `analysis.ts` stay as `extends AnalysisResult` from `prompts.ts`, or switch to extending the Zod-inferred type from `schema.ts`? | **Resolution:** Switch to importing `AnalysisResult` from `schema.ts` instead of `prompts.ts`. This ensures `sentimentScore` is included and the type matches what `parseAnalysisResponse` returns. |
| Q3 | Should the mock engine be moved out of `worker.ts` into `engines.ts`? | **Resolution:** Yes — export `createDefaultEngine()` from `engines.ts`. Both `worker.ts` and `pipeline.ts` use it as the fallback local engine. |

## 7. Risk Notes

| Risk | Severity | Mitigation |
|------|----------|------------|
| Existing AnalysisFeed tests mock the `generate` function directly — changing its return type will require test updates | Medium | Careful, file-by-file test updates; run coverage after each change |
| `CanonicalAnalysis` shape change may break existing persisted data in localStorage | Low | Old records lacking `schemaVersion` will fail `CanonicalAnalysisSchema.parse()` but `AnalysisFeed` reads them via `loadFeed()` which doesn't validate. Add read-time migration or graceful fallback. |
| Worker uses `self.onmessage` which is Web Worker API — pipeline extraction must not break worker context | Medium | Keep worker.ts as a thin wrapper around the extracted pipeline. Pipeline function has no `self` dependency. |
| `AnalysisResult` type divergence between `prompts.ts` and `schema.ts` | Low | Resolved by Q2: switch analysis.ts to use schema.ts type |
| LOC budget for AnalysisFeed.tsx (currently 331, cap 350) | Medium | Pipeline extraction removes ~15 lines of mock code; net should stay under 350 |
