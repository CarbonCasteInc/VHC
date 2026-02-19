# Context-Building Ladder (Lean VHC Cluster)

Last updated: 2026-02-19
Status: Active

Purpose: deterministic, low-noise context loading for the active cluster:
`main`, `coord`, `codex`, `opus`, `chief`, `impl`, `qa`, `docs`, `spec`.

---

## Global rule
Load tiers in order. Do not skip Tier 0.

- Tier 0 = always
- Tier 1 = role baseline
- Tier 2 = task-specific expansion
- Tier 3 = incident/escalation only

If context pressure rises, drop Tier 3 first, then Tier 2. Keep Tier 0/1.

---

## Tier 0 (all agents, every spawn)

1. `docs/foundational/WAVE_RUNTIME_CONSTANTS.json`
2. `docs/plans/ACTIVE_TASK_PACKET.md`
3. `docs/foundational/AGENT_RITUALS.md`
4. `docs/foundational/FPD_PROD_WIRING_DELTA_CONTRACT.md`
5. Agent-local `AGENTS.md`

---

## Tier 1 (role baseline)

### main / coord
- `docs/foundational/TRINITY_Season0_SoT.md`
- `docs/foundational/ARCHITECTURE_LOCK.md`
- `docs/foundational/CE_DUAL_REVIEW_CONTRACTS.md`
- `docs/foundational/STATUS.md`

### chief / impl / qa / docs / spec
- `docs/foundational/TRINITY_Season0_SoT.md`
- `docs/foundational/ARCHITECTURE_LOCK.md`
- role-relevant specs under `docs/specs/`

### codex / opus (CE pair)
- `docs/foundational/CE_DUAL_REVIEW_CONTRACTS.md`
- `docs/foundational/ARCHITECTURE_LOCK.md`
- task-relevant specs and run-state packet

---

## Tier 2 (task-specific expansion)

Load only what the active packet requires:

- `docs/plans/FPD-PROD-WIRING-RFC-20260219.md`
- `docs/plans/FPD_OUTLINE_AND_DISPATCH_2026-02-19.md`
- `docs/specs/spec-identity-trust-constituency.md`
- `docs/specs/spec-civic-sentiment.md`
- `docs/specs/topic-synthesis-v2.md`
- related PR/run evidence, touched source files/tests

---

## Tier 3 (incident/escalation only)

- CI run logs and failure artifacts
- prior CE disagreement packets
- historical wave docs only when needed to resolve precedence

---

## Refresh protocol

When context usage reaches risk levels:

1. Write handoff: `state now / done / next / blockers / artifacts`
2. Restart with Tier 0 + Tier 1
3. Rehydrate minimum Tier 2 docs only
4. Reconfirm hard gates before resuming

---

## Update protocol for new tasks

For a new task, update `docs/plans/ACTIVE_TASK_PACKET.md` first.
Only revise this ladder if role topology or baseline sources change.
