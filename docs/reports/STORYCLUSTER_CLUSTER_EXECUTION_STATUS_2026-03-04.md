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

## PR1 Closure Packet (Draft Updated)

- PR: `#362` — https://github.com/CarbonCasteInc/VHC/pull/362
- Branch: `coord/storycluster-pr1-feed-correctness-hardening`
- Evidence packet: `docs/reports/evidence/storycluster/pr1/EVIDENCE_PACKET.md`

### Exact PR1 targeted test commands (as executed)
1. `pnpm test:quick apps/web-pwa/src/store/newsRuntimeBootstrap.test.ts apps/web-pwa/src/store/news/index.test.ts apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/feedBridge.test.ts apps/web-pwa/src/components/feed/FeedShell.test.tsx apps/web-pwa/src/components/feed/NewsCard.test.tsx packages/gun-client/src/newsAdapters.test.ts packages/gun-client/src/topology.test.ts`
2. `pnpm test:quick apps/web-pwa/src/components/feed/NewsCard.expandedFocus.test.tsx apps/web-pwa/src/components/feed/NewsCard.sharedTopicIsolation.test.tsx apps/web-pwa/src/store/discovery/store.test.ts`

### Exact PR1 artifact paths
- `docs/reports/evidence/storycluster/pr1/EVIDENCE_PACKET.md`
- `docs/reports/evidence/storycluster/pr1/test-command-1.txt`
- `docs/reports/evidence/storycluster/pr1/test-command-2.txt`

### PR1 acceptance matrix
| Criterion | Status | Evidence |
|---|---|---|
| `story_id` propagation hardening (discovery/feed bridge/hydration) | PASS | `apps/web-pwa/src/store/news/hydration.ts`; `apps/web-pwa/src/store/feedBridge.ts`; `apps/web-pwa/src/components/feed/NewsCard.tsx`; tests |
| `created_at` first-write-wins on re-ingest | PASS | `packages/gun-client/src/newsAdapters.ts`; `apps/web-pwa/src/store/news/index.ts`; tests |
| latest-index write cutover to `cluster_window_end` with legacy read fallback | PASS | `packages/gun-client/src/newsAdapters.ts`; `apps/web-pwa/src/store/news/hydration.ts`; tests |
| single-writer lease behavior | PASS | `packages/gun-client/src/newsAdapters.ts`; `packages/gun-client/src/topology.ts`; `apps/web-pwa/src/store/newsRuntimeBootstrap.ts`; tests |
| story-identity feed/card key stability | PASS | `apps/web-pwa/src/components/feed/FeedShell.tsx`; `apps/web-pwa/src/components/feed/NewsCard.tsx`; tests |

### PR1 CI Unblock Packet (Coverage + Lease Evidence)

- Updated head candidate after unblock: `bad505cf02c4a92c20a3447f08f407c97dc27445`
- Focused remediation:
  - hardened runtime lease-path behavior evidence in `newsRuntimeBootstrap.ts`/tests
  - covered concurrent startup guard branch
  - reran strict diff coverage gate

#### Exact unblock commands
1. `pnpm exec vitest run apps/web-pwa/src/store/newsRuntimeBootstrap.test.ts apps/web-pwa/src/store/news/index.test.ts apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/feedBridge.test.ts packages/gun-client/src/newsAdapters.test.ts packages/gun-client/src/topology.test.ts`
2. `node tools/scripts/check-diff-coverage.mjs`

#### Exact unblock artifacts
- `docs/reports/evidence/storycluster/pr1/test-command-3-lease-coverage.txt`
- `docs/reports/evidence/storycluster/pr1/test-command-4-diff-coverage.txt`

#### Unblock result
- Diff-aware per-file gate: PASS (`100% lines + 100% branches` on changed source files)
- CI required checks on PR #362: green on latest evaluated head (`bad505c`)

### PR1 CE Round-2 Remediation (Lease continuity + resolver canonicalization)

- Scope addressed:
  1. runtime lease continuity via periodic renewal heartbeat and fail-closed stop on renewal failure
  2. canonical `story_id`-first bundle resolution in `NewsCardWithRemoval`
- Additional deterministic artifacts added:
  - `docs/reports/evidence/storycluster/pr1/test-command-5-lease-heartbeat-and-storyid.txt`
  - `docs/reports/evidence/storycluster/pr1/test-command-6-diff-coverage-post-lease-fix.txt`
- Local strict gate result: diff coverage PASS (100% lines + 100% branches on changed source files).
