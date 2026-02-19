# Agent Rituals (Lean VHC Cluster)

Last updated: 2026-02-19
Status: Active

Purpose: one shared operating ritual for all active agents (`main`, `coord`, `codex`, `opus`, `chief`, `impl`, `qa`, `docs`, `spec`).

---

## 1) Single-update task protocol

For each new task/milestone, update **one file first**:

- `docs/plans/ACTIVE_TASK_PACKET.md`

Everything else (AGENTS contracts, context ladder, role behavior) should be stable and reusable.

If a task truly changes architecture/policy, update runtime constants and contracts after the task packet.

---

## 2) Mandatory startup read order (all agents)

1. `docs/foundational/WAVE_RUNTIME_CONSTANTS.json`
2. `docs/plans/ACTIVE_TASK_PACKET.md`
3. `docs/foundational/CONTEXT_BUILDING_LADDER.md`
4. Role-local `AGENTS.md`

Do not skip this order.

---

## 3) Universal output format

All meaningful status reports use:

- **state now**
- **done**
- **next**
- **blockers**
- **artifacts** (PRs, SHAs, file paths, run links)

No vague progress updates.

---

## 4) Escalation discipline

Escalate immediately when:

- policy/safety decision is required,
- production gate decision is needed,
- requirements conflict across source docs,
- implementation is blocked by missing authority.

Default escalation path:
- `impl/qa/docs/spec -> chief -> coord -> main`
- CE reviews (`codex` + `opus`) are mandatory before major coordination decisions.

---

## 5) Task closeout discipline

A task is only complete when:

- acceptance criteria in `ACTIVE_TASK_PACKET.md` are met,
- checks/tests are green,
- docs are in sync for changed behavior,
- completion report is delivered upstream.

`chief` must send a completion report to `main` for assigned execution tasks.
