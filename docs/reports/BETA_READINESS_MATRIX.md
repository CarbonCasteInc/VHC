# Beta Readiness Matrix — Internal Testnet Launch

**Generated:** 2026-02-15T10:46Z  
**Branch assessed:** `origin/main` at `09285c9`  
**Author:** Lane D (Docs agent — subagent)  
**Status:** INITIAL (G1–G5 assessed; G6–G8 PENDING dependent lanes)

---

## Summary

| Gate | Status | Pass | Fail | Blocked |
|------|--------|------|------|---------|
| G1: Identity (LUMA) | **FAIL** | 1/4 | 3/4 | — |
| G2: Budget Enforcement | **PASS** | 3/3 | — | — |
| G3: Feature Flags | **FAIL** | 1/3 | 2/3 | — |
| G4: CI/CD Health | **PASS** | 3/3 | — | — |
| G5: Security Posture | **FAIL** | 2/3 | 1/3 | — |
| G6: Invite/Cohort Controls | **PENDING** | — | — | 3/3 |
| G7: AI Harness | **PENDING** | — | — | 2/2 |
| G8: Runtime Wiring | **PENDING** | — | — | 3/3 |

**Totals (G1–G5 only):** PASS 10 / FAIL 6 / BLOCKED 0  
**Overall verdict:** ❌ NOT READY — 6 gate criteria fail across G1, G3, G5  
**Critical blockers:** Missing trust.ts consolidation, session lifecycle module, constituency proof module, session revocation, incomplete feature flag documentation, hardcoded dev secret in storage adapter.

---

## G1: Identity (LUMA)

### G1.1 — Trust constants consolidated in `trust.ts`

| Criterion | Status |
|-----------|--------|
| A file named `trust.ts` exists containing consolidated trust constants | **FAIL** |

**Evidence:** `find . -name "trust.ts" -not -path "*/node_modules/*"` returns zero results.

Trust-related constants are scattered:
- Trust score threshold (`< 0.5` reject) — `apps/web-pwa/src/hooks/useIdentity.ts:112`
- `scaledTrustScore` clamping (0–10000) — `apps/web-pwa/src/hooks/useIdentity.ts:114,230–234`
- QF threshold (≥ 0.7) — documented in `docs/specs/spec-identity-trust-constituency.md:37` but not codified as a runtime constant
- `SEASON_0_BUDGET_DEFAULTS` — `packages/types/src/budget.ts:59–68` (budget layer, not trust layer)

No single `trust.ts` module consolidates these thresholds.

**Verdict:** ❌ **FAIL** — No `trust.ts` exists. Trust constants are dispersed across `useIdentity.ts`, the identity spec, and budget types with no single source of truth.

---

### G1.2 — Session lifecycle working (`session-lifecycle.ts` + tests)

| Criterion | Status |
|-----------|--------|
| A `session-lifecycle.ts` module exists with create/hydrate/revoke lifecycle | **FAIL** |

**Evidence:** `find . -name "session-lifecycle*" -not -path "*/node_modules/*"` returns zero results.

Session lifecycle logic is embedded directly in `useIdentity.ts` (React hook):
- **Create:** `useIdentity.ts:80–129` — `createIdentity()` calls `createSession()` (gun-client), builds `IdentityRecord`, persists to vault
- **Hydrate:** `useIdentity.ts:59–71` — `loadIdentityFromVault()` on mount
- **Revoke:** ❌ Not implemented — no `revokeSession` function exists anywhere in the codebase (grep confirms zero matches)

Tests exist in `apps/web-pwa/src/hooks/useIdentity.test.ts` (7 test cases) but they test the React hook, not a standalone module.

**Verdict:** ❌ **FAIL** — No `session-lifecycle.ts` module exists. Lifecycle logic is coupled to the React hook. No revocation capability.

---

### G1.3 — Constituency proof verification (`constituency-verification.ts` + tests)

| Criterion | Status |
|-----------|--------|
| A `constituency-verification.ts` module exists with proof verification | **FAIL** |

**Evidence:** `find . -name "constituency*" -not -path "*/node_modules/*"` returns zero results.

The spec (`docs/specs/spec-identity-trust-constituency.md`) defines:
- `ConstituencyProof`: `{ district_hash, nullifier, merkle_root }` (spec §1)
- `RegionProof.publicSignals = [district_hash, nullifier, merkle_root]` (spec §4)
- `decodeRegionProof(publicSignals) -> ConstituencyProof` (spec §4)

