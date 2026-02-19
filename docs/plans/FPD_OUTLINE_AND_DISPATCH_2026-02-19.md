# FPD Production Wiring — Outline + Dispatch (2026-02-19)

Status: Director-prep artifact (pre-implementation)
Source of direction: Lou directive + CE dual-sign (Codex + Opus)

---

## Part A — Comprehensive Iterative Outline (pre-implementation)

### Non-negotiables
1. No production rollout now.
2. Phase 0 shim is scaffolding only (dev/staging/E2E), never a ship target.
3. Production remains fail-closed if only mock/transitional proof paths exist.
4. During point-ID contract changes, legacy analysisKey-derived IDs remain readable/writable in migration window.
5. Quantitative canary gates are hard release blockers.

### Iteration 0 — Plan lock + release guard scaffold (no behavior change)
Goal: prevent accidental ship while implementation is in progress.
- Add/verify release guards for prod fail-closed proof path.
- Add/verify flag matrix and defaults.
Exit gate: prod build fails if transitional proof is only provider.

### Iteration 1 (Phase 0) — Transitional shim for dev/staging unblock
Goal: unblock end-to-end testing while production contracts are built.
- Add Season 0 transitional proof shim (identity-nullifier-derived, non-mock markers).
- Restrict to dev/staging/E2E.
- Tag TRANSITIONAL + explicit removal criteria.
Exit gate: staging/test flow works; prod remains blocked.

### Iteration 2 (Phase 1 / S1) — Real proof-provider contract
Goal: production-grade proof source and verification path.
- Proof provider interface + typed errors.
- `useRegion` real provider path when `VITE_CONSTITUENCY_PROOF_REAL=true`.
- `useConstituencyProof` enforces freshness/nullifier/district validity.
Exit gate: verified non-mock proof path passes staging; fail-closed in prod mode.

### Iteration 3 (Phase 1 / S2) — Canonical synthesis-bound point identity
Goal: one point-identity model across all vote surfaces.
- Canonical synthesis-bound point identity contract and implementation.
- Preserve legacy analysisKey derivation as migration path during S4 window.
Exit gate: deterministic identity tests pass; old and new roots coexist safely.

### Iteration 4 (Phase 2 / S3) — Unified vote enforcement
Goal: remove bypass paths.
- Single vote admission policy for Feed + AnalysisView.
- No direct writes around common guard.
Exit gate: no voting write path bypasses proof/context checks.

### Iteration 5 (Phase 2 / S4) — Migration (dual-write + backfill + sunset)
Goal: preserve user vote state across identity-root transition.
- Dual-write, backfill, migration telemetry.
- Cutover threshold >=99.5% migrated.
- Legacy read sunset: 30 days or 2 releases (whichever later).
Exit gate: migration threshold met; no vote-loss evidence.

### Iteration 6 (Phase 3 / S5+S6) — Projection completeness + deterministic mesh reads
Goal: eliminate write-only and pointer-only drift.
- Wire `readAggregates` in Feed + AnalysisView with retries/telemetry.
- Deterministic mesh read-by-key; latest-pointer fallback only.
Exit gate: aggregate consistency and resilience metrics pass.

### Iteration 7 (Phase 4 / S7) — CI/e2e/coverage + docs
Goal: convert from "green but blind" to ship-grade confidence.
- Remove critical-path coverage exclusions.
- Add e2e coverage for proof validity, synthesis gating, continuity, migration compatibility.
- Update `.env.example` and feature-flag docs.
Exit gate: CI blocks regressions across proof/vote critical paths.

### Iteration 8 (Phase 4 / S8) — Canary + rollback readiness
Goal: safe rollout mechanics.
- Canary 5% -> 25% -> 50% -> 100% with hold windows.
- SLOs: vote denial <2% (excluding expected no-identity denials), aggregate write success >98%, p95 vote->mesh <3s.
- Auto-abort when SLO breaches >5m.
- Manual rollback drill required before first canary.
Exit gate: signed canary + rollback readiness.

### Iteration 9 (Phase 5) — Transitional path removal
Goal: leave a clean production architecture.
- Remove shim and legacy dual-write/read paths after sunset criteria.
Exit gate: production build has no transitional/mock reachable paths.

---

## Part B — Dispatch Packet (Coordinator-bound)

### Dispatch ID
FPD-PROD-WIRING-DISPATCH-2026-02-19-A

### Objective
Execute production wiring for FPD voting and sentiment infrastructure using **Codex scope + Opus sequencing**, with explicit migration safety and release guardrails.

### Hard Rules
1. Do not ship to production until all hard gates pass.
2. Transitional shim is dev/staging/E2E only.
3. Production must fail-closed on proof path.
4. S2 root transition must preserve legacy analysisKey path during S4 dual-write window.
5. Quantitative canary gates are mandatory release blockers.

### Workstream sequence
- WS0: Guard scaffold (Iteration 0)
- WS1: Transitional shim (Iteration 1)
- WS2: Real proof contract (Iteration 2)
- WS3: Canonical point identity (Iteration 3)
- WS4: Unified enforcement + migration (Iterations 4–5)
- WS5: Projection/mesh correctness (Iteration 6)
- WS6: CI/e2e/docs and rollout readiness (Iterations 7–8)
- WS7: Transitional removal (Iteration 9)

### Suggested ownership map
- Coordinator: sequencing, gate enforcement, canary/rollback sign-off
- Chiefs: lane orchestration + merge discipline
- Impl agents: scoped coding slices and tests
- QA agents: deterministic verification + migration regression tests
- Docs agent: spec/doc updates + drift closure in same wave
- CE agents: gate reviews before user-facing implementation phase transitions

### Deliverables (minimum)
1. Proof provider contract + adapter docs
2. Canonical point identity contract docs
3. Migration runbook (dual-write/backfill/cutover/sunset)
4. Aggregate read + retry + telemetry design note
5. Mesh read-by-key decision record
6. Coverage/e2e policy update note
7. Canary/rollback runbook with SLO thresholds and abort criteria
8. Final transitional removal checklist

### Required reports per phase
- state/done/next/blockers
- changed files + tests added
- gate status (pass/fail)
- risks + explicit owner

### Stop conditions
- Any hard gate unmet
- Migration threshold below cutover criteria
- Canary SLO breach without validated mitigation
- CE disagreement on policy-critical phase transition

---

## Context-Building Ladder Reference
All agents must load `docs/foundational/CONTEXT_BUILDING_LADDER.md` plus role-specific context packs before acting.

This dispatch is binding only when approved by Director (Lou).
