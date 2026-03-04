# StoryCluster PR4 Evidence Packet

## Scope + branch
- Branch: `coord/storycluster-pr4-engine-phase1`
- PR target: Draft PR #365
- Scope implemented: PR4 items only (language/translation gate, near-dup collapse, embeddings retrieval + hybrid assignment, stable incremental story IDs, canonical summary generation, feature emission, enrichment work-item emission/non-blocking)

## Code evidence map

1. **Language detect + selective translation gate**
   - `packages/ai-engine/src/newsNormalize.ts`
   - Deterministic language detection + lexicon-gated translation for supported non-English content.

2. **Near-duplicate collapse (text + image where available)**
   - `packages/ai-engine/src/newsNormalize.ts`
   - `packages/ai-engine/src/newsCluster.ts`
   - URL canonical dedup + similarity/image-hash collapse.

3. **Embeddings + retrieval + hybrid assignment**
   - `packages/ai-engine/src/newsCluster.ts`
   - Local deterministic embeddings, cosine/Jaccard/source overlap hybrid score.

4. **Stable incremental cluster assignment**
   - `packages/ai-engine/src/newsCluster.ts`
   - Topic-scoped in-memory assignment state with retrieval-based story ID reuse.

5. **Canonical 2–3 sentence summary into `summary_hint`**
   - `packages/ai-engine/src/newsCluster.ts`
   - Canonical summary builder now always emits 2–3 sentence summaries.

6. **Coverage/velocity/confidence features emitted**
   - `packages/ai-engine/src/newsCluster.ts`
   - `packages/ai-engine/src/newsTypes.ts`
   - `packages/data-model/src/schemas/hermes/storyBundle.ts`
   - Adds optional `coverage_score`, `velocity_score`, `confidence_score`, `primary_language`, `translation_applied`.

7. **Enrichment work-item emission, non-blocking publish**
   - `packages/ai-engine/src/newsCluster.ts` (`buildEnrichmentWorkItems`)
   - `packages/ai-engine/src/newsRuntime.ts`
   - Runtime writes bundle first, then async emits enrichment candidate/work items with error isolation (`Promise.resolve(...).catch(...)`).

## Exact command logs
- `docs/reports/evidence/storycluster/pr4/test-command-1-ai-engine-core.txt`
- `docs/reports/evidence/storycluster/pr4/test-command-2-ai-engine-typecheck.txt`
- `docs/reports/evidence/storycluster/pr4/test-command-3-news-aggregator.txt`
- `docs/reports/evidence/storycluster/pr4/test-command-4-news-aggregator-typecheck.txt`
- `docs/reports/evidence/storycluster/pr4/test-command-5-diff-coverage.txt`

## Acceptance matrix

| PR4 acceptance criterion | Status | Deterministic evidence |
|---|---|---|
| Stable `story_id` across updates | PASS | `packages/ai-engine/src/__tests__/newsCluster.test.ts` (`keeps stable story_id across incremental updates via hybrid assignment`) |
| Duplicate collapse improves source grouping quality | PASS | `packages/ai-engine/src/__tests__/newsNormalize.test.ts`, `packages/ai-engine/src/__tests__/newsCluster.test.ts` near-dup collapse tests (text + image signatures) |
| Generated summaries populate `summary_hint` reliably | PASS | `packages/ai-engine/src/__tests__/newsCluster.test.ts` validates canonical 2–3 sentence `summary_hint`; runtime tests exercise downstream usage |
| Enrichment failures/timeouts do **not** block publication/ordering updates | PASS | `packages/ai-engine/src/newsRuntime.test.ts` (`does not block story publish when enrichment callback fails asynchronously`) and daemon queue non-blocking tests in `services/news-aggregator/src/daemon.test.ts` |

## Contract safety
- PR0/PR1/PR3 contract-critical paths preserved.
- Additions are additive/optional schema extensions (`cluster_features`, `RawFeedItem.imageUrl`) and do not remove existing required fields.
- Per-file diff coverage gate: PASS (100% line + 100% branch on changed source files; see command log #5).