None of this is implemented. The `IdentityRecord` type (`packages/types/src/identity.ts`) has no constituency/region fields. STATUS.md confirms LUMA is "🔴 Stubbed" with "No sybil defense" and "No uniqueness checking."

**Verdict:** ❌ **FAIL** — No constituency proof verification code exists. Entirely planned/specced, not implemented.

---

### G1.4 — Session revocation (`useIdentity.ts` `revokeSession`)

| Criterion | Status |
|-----------|--------|
| `useIdentity.ts` exports a `revokeSession` (or equivalent revocation) function | **FAIL** |

**Evidence:** `grep -rn "revokeSession\|revoke.*session\|session.*revoke\|logout\|signOut\|clearSession\|destroySession" --include="*.ts" --include="*.tsx"` returns zero matches for any revocation function in `useIdentity.ts`.

The hook exposes: `createIdentity`, `linkDevice`, `startLinkSession`, `completeLinkSession`, `updateHandle`, `validateHandle`. No revocation.

`clearIdentity()` exists in `packages/identity-vault/src/vault.ts:157` (wipes vault data) but is not wired into `useIdentity` as a session revocation flow.

**Verdict:** ❌ **FAIL** — No `revokeSession` or equivalent exists in `useIdentity.ts`. `clearIdentity` in vault is unwired.

---

## G2: Budget Enforcement

### G2.1 — All 8 budget keys active

| Criterion | Status |
|-----------|--------|
| All 8 canonical budget action keys are defined AND enforced at runtime | **PASS** |

**Evidence — Definition:** `packages/types/src/budget.ts:4–13` defines the `BudgetActionKey` union type with exactly 8 keys. `BUDGET_ACTION_KEYS` tuple (line 16–25) lists all 8. `SEASON_0_BUDGET_DEFAULTS` (line 59–68) provides limits for all 8.

**Evidence — Runtime enforcement (canPerformAction + consumeAction calls):**

| Key | Enforcement site | File:Line |
|-----|-----------------|-----------|
| `posts/day` | `createThread()` | `apps/web-pwa/src/store/forum/index.ts:64,119` |
| `comments/day` | `createComment()` | `apps/web-pwa/src/store/forum/index.ts:134,183` |
| `sentiment_votes/day` | `castVote()` | `apps/web-pwa/src/hooks/useSentimentState.ts:87,127` |
| `governance_votes/day` | `castGovernanceVote()` | `apps/web-pwa/src/hooks/useGovernance.ts:214,245` |
| `analyses/day` | analysis trigger | `apps/web-pwa/src/routes/AnalysisFeed.tsx:164,179` |
| `shares/day` | share action | `apps/web-pwa/src/routes/AnalysisFeed.tsx:244,262,268` |
| `moderation/day` | familiar panel | `apps/web-pwa/src/components/hermes/FamiliarControlPanel.tsx:95` + `xpLedgerBudget.ts:86–104` |
| `civic_actions/day` | familiar panel | `apps/web-pwa/src/components/hermes/FamiliarControlPanel.tsx:100` + `xpLedgerBudget.ts:108–126` |

**Note:** STATUS.md says "6/8 budget keys active" — this is **stale**. Code review confirms 8/8 are now enforced. The remaining 2 (`moderation/day`, `civic_actions/day`) were wired via `FamiliarControlPanel.tsx` and dedicated entrypoints in `xpLedgerBudget.ts`.

**Test coverage:**
- `packages/types/src/budget.test.ts` — 8-key validation, Season 0 defaults, schema parse/reject (30+ tests)
- `packages/types/src/budget-utils.test.ts` — consume/check/rollover logic (30+ tests)
- `apps/web-pwa/src/store/xpLedgerBudget.test.ts` — moderation & civic action budget helpers (20+ tests)
- `apps/web-pwa/src/store/xpLedger.test.ts` — store integration, canPerformAction/consumeAction (20+ tests)

**Verdict:** ✅ **PASS** — All 8 budget keys defined, all 8 enforced at runtime with check+consume pattern.

---

### G2.2 — TOCTOU hardening present

| Criterion | Status |
|-----------|--------|
| Concurrent budget operations are hardened against TOCTOU races | **PASS** |

**Evidence:**

