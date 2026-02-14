# Wave 4 Delta Contract

Companion to:
- `docs/foundational/WAVE3_DELTA_CONTRACT.md` (all policies + amendments carry forward)
- `docs/foundational/CE_DUAL_REVIEW_CONTRACTS.md`
- `docs/foundational/WAVE4_KICKOFF_COMMAND_SHEET.md`

Status: Binding for Wave 4 execution.

Last updated: 2026-02-14

---

## Policy Inheritance

All 16 binding policies from `WAVE2_DELTA_CONTRACT.md` remain in effect.
All Wave 3 amendments (A1–A4) carry forward with Wave 4-specific adjustments below.

Key carried policies:
- **A4 (chiefs orchestration-only):** Unchanged. No size-threshold exception. Break-glass per incident only.
- **CE dual-review:** Mandatory for all execution dispatches.
- **Merge queue:** All PRs via `gh pr merge --merge --auto`.

## Wave 4 Runtime Constants

Source of truth: `docs/foundational/WAVE_RUNTIME_CONSTANTS.json`

## Wave 4 Amendments

### A5. LUMA-focused wave scope

Wave 4 is a single-workstream wave focused on LUMA identity hardening implementation, based on `spec-identity-trust-constituency.md` v0.2 and `spec-luma-season0-trust-v0.md` v0.1.

All implementation MUST conform to the Season 0 boundary fence (spec §9): only capabilities marked "Enforced" are in scope. Deferred capabilities (Gold/Platinum, BioKey, DBA, ZK-SNARK, etc.) are out of scope.

### A6. Branch prefix continuity

Wave 4 uses `w4l/*` prefix for LUMA work. Agent assignments:
- `w1a-chief` (identity domain — continuity from Sprint 2 identity work)
- Impl agents spawned per A4 orchestration-only policy

### A7. Shared-file pre-approvals (Policy 3)

The following shared-file expansions are pre-approved for Wave 4:

| File | Team | Justification |
|------|------|---------------|
| `packages/data-model/src/constants/*` | w4l | New TRUST_THRESHOLDS constant module (additive) |
| `packages/data-model/src/index*.ts` | w4l | Barrel re-export for trust constants (additive) |
| `apps/web-pwa/src/hooks/useIdentity.ts` | w4l | Session lifecycle hardening (TTL, expiry) |

### A8. Spec-implementation traceability

Every implementation PR in Wave 4 MUST reference the specific spec section it implements:
- `spec-identity-trust-constituency.md` v0.2 §X.Y for architectural contracts
- `spec-luma-season0-trust-v0.md` v0.1 §X for enforcement contracts

This enables post-wave audit of spec coverage.
