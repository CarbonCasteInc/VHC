# FPD Production Wiring RFC — 2026-02-19

**Status:** CE dual-signed, awaiting director approval  
**Main commit:** `a07eb50f057b423eb40aad3feaa54350817da779`  
**Baseline:** `f97af274b07c0d6ebf1ec0d0cdfb70f9e9d25900`

---

## CE Verdicts

| Agent | Model | Verdict | Blockers |
|---|---|---|---|
| CE-Codex | gpt-5.3-codex | **GO-WITH-CONDITIONS** | 0 |
| CE-Opus | claude-opus-4-6 | **GO-WITH-CONDITIONS** | 0 |

### CE-Codex condition
> Production remains fail-closed against transitional or mock proof paths and the migration-plus-canary quantitative gates are enforced as hard release blockers.

### CE-Opus condition
> S2's `derivePointId` refactoring must preserve the existing analysisKey-based derivation as the legacy path during S4's dual-write window, since current production point IDs are keyed to `story_id+provenance_hash+pipeline_version+model_scope` (not `topic_id+synthesis_id+epoch`), and a clean break without dual-write would orphan all existing vote state.

---

## Plan: "Codex scope + Opus sequencing"

### Phase 0 — Dev/staging unblock (NOT shippable)
- Transitional Season 0 proof shim: identity-nullifier-derived, non-mock proof that passes `isMockProof` + `verifyConstituencyProof` checks.
- Explicitly marked **TRANSITIONAL** in code + tracked as tech debt.
- Used ONLY in dev/staging/E2E. Production build MUST fail-closed if shim is the only proof source.
- **Removal criteria:** remove when Phase 1 real proof-provider ships.
- **Purpose:** unblock integration testing of downstream steps while contracts are built.

### Phase 1 — Contracts first
**S1:** Real production proof-provider contract + adapter.
- `useRegion` resolves from attestation verifier when `VITE_CONSTITUENCY_PROOF_REAL=true`.
- CI/runtime checks block mock/shim providers in production builds (fail-closed).
- Files: `useRegion.ts`, `store/bridge/constituencyProof.ts`, new `store/bridge/realConstituencyProof.ts`

**S2:** Canonical synthesis-bound point identity contract.
- `derivePointId` keyed to `topic_id+synthesis_id+epoch+column+text`.
- Replaces `analysisId` parsing AND `perspective.id:column` concatenation.
- **CE-Opus condition:** Must preserve existing `analysisKey`-based derivation as legacy path during S4's dual-write window.
- Files: `data-model/schemas/hermes/synthesis.ts`, `useBiasPointIds.ts`, `AnalysisView.tsx`

### Phase 2 — FE wiring + migration
**S3:** Unify vote enforcement across Feed (`BiasTable`/`CellVoteControls`) + `AnalysisView`.
- Single vote-admission hook, no bypass paths.
- Files: `CellVoteControls.tsx`, `AnalysisView.tsx`, new shared vote-admission hook

**S4:** Legacy vote-key migration with DUAL-WRITE + BACKFILL.
- Cutover success criteria: ≥99.5% keys migrated.
- Hard legacy-read sunset: 30 days post-migration or 2 release cycles (whichever later).
- Telemetry on mapped/unmapped/orphaned keys.
- Files: `useSentimentState.ts`, new migration module

### Phase 3 — Projection completeness
**S5:** Wire `readAggregates` into UI (both Feed + AnalysisView).
- Retry with bounded exponential backoff.
- Structured telemetry: `{topic_id, point_id, status, error_code}`.
- Files: `CellVoteControls.tsx`, `AnalysisView.tsx`, new aggregate hook

**S6:** Deterministic analysis mesh read-by-derived-key. Latest pointer as fallback only.
- Files: `useAnalysisMesh.ts`

### Phase 4 — Ship readiness
**S7:** CI coverage policy + e2e + flag docs.
- Remove exclusions for voting-path hooks/components in `vitest.config.ts`.
- e2e for proof validity, synthesis gating, vote continuity, backward compat.
- Create `.env.example` + `docs/feature-flags.md`.

**S8:** Canary + rollback gates with quantitative thresholds:
- Vote denial rate < 2% (excluding expected no-identity denials)
- Aggregate write success > 98%
- P95 vote-to-mesh latency < 3s
- Automatic abort trigger if any SLO breached for >5min
- Manual rollback drill validated before canary starts
- Canary ramp: 5% internal → 25% → 50% → 100% with 24h hold per stage

### Phase 5 — Shim removal
- Remove Season 0 proof shim from codebase.
- Remove legacy key dual-write/read after sunset window.
- Final audit: no mock/transitional paths remain in prod build.

---

## Policy
- `prod_rollout_allowed_now: false`
- Transitional shims: dev/staging/E2E only with explicit removal criteria
- No production enablement until all hard gates pass and canary SLOs are met

---

## Hard Gates (8)
1. Real non-mock proof source contract implemented for production
2. Unified vote enforcement across feed + AnalysisView
3. Canonical synthesis-bound point identity
4. Legacy vote-key migration/compat with dual-write + backfill
5. Aggregate read + retry/telemetry (not write-only)
6. Deterministic mesh read-by-key behavior
7. CI coverage/e2e guardrails + flag docs
8. Canary + rollback plan with quantitative SLOs