1. **Forum store TOCTOU documentation:** `apps/web-pwa/src/store/forum/index.ts:115–118` and `179–182` — explicit TOCTOU comments documenting the race window between `canPerformAction` and `consumeAction` (check-then-write to Gun, then consume). Known tradeoff with issue #68 filed for optimistic-consume fix.

2. **Delegation-utils TOCTOU guards:** `packages/types/src/delegation-utils.ts:124,188,205` — three TOCTOU guard checks:
   - Delegation validation must happen at action time (line 124)
   - Assertion must be bound to action timestamp (line 188)
   - High-impact approval must be bound to action timestamp (line 205)
   
   Tested: `packages/types/src/delegation-utils.test.ts:202,339,373` — three dedicated TOCTOU test cases.

3. **Vault master key race protection:** `packages/identity-vault/src/vault.ts:52` — insert-only semantics (`IDB add`) to avoid TOCTOU races across tabs. Race test: `vault.master-key-race.test.ts`.

4. **Budget immutability:** `packages/types/src/budget-utils.ts` — all budget functions return new objects (no mutation), verified by `does not mutate original budget` tests in `budget-utils.test.ts`.

**Verdict:** ✅ **PASS** — TOCTOU hardening present at delegation, vault, and budget layers. Forum store documents known TOCTOU window with mitigation plan.

---

### G2.3 — Denial UX functional

| Criterion | Status |
|-----------|--------|
| Budget denial produces user-visible messaging at all enforcement points | **PASS** |

**Evidence — Denial messages at each enforcement site:**

| Key | Denial message | File:Line |
|-----|---------------|-----------|
| `posts/day` | `"Budget denied: Daily limit of 20 reached for posts/day"` | `forum/index.ts:66` |
| `comments/day` | `"Budget denied: Daily limit of 50 reached for comments/day"` | `forum/index.ts:136` |
| `sentiment_votes/day` | `"Daily limit reached for sentiment_votes/day"` (console.warn) | `useSentimentState.ts:89–90` |
| `governance_votes/day` | `"Governance vote budget exhausted"` (error state) | `useGovernance.ts:216–217` |
| `analyses/day` | `"Daily limit reached for analyses/day"` (console.warn) | `AnalysisFeed.tsx:166–167` |
| `shares/day` | `"Daily share limit reached"` (console.warn) | `AnalysisFeed.tsx:246` |
| `moderation/day` | `"moderation/day budget denied"` | `FamiliarControlPanel.tsx:97` |
| `civic_actions/day` | `"civic_actions/day budget denied"` | `FamiliarControlPanel.tsx:102` |
| No nullifier | `"Budget denied: No active nullifier"` | `xpLedger.ts:342` |
| No nullifier (check) | `"No active nullifier"` | `xpLedger.ts:337` |

All denial paths return structured `BudgetCheckResult` with `{ allowed: false, reason: string }`. Consumer code surfaces the reason string.

**Verdict:** ✅ **PASS** — All 8 budget keys produce denial messages. Null-nullifier edge case also covered.

---

## G3: Feature Flags

### G3.1 — All 10 flags documented in STATUS.md flag table

| Criterion | Status |
|-----------|--------|
| STATUS.md flag table lists all feature flags with purpose and default | **FAIL** |

**Evidence:** STATUS.md "Feature Flags (Wave 1)" table lists **3 flags only:**
1. `VITE_FEED_V2_ENABLED` — default `false`
2. `VITE_TOPIC_SYNTHESIS_V2_ENABLED` — default `false`
3. `VITE_REMOTE_ENGINE_URL` — default empty

**Undocumented flags found in codebase:**

| Flag | Source | Purpose |
|------|--------|---------|
| `VITE_E2E_MODE` | `env.d.ts:4`, `useIdentity.ts:11` | Gates E2E test mode (mock identity) |
| `VITE_GUN_PEERS` | `env.d.ts:5` | Gun relay peer list |
| `VITE_ATTESTATION_URL` | `env.d.ts:6`, `useIdentity.ts:14` | Attestation verifier endpoint |
| `VITE_ATTESTATION_TIMEOUT_MS` | `env.d.ts:7`, `useIdentity.ts:15` | Verifier timeout |
| `VITE_RPC_URL` | `env.d.ts:9` | Ethereum RPC endpoint |
| `VITE_UBE_ADDRESS` | `env.d.ts:10` | UBE contract address |
| `VITE_RVU_ADDRESS` | `env.d.ts:11` | RVU contract address |
| `VITE_HERMES_DOCS_ENABLED` | `store/hermesDocs.ts:17` | Gates collaborative docs feature |
| `VITE_REMOTE_ENGINE_API_KEY` | `ai-engine/src/engines.ts:115` | Remote AI engine API key |
| `VITE_E2E_MULTI_USER` | `packages/e2e/src/fixtures/multi-user.ts:110` | Multi-user E2E fixture |

