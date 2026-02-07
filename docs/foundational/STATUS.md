# TRINITY Implementation Status

**Last Updated:** 2026-02-07  
**Version:** 0.2.1 (Sprint 4 — Agentic Foundation & Stabilization)  
**Assessment:** Pre-production prototype

> ⚠️ **This document reflects actual implementation status, not target architecture.**  
> For the full vision, see `System_Architecture.md` and whitepapers in `docs/`.

---

## Quick Summary

| Layer | Status | Production-Ready |
|-------|--------|------------------|
| **LUMA (Identity)** | 🔴 Stubbed | ❌ No |
| **GWC (Economics)** | 🟡 Contracts ready, undeployed | ⚠️ Partial |
| **VENN (Analysis)** | 🟡 Pipeline exists, AI mocked | ❌ No |
| **HERMES Messaging** | 🟢 Implemented | ⚠️ Partial |
| **HERMES Forum** | 🟢 Implemented | ⚠️ Partial |
| **HERMES Docs** | ⚪ Planned (Sprint 5) | ❌ No |
| **HERMES Bridge (Civic Action Kit)** | ⚪ Planned/Redesign (Sprint 5) | ❌ No |

---

## Recently Completed (Issues #3, #4, #6, #11, #12, #15, #18, #19, #22, #23, #24, #27, #33, #40, #44, #46, #50, #53, #56, #59, #63, #66, #69, #70, #71, #72, #73, #77, #80, #87, #90, #98)

- ✅ **Issue #3** — Chief token smoke test: validated agent loop smoke test infrastructure.
- ✅ **Issue #11** — Added root `pnpm typecheck` script.
- ✅ **Issue #12** — Landed defensive-copy semantics for `getFullIdentity()` plus race test harness coverage.
- ✅ **Issue #15** — Extended typecheck coverage to remaining packages.
- ✅ **Issue #18** — Fixed ~100 web-pwa typecheck errors.
- ✅ **Issue #19** — Fixed contracts and e2e typecheck errors: added typecheck scripts for both packages (PR #32, merged 2026-02-06).
- ✅ **Issue #22** — Split `DevColorPanel.tsx` into 5 focused files in `apps/web-pwa/src/components/`:
  - `DevColorPanel.tsx`
  - `ColorControl.tsx`
  - `colorConfigs.ts`
  - `colorUtils.ts`
  - `useColorPanel.ts`
