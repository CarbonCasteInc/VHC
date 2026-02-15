# CE Closeout Verdict — Beta Readiness Sprint

**Date:** 2026-02-15 ~16:15 UTC (amended 18:15 UTC)
**Main HEAD:** `de322f8` (updated from `c538f71` — PR #265 merged post-verdict)
**CE Protocol:** ce-opus Pass 1 (substantial analysis extracted from thinking before timeout) + ce-codex (timed out during verification). Coordinator performed independent verification of all findings.

> **Amendment note:** PR #265 (`coord/ce-hold-w1c-store-publishback`) merged after initial verdict, closing the hermesDocs publish-back store-layer gap. Main advanced from `c538f71` → `995c5c9` (PR #271 CE docs) → `de322f8` (PR #265 publish-back).

---

## Verdict: **GO (CONDITIONAL)**

The codebase is suitable for internal invite-only testnet evaluation with the conditions listed below. No HIGH-severity *functional* gaps exist in the tested paths. The gaps identified are all *wiring/integration* issues — the code exists, is tested, and works in isolation, but isn't connected at the app bootstrap level. This is expected for flag-gated features in staged rollout.

---

## Findings Table

| ID | Severity | Area | Finding | Evidence | Recommended Fix |
|----|----------|------|---------|----------|----------------|
| F1 | **HIGH** | Invite Gating | `isInviteOnlyEnabled()` exists but no `InviteGate` component wraps routes. No route-level enforcement of invite-only mode. | `grep -rn 'InviteGate\|isInviteOnlyEnabled' apps/web-pwa/src/routes/` returns empty | Create `InviteGate.tsx` wrapper component, wire into router layout |
| ~~F1b~~ | ~~HIGH~~ | ~~Publish-back~~ | ~~hermesDocs `publishArticle()` doesn't push to forum feed~~ | ~~CLOSED by PR #265 (`ec26e10`)~~ | ~~Merged at `de322f8`~~ |
| F2 | **MEDIUM** | Synthesis Pipeline | `TopicSynthesisPipeline` class defined but never instantiated. `setSynthesisBridgeHandler()` exported but never called. Producer path is disconnected. | `grep -rn 'setSynthesisBridgeHandler(' | grep -v test | grep -v export` returns empty | Wire handler registration in app init (behind `VITE_TOPIC_SYNTHESIS_V2_ENABLED` flag) |
| F3 | **MEDIUM** | News Runtime | `startNewsRuntime()` exported but never called in app bootstrap. Feature flag `VITE_NEWS_RUNTIME_ENABLED` not in env config. | Only references: export in `index.ts` and definition in `newsRuntime.ts` | Add bootstrap call behind feature flag; add flag to `env.d.ts` |
| F4 | **LOW** | Module Duplication | News modules exist in both `packages/ai-engine/src/news*.ts` AND `services/news-aggregator/src/`. Potential divergence risk. | Both locations have orchestrator, ingest, normalize, cluster modules | Consolidate to single location; one barrel re-exports |
| F5 | **LOW** | Feature Flag Docs | Several flags (`VITE_NEWS_RUNTIME_ENABLED`, `VITE_ANALYSIS_MODEL`, remote API keys) not listed in STATUS.md flag table | STATUS.md flag table incomplete | Update flag table in STATUS.md |
| F6 | **LOW** | Schema Drift | ai-engine `StoryBundleSchema` uses strict Zod validation vs looser patterns in data-model | Schema strictness mismatch between packages | Align schemas or document intentional difference |

---

## CE HIGH Closure Assessment

| Original CE HIGH | Status | Evidence |
|-----------------|--------|----------|
| 1. News runtime orchestration path | ✅ **CLOSED** | `orchestrateNewsPipeline()` in `orchestrator.ts` calls ingest→normalize→cluster. 8 integration tests. Pipeline works in isolation. |
| 2. Remote model propagation | ✅ **CLOSED** | `getAnalysisModel()` reads `VITE_ANALYSIS_MODEL` (default `gpt-5.2`). `buildRemoteRequest()` includes model. Auth enforced via `RemoteAuthError`. |
| 3. Auth contract clarity | ✅ **CLOSED** | `AUTH_CONTRACT.md` documents contract. Key never in request body. Tests enforce. |

All 3 original CE HIGHs are closed. The new findings (F1-F6) are integration/wiring issues, not functional gaps in the underlying code.

---

## GO Conditions

For internal invite-only testnet to proceed safely:

1. **F1 must be addressed before any external invite distribution** — the invite gating store exists and works but isn't enforced at the route level. For *internal* testing this is acceptable (testers have direct access anyway), but it MUST be wired before any invite tokens are distributed externally.

2. **F2 and F3 are acceptable as flag-gated deferred features** — synthesis production and news runtime are correctly behind feature flags (defaulting false). The read paths work (TopicCard renders synthesis data from mesh). Producer wiring is a follow-up sprint item.

---

## Residual Risk List

1. **Bootstrap wiring gap** — Three systems (`InviteGate`, `setSynthesisBridgeHandler`, `startNewsRuntime`) are built and tested but not wired into app initialization. Risk: false confidence that features "work" when they're actually disconnected.

2. **Module duplication** — News modules in two locations could diverge. Risk: bug fixes in one location missed in the other.

3. **Feature flag proliferation** — 12+ flags with no formal governance (owner, promotion criteria, rollback trigger, retirement date). Risk: flag debt accumulates.

4. **No `/docs` or `/bridge` routes** — CollabEditor and Bridge/CAK UI stacks are complete but have no router entries. Not needed for beta but noted.

---

## Top 5 Recommended Actions (execution order)

1. **Wire `InviteGate` into router layout** — Create component, wrap protected routes, check `isInviteOnlyEnabled()` + token validation. ~30 min. [BLOCKS external invite distribution]

2. **Add missing flags to `env.d.ts` and STATUS.md** — `VITE_NEWS_RUNTIME_ENABLED`, `VITE_ANALYSIS_MODEL`, `VITE_REMOTE_API_KEY`, `VITE_REMOTE_API_ENDPOINT`. ~15 min.

3. **News module dedup PR** — Consolidate `packages/ai-engine/src/news*.ts` with `services/news-aggregator/src/`. One canonical location, other re-exports. ~45 min.

4. **Feature flag governance pass** — Assign owner, promotion criteria, rollback trigger, retirement date for all 12+ flags. Document in `docs/foundational/FEATURE_FLAGS.md`. ~30 min.

5. **Bootstrap wiring PR** — Wire `setSynthesisBridgeHandler()` and `startNewsRuntime()` into app init, both behind their respective feature flags. ~30 min.

---

## Scope Statement

**Verified:** All 3 evaluation areas (news pipeline, comment→article, synthesis feed) against actual source files on `c538f71`. Import/export chains, test existence, feature flag gating, route wiring, bootstrap initialization.

**Inferred:** CI health (based on all 7 checks green on merged PRs). Test coverage quality (based on 100% thresholds passing).

**Unverified:** Runtime behavior in browser (no E2E manual smoke test). Gun mesh replication behavior under load. Production env-var configuration.
