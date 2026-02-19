# FPD Production Wiring Delta Contract

Last updated: 2026-02-19
Status: Binding for FPD production-wiring execution
Companion dispatch: `docs/plans/FPD_OUTLINE_AND_DISPATCH_2026-02-19.md`

---

## Objective

Close the gap between currently merged FPD L1-L4 behavior and production-safe end-to-end wiring for proof validation, vote identity, migration continuity, aggregate visibility, deterministic mesh lookup, and release safety.

---

## Hard gates (must all pass before production enablement)

1. Real non-mock proof-provider contract active in production path.
2. Unified vote admission policy across Feed and AnalysisView (no bypass path).
3. Canonical synthesis-bound point identity contract in write/read paths.
4. Legacy vote-key migration complete with dual-write/backfill and explicit sunset.
5. Aggregate read path wired to UI with retry/backoff + telemetry.
6. Deterministic analysis mesh read-by-key (latest pointer fallback only).
7. CI/e2e/coverage guardrails include critical proof/vote paths.
8. Canary + rollback plan validated with quantitative thresholds.

---

## Mandatory policies

### P1 — Fail-closed production proof policy
- Production must reject mock/transitional-only proof providers.
- Build/release checks must block production artifact if only transitional provider is available.

### P2 — Transitional shim policy (Phase 0 only)
- Transitional proof shim is allowed only in dev/staging/E2E.
- Transitional code must be marked `TRANSITIONAL` and tracked with removal criteria.
- Transitional path must be removed before final production completion gate.

### P2.1 — Transitional Shim Tracking

| File | Added | Removal Trigger |
|------|-------|-----------------|
| `apps/web-pwa/src/store/bridge/transitionalConstituencyProof.ts` | WS1 (Phase 0) | Phase 1 real proof-provider ships (WS2/S1) |
| `apps/web-pwa/src/hooks/useRegion.ts` (transitional branch) | WS1 (Phase 0) | Phase 1 real proof-provider ships (WS2/S1) |
| `packages/data-model/src/schemas/hermes/sentiment.ts::derivePointId` (legacy analysis-bound point identity) | Pre-WS3 | WS4 dual-write migration complete (consumer switchover + key mapping for stored agreements and Gun mesh data) |

Removal criteria: All transitional code is removed in Phase 5 (WS7) after production proof provider is validated and legacy paths are sunset.

### P2.2 — Season 0 "Real" Provider Semantics

"Real" in Season 0 means:
- **Attestation-bound**: proof is derived from actual identity session data (real nullifier from verifier)
- **Non-mock**: does not use `mock-district-hash` or `mock-root` values
- **Non-transitional**: does not use `t9n-*` prefixed values
- **Externalized district**: `district_hash` comes from configured source (`VITE_DEFAULT_DISTRICT_HASH`), not self-derived from nullifier
- **Deterministic**: same inputs produce the same proof
- **Not cryptographically verifiable**: Season 0 `merkle_root` is not ZK-bound to a residency set (that requires Phase 4-5 DBA/ZK enrollment per spec §4.3)

This is not the final proof provider. It satisfies Hard Gate 1 within Season 0 boundary fence (spec §9). The upgrade path to real ZK-bound proofs is documented in spec §4.4.

### P3 — Identity-root migration safety
- S2 point-identity root transition must preserve legacy analysisKey-based derivation during S4 dual-write window.
- No hard cut that orphans existing user vote state.
- Status (WS3): **Partially addressed** — synthesis-bound derivation contract (`deriveSynthesisPointId`) is created; consumer migration is deferred to WS4.
- WS4 migration note: consumer switchover requires dual-read/dual-write compatibility across old+new point IDs, including key-mapping for stored agreement keys and Gun mesh `point_id` data.

### P4 — Quantitative rollout gates
- Vote denial rate < 2% (excluding expected no-identity denials)
- Aggregate write success > 98%
- P95 vote-to-mesh latency < 3s
- Auto-abort if any threshold is breached for >5m in canary stage

### P5 — Documentation parity in-lockstep
- Spec and foundational docs must be updated in the same wave as runtime behavior changes.
- No unresolved contract drift crossing phase boundaries.

---

## Branch and execution posture

- Active integration target for this job: `main` (no wave integration branch active).
- Execution branches: `coord/fpd-*` or role-appropriate execution branches approved by coordinator.
- Parked branches (`agent/*`) are context-only and must not be used for implementation pushes.

---

## Required artifacts per phase

- Phase report: `state / done / next / blockers`
- Changed contracts/specs list
- Test and CI evidence
- Risk register update with owner + mitigation

---

## Stop conditions

- Any hard gate unresolved
- CE disagreement on policy-critical transition
- Migration threshold below cutover target
- Canary SLO breach without validated rollback

---

## Signoff protocol

Production enablement requires:
- CE-Codex + CE-Opus alignment on final gate state
- Coordinator signoff
- Director (Lou) approval