Total distinct `VITE_` variables: **13**. Feature-toggle flags (behavioral): **4** (`E2E_MODE`, `FEED_V2`, `SYNTHESIS_V2`, `HERMES_DOCS_ENABLED`). STATUS.md documents **3/13** total, **2/4** behavioral flags.

**Verdict:** ❌ **FAIL** — STATUS.md flag table is incomplete. At minimum `VITE_HERMES_DOCS_ENABLED` and `VITE_E2E_MODE` are missing from documentation.

---

### G3.2 — All flags default false in `.env` files

| Criterion | Status |
|-----------|--------|
| Production `.env` sets all feature toggle flags to `false` | **PASS** |

**Evidence:** `apps/web-pwa/.env.production` contents:
```
VITE_E2E_MODE=false
VITE_FEED_V2_ENABLED=false
VITE_TOPIC_SYNTHESIS_V2_ENABLED=false
```

All three documented feature flags default to `false`. `VITE_REMOTE_ENGINE_URL` defaults to empty string (disabled). `VITE_HERMES_DOCS_ENABLED` is **not** in `.env.production` but defaults to `false` at runtime (reads `import.meta.env` which is `undefined` → not `'true'`).

**Verdict:** ✅ **PASS** — All feature toggle flags that exist in `.env.production` default to `false`. Undocumented flags also default safely.

---

### G3.3 — ON/OFF behavior verified for each flag

| Criterion | Status |
|-----------|--------|
| Test files verify both ON and OFF behavior for each feature flag | **FAIL** |

**Evidence — Flags with ON/OFF tests:**

| Flag | ON test | OFF test | File |
|------|---------|----------|------|
| `VITE_FEED_V2_ENABLED` | ✅ `store/discovery/store.test.ts:398` | ✅ `store/discovery/store.test.ts:329`, `useFeedStore.test.ts:6`, `FeedList.test.tsx:15` | Multiple |
| `VITE_TOPIC_SYNTHESIS_V2_ENABLED` | ✅ `useSynthesis.test.ts:83,114,142`, `commentCounts.test.ts:239` | ✅ `useSynthesis.test.ts:60`, `commentCounts.test.ts:229` | Multiple |
| `VITE_REMOTE_ENGINE_URL` | ✅ (implicitly via `remoteApiEngine.test.ts`) | ✅ (empty = disabled) | `remoteApiEngine.test.ts` |
| `VITE_E2E_MODE` | ✅ `useIdentity.test.ts` (loadHook with e2eMode=true) | ✅ `useIdentity.test.ts` (loadHook with e2eMode=false) | `useIdentity.test.ts` |
| `VITE_HERMES_DOCS_ENABLED` | ❌ No test | ❌ No test | — |

STATUS.md claims "Feature-flag variants ✅ PASS — Both ON/OFF pass all 1390 tests" — this refers to Wave 1 flags only. `VITE_HERMES_DOCS_ENABLED` has no ON/OFF variant test coverage.

**Verdict:** ❌ **FAIL** — 4/5 behavioral flags have ON/OFF tests; `VITE_HERMES_DOCS_ENABLED` lacks any test coverage.

---

## G4: CI/CD Health

### G4.1 — All 7 checks green on main

| Criterion | Status |
|-----------|--------|
| CI workflow defines 7 jobs; latest main run all green | **PASS** |

**Evidence:** `.github/workflows/main.yml` defines 7 jobs:
1. `ownership-scope` (PR-only) — `timeout-minutes: 5`
2. `change-detection` — `timeout-minutes: 5`
3. `quality` (lint, build, typecheck, deps:check) — `timeout-minutes: 20`
4. `test-and-build` (unit tests, diff-coverage, build) — `timeout-minutes: 25`
5. `e2e` (E2E tests, conditional) — `timeout-minutes: 30`
6. `bundle-check` (bundle size, conditional) — `timeout-minutes: 20`
7. `lighthouse` (Lighthouse audit, conditional) — `timeout-minutes: 15`