- ✅ **Issue #23** — Aligned `Identity` / `IdentityRecord` types across packages.
- ✅ **Issue #24** — Added `apps/web-pwa/tsconfig.test.json` for test-file typechecking.
- ✅ **Issue #27** — Fixed fresh-checkout typecheck: workspace `exports.types` point at `src/`, data-model uses `bundler` moduleResolution, gun-client stale references removed (PR #30, `4d19026c`).
- ✅ **Issue #33** — Restored 100% coverage gate: added `colorUtils.test.ts` (15 tests for hex↔HSL, parseColor, buildColor), excluded type-only files and dev-only hooks from instrumentation (PR #35, merged 2026-02-06).
- ✅ **Issue #6** — SSR-hardened localStorage access: created `safeStorage.ts` utility with SSR-safe `safeGetItem`/`safeSetItem`/`safeRemoveItem`, applied to xpLedger and profile stores (PR #38, merged 2026-02-06).
- ✅ **Issue #4** — SMOKE: agent loop end-to-end smoke test — validated full ritual (spec → impl → QA → maint → merge) with a docs-only PR (PR #41, merged 2026-02-06).
- ✅ **Issue #40** — Migrated all remaining bare `localStorage` calls to `safeStorage` utility (13 files), added ESLint `no-restricted-globals` rule to prevent regressions (PR #42, merged 2026-02-06).
- ✅ **Issue #44** — CSP meta tag + secure storage policy enforcement: added restrictive `<meta>` CSP to `index.html`, extracted inline E2E script to `public/e2e-init.js`, created `docs/specs/secure-storage-policy.md` (3-tier model: Vault/safeStorage/Ephemeral), added CSP test + storage audit test. All existing tests pass, 100% coverage maintained (PR #45, merged 2026-02-07).
- ✅ **Issue #46** — Added canonical delegation/familiar type foundations: `FamiliarRecord`, `DelegationGrant`, `OnBehalfOfAssertion` interfaces + Zod schemas, `DelegationTier`/`DelegationScope` types, `TIER_SCOPES` constant (PR #48, merged 2026-02-07).
- ✅ **Issue #50** — Added participation governor type foundations: `BudgetActionKey` (8-key string literal union), `BudgetLimit`/`DailyUsage`/`NullifierBudget` interfaces + Zod schemas, `BUDGET_ACTION_KEYS` runtime tuple, `SEASON_0_BUDGET_DEFAULTS` constant. Full test suite with 100% coverage (PR #51, merged 2026-02-07).
- ✅ **Issue #53** — Added participation governor runtime utilities: `initializeNullifierBudget`, `rolloverBudgetIfNeeded`, `canConsumeBudget`, `consumeBudget` pure functions + `BudgetCheckResult` interface. 52 tests, 100% coverage (PR #54, merged 2026-02-07).
- ✅ **Issue #56** — Wired participation governor budget enforcement into forum store: budget state persisted per-nullifier in XP ledger, `canPerformAction`/`consumeAction` methods exposed, `posts/day` (20) and `comments/day` (50) enforced in `createThread`/`createComment` with check-before/consume-after pattern. New `xpLedgerBudget.ts` bridge file (59 LOC). 582 tests, 100% coverage (PR #57, merged 2026-02-07).
- ✅ **Issue #59** — Wired `governance_votes/day` budget enforcement into `useGovernanceStore.submitVote`: check-before/consume-after pattern via `canPerformAction`/`consumeAction`, `setActiveNullifier` called unconditionally for all votes. 5 new tests, 587 total, 100% coverage maintained (PR #60, merged 2026-02-07).
- ✅ **Issue #63** — Wired `sentiment_votes/day` budget enforcement into `useSentimentState.setAgreement`: check-before/consume-after pattern via `canPerformAction`/`consumeAction`, `setActiveNullifier` called before budget check. Season 0 limit: 200 sentiment votes/day per nullifier. 100% coverage maintained (PR #64, merged 2026-02-07).
- ✅ **Issue #66** — Wired `analyses/day` budget enforcement into `AnalysisFeed.tsx`: check-before/consume-after pattern via `canPerformAction`/`consumeAction`, budget checked before `getOrGenerate`, consumed only when result is fresh (not reused) and nullifier is present. Season 0 limits: 25 analyses/day per nullifier, max 5/topic. 9 new test cases, 604 total, 100% coverage maintained (PR #67, merged 2026-02-07).
- ✅ **Issue #69** — Budget denial UX hardening: `useSentimentState.setAgreement` now returns `{ denied: true, reason }` and logs `console.warn` on budget denial (was silent void return). `AnalysisFeed.runAnalysis` resolves with `analysis: null` on denial (was `{} as CanonicalAnalysis` type-unsafe cast). `handleSubmit` guards null analysis. Reason fallback uses `||` for empty-string edge case. `createBudgetDeniedResult` helper exported. 10 new tests, 721 total, 100% coverage maintained (PR #96, merged 2026-02-07).
- ✅ **Issue #98** — Gated `consumeAction('analyses/day')` on non-null analysis result. Prevents phantom budget debit when `getOrGenerate` returns null analysis. 1 LOC fix + 1 test assertion correction. 721 tests, 100% coverage maintained (PR #102, merged 2026-02-07).
- ✅ **Issue #70** — Hardened budget localStorage validation: added `validateBudgetOrNull` using `NullifierBudgetSchema.safeParse` at the restore boundary, wrapped `ensureBudget` with try/catch fallback to `initializeNullifierBudget`. 22 new tests, 623 total, 100% coverage maintained (PR #75, merged 2026-02-07).
- ✅ **Issue #71** — Hardened `useGovernance.ts` branch coverage from 72% to 100%: added 26 focused tests covering early-return paths (no active identity, missing nullifier, empty proposals, duplicate vote dedup), governance vote budget enforcement (limit hit, budget consumed on success), proposal hydration edge cases (empty/populated stores, multiple proposals), and `initGovernance` sequencing. Minor source fix: early-return when `proposals` is empty in `hydrateProposals`. Removed stale `useGovernance.ts` from coverage exclusion in `vitest.config.ts`. 685 tests total, 100% coverage maintained (PR #86, merged 2026-02-07).
- ✅ **Issue #72** — Budget test scaffolding dedup + code comments cleanup: deduped `today()`/`todayISO()` between `xpLedger.ts` and `xpLedgerBudget.ts`, extracted shared `createBudgetMock()` test helper in `test-utils/budgetMock.ts`, added intentionality comments for budget call sites in `useSentimentState.ts`, restored inline Map type docs in `xpLedger.ts`, exported `ANALYSIS_FEED_STORAGE_KEY` constant for test use. 6 files changed, net −16 lines. 711 tests, 100% coverage maintained (PR #94, merged 2026-02-07).
- ✅ **Issue #73** — Closed as already addressed: the imprecise spec language ("same pattern as `useGovernance.submitVote`") referenced in the issue was never committed to spec docs; all STATUS.md entries correctly describe the "check-before/consume-after" pattern. No changes needed.
- ✅ **Issue #77** — Unified Topics Model: added `topicId`, `sourceUrl`, `urlHash`, `isHeadline` to Thread schema, `ProposalExtensionSchema` with proposal extension on threads, `via` field on comments, topic derivation utilities (`sha256Hex`, `deriveTopicId`, `deriveUrlTopicId`) using Web Crypto API, wired derivation into `createThread`, added `via` param to `createComment`. 652 tests, 100% coverage maintained (PR #78, merged 2026-02-07).
- ✅ **Issue #90** — Forum Proposal Guard Hardening: used Approach C (destructure `proposal` out before spreading) in `parseThreadFromGun` to prevent array-valued proposals from leaking through. Added `!Array.isArray` triple-guard. 18 new tests in new `helpers.test.ts` covering tags parsing, proposal guard (arrays/objects/null/primitives/`_` stripping), and field pass-through. 711 tests total, 100% coverage maintained (PR #92, merged 2026-02-07).
- ✅ **Issue #87** — Governance Storage Guard Hardening: added `&& !Array.isArray(parsed)` to `readFromStorage` and `readStoreMap` type guards in `useGovernance.ts`, preventing JSON arrays from passing the `typeof === 'object'` check. 8 new tests (array rejection, valid object regression, null/primitive handling). 693 tests total, 100% coverage maintained (PR #89, merged 2026-02-07). Follow-up #90 filed for `forum/helpers.ts` proposal guard audit.
- ✅ **Issue #80** — Feed↔Forum UI Integration: wired `sourceUrl` from AnalysisFeed through route/ForumFeed/NewThreadForm to `createThread` opts. Analysis-feed-created threads now carry `topicId`, `sourceUrl`, `urlHash`, `isHeadline: true`. 659 tests, 100% coverage maintained (PR #81, merged 2026-02-07).

