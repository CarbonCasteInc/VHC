# STORYCLUSTER Cluster Execution Status — 2026-03-04

## Kickoff (PR0)

- Branch: `coord/storycluster-pr0-contract-freeze`
- Baseline source: `origin/main`
- Baseline verification commands:
  - `git fetch origin && git checkout -B coord/storycluster-pr0-contract-freeze origin/main`
  - `git rev-parse --short origin/main` → `9d6affa`
  - `git rev-parse --short HEAD` (post-checkout baseline) → `9d6affa`

## PR0 Milestone — Contract Freeze + Test Harness Alignment (Completed)

### Delivered

1. **StoryBundle + NEWS_STORY identity contract freeze**
   - Added explicit `story_id?: string` to discovery `FeedItem` contract.
   - Discovery dedupe contract now prefers `story_id` when present, with legacy fallback keying when absent.
   - News→discovery projection now forwards `StoryBundle.story_id`.

2. **Latest-index migration fixtures + compatibility checks**
   - Added deterministic fixtures:
     - `packages/gun-client/src/__fixtures__/latestIndexMigrationFixtures.ts`
   - Updated readers to accept legacy and target payloads:
     - scalar timestamp values
     - `{ cluster_window_end }`
     - `{ latest_activity_at }`
     - `{ created_at }`
   - Added precedence check for mixed payload objects.

3. **Created_at + lease baseline documentation**
   - Added PR0 contract note:
     - `docs/plans/STORYCLUSTER_PR0_CONTRACT_FREEZE_NOTES.md`
   - Explicitly documents PR0 lease behavior as unchanged baseline.

### Deterministic artifact list

- `docs/plans/STORYCLUSTER_PR0_CONTRACT_FREEZE_NOTES.md`
- `packages/gun-client/src/__fixtures__/latestIndexMigrationFixtures.ts`
- `docs/reports/evidence/storycluster/pr0/test-data-model-discovery.log`
- `docs/reports/evidence/storycluster/pr0/test-gun-client-newsAdapters.log`
- `docs/reports/evidence/storycluster/pr0/test-web-pwa-storycluster-pr0.log`
- `docs/reports/evidence/storycluster/pr0/test-pr0-regression-full.log`

### Targeted validation commands executed

1. `pnpm exec vitest run packages/data-model/src/schemas/hermes/discovery.test.ts`
2. `pnpm exec vitest run packages/gun-client/src/newsAdapters.test.ts`
3. `pnpm exec vitest run apps/web-pwa/src/store/discovery/store.test.ts apps/web-pwa/src/store/feedBridge.test.ts apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/news/index.test.ts`
4. `pnpm exec vitest run packages/gun-client/src/newsAdapters.test.ts apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/discovery/store.test.ts apps/web-pwa/src/store/feedBridge.test.ts apps/web-pwa/src/store/news/index.test.ts packages/data-model/src/schemas/hermes/discovery.test.ts`

## PR0 Closure Packet (Merged)

- PR: `#361` — https://github.com/CarbonCasteInc/VHC/pull/361
- Head SHA (final PR head): `2c6f3522993a88e9d90ab6738c6f9901f02461a5`
- Merge commit on `main`: `9b751e6`
- Merge time (UTC): `2026-03-04T14:29:00Z`

### Exact PR0 test commands (as executed)
1. `pnpm exec vitest run packages/data-model/src/schemas/hermes/discovery.test.ts`
2. `pnpm exec vitest run packages/gun-client/src/newsAdapters.test.ts`
3. `pnpm exec vitest run apps/web-pwa/src/store/discovery/store.test.ts apps/web-pwa/src/store/feedBridge.test.ts apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/news/index.test.ts`
4. `pnpm exec vitest run packages/gun-client/src/newsAdapters.test.ts apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/discovery/store.test.ts apps/web-pwa/src/store/feedBridge.test.ts apps/web-pwa/src/store/news/index.test.ts packages/data-model/src/schemas/hermes/discovery.test.ts`

### Exact PR0 artifact paths
- `docs/plans/STORYCLUSTER_PR0_CONTRACT_FREEZE_NOTES.md`
- `docs/reports/evidence/storycluster/pr0/test-data-model-discovery.log`
- `docs/reports/evidence/storycluster/pr0/test-gun-client-newsAdapters.log`
- `docs/reports/evidence/storycluster/pr0/test-web-pwa-storycluster-pr0.log`
- `docs/reports/evidence/storycluster/pr0/test-pr0-regression-full.log`
- `packages/gun-client/src/__fixtures__/latestIndexMigrationFixtures.ts`

### PR0 acceptance matrix
| Criterion | Status | Evidence |
|---|---|---|
| Identity contract behavior | PASS | `packages/data-model/src/schemas/hermes/discovery.ts`; `apps/web-pwa/src/store/discovery/index.ts`; related tests |
| `created_at` immutability expectation | PASS | `docs/specs/spec-news-aggregator-v0.md`; `packages/gun-client/src/newsAdapters.test.ts` |
| Latest-index semantics (legacy + target compatibility) | PASS | `packages/gun-client/src/newsAdapters.ts`; `apps/web-pwa/src/store/news/hydration.ts`; migration fixture + tests |
| Lease behavior baseline unchanged in PR0 | PASS | `docs/plans/STORYCLUSTER_PR0_CONTRACT_FREEZE_NOTES.md` |
| CI required checks green | PASS | GH run `22671517002` (all checks pass) |
| CE dual review convergence | PASS | ce1 round-3 `AGREE`; ce2 round-2 `AGREE` on final head |

## PR1 Kickoff (In Progress)

- Branch: `coord/storycluster-pr1-feed-correctness-hardening`
- Baseline: `main @ 9b751e6` (post-PR0 merge)
- Scope source: `docs/plans/STORYCLUSTER_INTEGRATION_EXECUTION_PLAN.md` (PR1 section)
- Immediate PR1 implementation targets:
  1. `story_id` propagation hardening across discovery/feed bridge/news hydration.
  2. `created_at` first-write-wins enforcement on re-ingest.
  3. latest-index activity semantics write cutover with legacy read fallback preserved.
  4. single-writer lease behavior enforcement path.
  5. stable feed/card identity (no remount churn from timestamp updates).
