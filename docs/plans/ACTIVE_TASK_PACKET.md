# ACTIVE TASK PACKET

Last updated: 2026-02-19
Status: Active
Owner: Lou + main/coord

## Task ID
FPD-PROD-WIRING

## Objective
Ship FPD production wiring safely on `main` with fail-closed production gates, migration safety, and quantitative rollout controls.

## Source of truth
- `docs/plans/FPD-PROD-WIRING-RFC-20260219.md`
- `docs/plans/FPD_OUTLINE_AND_DISPATCH_2026-02-19.md`
- `docs/foundational/FPD_PROD_WIRING_DELTA_CONTRACT.md`
- `docs/foundational/CE_DUAL_REVIEW_CONTRACTS.md`

## Required hard gates
1. Production fail-closed proof enforcement
2. Transitional shim restricted to dev/staging/E2E
3. Identity-root migration safety (dual-write/backfill/sunset)
4. Aggregate read + deterministic mesh behavior
5. CI/E2E/docs parity checks
6. Canary SLO thresholds + abort/rollback readiness

## Execution pattern
- `main -> coord -> chief -> impl`
- `chief` fanout to `qa/docs/spec` as needed
- `coord` runs `codex + opus` dual-review before major dispatch decisions

## Reporting contract
Use: `state now / done / next / blockers / artifacts`

## Branching target
- Integration target: `main`
- Execution branches: `coord/fpd-*`, `team-*/*`, `coord/*`

## Out of scope
- Dream automation work
- Non-VHC initiatives
- Historical wave reactivation

## Update rule for next task
When priorities change, edit this file first (keep section headers stable so AGENTS contracts remain reusable).