---

## Active Follow-ups

| Issue | Title | Priority |
|-------|-------|----------|
| #68 | TOCTOU hardening across budget enforcement call sites | Should |
| #61 | Cleanup: remove redundant setActiveNullifier in ProposalList.tsx useEffect | Nit |
| #47 | CSP header hardening & documentation (Shoulds from #44) | Should |

Next work: remaining budget enforcement slices (moderation, civic_actions, shares) and above follow-ups (#68, #61, #47).

---

## Sprint Completion Status

| Sprint | Doc Status | Actual Status | Key Gaps |
|--------|------------|---------------|----------|
| **Sprint 0** (Foundation) | ✅ Archived | ✅ Complete | None — monorepo, CLI, CI, core packages done |
| **Sprint 1** (Core Bedrock) | ✅ Archived | ⚠️ 90% Complete | Testnet deployment never done (localhost only); attestation is stub |
| **Sprint 2** (Civic Nervous System) | ✅ Complete | ⚠️ 85% Complete | AI engine mocked; no WebLLM/remote; Engine router exists but unused |
| **Sprint 3** (Communication) | ✅ Complete | ✅ Complete | Messaging E2EE working; Forum working; XP integrated |
| **Sprint 3.5** (UI Refinement) | ✅ Complete | ✅ Complete | Stance-based threading; design unification |
| **Sprint 4** (Agentic Foundation) | ⚪ Planning | 🟡 In Progress | Delegation types + participation governor types, runtime utils, forum, governance vote, sentiment vote & analyses enforcement wiring landed; budget denial UX hardened (#69); consume-on-null fix (#98); unified topics fully landed (schema + derivation + Feed↔Forum integration, PRs #78/#81); remaining budget enforcement (moderation/civic_actions/shares) + follow-ups (#68 TOCTOU) pending |
| **Sprint 5** (Bridge + Docs) | ⚪ Planning | ⚪ Not Started | Docs updated for Civic Action Kit (facilitation model); no code yet (`docs/sprints/05-sprint-the-bridge.md`) |

---

## Docs vs. Code Alignment (Key Deltas)

| Doc / Spec | Intended State | Current Code State | Evidence |
|------------|----------------|--------------------|----------|
| Sprint 1 Core Bedrock | Attestation verifier validates Apple/Google chains | Stub logic (token prefix/length); no real chain validation | `services/attestation-verifier/src/main.rs:105-136` |
| Sprint 1 Core Bedrock | Contracts deployed to Sepolia/Base with verified sources | Deploy script exists; only localhost deployments committed | `packages/contracts/scripts/deploy-testnet.ts` + `packages/contracts/deployments/localhost.json` |
| AI_ENGINE_CONTRACT + Sprint 2 | Remote/local engines + policy routing (remote-first etc.) | EngineRouter exists, but worker uses mock local-only engine; no RemoteApiEngine/LocalMlEngine | `packages/ai-engine/src/engines.ts` + `packages/ai-engine/src/worker.ts` |
| Hero_Paths / Sentiment Spec | Constituency proofs + district aggregates | SentimentSignal emission requires constituency proof; no RegionProof generation or aggregates | `apps/web-pwa/src/hooks/useSentimentState.ts:76-100` |
| Sprint 5 Bridge Plan | Civic Action Kit facilitation (reports + native intents) | Bridge is stubbed; facilitation features not implemented | `services/bridge-stub/index.ts` + `docs/sprints/05-sprint-the-bridge.md` |
| Agentic Familiars (Delegation) | Delegation grants + OBO assertions | 🟡 Types + Zod schemas defined; runtime not implemented | `packages/types/src/delegation.ts` (PR #48); no familiar runtime yet |
| Participation Governors | Action/analysis budgets per principal | 🟡 Types + defaults + runtime utils defined; forum (posts/comments), governance votes, sentiment votes & analyses enforcement wired | `packages/types/src/budget.ts` (PR #51) + `packages/types/src/budget-utils.ts` (PR #54) + `apps/web-pwa/src/store/xpLedgerBudget.ts` (PR #57) + `useGovernanceStore.submitVote` (PR #60) + `useSentimentState.setAgreement` (PR #64) + `AnalysisFeed.tsx` (PR #67); remaining store/flow integration (moderation, civic_actions, shares) pending |
| Unified Topics Model | Headlines ↔ threads share `topicId` + proposal threads | ✅ Schema, derivation, and Feed↔Forum integration done | `packages/data-model/src/schemas/hermes/forum.ts` + `apps/web-pwa/src/store/forum/helpers.ts` (PR #78) + `AnalysisFeed.tsx`/`ForumFeed.tsx`/`NewThreadForm.tsx` (PR #81) |
| Topic Reanalysis Epochs | Frame/Reframe table updates after N posts via reanalysis | Not implemented | No reanalysis loop or digest types in app state |

---

## Outstanding Work (Post-Refactor TODOs)

The following tasks are required to align the codebase with the updated specs (agentic familiars, unified topics, participation governors).

### P0 — Identity & Delegation

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| ✅ ~~Define `FamiliarRecord`, `DelegationGrant`, `OnBehalfOfAssertion` types~~ | `spec-identity-trust-constituency.md` §6 | Done — `packages/types/src/delegation.ts` (PR #48) |
| Implement tiered scopes (Suggest/Act/High-Impact) with Tier 3 human-approval | `spec-identity-trust-constituency.md` §6 | New: `apps/web-pwa/src/hooks/useFamiliar.ts` |
| Implement delegation grant creation/revocation | `spec-identity-trust-constituency.md` §6 | New: familiar management UI + store |

### P0 — Participation Governors (Anti-Swarm Budgets)

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| ✅ ~~Define `BudgetActionKey`, `BudgetLimit`, `DailyUsage`, `NullifierBudget` types + Zod schemas, `SEASON_0_BUDGET_DEFAULTS`~~ | `spec-xp-ledger-v0.md` §4 | Done — `packages/types/src/budget.ts` (PR #51) |
| ✅ ~~Implement runtime utilities: `initializeNullifierBudget`, `rolloverBudgetIfNeeded`, `canConsumeBudget`, `consumeBudget`, `BudgetCheckResult`~~ | `spec-xp-ledger-v0.md` §4 | Done — `packages/types/src/budget-utils.ts` (PR #54) |
| ✅ ~~Wire budget enforcement into XP ledger store~~ | `spec-xp-ledger-v0.md` §4 | Done — `apps/web-pwa/src/store/xpLedgerBudget.ts` (PR #57) |
| ✅ ~~Implement `canPerformAction(type)` budget check in stores~~ | `spec-xp-ledger-v0.md` §4 | Done — `canPerformAction`/`consumeAction` exposed via `xpLedgerBudget.ts` (PR #57) |
| ✅ ~~Enforce budgets: posts/day=20, comments/day=50~~ | `spec-xp-ledger-v0.md` §4 | Done — enforced in `createThread`/`createComment` with check-before/consume-after pattern (PR #57) |
| ✅ ~~Enforce budgets: sentiment_votes/day=200~~ | `spec-xp-ledger-v0.md` §4 | Done — enforced in `useSentimentState.setAgreement` with check-before/consume-after pattern (PR #64) |
| ✅ ~~Enforce budgets: governance_votes/day=20~~ | `spec-xp-ledger-v0.md` §4 | Done — enforced in `useGovernanceStore.submitVote` with check-before/consume-after pattern (PR #60) |
| ✅ ~~Enforce budgets: analyses/day=25 (max 5/topic)~~ | `canonical-analysis-v1.md` §4.2 | Done — enforced in `AnalysisFeed.tsx` with check-before/consume-after pattern, per-topic sub-cap via `topicId` (PR #67) |
| Enforce budgets: moderation/day=10, civic_actions/day=3, shares/day=10 | `spec-xp-ledger-v0.md` §4 | Various stores |

### P0 — Unified Topics Model

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| ✅ ~~Add `topicId`, `sourceUrl`, `urlHash`, `isHeadline` to Thread schema~~ | `spec-hermes-forum-v0.md` §2.1 | Done — `packages/data-model/src/schemas/hermes/forum.ts` (PR #78) |
| ✅ ~~Add `THREAD_TOPIC_PREFIX = "thread:"` constant~~ | `spec-hermes-forum-v0.md` §2.1.1 | Done — `packages/data-model/src/schemas/hermes/forum.ts` (PR #78) |
| ✅ ~~Implement `topicId` derivation (sha256 for threads, urlHash for URLs)~~ | `spec-hermes-forum-v0.md` §2.1.1 | Done — `apps/web-pwa/src/store/forum/helpers.ts` (PR #78) |
| ✅ ~~Add `via?: 'human' \| 'familiar'` to Comment schema~~ | `spec-hermes-forum-v0.md` §2.2 | Done — `packages/data-model/src/schemas/hermes/forum.ts` (PR #78) |
| ✅ ~~Add `proposal?: ProposalExtension` to Thread schema~~ | `spec-hermes-forum-v0.md` §2.1 | Done — `packages/data-model/src/schemas/hermes/forum.ts` (PR #78) |
| ✅ ~~Unify Feed ↔ Forum: headlines and threads share topicId~~ | `spec-hermes-forum-v0.md` §2.1.1 | Done — `AnalysisFeed.tsx`, `ForumFeed.tsx`, `NewThreadForm.tsx`, forum stores (PR #81) |

### P1 — Canonical Analysis v2 (Quorum Synthesis)

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| Define `CandidateAnalysis`, `QuorumMeta`, `CanonicalAnalysisV2` types | `canonical-analysis-v2.md` §3 | `packages/data-model/src/schemas.ts` |
| Implement candidate gathering (N=5, timeout=24h) | `canonical-analysis-v2.md` §4.1 | `packages/ai-engine/src/analysis.ts` |
| Add verified-only candidate submission gate | `canonical-analysis-v2.md` §4.1 | `packages/ai-engine/src/analysis.ts` |
| Implement critique/refine mandate (candidates compare to prior analyses) | `canonical-analysis-v2.md` §4.1 | `packages/ai-engine/src/prompts.ts` |
| Implement synthesis engine (candidates → synthesis + divergence) | `canonical-analysis-v2.md` §4.2 | New: `packages/ai-engine/src/synthesis.ts` |
| Wire real AI engine (WebLLM or consented remote) | `AI_ENGINE_CONTRACT.md` | `packages/ai-engine/src/worker.ts` |

### P1 — Comment-Driven Re-Synthesis

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| Track verified comment count per topic since last synthesis | `canonical-analysis-v2.md` §4.3 | `apps/web-pwa/src/store/forum/index.ts` |
| Track unique verified principals per topic | `canonical-analysis-v2.md` §4.3 | `apps/web-pwa/src/store/forum/index.ts` |
| Implement re-synthesis trigger (N=10 comments, 3 unique principals) | `canonical-analysis-v2.md` §4.3 | New: re-synthesis hook or store action |
| Implement debounce (30 min) and daily cap (4/topic) | `canonical-analysis-v2.md` §4.3 | Re-synthesis store |
| Generate topic digest for re-analysis input | `Hero_Paths.md` | New: digest builder |

### P2 — Agentic Guardrails

| Task | Spec Reference | Files to Modify |
|------|----------------|-----------------|
| Implement deny-by-default tool access for familiars | `ARCHITECTURE_LOCK.md` §1.1 | Familiar runtime |
| Add E2E mock for familiar orchestration (`VITE_E2E_MODE`) | `ARCHITECTURE_LOCK.md` §2.2 | Vite config, mock stores |
| Implement prompt injection defenses (treat content as hostile) | `ARCHITECTURE_LOCK.md` §1.1 | Familiar runtime |

---

## Detailed Status by Subsystem

### LUMA (Identity Layer)

**Status:** 🔴 **Stubbed** — Development placeholder only

| Feature | Whitepaper | Implementation | Evidence |
|---------|------------|----------------|----------|
| Hardware TEE binding | ✅ Specified | ❌ Not implemented | No Secure Enclave/StrongBox code |
| VIO liveness detection | ✅ Specified | ❌ Not implemented | No sensor fusion code |
| BioKey hardware | ✅ Specified | ❌ Not implemented | No hardware integration |
| Trust score calculation | ✅ Specified | ⚠️ Stub logic | `main.rs:105-116` — token length/prefix checks |
| Nullifier derivation | ✅ Specified | ⚠️ Device-bound | `main.rs:162` — SHA256(device_key + salt) |
| Identity storage | Secure | ✅ Encrypted vault (`vh-vault`/`vault`) + in-memory identity provider | `apps/web-pwa/src/hooks/useIdentity.ts` + `packages/identity-vault/src/*` |
| Sybil resistance | ✅ Specified | ❌ Not implemented | No uniqueness checking |
| Social recovery | ✅ Specified | ❌ Not implemented | No Lazarus Protocol code |
| Multi-device linking | ✅ Specified | ⚠️ Local-only stub | `useIdentity.ts:174+` (local record updates only) |

**Current Trust Score Logic:**
```rust
// services/attestation-verifier/src/main.rs:105-116
fn verify_web(payload, mock_mode) -> f32 {
    if mock_mode || token == "test-token" { return 1.0; }
    if token.len() > 8 { 0.8 } else { 0.0 }
}
// iOS: 1.0 if starts with "apple-", else 0.5
// Android: 1.0 if starts with "google-", else 0.5
```

**⚠️ WARNING:** Current identity layer provides no real sybil defense. Do not use for production governance or economics.

---

### Agentic Familiars (Delegation)

**Status:** 🟡 **Types Defined** — Runtime not implemented

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Delegation grants / OBO assertions | 🟡 Types + schemas defined | `packages/types/src/delegation.ts` (PR #48) |
| Familiar runtime modes (suggest/act/high-impact) | ❌ Not implemented | No familiar orchestration layer |
| Action/compute budgets per nullifier | 🟡 Types + runtime utils defined; forum, governance, sentiment & analyses enforcement wired | `packages/types/src/budget.ts` (PR #51) + `packages/types/src/budget-utils.ts` (PR #54) + `apps/web-pwa/src/store/xpLedgerBudget.ts` (PR #57) + `useGovernanceStore.submitVote` (PR #60) + `useSentimentState.setAgreement` (PR #64) + `AnalysisFeed.tsx` (PR #67); posts/day, comments/day, governance_votes/day, sentiment_votes/day & analyses/day enforced; remaining action types (moderation, civic_actions, shares) pending |

**Invariant:** Familiars inherit the principal’s trust gate and budgets; they never add influence.

---

### GWC (Economics Layer)

**Status:** 🟡 **Contracts Implemented, Undeployed to Public Testnet**

| Feature | Contract | Tests | Deployed |
|---------|----------|-------|----------|
| RVU Token (ERC-20) | ✅ `RVU.sol` | ✅ | ⚠️ Localhost only |
| UBE Distribution | ✅ `UBE.sol` | ✅ | ❌ Not deployed |
| Quadratic Funding | ✅ `QuadraticFunding.sol` | ✅ | ❌ Not deployed |
| Median Oracle | ✅ `MedianOracle.sol` | ✅ | ⚠️ Localhost only |
| Faucet | ✅ `Faucet.sol` | ✅ | ❌ Not deployed |

**Deployment Artifacts:**
```
packages/contracts/deployments/
└── localhost.json  ← Only deployment (RVU + MedianOracle)
```
- `deployments/localhost.json` — ✅ Exists (deployed 2025-11-21)
- `deployments/sepolia.json` — ❌ Not committed
- `deploy-testnet.ts` — ✅ Script exists (supports Sepolia, Base Sepolia)

**Sprint 1 Gap:** Testnet deployment was listed as a goal but never completed. Script exists, artifact does not.

**XP Ledger:**
- Implementation: ✅ Complete (`store/xpLedger.ts`)
- Tests: ✅ Comprehensive (caps, tracks, per-nullifier isolation)
- Storage: localStorage `vh_xp_ledger` (per-nullifier)
- Integration: ✅ Wired to Messaging (socialXP), Forum (civicXP), Governance (projectXP)

**Attestor Bridge:**
- Implementation: ⚠️ Stub only (`services/bridge-stub/index.ts` logs payload, no on-chain writes)
- Spec: `docs/specs/spec-attestor-bridge-v0.md`
- Purpose: SessionResponse (trustScore, nullifier) → on-chain registration (UBE, Faucet, QF)

**Frontend Governance (Season 0):**
- Proposals: ✅ Seeded locally (`seedProposals`) — legacy Proposal objects; migration to proposal-threads pending
- Legacy ProposalSchema: ⚠️ Deprecated — do not build new features against it; use thread `proposal` extension
- Voting: ✅ Local-only (localStorage `vh_governance_votes`) — to be wired to proposal-threads
- On-chain QF: ❌ Not exposed to public users (curators/dev accounts only)

**⚠️ WARNING:** Do not enable UBE claiming until identity layer provides sybil resistance.

---

### VENN (Canonical Analysis Layer)

**Status:** 🟡 **Pipeline Exists, AI Mocked**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Prompt builder | ✅ Implemented | `prompts.ts` — `buildPrompt(articleText)` with GOALS/GUIDELINES |
| Response parser | ✅ Implemented | `schema.ts` — `parseAnalysisResponse()` handles wrapped + bare JSON |
| Schema validation | ✅ Implemented | `schema.ts` — `AnalysisResultSchema` + `CanonicalAnalysisSchema` (Zod) |
| Hallucination guardrails | ✅ Implemented | `validation.ts` — `validateAnalysisAgainstSource()` |
| First-to-file lookup | ✅ Implemented | `analysis.ts:30-48` — `getOrGenerate()` |
| Engine router | ✅ Implemented | `engines.ts` — `EngineRouter` supports all policy modes |
| AI engine (WebLLM) | ❌ Not integrated | Interface exists, no `LocalMlEngine` wired |
| AI engine (Remote) | ❌ Not wired | Interface exists, no `RemoteApiEngine` wired |
| Mock engine | ⚠️ Active | `worker.ts:6-23` — hardcoded mock response |

**Sprint 2 AI Engine Contract Status:**
- ✅ `AI_ENGINE_CONTRACT.md` spec written
- ✅ `EnginePolicy` types defined (`remote-first`, `local-first`, etc.)
- ✅ `EngineRouter` class implemented with fallback logic
- ✅ Tests cover policy behaviors and fallbacks
- ❌ **No real engine is wired** — `worker.ts` uses `mockEngine` with `'local-only'` policy

**Current AI Output (mocked):**
```typescript
// packages/ai-engine/src/worker.ts:6-23
const mockEngine = {
  name: 'mock-engine',
  kind: 'local' as const,
  generate: async () => JSON.stringify({
    final_refined: {
      summary: 'Mock summary',
      bias_claim_quote: ['quote'],
      justify_bias_claim: ['justification'],
      biases: ['bias'],
      counterpoints: ['counter'],
      sentimentScore: 0.5,
      confidence: 0.9
    }
  })
};
const router = new EngineRouter(mockEngine, undefined, 'local-only');
```

**Civic Signals:**
- Eye (read tracking): ✅ Implemented, local-only
- Lightbulb (engagement): ✅ Implemented, local-only
- Sentiment (agreement): ✅ Implemented, local-only
- Mesh aggregation: ❌ Not implemented

**Constituency Proofs:**
- SentimentSignal emission requires `constituency_proof` and currently short-circuits without it.
- No RegionProof generation or district aggregation is implemented.

**First-to-File Limitations (v1 → v2 Direction):**
- Current (v1): First analysis is immutable, vulnerable to poisoning
- Risk: Single attacker can publish misleading canonical analysis
- Planned (v2): Quorum synthesis — first N analyses compared + synthesized
- v2 will add challenge/supersession path; v1 records remain immutable
- Defaults (v2): N=5, timeout=24h, challenge=7d
- See `docs/specs/canonical-analysis-v2.md` for quorum synthesis contract

**v2 Implementation Gaps:**

| Feature | Spec | Status |
|---------|------|--------|
| `CandidateAnalysis` type | `canonical-analysis-v2.md` §3 | ❌ Missing |
| Candidate gathering (N=5, timeout=24h) | `canonical-analysis-v2.md` §4.1 | ❌ Missing |
| Verified-only candidate submission | `canonical-analysis-v2.md` §4.1 | ❌ Missing |
| Critique/refine prior analyses | `canonical-analysis-v2.md` §4.1 | ❌ Missing |
| Synthesis engine (divergence table) | `canonical-analysis-v2.md` §4.2 | ❌ Missing |
| Comment-driven re-synthesis | `canonical-analysis-v2.md` §4.3 | ❌ Missing |
| Per-principal analysis budget (25/day, 5/topic) | `spec-xp-ledger-v0.md` §4 | ✅ Types + runtime utils defined; enforcement wired in `AnalysisFeed.tsx` via check-before/consume-after pattern (PR #67) |

---

### HERMES (Communication Layer)

#### Messaging

**Status:** 🟢 **Implemented**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| E2EE encryption | ✅ SEA shared secret | `hermesCrypto.ts:4` |
| Gun sync | ✅ Real integration | `hermesAdapters.ts` |
| Topology guard | ✅ Enforced | `topology.ts:55` |
| XP integration | ✅ Complete | `xpLedger.ts` |
| Trust gating | ⚠️ Forum-only | Forum checks trustScore ≥ 0.5; chat does not |

**Dependencies:** Messaging assumes a valid identity/session; current attestation is stubbed (see LUMA).

#### Forum

**Status:** 🟢 **Implemented** (core features); ✅ **Unified Topics fully landed (schema + derivation + Feed↔Forum integration)**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Threaded comments | ✅ Complete | `CommentStream.tsx` |
| Stance-based threading | ✅ Complete | concur/counter/discuss |
| Voting | ✅ Complete | `VoteControl.tsx` |
| Gun sync | ✅ Real integration | `forumAdapters.ts` |
| XP integration | ✅ Complete | thread/comment/quality XP |
| `topicId` field | ✅ Schema + derivation done | `topicId`, `sourceUrl`, `urlHash`, `isHeadline` on Thread; derivation wired into `createThread` (PR #78) |
| `via` field on Comment | ✅ Schema done | `via?: 'human' \| 'familiar'` on Comment; wired into `createComment` (PR #78) |
| Unified Feed ↔ Forum | ✅ Integration wired | `sourceUrl` flows from AnalysisFeed through route/ForumFeed/NewThreadForm to `createThread`; threads carry `topicId`, `sourceUrl`, `urlHash`, `isHeadline` (PR #81) |

#### Docs (Collaborative)

**Status:** ⚪ **Planned**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Doc schema | ❌ Not implemented | — |
| CRDT provider | ❌ Not implemented | — |
| Docs store | ❌ Not implemented | — |

#### Bridge (Civic Action Kit)

**Status:** ⚪ **Planned/Stub** — Redesign in progress toward facilitation model

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Report generator (PDF) | ❌ Not implemented | — |
| Native intents (email/phone/share) | ❌ Not implemented | — |
| Contact directory | ❌ Not implemented | — |
| Receipt storage | ❌ Not implemented | — |
| Legacy automation stub | ⚠️ Stub only | `services/bridge-stub/index.ts:1` |

**Planned Redesign:** Facilitation model (PDF reports + contact directory + native intents), not automated form submission.  
**Spec:** `docs/specs/spec-civic-action-kit-v0.md` (canonical)

---

## Known Gaps vs. Whitepapers

| Whitepaper Claim | Current Reality |
|------------------|-----------------|
| "Hardware Root of Trust" (LUMA) | Encrypted vault + in-memory provider are in place, but no TEE integration yet |
| "VIO liveness detection" (LUMA) | Not implemented |
| "Holographic vectors" (LUMA) | Not implemented |
| "Mathematically private" (LUMA) | Device-bound nullifier, not human-bound |
| "BMR compliance" (GWC) | No compliance implementation |
| "Local AI inference" (VENN) | Mock engine, no WebLLM |
| "Sovereign Delivery" (HERMES) | Redesigning as facilitation (Civic Action Kit) |

**⚠️ Whitepapers describe target architecture, not current implementation.**

---

## Security Considerations

### Current Risks (Code-Verified)

| Risk | Severity | Status | Evidence |
|------|----------|--------|----------|
| No sybil defense | 🔴 High | Open | `main.rs:162` (device-only nullifier) |
| Trust scores spoofable | 🔴 High | Open | `main.rs:105-116` |
| AI analysis mocked | 🟡 Medium | Open | `worker.ts:6-23` |
| First-to-file poisoning | 🟡 Medium | Open | `analysis.ts:30-48` (no supersession) |

### Mitigations in Place

- ✅ **Resolved (PR #10):** identity is no longer persisted in localStorage; encrypted IndexedDB vault is authoritative, with migration-only legacy key handling.
- ✅ **Resolved (PR #10):** identity publish event leak removed (`vh:identity-published` carries no identity payload).
- ✅ **Resolved (PR #10):** master-key initialization race hardened via atomic IndexedDB `add` flow.
- ✅ **Resolved (PR #10):** migration clobber guard prevents stale legacy identity from overwriting existing vault state.
- ✅ Topology guard prevents unauthorized Gun writes
- ✅ Encryption required for sensitive mesh paths
- ✅ XP ledger is local-only (no off-device leak)
- ✅ Civic signals stay local, only aggregates planned for mesh
- ⚠️ Constituency proofs are required for SentimentSignal emission; currently missing in app state

---

## Test Coverage

**Repo-wide (Vitest `pnpm test:quick`):** 721 tests (unit + component + integration).

**Coverage (`pnpm test:coverage`, last validated 2026-02-07):**

| Metric | Value |
|--------|-------|
| Statements | 100% |
| Branches | 100% |
| Functions | 100% |
| Lines | 100% |

> Note: Coverage totals vary as files are added/modified. Gate enforces 100% on all metrics. Exact counts available from CI.

✅ **Coverage gate (100% threshold) passes.**

---

## Deployment Status

| Environment | Status | Artifacts |
|-------------|--------|-----------|
| Localhost (Anvil) | ✅ Working | `deployments/localhost.json` |
| Sepolia Testnet | ❌ Not deployed | Script exists: `deploy-testnet.ts` |
| Base Sepolia | ❌ Not deployed | Script exists |
| Mainnet | ❌ Not planned | — |

---

## Roadmap to Production-Ready

### Immediate Blockers (Must Fix)

| Blocker | Severity | Sprint Gap | Fix |
|---------|----------|------------|-----|
| AI engine mocked | 🔴 High | Sprint 2 | Wire WebLLM or consented remote API |
| Testnet undeployed | 🟡 Medium | Sprint 1 | Run `deploy-testnet.ts` to Sepolia |
| Attestation is stub | 🟡 Medium | Sprint 1 | Label as DEV ONLY or implement real validation |
| No sybil defense | 🔴 High | N/A (LUMA gap) | Research pragmatic uniqueness checking |

### Phase 1: Complete Sprint Gaps (Immediate)

- [ ] **Deploy contracts to Sepolia** — Run existing `deploy-testnet.ts`, commit artifact
- [ ] **Integrate real AI engine** — Wire WebLLM (local) or add consent flow for remote API
- [ ] **Label attestation as DEV ONLY** — Prevent false security assumptions
- [ ] **Add beta warnings to UI** — Prominent disclaimers on analyses/governance

### Phase 2: Security Hardening (30 days)

- [x] Move identity persistence from localStorage to encrypted IndexedDB vault (`vh-vault`/`vault`) — completed in PR #10 (`813558c`), including DOM event leak removal, master-key race hardening, and migration clobber guard.
- [ ] Implement first-N quorum canonicalization (supersession for poisoned analyses)
- [ ] Add cohort thresholds for any aggregate display (N≥20)

### Phase 3: Bridge Redesign (Sprint 5)

- [ ] Redesign as facilitation model (PDF reports + contact directory + native intents)
- [ ] Remove automation language from documentation
- [ ] Legal review before any form automation
- [ ] Add representative contact database (public data)

### Phase 4: Identity Strengthening (90 days)

- [ ] Research pragmatic sybil defense (federated attestation, social vouching)
- [ ] Implement basic uniqueness checking (even if centralized initially)
- [ ] Design hardware attestation integration path (Secure Enclave, StrongBox)

---

## How to Interpret This Document

- **🟢 Implemented** — Feature works and is tested
- **🟡 Partial** — Feature exists but has significant gaps
- **🔴 Stubbed** — Placeholder code only, not functional
- **⚪ Planned** — Design exists, no implementation
- **❌ Not implemented** — No code exists

---

## References

### Architecture & Vision
- `System_Architecture.md` — Target architecture (partially implemented)
- `docs/foundational/LUMA_BriefWhitePaper.md` — Identity vision (mostly aspirational)
- `docs/foundational/GWC_BriefWhitePaper.md` — Economics vision (contracts implemented, undeployed)
- `docs/foundational/ARCHITECTURE_LOCK.md` — Non-negotiable engineering guardrails (enforced)

### Canonical Specs
- `docs/specs/canonical-analysis-v1.md` — Analysis schema contract (implemented)
- `docs/specs/canonical-analysis-v2.md` — Quorum synthesis contract (planned)
- `docs/foundational/AI_ENGINE_CONTRACT.md` — AI engine pipeline contract (pipeline implemented, engine mocked)
- `docs/specs/spec-civic-sentiment.md` — Eye/Lightbulb/Sentiment spec (implemented locally)
- `docs/specs/spec-xp-ledger-v0.md` — XP ledger spec (fully implemented)
- `docs/specs/spec-identity-trust-constituency.md` — Identity contract (partially implemented)
- `docs/specs/spec-rvu-economics-v0.md` — RVU/UBE/QF economics (contracts ready, undeployed)
- `docs/specs/spec-data-topology-privacy-v0.md` — Data placement rules (implemented)
- `docs/specs/spec-hermes-messaging-v0.md` — Messaging spec (implemented)
- `docs/specs/spec-hermes-forum-v0.md` — Forum spec (implemented)

### Sprint Documentation
- `docs/sprints/archive/00-sprint-0-foundation.md` — ✅ Complete
- `docs/sprints/archive/01-sprint-1-core-bedrock.md` — ⚠️ 90% (testnet gap)
- `docs/sprints/02-sprint-2-advanced-features.md` — ⚠️ 85% (AI engine gap)
- `docs/sprints/03-sprint-3-the-agora.md` — ✅ Complete
- `docs/sprints/03.5-sprint-3.5-ui-refinement.md` — ✅ Complete
- `docs/sprints/04-sprint-agentic-foundation.md` — 🟡 In Progress (delegation types landed)
- `docs/sprints/05-sprint-the-bridge.md` — ⚪ Planning (not started)

### Developer Resources
- `CONTRIBUTING.md` — Engineering standards (enforced)
- `docs/foundational/Hero_Paths.md` — Canonical user journeys
- `docs/sprints/MANUAL_TEST_CHECKLIST_SPRINT3.md` — Manual testing guide