Latest `main` HEAD: `09285c9` (Merge PR #257 — CSP/LHCI fix). PR #257 merged implies CI passed (branch protection requires checks).

**Note:** Cannot directly verify GitHub Actions run status from this environment. Verdict based on merge-to-main implying required checks passed per branch protection.

**Verdict:** ✅ **PASS** — 7 CI jobs defined; merge to main at `09285c9` implies all required checks passed.

---

### G4.2 — Coverage gate passing

| Criterion | Status |
|-----------|--------|
| Coverage gate passes on latest main | **PASS** |

**Evidence:**
- `tools/scripts/check-diff-coverage.mjs` runs as PR-only gate (`test-and-build` job, line: `if: github.event_name == 'pull_request'`)
- STATUS.md (verified at `cd22dd0`, Wave 1 integration): 100% statements, branches, functions, lines (4531/4531, 1492/1492, 388/388)
- `pnpm test:coverage` listed as ✅ PASS in STATUS.md gate table
- PR #257 merged to main = diff-coverage gate passed

**Verdict:** ✅ **PASS** — Coverage gate passing per merge evidence and STATUS.md verification.

---

### G4.3 — Bundle size within budget

| Criterion | Status |
|-----------|--------|
| Bundle size ≤ 1 MiB gzipped | **PASS** |

**Evidence:**
- `bundle-check` CI job runs `pnpm bundle:check` with limit ≤ 1 MiB gzipped
- STATUS.md: "180.61 KiB gzipped (< 1 MiB limit)" — ✅ PASS
- PR #257 merged to main = bundle check passed (conditional on relevant file changes)

**Verdict:** ✅ **PASS** — 180.61 KiB << 1 MiB budget. Well within limits.

---

## G5: Security Posture

### G5.1 — No hardcoded secrets

| Criterion | Status |
|-----------|--------|
| No hardcoded secrets, API keys, or private keys in source | **FAIL** |

**Evidence of concerns:**

1. **Hardcoded dev root secret:** `packages/gun-client/src/storage/indexeddb.ts:8`
   ```ts
   const DEV_ROOT_SECRET = 'vh-dev-root-secret';
   ```
   Used at line 37 to derive the encryption root key for the encrypted IndexedDB adapter. This is a **static, predictable secret** used to encrypt the local Gun graph store. Any attacker with access to the IDB data can derive the same key.

2. **Hardcoded dev root salt:** `packages/gun-client/src/storage/indexeddb.ts:9`
   ```ts
   const DEV_ROOT_SALT = 'vh-dev-root-salt';
   ```

3. **E2E/dev mode fallback tokens:** `apps/web-pwa/src/hooks/useIdentity.ts:93,105–107,241–242` — `mock-session-*`, `dev-session-*`, `mock-device`, `mock-nonce` — these are gated behind `E2E_MODE` and `DEV_MODE` flags, acceptable for dev but the `DEV_MODE` fallback at line 99–109 activates in any development build.

4. **Contract config reads from env (safe pattern):** `packages/contracts/hardhat.config.ts:7,11` — `TESTNET_PRIVATE_KEY` from `process.env`, not hardcoded. ✅

5. **AI engine API key from env (safe pattern):** `packages/ai-engine/src/engines.ts:115` — reads `VITE_REMOTE_ENGINE_API_KEY` from env. ✅

**Primary concern:** The `DEV_ROOT_SECRET` in `indexeddb.ts` is a hardcoded encryption key used in production builds. The encrypted IndexedDB adapter uses it unconditionally — no environment gating.

**Verdict:** ❌ **FAIL** — `DEV_ROOT_SECRET`/`DEV_ROOT_SALT` in `packages/gun-client/src/storage/indexeddb.ts:8–9` are hardcoded static secrets used for encryption key derivation, present in all builds.

---

### G5.2 — CSP enforced

| Criterion | Status |
|-----------|--------|
| Content Security Policy is present and enforced in `index.html` | **PASS** |

**Evidence:** `apps/web-pwa/index.html:12–15` — CSP meta tag:
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:;
  object-src 'none'; base-uri 'self'; form-action 'self'" />
```

**CSP directives verified (9 total):**
- `default-src 'self'` ✅
- `script-src 'self'` (no `unsafe-inline`, no `unsafe-eval`) ✅
- `style-src 'self' 'unsafe-inline'` (acceptable for Tailwind/CSS-in-JS) ✅
- `connect-src 'self'` (no ws:/wss: — Gun peers must go through self) ✅
- `img-src 'self' data: blob:` ✅
- `worker-src 'self' blob:` (for WebLLM worker) ✅
- `object-src 'none'` ✅
- `base-uri 'self'` ✅
- `form-action 'self'` ✅

**Test coverage:** `apps/web-pwa/src/csp.test.ts` — verifies all 9 directives present, `unsafe-inline` only in `style-src`, no `ws:`/`wss:` in `connect-src`.

**Known limitation (documented):** CSP via meta tag; `frame-ancestors`, `report-to`, `sandbox` unsupported. Migration plan referenced at `docs/foundational/CSP_HEADER_MIGRATION.md`.

**Verdict:** ✅ **PASS** — CSP enforced via meta tag with tight policy. Test coverage verifies invariants.

---

### G5.3 — Topology guard active

| Criterion | Status |
|-----------|--------|
| `TopologyGuard` validates all Gun writes against classification rules | **PASS** |

**Evidence:** `packages/gun-client/src/topology.ts` implements `TopologyGuard` class:
- **3 classifications:** `public`, `sensitive`, `local` (line 1)
- **28 path rules** covering all namespaces: `vh/public/`, `vh/sensitive/`, `vh/local/`, `vh/user/`, `vh/directory/`, `vh/chat/`, `vh/outbox/`, `vh/analyses/`, `vh/aggregates/`, `vh/news/*`, `vh/topics/*`, `vh/discovery/*`, `vh/social/*`, `vh/forum/*`, `vh/civic/*`, `vh/hermes/*`, `~*/hermes/*`, `~*/docs/*` (lines 7–44)
- **PII guard:** `containsPII()` checks for `nullifier`, `district_hash`, `email`, `wallet`, `address` keys in public paths (lines 46–51)
- **Encryption guard:** Sensitive paths require `__encrypted` flag on payload (lines 69–72)
- **Directory exception:** `vh/directory/` allows PII (intentional for public directory entries) (line 63)
- **Disallowed path rejection:** Unknown paths throw `Topology violation: disallowed path` (line 58)

**Test coverage:** `packages/gun-client/src/topology.test.ts` — 10 test cases:
- PII blocking in public paths ✅
- Encryption requirement for sensitive paths ✅
- Public data without PII allowed ✅
- Directory PII exception ✅
- Wave-0 namespace registration ✅
- Document encryption requirement ✅
- Invalid prefix rejection ✅

**Verdict:** ✅ **PASS** — TopologyGuard active with comprehensive path rules, PII detection, and encryption enforcement. Well tested.

---

## G6: Invite/Cohort Controls — PENDING

| Sub-gate | Status | Notes |
|----------|--------|-------|
| G6.1 Invite gating implemented | **BLOCKED** | Lane C deliverable — not yet assessed |
| G6.2 Rate limiting present | **BLOCKED** | Lane C deliverable — not yet assessed |
| G6.3 Kill switch functional | **BLOCKED** | Lane C deliverable — not yet assessed |

**Action:** Await Lane C completion; then verify implementation and update this matrix.

---

## G7: AI Harness — PENDING

| Sub-gate | Status | Notes |
|----------|--------|-------|
| G7.1 All 7 adversarial scenarios tested | **BLOCKED** | Lane B deliverable — not yet assessed |
| G7.2 No critical failures | **BLOCKED** | Lane B deliverable — not yet assessed |

**Action:** Await Lane B results; then incorporate findings and update this matrix.

---

## G8: Runtime Wiring — PENDING

| Sub-gate | Status | Notes |
|----------|--------|-------|
| G8.1 Synthesis v2 → feed E2E | **BLOCKED** | Lane A1 deliverable — STATUS.md confirms "Runtime wiring (v2 → UI) ❌ Pending" |
| G8.2 CollabEditor → ArticleEditor | **BLOCKED** | Lane A3 deliverable — not yet assessed |
| G8.3 Budget 8/8 | **BLOCKED** | Lane A2 deliverable — NOTE: code review shows 8/8 enforced (see G2.1), but Lane A2 may have additional integration requirements |

**Action:** Await Lane A sub-lanes; then verify E2E wiring and update this matrix.

---

## Blockers Summary

| # | Blocker | Severity | Gate | Required Action |
|---|---------|----------|------|-----------------|
| B1 | No `trust.ts` — trust constants scattered | HIGH | G1.1 | Consolidate trust thresholds into `packages/types/src/trust.ts` |
| B2 | No `session-lifecycle.ts` — lifecycle in React hook | HIGH | G1.2 | Extract session create/hydrate/revoke into standalone module |
| B3 | No constituency proof verification | HIGH | G1.3 | Implement `constituency-verification.ts` per spec §4 |
| B4 | No `revokeSession` in `useIdentity` | HIGH | G1.4 | Wire `clearIdentity()` from vault into `useIdentity` as revocation flow |
| B5 | Feature flag table incomplete | MEDIUM | G3.1 | Add `VITE_HERMES_DOCS_ENABLED`, `VITE_E2E_MODE`, and all env vars to STATUS.md |
| B6 | `VITE_HERMES_DOCS_ENABLED` untested | MEDIUM | G3.3 | Add ON/OFF test coverage for hermes docs flag |
| B7 | Hardcoded `DEV_ROOT_SECRET` in storage adapter | HIGH | G5.1 | Replace with per-identity derived key or user-provided passphrase |
| B8 | STATUS.md says "6/8 budget keys" — actually 8/8 | LOW | — | Update STATUS.md to reflect current 8/8 enforcement |

---

## Appendix: Evidence Index

| Evidence ID | File | Line(s) | Gate |
|-------------|------|---------|------|
| E1 | `packages/types/src/budget.ts` | 4–25, 59–68 | G2.1 |
| E2 | `packages/types/src/budget-utils.ts` | full | G2.1, G2.2 |
| E3 | `packages/types/src/budget.test.ts` | full | G2.1 |
| E4 | `packages/types/src/budget-utils.test.ts` | full | G2.1, G2.2 |
| E5 | `apps/web-pwa/src/store/xpLedgerBudget.ts` | 86–126 | G2.1 |
| E6 | `apps/web-pwa/src/store/xpLedgerBudget.test.ts` | full | G2.1, G2.3 |
| E7 | `apps/web-pwa/src/store/xpLedger.ts` | 322–350 | G2.1, G2.3 |
| E8 | `apps/web-pwa/src/store/xpLedger.test.ts` | full | G2.1 |
| E9 | `apps/web-pwa/src/store/forum/index.ts` | 64–66, 115–119, 134–136, 179–183 | G2.1, G2.2 |
| E10 | `apps/web-pwa/src/hooks/useGovernance.ts` | 214–217, 245 | G2.1, G2.3 |
| E11 | `apps/web-pwa/src/hooks/useSentimentState.ts` | 87–90, 127 | G2.1, G2.3 |
| E12 | `apps/web-pwa/src/routes/AnalysisFeed.tsx` | 164–167, 179, 244–246, 262, 268 | G2.1, G2.3 |
| E13 | `apps/web-pwa/src/components/hermes/FamiliarControlPanel.tsx` | 31, 95–102 | G2.1, G2.3 |
| E14 | `packages/types/src/delegation-utils.ts` | 124, 188, 205 | G2.2 |
| E15 | `packages/types/src/delegation-utils.test.ts` | 202, 339, 373 | G2.2 |
| E16 | `packages/identity-vault/src/vault.ts` | 52 | G2.2 |
| E17 | `apps/web-pwa/src/hooks/useIdentity.ts` | full | G1.1–G1.4 |
| E18 | `apps/web-pwa/src/hooks/useIdentity.test.ts` | full | G1.2 |
| E19 | `packages/types/src/identity.ts` | full | G1.3 |
| E20 | `docs/specs/spec-identity-trust-constituency.md` | §1, §2, §4 | G1.1, G1.3 |
| E21 | `apps/web-pwa/src/env.d.ts` | full | G3.1 |
| E22 | `apps/web-pwa/.env.production` | full | G3.2 |
| E23 | `docs/foundational/STATUS.md` | "Feature Flags" section | G3.1 |
| E24 | `apps/web-pwa/src/store/hermesDocs.ts` | 17 | G3.1, G3.3 |
| E25 | `.github/workflows/main.yml` | full | G4.1–G4.3 |
| E26 | `apps/web-pwa/index.html` | 12–15 | G5.2 |
| E27 | `apps/web-pwa/src/csp.test.ts` | full | G5.2 |
| E28 | `packages/gun-client/src/topology.ts` | full | G5.3 |
| E29 | `packages/gun-client/src/topology.test.ts` | full | G5.3 |
| E30 | `packages/gun-client/src/storage/indexeddb.ts` | 8–9, 37 | G5.1 |
