# Public Beta Current-State Handoff

> Document Role: Non-authoritative onboarding router
> Status: Active compatibility path
> Owner: VHC Launch Ops + VHC Core Engineering
> Human authority: Lou
> Technical executor: Codex

Do not maintain incident state, hashes, PR status, mailbox counts, or attempt
chronology here. Moving evidence and the next eligible gate live only in
`docs/ops/public-beta-operational-state.md`.

The exact prior handoff is archived at
`docs/archive/public-beta-pre-mvp-completion-2026-07-11/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md`.

## Read In This Order

1. `docs/foundational/STATUS.md` - implementation and drift;
2. `docs/ops/public-beta-operational-state.md` - current decision, evidence, and
   next gate;
3. `docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md` - outcomes,
   dependency order, working-MVP threshold, and definition of done;
4. the runbook or reviewed packet named by the current lane;
5. `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md` - compact
   orchestration mechanics;
6. `docs/ops/public-beta-launch-readiness-closeout.md` - release evidence and
   claim boundary.

## Durable Boundaries

- Repo capability, review, and human authorization are not live execution.
- Lou alone owns incident, rollback, provider, pager, release, and tester-wave
  authority.
- Subagents do not mutate A6, services, relays, Gmail, DNS, Cloudflare,
  providers, pager, testers, or production data.
- Every live lane uses one authorized technical driver plus an independent
  reviewer.
- `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`.
- `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`.
- `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`.
- `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`.
- Stale/fixture-only evidence never substitutes for current live proof.
- No secret or private identity/provider/support material enters public or
  committed surfaces.

## Resume Rule

Refresh repo/PR/mailbox/read-only A6 state, compare it with the operational
owner, and dispatch only the named next eligible gate. On drift, exit `78`,
rollback, new/unbound critical, missing evidence, or missing authority, stop and
preserve evidence.

Use the active sprint's lane matrix and completion-report schema for every
delegated result. The operational owner overrides this router whenever state
changes.
