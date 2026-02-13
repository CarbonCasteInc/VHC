# Wave 3 Kickoff Command Sheet

Companion to:
- `docs/foundational/V2_Sprint_Staffing_Plan.md`
- `docs/foundational/V2_Sprint_Staffing_Roles.md`
- `docs/foundational/WAVE3_DELTA_CONTRACT.md`
- `docs/foundational/CE_DUAL_REVIEW_CONTRACTS.md`
- `docs/foundational/WAVE3_CARRYOVER.md`

## Wave 3 Runtime Constants

Source of truth: `docs/foundational/WAVE_RUNTIME_CONSTANTS.json`

- `ACTIVE_INTEGRATION_BRANCH=integration/wave-3`
- `ACTIVE_WAVE_LABEL=wave-3`
- `EXECUTION_BRANCH_PREFIXES=w3c/*,w3b/*,w3f/*,w3l/*,coord/*`
- `PARKED_BRANCH_PREFIX=agent/*`

## Wave 3 Priority Order (CEO Directive 2026-02-13)

1. **W3-CAK:** Civic Action Kit completion (receipt-in-feed + rep directory + native intents)
2. **W3-Collab:** CollabEditor runtime wiring into ArticleEditor
3. **W3-Flags:** Feature-flag retirement (Wave 1+2 flags → permanent-on)
4. **W3-Budget:** Remaining budget key (`moderation/day` — key 8/8)
5. **W3-Synth:** Runtime wiring: synthesis pipeline → discovery feed UI
6. **W3-LUMA:** LUMA identity hardening (sybil defense) — Season 0 scope

## Workstream Structure

### W3-CAK: Civic Action Kit Completion

**Spec:** `docs/specs/spec-civic-action-kit-v0.md` (Canonical, v0.3 — DeliveryReceipt already defined §2.4)
**Agent:** `w2g-chief` (continuity from W2-Gamma elevation foundation)
**Branch prefix:** `w3c/*`

**Depends on:** Wave 2 Gamma Phases 1-3 (all landed)

**Execution phases (isolated per Policy 10):**

Phase 1 — Data model + Gun adapters:
- `DeliveryReceiptSchema` (Zod, from spec §2.4)
- `RepresentativeSchema` (Zod, from spec §2.2)
- `CivicActionSchema` (Zod, from spec §2.3)
- Gun bridge adapters: user action/receipt chains, aggregate stats, strip-PII helpers
- Representative directory: data model, validation, district-hash lookup
- Ownership map update: `w3c` paths for `apps/web-pwa/src/store/bridge/**`, `apps/web-pwa/src/components/bridge/**`, `packages/data-model/src/schemas/hermes/bridge*.ts`

Phase 2 — Store + delivery pipeline:
- `useBridgeStore`: actions, hydration, persistence, encrypted profile
- Report generation pipeline (local PDF)
- Native intent adapters: mailto, tel, share, export, manual
- Receipt creation for success/failure/cancel/retry
- E2E mock bridge store

Phase 3 — UI + trust + XP:
- `BridgeLayout`, `RepresentativeSelector`, `ActionComposer`, `ActionHistory`, `ReceiptViewer`
- Trust threshold enforcement (§7.1)
- `civic_actions/day` budget wiring (already landed — integration)
- XP emissions (§9)
- Receipt-in-feed adapter + `ACTION_RECEIPT` feed kind in discovery store

**Key constraint:** Spec §2.4 DeliveryReceipt schema is already defined — no spec dispatch needed.

### W3-Collab: CollabEditor Runtime Wiring

**Agent:** `w2b-chief` (continuity from W2-Beta Stage 2)
**Branch prefix:** `w3b/*`
**Scope:** Single focused PR per WAVE3_CARRYOVER.md §3

Deliverables:
- Wire `CollabEditor` into `ArticleEditor.tsx` via flag gate (`VITE_DOCS_COLLAB_ENABLED`)
- Mode selection: single-author textarea (flag off) vs CollabEditor (flag on)
- Integration tests for both modes
- Lazy-load path verification

### W3-Flags: Feature Flag Retirement

**Agent:** Coordinator (coord/* branches)
**Branch prefix:** `coord/*`

Deliverables:
- Remove `VITE_FEED_V2_ENABLED` gate — make v2 feed permanent
- Remove `VITE_TOPIC_SYNTHESIS_V2_ENABLED` gate — make v2 synthesis permanent
- Remove dead v1-fallback code paths
- Harden 4 flag-default assertion tests (CE recommendation)
- Keep Wave 2 feature flags (`VITE_HERMES_DOCS_ENABLED`, `VITE_DOCS_COLLAB_ENABLED`, `VITE_LINKED_SOCIAL_ENABLED`, `VITE_ELEVATION_ENABLED`) — these are newer and stay gated until integration verified

### W3-Budget: Moderation Budget Key

**Agent:** Coordinator or w2g-chief
**Branch prefix:** `coord/*` or `w3c/*`
**Scope:** Wire `moderation/day` budget key (8/8) at moderation action call sites

### W3-Synth: Synthesis → Feed Runtime Wiring

**Agent:** w2a-chief or coordinator
**Scope:** Connect synthesis pipeline output to discovery feed UI (v2 end-to-end rendering)

### W3-LUMA: Identity Hardening

**Agent:** TBD — needs spec work first
**Scope:** Sybil defense hardening. Requires new spec for LUMA trust model beyond stubs.
**Entry point:** Dispatch `w1-spec` for LUMA hardening spec, then plan implementation.

## Dependency-Safe Execution Order

```
Phase 0: Infrastructure (integration branch + ownership map + runtime constants)
    ↓
Phase 1: W3-Collab (independent, small, quick win)
    ↓  (parallel with W3-CAK Phase 1)
Phase 2: W3-CAK Phases 1-3 (largest workstream, main track)
    ↓
Phase 3: W3-Flags (after W3-Collab lands — can retire DOCS_COLLAB flag too)
    ↓
Phase 4: W3-Budget + W3-Synth (independent, can parallel)
    ↓
Phase 5: W3-LUMA (spec first, then implementation)
```

## Pre-Dispatch Checks

Same as Wave 2 (per WAVE2_DELTA_CONTRACT.md — policies carry forward):
1. CE dual-review mandatory for all execution dispatches
2. Ownership preflight simulation before dispatch
3. Context rotation guard enforced
4. Merge queue for all PRs (route through main for merge if PAT limited)

## Merge Protocol

- `gh pr merge --merge <PR>` (no `--auto` — PAT limitation)
- If merge fails, route through main agent
- Same for PR creation if needed
