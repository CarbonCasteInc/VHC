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
