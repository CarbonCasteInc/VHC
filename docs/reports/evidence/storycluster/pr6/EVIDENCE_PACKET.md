# PR6 Evidence Packet — Advanced Story Pipeline (ME tuples, grounding, drift, timeline)

- Date (UTC): 2026-03-04
- Branch: `coord/storycluster-pr6-advanced-pipeline`
- PR: `#367` — https://github.com/CarbonCasteInc/VHC/pull/367
- Scope lock: PR6 only (`ME extraction + linking + temporal normalization`, `rerank/adjudication`, `GDELT grounding + impact blend`, `periodic refinement + drift metrics`, `timeline/sub-event graph`)

## Changed contract surfaces (PR6)

1. **ME tuple extraction + entity linking + temporal normalization**
   - `packages/ai-engine/src/newsAdvancedPipeline.ts`
   - Deterministic candidate extraction, canonical entity links, mention resolution fallback behavior, ISO/relative/published/fallback temporal normalization.

2. **Rerank/adjudication gates**
   - `packages/ai-engine/src/newsAdvancedPipeline.ts`
   - Deterministic ranking comparator and adjudication thresholds (`accepted/review/rejected`) with guard to ensure non-empty review surface when all tuples score low.

3. **GDELT grounding + impact blending**
   - `packages/ai-engine/src/newsAdvancedPipeline.ts`
   - GDELT aggregate rollup with deterministic ordering + impact blend components (`cluster_signal`, `gdelt_signal`, `adjudication_signal`).

4. **Periodic cluster refinement + drift metrics**
   - `packages/ai-engine/src/newsAdvancedPipeline.ts`
   - Refinement windows and drift metrics (`entity_drift`, `tuple_drift`, `temporal_drift`, `sub_event_drift`, composite).

5. **Timeline/sub-event graph outputs**
   - `packages/ai-engine/src/newsAdvancedPipeline.ts`
   - Deterministic timeline nodes/edges and windowed sub-event derivation with dominant-entity tie break.

6. **Strict diff-coverage remediation tests for CI unblock**
   - `packages/ai-engine/src/newsAdvancedPipeline.test.ts`
   - Added focused branch/line tests for temporal branches, entity fallback/dedupe, tuple-init branches, rerank tie-breaks, grounding aggregation, blend empty/non-empty branches, refinement/timeline same-window paths.

## Validation commands (exact)

1. `pnpm vitest run packages/ai-engine/src/newsAdvancedPipeline.test.ts packages/ai-engine/src/newsRuntime.test.ts packages/ai-engine/src/__tests__/newsCluster.test.ts packages/ai-engine/src/__tests__/newsOrchestrator.test.ts`
2. `pnpm --filter @vh/ai-engine typecheck`
3. `pnpm --filter @vh/news-aggregator test`
4. `pnpm --filter @vh/news-aggregator typecheck`
5. `node tools/scripts/check-diff-coverage.mjs`
6. `pnpm vitest run packages/ai-engine/src/newsAdvancedPipeline.test.ts packages/ai-engine/src/newsRuntime.test.ts`
7. `pnpm --filter @vh/ai-engine typecheck`

## Command logs (exact paths)

- `docs/reports/evidence/storycluster/pr6/test-command-1-focused-vitest.txt`
- `docs/reports/evidence/storycluster/pr6/test-command-2-ai-engine-typecheck.txt`
- `docs/reports/evidence/storycluster/pr6/test-command-3-news-aggregator.txt`
- `docs/reports/evidence/storycluster/pr6/test-command-4-news-aggregator-typecheck.txt`
- `docs/reports/evidence/storycluster/pr6/test-command-5-diff-coverage.txt`
- `docs/reports/evidence/storycluster/pr6/test-command-6-interim-focused-vitest.txt`
- `docs/reports/evidence/storycluster/pr6/test-command-7-interim-ai-engine-typecheck.txt`

## Acceptance matrix (PR6)

| Criterion | Status | Evidence |
|---|---|---|
| ME tuple extraction + entity linking + temporal normalization | PASS | `newsAdvancedPipeline.ts` + deterministic coverage in `newsAdvancedPipeline.test.ts` |
| rerank/adjudication gates | PASS | `rerankAndAdjudicateTuples` branch coverage incl. all-low guard |
| GDELT grounding + impact blending | PASS | `buildGdeltGrounding`/`buildImpactBlend` tests for aggregate + empty/non-empty branches |
| periodic cluster refinement + drift metrics | PASS | `buildRefinementWindows`/`computeDriftMetrics` multi-shape tuple distributions |
| timeline/sub-event graph outputs | PASS | `buildTimelineGraph` tests for fallback, shared-edge, tie ordering, dominant entity fallback |
| PR0–PR5 contracts preserved | PASS | PR6 diff scoped to advanced-pipeline surface + tests; no removal/mutation of prior contract paths |
| deterministic behavior for same inputs | PASS | repeated artifact build equality + source-order invariance assertions |
| strict per-file diff coverage pass | PASS | `test-command-5-diff-coverage.txt` (100% lines + 100% branches on changed source files) |

## CI unblock addendum (run 22688301958)

- Trigger: diff-coverage failure concentrated in `packages/ai-engine/src/newsAdvancedPipeline.ts` with uncovered line/branch clusters.
- Remediation strategy: **A (focused tests)**.
  - Added targeted tests to cover all reported branch/line groups (temporal parsing branches, entity/link branches, tuple init and ranking tie-break branches, grounding/blend branches, refinement/timeline aggregation branches).
- Result: local diff-coverage gate now passes at 100% line + 100% branch for all changed source files.
