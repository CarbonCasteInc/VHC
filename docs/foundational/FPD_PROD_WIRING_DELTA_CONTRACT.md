# FPD Production Wiring Delta Contract

Last updated: 2026-02-21
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
8a. Canary + rollback plan, telemetry instrumentation, and drill procedure documented in-repo (PR-satisfiable).
8b. Canary drill executed with recorded evidence and quantitative threshold validation (runtime ceremony, post-merge/pre-prod).

### Gate status snapshot

- Hard Gate 5 (WS5): **Satisfied** — `readAggregates` is wired into Feed (`CellVoteControls`) and `AnalysisView` via `usePointAggregate` with bounded exponential backoff retry (3 retries; 500ms/1s/2s/4s envelope) and structured telemetry `[vh:aggregate:read]`.
- Hard Gate 6 (WS5): **Satisfied** — `readMeshAnalysis` reads by `deriveAnalysisKey`-derived key first; `readLatestAnalysis` is fallback-only; structured telemetry emitted as `[vh:analysis:mesh]`.
- Hard Gate 2 (WS6): **Satisfied** — `AnalysisView` now uses `useConstituencyProof` for vote admission parity with Feed; vote requires identity + validated proof, with reason-specific blocked UX.
- Hard Gate 7 (WS6): **Satisfied** — critical vote-admission paths (`useSentimentState`, `CellVoteControls`, `AnalysisView`) are included in coverage gates with expanded unit tests and diff-coverage allowlisting.
- Hard Gate 8a (WS6): **Satisfied** — telemetry (`[vh:vote:admission]`, `[vh:vote:mesh-write]`) and canary/rollback plan are documented.
- Hard Gate 8b (WS7/WS8): **Satisfied (runtime rerun evidence captured)** — initial 2026-02-20 drill auto-aborted/rolled back, then 2026-02-21 rerun passed canary thresholds with healthy-phase non-zero mesh success and breach-sim distinction. See `docs/reports/evidence/2026-02-21-canary-rerun/EVIDENCE_BUNDLE.md` (plus legacy abort bundle at `docs/reports/FPD_CANARY_EVIDENCE_BUNDLE_2026-02-20.md`).

### Post-Gate 8b mesh persistence remediation snapshot (2026-02-21)

- Scope: AC1-AC5 closure for click-to-start analysis continuity, deterministic mesh persistence/reuse, multi-user shared artifact readability, and per-cell multi-user vote persistence with aggregate convergence.
- Branch status: implemented on `coord/ce-mesh-persistence-remediation` (pending PR creation and CE dual-review on PR head).
- Validation status: `pnpm test`, `pnpm typecheck`, and `pnpm lint` are green on remediation head.
- Evidence bundle: `docs/reports/evidence/2026-02-21-ce-mesh-persistence/EVIDENCE_BUNDLE.md` (plus `pnpm-test.log`, `typecheck.log`, `lint.log`, `vitest-slices.log`).
- Governance status: Phase 2 model-switch A/B remains separately gated by telemetry burn-in and CE convergence; this does not block remediation PR publication.

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

| File | Added | Removal Trigger | Status |
|------|-------|-----------------|--------|
| `apps/web-pwa/src/store/bridge/transitionalConstituencyProof.ts` | WS1 (Phase 0) | Phase 1 real proof-provider ships (WS2/S1) | **REMOVED (WS7)** |
| `apps/web-pwa/src/hooks/useRegion.ts` (transitional branch) | WS1 (Phase 0) | Phase 1 real proof-provider ships (WS2/S1) | **REMOVED (WS7)** |
| `apps/web-pwa/src/hooks/useSentimentState.ts` (dual-write/dual-read bridge + point-id alias map) | WS4 | WS7 / Phase 5 migration-window sunset | Pending (out of WS7 scope) |
| `packages/data-model/src/schemas/hermes/sentiment.ts::derivePointId` (legacy analysis-bound point identity) | Pre-WS3 | WS7 / Phase 5 after dual-compat window closes and legacy keyspace is retired | Pending (out of WS7 scope) |

Removal criteria: Proof-path transitional code removed in WS7. Sentiment dual-write bridge removal pending explicit migration sunset decision.

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
- Status (WS4): **Fully addressed (migration window active)** — consumer write/read paths now run canonical synthesis-bound IDs with dual-write + canonical-first/legacy-fallback reads.
- Migration bridge details (WS4): `useSentimentState` stores contextual alias mappings so legacy compatibility keys do not inflate active-count weighting while preserving legacy key readability.
- WS7 note: remove dual-write bridge and retire legacy keyspace only after Phase 5 cutover validation.

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
