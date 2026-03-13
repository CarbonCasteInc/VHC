# StoryCluster Final DoD Closure Report — 2026-03-06

> Superseded historical report.
> Do not use this document as current implementation truth or release status.
> Current truth sources:
> - `/Users/bldt/Desktop/VHC/VHC/docs/foundational/STATUS.md`
> - `/Users/bldt/Desktop/VHC/VHC/docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`
> - `/Users/bldt/Desktop/VHC/VHC/docs/plans/STORYCLUSTER_IMPLEMENTATION_TICKET_STACK.md`

**Owner:** Core Engineering (VHC)  
**Branch:** `coord/storycluster-dod-final`  
**Baseline commit:** `3aa6f052869747be7ee4e8f848d2ee967868bb7c`  
**Evidence packet:** `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/EVIDENCE_PACKET.md`

## 1) Summary

This closure run completes the remaining DoD gaps for StoryCluster by locking identity semantics, proving deterministic coherence/ranking behavior, and recording a full evidence run. Core changes:

1. **Stable story identity across expanding source sets** — `story_id` now derives from a stable cluster key (`storycluster-v1:${topicId}:${cluster.key}`) rather than source-list concatenation.
2. **News topic derivation enforced** — `topic_id = sha256Hex("news:" + story_id)` is now enforced in StoryCluster remote output and contract tests.
3. **Deterministic contract coverage** — new tests prove `story_id` stability under source expansion and hashed topic derivation, while avoiding intermittent port conflicts in server tests.

All required evidence runs completed successfully and are recorded in the evidence packet.

## 2) What changed (files)

- `services/storycluster-engine/src/stageHandlers.ts`
  - `story_id` derivation stabilized (no dependency on expanding source list).
- `services/storycluster-engine/src/remoteContract.ts`
  - `topic_id` derivation enforced as `sha256Hex("news:" + story_id)`.
- `services/storycluster-engine/src/remoteContract.test.ts`
  - Contract tests now enforce hashed `topic_id`.
- `services/storycluster-engine/src/remoteEngine.contract.test.ts`
  - Remote engine integration validates hashed `topic_id`.
- `services/storycluster-engine/src/stageRunner.pipeline.test.ts`
  - New stability test for expanding source sets.
- `services/storycluster-engine/src/server.test.ts`
  - Port-collision-safe startup in test helper.

## 3) Commands executed (deterministic evidence)

See full command logs in:
`docs/reports/evidence/storycluster/program/2026-03-06T2235Z/`

Highlights:
- `pnpm --filter @vh/storycluster-engine typecheck`
- `pnpm --filter @vh/storycluster-engine build`
- `pnpm --filter @vh/storycluster-engine test`
- `pnpm --filter @vh/storycluster-engine exec vitest run src/stageRunner.pipeline.test.ts src/remoteContract.test.ts src/remoteEngine.contract.test.ts --reporter=verbose`
- `pnpm exec vitest run packages/ai-engine/src/__tests__/newsOrchestrator.production.test.ts packages/ai-engine/src/newsRuntime.test.ts`
- `pnpm --dir services/news-aggregator exec vitest run src/daemon.production.test.ts src/daemon.test.ts`
- `pnpm exec vitest run apps/web-pwa/src/store/discovery/ranking.test.ts`
- `pnpm --filter @vh/data-model build`
- `pnpm --dir packages/gun-client exec vitest run src/newsAdapters.test.ts src/analysisAdapters.test.ts src/aggregateAdapters.test.ts`
- `node tools/scripts/check-diff-coverage.mjs`

## 4) Metrics achieved

- **Storycluster-engine coverage:** 100% statements/branches/functions/lines (1111/1111) — `command-4-storycluster-test.txt`.
- **Coherence audit:** contamination_rate=0, fragmentation_rate=0, coherence_score=1.0 for fixture + live replay — `command-4-storycluster-test.txt`.
- **LOC cap:** all touched files ≤ 350 LOC — `command-12-loc-cap-audit.txt`.

## 5) Final DoD Matrix

| DoD requirement | Status | Evidence |
|---|---|---|
| Production ingestion path uses StoryCluster only (no fallback) | PASS | `packages/ai-engine/src/newsOrchestrator.ts`, `services/news-aggregator/src/daemon.ts`; `command-5-ai-engine-prod-runtime-tests.txt`, `command-6-news-aggregator-daemon-tests.txt` |
| Mandatory pipeline stages implemented + telemetry verified | PASS | `services/storycluster-engine/src/stageHandlers.ts`, `stageRunner.ts`, `stageHelpers.ts`; `command-4-storycluster-test.txt` |
| Same-event coherence fixture + live replay thresholds | PASS | `services/storycluster-engine/src/coherenceAudit.ts`; `command-4-storycluster-test.txt` |
| Latest/Hot deterministic ranking + diversification | PASS | `apps/web-pwa/src/store/discovery/ranking.ts`; `command-7-pwa-ranking-tests.txt` |
| Non-blocking StoryBundle publish vs analysis/bias enrichment | PASS | `packages/ai-engine/src/newsRuntime.ts`; `command-5-ai-engine-prod-runtime-tests.txt` |
| `story_id` stable under expanding sources | PASS | `services/storycluster-engine/src/stageHandlers.ts`; `command-4b-storycluster-focused-contract-tests.txt` |
| `topic_id = sha256Hex("news:" + story_id)` | PASS | `services/storycluster-engine/src/remoteContract.ts`; `command-4b-storycluster-focused-contract-tests.txt` |
| `created_at` immutable + `cluster_window_end` monotonic | PASS | `packages/gun-client/src/newsAdapters.ts`; `command-8b-gun-client-news-analysis-tests-existing-suites.txt` |
| Deterministic evidence + diff coverage | PASS | `command-9-diff-coverage.txt` |

## 6) Operator handoff (production/distribution)

**Required env/config:**
- `VH_STORYCLUSTER_REMOTE_URL` (StoryCluster `/cluster` endpoint)
- `VH_STORYCLUSTER_REMOTE_AUTH_TOKEN`
- `VH_STORYCLUSTER_REMOTE_AUTH_HEADER` (default `authorization`)
- `VH_STORYCLUSTER_REMOTE_AUTH_SCHEME` (default `Bearer`)
- `VH_STORYCLUSTER_REMOTE_HEALTH_URL` (optional; defaults to `/health`)
- `VH_STORYCLUSTER_REMOTE_TIMEOUT_MS` (optional; default 8000)

**Start order:**
1. Start StoryCluster engine service (`/health` must return 200 before ingestion).
2. Start news-aggregator daemon (fails closed if StoryCluster health is not green).
3. Verify ingestion lease + StoryBundle publish.

**Troubleshooting:**
- If the daemon fails to start: verify StoryCluster `/health` and auth headers.
- If no bundles publish: confirm lease holder writes and `VH_GUN_PEERS` connectivity.
- If hot/latest anomalies appear: rerun `apps/web-pwa/src/store/discovery/ranking.test.ts` and check `computeStoryHotness` in `packages/gun-client/src/newsAdapters.ts`.

## 7) Closure statement

All final release-gate items in §16.7 are now **PASS** with deterministic evidence. StoryCluster can be claimed as the authoritative production bundler and sorter for VHC.
