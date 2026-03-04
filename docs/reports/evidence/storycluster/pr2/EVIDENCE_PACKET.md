# STORYCLUSTER PR2 Evidence Packet — ClusterEngine Abstraction + Dual-Path Routing

Date: 2026-03-04 (UTC)
Branch: `coord/storycluster-pr2-clusterengine-abstraction`
Authoritative worktree: `/srv/trinity/worktrees/live-main`

## Scope lock (PR2 only)

1. Introduce `ClusterEngine` abstraction for shared clustering pipeline usage.
2. Route both sync and async story-cluster paths through this abstraction.
3. Preserve PR0/PR1 contracts (story identity invariants, `created_at` first-write-wins, latest-index activity semantics, lease assumptions).
4. Add deterministic PR2 evidence artifacts.

## Acceptance matrix

| Criterion | Status | Evidence |
|---|---|---|
| 1) `ClusterEngine` abstraction introduced | PASS | `packages/ai-engine/src/clusterEngine.ts` (`ClusterEngine`, `HeuristicClusterEngine`, `StoryClusterRemoteEngine`, `AutoEngine`) + `packages/ai-engine/src/__tests__/clusterEngine.test.ts` |
| 2) Sync + async clustering paths routed through abstraction | PASS | Sync: `packages/ai-engine/src/newsCluster.ts` (`clusterItems` via `runClusterBatchSync`), `services/news-aggregator/src/cluster.ts` (`clusterItems` via `runClusterBatchSync`); Async: `packages/ai-engine/src/newsOrchestrator.ts` + `services/news-aggregator/src/orchestrator.ts` via `runClusterBatch` |
| 3) Remote-down deterministic fallback | PASS | `AutoEngine` fallback behavior in `packages/ai-engine/src/clusterEngine.ts`; regression tests in `packages/ai-engine/src/__tests__/clusterEngine.test.ts` and `packages/ai-engine/src/__tests__/newsOrchestrator.test.ts` |
| 4) PR0/PR1 contract behavior preserved | PASS | No changes to PR0/PR1 contract-critical paths (`packages/gun-client/src/newsAdapters.ts`, lease/runtime writers, discovery hydration/index semantics). Story bundle identity generation preserved via heuristic clustering path now wrapped by engine abstraction (`newsCluster.ts`) |
| 5) Duplicate active clustering path removed from runtime orchestration path | PASS | Both orchestrators now call cluster engines through a single batch abstraction (`runClusterBatch`) rather than direct algorithm calls |

## Exact targeted test commands executed

1. `pnpm exec vitest run packages/ai-engine/src/__tests__/clusterEngine.test.ts packages/ai-engine/src/__tests__/newsOrchestrator.test.ts packages/ai-engine/src/__tests__/newsCluster.test.ts packages/ai-engine/src/__tests__/bundleVerification.test.ts packages/ai-engine/src/newsRuntime.test.ts`
2. `pnpm --dir services/news-aggregator exec vitest run src/cluster.test.ts src/orchestrator.test.ts`
3. `set -o pipefail; node tools/scripts/check-diff-coverage.mjs 2>&1 | rg "Coverage summary|Statements|Branches|Functions|Lines|Diff Coverage"`

## Test log artifacts

- `docs/reports/evidence/storycluster/pr2/test-command-1-ai-engine.txt`
- `docs/reports/evidence/storycluster/pr2/test-command-2-news-aggregator.txt`
- `docs/reports/evidence/storycluster/pr2/test-command-3-diff-coverage.txt`

## Files changed for PR2

- `packages/ai-engine/src/clusterEngine.ts`
- `packages/ai-engine/src/__tests__/clusterEngine.test.ts`
- `packages/ai-engine/src/newsCluster.ts`
- `packages/ai-engine/src/newsOrchestrator.ts`
- `packages/ai-engine/src/__tests__/newsOrchestrator.test.ts`
- `packages/ai-engine/src/index.ts`
- `services/news-aggregator/src/cluster.ts`
- `services/news-aggregator/src/orchestrator.ts`
- `services/news-aggregator/src/orchestrator.test.ts`
- `services/news-aggregator/src/index.ts`
