# STORYCLUSTER PR3 Evidence Packet — Daemon Canonical Writer

Date: 2026-03-04 (UTC)
Branch: `coord/storycluster-pr3-daemon-canonical-writer`
Authoritative worktree: `/srv/trinity/worktrees/live-main`

## Scope lock (PR3 only)

1. Add daemon entrypoint in `services/news-aggregator` for scheduled ingest + publish.
2. Enforce daemon lease acquisition before writes.
3. Browser runtime defaults to consumer mode for normal runs (explicit dev ingester override retained).
4. Add daemon-managed async enrichment queue wiring that is non-blocking from publish path.

## Acceptance matrix

| Criterion | Status | Evidence |
|---|---|---|
| PWA shows live headlines without browser ingest authority | PASS | `apps/web-pwa/src/store/newsRuntimeBootstrap.ts` now defaults `auto` role to consumer outside `MODE=test`; explicit regression in `apps/web-pwa/src/store/newsRuntimeBootstrap.test.ts` (`defaults browser runtime to consumer mode outside test mode`), and live-feed hydration contracts remain covered by `apps/web-pwa/src/store/news/{hydration,index}.test.ts` |
| Daemon continuously updates StoryBundles + indexes | PASS | New daemon entrypoint in `services/news-aggregator/src/daemon.ts` starts `startNewsRuntime` in daemon mode (`enabled: true`), acquires/renews ingestion lease, and writes through guarded publish adapter; coverage in `services/news-aggregator/src/daemon.test.ts` (`acquires lease before starting runtime`, `renews lease on heartbeat ticks while running`, publish/write-path tests) |
| StoryBundle/index publish latency not coupled to enrichment completion | PASS | `services/news-aggregator/src/daemon.ts` introduces async enrichment queue (`queueMicrotask` drain, fire-and-forget enqueue). Verified by `services/news-aggregator/src/daemon.test.ts` (`wires async enrichment queue without blocking publish path`) where publish resolves while enrichment worker promise remains pending |

## Exact targeted test commands executed

1. `pnpm exec vitest run packages/ai-engine/src/newsRuntime.test.ts apps/web-pwa/src/store/newsRuntimeBootstrap.test.ts`
2. `pnpm --dir services/news-aggregator exec vitest run src/daemon.test.ts src/cluster.test.ts src/orchestrator.test.ts`
3. `pnpm --dir services/news-aggregator exec tsc --noEmit`
4. `node tools/scripts/check-diff-coverage.mjs`
5. `pnpm exec vitest run apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/news/index.test.ts`

## Test log artifacts

- `docs/reports/evidence/storycluster/pr3/test-command-1-runtime-and-browser.txt`
- `docs/reports/evidence/storycluster/pr3/test-command-2-news-aggregator-daemon.txt`
- `docs/reports/evidence/storycluster/pr3/test-command-3-news-aggregator-typecheck.txt`
- `docs/reports/evidence/storycluster/pr3/test-command-4-diff-coverage.txt`
- `docs/reports/evidence/storycluster/pr3/test-command-5-pwa-news-store-hydration.txt`

## Files changed for PR3

- `apps/web-pwa/src/store/newsRuntimeBootstrap.ts`
- `apps/web-pwa/src/store/newsRuntimeBootstrap.test.ts`
- `packages/ai-engine/src/newsRuntime.ts`
- `packages/ai-engine/src/newsRuntime.test.ts`
- `services/news-aggregator/src/daemon.ts`
- `services/news-aggregator/src/daemon.test.ts`
- `services/news-aggregator/src/index.ts`
- `services/news-aggregator/package.json`
- `services/news-aggregator/vitest.config.ts`
- `pnpm-lock.yaml`

## CI Unblock Addendum (Diff-coverage branch at runtime mode fallback)

Trigger: PR #364 `Test & Build` diff-aware coverage gate reported uncovered branch on `apps/web-pwa/src/store/newsRuntimeBootstrap.ts` line 90.

### Remediation
- Added explicit test case for blank `MODE` fallback path in auto role:
  - `apps/web-pwa/src/store/newsRuntimeBootstrap.test.ts`
  - test: `treats blank MODE as test fallback in auto role`

### Additional exact commands
6. `pnpm exec vitest run packages/ai-engine/src/newsRuntime.test.ts apps/web-pwa/src/store/newsRuntimeBootstrap.test.ts`
7. `node tools/scripts/check-diff-coverage.mjs`

### Additional artifacts
- `docs/reports/evidence/storycluster/pr3/test-command-6-runtime-mode-blank-fallback.txt`
- `docs/reports/evidence/storycluster/pr3/test-command-7-diff-coverage-remediation.txt`

### Addendum acceptance checks
| Criterion | Status | Evidence |
|---|---|---|
| runtime mode fallback branch fully covered | PASS | `newsRuntimeBootstrap.test.ts` blank MODE fallback test |
| per-file strict diff coverage (100/100) | PASS | `test-command-7-diff-coverage-remediation.txt` |
