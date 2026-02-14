# Wave 4 Kickoff Command Sheet

Companion to:
- `docs/foundational/WAVE4_DELTA_CONTRACT.md`
- `docs/foundational/V2_Sprint_Staffing_Roles.md`
- `docs/foundational/CE_DUAL_REVIEW_CONTRACTS.md`
- `docs/specs/spec-identity-trust-constituency.md` (v0.2)
- `docs/specs/spec-luma-season0-trust-v0.md` (v0.1)

## Wave 4 Runtime Constants

Source of truth: `docs/foundational/WAVE_RUNTIME_CONSTANTS.json`

- `ACTIVE_INTEGRATION_BRANCH=integration/wave-4`
- `ACTIVE_WAVE_LABEL=wave-4`
- `EXECUTION_BRANCH_PREFIXES=w4l/*,coord/*`
- `PARKED_BRANCH_PREFIX=agent/*`

## Wave 4 Focus: LUMA Identity Hardening (Implementation)

Wave 4 is a single-workstream wave implementing the Season 0 trust enforcement spec. The spec work is complete (Wave 3, PR #242). This wave delivers the code.

**Primary spec:** `docs/specs/spec-luma-season0-trust-v0.md` v0.1
**Parent spec:** `docs/specs/spec-identity-trust-constituency.md` v0.2
**Agent:** `w1a-chief` (orchestration-only per A4) → impl agents
**Branch prefix:** `w4l/*` (LUMA), `coord/*` (coordinator)

## Implementation Phases

### Phase 1: TRUST_THRESHOLDS Constant Consolidation

**Spec ref:** `spec-luma-season0-trust-v0.md` §2
**Scope:** Extract scattered magic numbers into canonical constants.

Deliverables:
- Create `packages/data-model/src/constants/trust.ts` with `TRUST_THRESHOLDS` and `SCALED_TRUST_THRESHOLDS`
- Barrel re-export from `packages/data-model/src/index.ts`
- Replace all 11 hardcoded threshold sites (see spec §6 handoff map):
  - `useIdentity.ts:115` (0.5 → `TRUST_THRESHOLDS.STANDARD`)
  - `TrustGate.tsx:12` (0.5 → `TRUST_THRESHOLDS.STANDARD`)
  - `BridgeLayout.tsx:49` (0.5 → `TRUST_THRESHOLDS.STANDARD`)
  - `RepresentativeSelector.tsx:36` (0.5 → `TRUST_THRESHOLDS.STANDARD`)
  - `ActionComposer.tsx:73,75` (0.5/0.7 → `TRUST_THRESHOLDS.STANDARD`/`ELEVATED`)
  - `ShareModal.tsx:46` (0.5 → `TRUST_THRESHOLDS.STANDARD`)
  - `WalletPanel.tsx:70` (0.5 → `TRUST_THRESHOLDS.STANDARD`)
  - `forum/types.ts:5` (0.5 → `TRUST_THRESHOLDS.STANDARD`)
  - `xpLedger.ts:319` (0.5 → `TRUST_THRESHOLDS.STANDARD`)
  - `useGovernance.ts:30` (0.7 → `TRUST_THRESHOLDS.ELEVATED`)
  - `dashboardContent.tsx:178-188` (0.5/0.7 → `TRUST_THRESHOLDS`)
- Tests: unit tests for constants module, update existing tests that reference thresholds

**Risk:** Low — mechanical replacement, no behavior change.

### Phase 2: Session Lifecycle Foundation

**Spec ref:** `spec-luma-season0-trust-v0.md` §3
**Scope:** Add session expiry/refresh skeleton to `useIdentity`.

Deliverables:
- Add `expiresAt` field to `SessionResponse` type (spec §3.2)
- Add lazy expiry check at action boundaries (spec §3.2 — check on `useIdentity` access)
- Add `revokeSession()` function (spec §3.3 — local store clear + grant cascade)
- E2E/dev mode: mock sessions get `expiresAt = Infinity` (spec §3.1)
- Feature-flag: `VITE_SESSION_LIFECYCLE_ENABLED` (default false, preserves current behavior)
- Tests: expiry check, revocation, dev mode bypass

**Risk:** Medium — touches auth-critical path. Feature flag mandatory.

### Phase 3: Constituency Proof Migration

**Spec ref:** `spec-luma-season0-trust-v0.md` §4
**Scope:** Add validation layer and feature-flag for real proof path.

Deliverables:
- Create `validateConstituencyProof()` implementing spec §4.2 error codes
- Feature-flag: `VITE_CONSTITUENCY_PROOF_REAL` (default false — mock remains default)
- When flag on: validate proof shape, nullifier match, district format
- When flag off: `getMockConstituencyProof()` unchanged
- Tests: validation for all 4 error codes, mock passthrough, flag toggle

**Risk:** Low — mock path unchanged, real path behind flag.

## Dependency-Safe Execution Order

```
Phase 0: Infrastructure (integration branch + ownership map + runtime constants)
    ↓
Phase 1: TRUST_THRESHOLDS consolidation (mechanical, low risk, unblocks Phase 2)
    ↓
Phase 2: Session lifecycle foundation (medium risk, feature-flagged)
    ↓  (can parallel with Phase 3)
Phase 3: Constituency proof migration (low risk, feature-flagged)
    ↓
Phase 4: Wave 4 closeout (docs audit, integration→main assessment)
```

## Ownership Map Updates

Add to `.github/ownership-map.json`:

```json
{
  "w4l": {
    "source": [
      "packages/data-model/src/constants/**",
      "apps/web-pwa/src/hooks/useIdentity*",
      "apps/web-pwa/src/store/bridge/constituencyProof*"
    ],
    "test": [
      "packages/data-model/src/constants/**/*.test.*",
      "apps/web-pwa/src/hooks/useIdentity*.test.*",
      "apps/web-pwa/src/store/bridge/constituencyProof*.test.*"
    ]
  }
}
```

## Pre-Dispatch Checks

Same as Wave 3 (all policies carry forward):
1. CE dual-review mandatory for all execution dispatches
2. Ownership preflight simulation before dispatch
3. Context rotation guard enforced
4. Merge queue for all PRs

## Wave 3 Closeout Summary

Wave 3 delivered 13 PRs (#229–#242) to `integration/wave-3`:
- W3-CAK (Phases 1-3): Full Civic Action Kit UI + trust/XP/budget enforcement
- W3-Collab: CollabEditor runtime wiring
- W3-Flags: Wave 1 feature flag retirement
- W3-Budget: Budget boundary close-out (8/8 keys)
- W3-Synth: Synthesis feed enrichment for TopicCards
- W3-LUMA: Identity hardening spec (v0.2 + Season 0 enforcement spec)
- Infrastructure: Guardrails, ownership, docs audit, A4 policy

All CE gates closed. DOC_AUDIT_PASS achieved.
