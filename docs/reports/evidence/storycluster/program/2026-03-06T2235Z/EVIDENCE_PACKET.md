# StoryCluster Program Evidence Packet — Final DoD Closure Run (2026-03-06T2235Z)

- Date (UTC): 2026-03-06
- Milestone type: **DoD closure + evidence refresh**
- Canonical baseline: `main` @ `3aa6f052869747be7ee4e8f848d2ee967868bb7c`
- Working branch: `coord/storycluster-dod-final`
- Workspace: `/srv/trinity/worktrees/storycluster-dod-final`

## Scope of this evidence run

1. StoryCluster identity semantics tightened:
   - `story_id` stability across expanding source sets (cluster key no longer depends on source list).
   - `topic_id = sha256Hex("news:" + story_id)` enforced in StoryCluster remote contract output.
2. Deterministic test coverage for stable story identity and topic derivation.
3. Full deterministic evidence runs for production no-fallback, ranking determinism, coherence audits, and enrichment invariants.

## Exact commands executed

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @vh/storycluster-engine typecheck`
3. `pnpm --filter @vh/storycluster-engine build`
4. `pnpm --filter @vh/storycluster-engine test`
5. `pnpm --filter @vh/storycluster-engine exec vitest run src/stageRunner.pipeline.test.ts src/remoteContract.test.ts src/remoteEngine.contract.test.ts --reporter=verbose`
6. `pnpm exec vitest run packages/ai-engine/src/__tests__/newsOrchestrator.production.test.ts packages/ai-engine/src/newsRuntime.test.ts`
7. `pnpm --dir services/news-aggregator exec vitest run src/daemon.production.test.ts src/daemon.test.ts`
8. `pnpm exec vitest run apps/web-pwa/src/store/discovery/ranking.test.ts`
9. `pnpm --filter @vh/data-model build`
10. `pnpm --dir packages/gun-client exec vitest run src/newsAdapters.test.ts src/analysisAdapters.test.ts src/aggregateAdapters.test.ts`
11. `node tools/scripts/check-diff-coverage.mjs`
12. `git status --short --branch`
13. `git rev-parse HEAD`
14. `wc -l services/storycluster-engine/src/stageHandlers.ts services/storycluster-engine/src/remoteContract.ts services/storycluster-engine/src/stageRunner.pipeline.test.ts services/storycluster-engine/src/remoteContract.test.ts services/storycluster-engine/src/remoteEngine.contract.test.ts services/storycluster-engine/src/server.test.ts`
15. `rg -n 'heuristic fallback is disallowed in production mode|storycluster remote endpoint is required in production mode|deriveNewsTopicId|storycluster-v1' packages/ai-engine/src/newsOrchestrator.ts services/storycluster-engine/src/remoteContract.ts services/storycluster-engine/src/stageHandlers.ts`

## Deterministic artifact paths

- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/EVIDENCE_PACKET.md`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-1-pnpm-install.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-2-storycluster-typecheck.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-3-storycluster-build.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-4-storycluster-test.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-4b-storycluster-focused-contract-tests.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-5-ai-engine-prod-runtime-tests.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-6-news-aggregator-daemon-tests.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-7-pwa-ranking-tests.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-8a-data-model-build.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-8b-gun-client-news-analysis-tests-existing-suites.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-9-diff-coverage.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-10-git-status.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-11-head-sha.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-12-loc-cap-audit.txt`
- `docs/reports/evidence/storycluster/program/2026-03-06T2235Z/command-13-semantic-gate-grep.txt`

## Key metrics (from evidence logs)

- **Storycluster-engine coverage:** 100% statements/branches/functions/lines (1111/1111). See `command-4-storycluster-test.txt`.
- **Coherence audit:** contamination_rate=0, fragmentation_rate=0, coherence_score=1.0 for fixture + live replay. See `command-4-storycluster-test.txt`.
- **LOC cap:** all touched files ≤ 350 LOC (see `command-12-loc-cap-audit.txt`).

## Acceptance matrix (Final DoD gate)

| Criterion | Status | Evidence |
|---|---|---|
| Production ingestion path uses StoryCluster only; no heuristic fallback in production | PASS | `packages/ai-engine/src/newsOrchestrator.ts` guard + `command-5-ai-engine-prod-runtime-tests.txt`; `services/news-aggregator/src/daemon.ts` + `command-6-news-aggregator-daemon-tests.txt` |
| All mandatory stages implemented and telemetry-verified | PASS | `services/storycluster-engine/src/stageHandlers.ts`, `stageRunner.ts`, `stageHelpers.ts` + `command-4-storycluster-test.txt` |
| Same-event coherence passes fixture + live-replay thresholds | PASS | `services/storycluster-engine/src/coherenceAudit.ts` + `command-4-storycluster-test.txt` |
| Deterministic Latest/Hot semantics and diversification | PASS | `apps/web-pwa/src/store/discovery/ranking.ts` + `command-7-pwa-ranking-tests.txt` |
| StoryBundle publish remains non-blocking vs analysis/bias enrichment | PASS | `packages/ai-engine/src/newsRuntime.ts` + `command-5-ai-engine-prod-runtime-tests.txt` |
| `story_id` stable across repeated ticks / source expansion | PASS | `services/storycluster-engine/src/stageHandlers.ts` + `stageRunner.pipeline.test.ts` in `command-4b-storycluster-focused-contract-tests.txt` |
| `topic_id = sha256Hex("news:" + story_id)` enforced | PASS | `services/storycluster-engine/src/remoteContract.ts` + `command-4b-storycluster-focused-contract-tests.txt` |
| `created_at` immutable; `cluster_window_end` monotonic | PASS | `packages/gun-client/src/newsAdapters.ts` + `command-8b-gun-client-news-analysis-tests-existing-suites.txt` |
| Deterministic evidence logs + diff coverage | PASS | `command-9-diff-coverage.txt` |

## Notes

- The command suite intentionally builds `@vh/data-model` before gun-client tests to satisfy Vite resolution of package exports.
- The prior request for `analysisFeed.test.ts` was mapped to `analysisAdapters.test.ts` (the existing suite in this repo).
