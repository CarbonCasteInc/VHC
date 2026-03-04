# STORYCLUSTER PR1 Evidence Packet — Feed Correctness Hardening

Date: 2026-03-04 (UTC)
Branch: `coord/storycluster-pr1-feed-correctness-hardening`
Authoritative worktree: `/srv/trinity/worktrees/live-main`

## Scope lock (PR1 only)

1. `story_id` propagation hardening across discovery/feed bridge/news hydration.
2. `created_at` first-write-wins for re-ingest on the same story identity.
3. latest-index write cutover to activity semantics (`cluster_window_end`) with legacy read fallback preserved.
4. single-writer lease behavior in ingestion runtime path.
5. feed/card identity re-keyed to story identity to eliminate timestamp remount churn.

## Acceptance matrix

| Criterion | Status | Evidence |
|---|---|---|
| 1) `story_id` propagation hardening | PASS | `apps/web-pwa/src/store/news/hydration.ts`; `apps/web-pwa/src/store/feedBridge.ts`; `apps/web-pwa/src/components/feed/NewsCard.tsx`; `apps/web-pwa/src/components/feed/FeedShell.tsx`; tests in `news/hydration.test.ts`, `feedBridge.test.ts`, `NewsCard.test.tsx`, `FeedShell.test.tsx` |
| 2) `created_at` first-write-wins on re-ingest | PASS | `packages/gun-client/src/newsAdapters.ts` (`writeNewsStory` first-write-wins guard); `apps/web-pwa/src/store/news/index.ts` local freeze on merges; tests in `newsAdapters.test.ts` and `news/index.test.ts` |
| 3) latest-index write cutover to activity semantics | PASS | `packages/gun-client/src/newsAdapters.ts` (`writeNewsBundle` writes `cluster_window_end`); legacy read fallback remains in `readNewsLatestIndex` + `apps/web-pwa/src/store/news/hydration.ts`; tests in `newsAdapters.test.ts` + `news/hydration.test.ts` |
| 4) single-writer lease behavior | PASS | New lease adapters + topology allowlist in `packages/gun-client/src/newsAdapters.ts` and `packages/gun-client/src/topology.ts`; runtime enforcement in `apps/web-pwa/src/store/newsRuntimeBootstrap.ts`; tests in `newsRuntimeBootstrap.test.ts`, `newsAdapters.test.ts`, `topology.test.ts` |
| 5) stable feed/card identity keyed to story identity | PASS | `FeedShell` list key + row id now story-based (`story_id` first); `NewsCard` instance key + story resolution now story-id-first; tests in `FeedShell.test.tsx`, `NewsCard.test.tsx`, and shared-topic/expanded focus suites |

## Exact targeted test commands executed

1. `pnpm test:quick apps/web-pwa/src/store/newsRuntimeBootstrap.test.ts apps/web-pwa/src/store/news/index.test.ts apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/feedBridge.test.ts apps/web-pwa/src/components/feed/FeedShell.test.tsx apps/web-pwa/src/components/feed/NewsCard.test.tsx packages/gun-client/src/newsAdapters.test.ts packages/gun-client/src/topology.test.ts`
2. `pnpm test:quick apps/web-pwa/src/components/feed/NewsCard.expandedFocus.test.tsx apps/web-pwa/src/components/feed/NewsCard.sharedTopicIsolation.test.tsx apps/web-pwa/src/store/discovery/store.test.ts`

## Test log artifacts

- `docs/reports/evidence/storycluster/pr1/test-command-1.txt`
- `docs/reports/evidence/storycluster/pr1/test-command-2.txt`

## Files changed for PR1

- `apps/web-pwa/src/components/feed/FeedShell.tsx`
- `apps/web-pwa/src/components/feed/FeedShell.test.tsx`
- `apps/web-pwa/src/components/feed/NewsCard.tsx`
- `apps/web-pwa/src/components/feed/NewsCard.test.tsx`
- `apps/web-pwa/src/store/feedBridge.ts`
- `apps/web-pwa/src/store/feedBridge.test.ts`
- `apps/web-pwa/src/store/news/hydration.ts`
- `apps/web-pwa/src/store/news/hydration.test.ts`
- `apps/web-pwa/src/store/news/index.ts`
- `apps/web-pwa/src/store/news/index.test.ts`
- `apps/web-pwa/src/store/news/types.ts`
- `apps/web-pwa/src/store/newsRuntimeBootstrap.ts`
- `apps/web-pwa/src/store/newsRuntimeBootstrap.test.ts`
- `packages/gun-client/src/newsAdapters.ts`
- `packages/gun-client/src/newsAdapters.test.ts`
- `packages/gun-client/src/topology.ts`
- `packages/gun-client/src/topology.test.ts`
