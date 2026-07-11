# Public Beta Next-Phase Orchestration Checklist

> Document Role: Non-authoritative executable companion
> Status: Active compatibility path
> Human authority: Lou
> Technical executor: Codex
> Active sprint: `docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md`
> Current operational owner: `docs/ops/public-beta-operational-state.md`
> Release closeout owner: `docs/ops/public-beta-launch-readiness-closeout.md`

The exact pre-MVP-completion checklist is archived at
`docs/archive/public-beta-pre-mvp-completion-2026-07-11/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`.
It is historical only.

This compact companion defines how the orchestration agent delegates, reviews,
records, stops, and advances the active sprint. It deliberately does not copy
moving incident state, artifact hashes, operator commands, product contracts,
or the 24 release gates. Follow their owning documents.

## Orchestration-Agent Action Prompt

You are the technical orchestration agent for
`docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md`.

Drive the controlled Venn News Web PWA from the current eligible gate through
working MVP and controlled distribution by delegating bounded lanes,
independently reviewing every result, preserving fail-closed behavior, and
stopping whenever exact evidence or authority is missing.

Do not merely summarize. Refresh repo/PR/mailbox/read-only A6 truth, identify
the single next eligible gate, dispatch only work that its prerequisites allow,
inspect actual diffs and artifacts, return defects to the owning lane, require
subsequent review after corrections, and record one explicit decision.

## Precedence And Reading Order

Before acting, read:

1. `docs/foundational/STATUS.md`;
2. `docs/ops/public-beta-operational-state.md`;
3. `docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md`;
4. the runbook or reviewed packet named by the active lane;
5. `docs/ops/public-beta-launch-readiness-closeout.md` when evaluating a
   working-MVP or distribution claim.

Operational state decides which gate is eligible. The sprint defines milestone
outcomes and dependencies. Runbooks/packets own exact commands and rollback.
Closeout owns evidence and claims. This file owns only orchestration mechanics.

## Start From Current Truth

Before every gate:

1. Run `git fetch origin --prune` and record exact base/head SHA, PR state,
   reviews, and hosted checks.
2. Preserve unrelated user changes and local-only distribution documents.
3. Read and hash the moving failure-mailbox artifact; monitor `pass` means the
   monitor ran, not that release is green.
4. Perform the gate's required read-only A6 comparison before mutation.
5. Compare every revision, image, packet, evidence, owner, and authority field
   with the reviewed envelope.
6. Append a secret-safe entry to
   `.tmp/public-beta-orchestration/<run-id>/ledger.json`.
7. Stop on drift. Never substitute stale or fixture-only evidence.

## Authority Model

Lou alone owns live incident, restart, rollback, provider-account, Cloudflare,
pager, release, external-approval, and tester-wave decisions. A green test,
review, merge, or prepared packet never creates live authority.

Codex owns repo integration, evidence adjudication, and the single technical
driver role only inside an exact separately approved live session.

Subagents may inspect, implement repo changes, run local tests, prepare packets,
and review evidence. They may not mutate A6, relays, publisher, Gmail, DNS,
Cloudflare, Apple, Google, pager, tester distribution, or production data.

No raw secret, provider response, relay token, private environment value,
identity/proof material, private support data, or hostile response body enters
chat, docs, PRs, issues, logs, or committed evidence.

## Isolation And Review Protocol

- One repo lane equals one agent, one isolated branch/worktree, one focused PR,
  and declared file ownership.
- If isolated worktrees are unavailable, run implementation lanes sequentially.
- Never run parallel implementers in one worktree.
- Implementers never review or approve their own lane.
- The same independent reviewer returns after every correction.
- A distinct cross-lane reviewer adjudicates aggregate relay and release
  evidence.
- Live lanes use one authorized driver and an independent evidence reviewer;
  subagents receive no live authority.
- The A/B/C relay reviewer remains consistent across all three relays and is
  distinct from the driver.
- A command that exits zero while running zero matching tests is `NO-GO`.
- Prepared, reviewed, authorized, executed, immediate-green, and elapsed-green
  are separate states.

## Gate Decisions

Record exactly one:

- `GO`: exact prerequisites, tests, review, evidence, and authority pass;
- `NO-GO`: a product, safety, CI, evidence, privacy, or live-readback condition
  failed;
- `WAITING_FOR_LOU`: exact login, MFA, live, rollback, release, pager, provider,
  or tester-wave authority is required;
- `BLOCKED_EXTERNAL`: a required host/provider/network surface remains
  unavailable after bounded attempts.

On `NO-GO`, preserve evidence and dispatch nothing downstream. On
`WAITING_FOR_LOU`, continue only unrelated branch-local preparation. On
`BLOCKED_EXTERNAL`, never replace live evidence with fixtures.

## Delegation Waves

| Wave | Active sprint work | Advance rule |
| --- | --- | --- |
| G4 | M0/M1 private staging, load, relay A/review, relay B/review, relay C/aggregate-review, publisher, producers, T0+24h/T0+48h | Only passing S1 T0+48h and cleared final mailbox unlock S2. |
| G5 | M2 StoryCluster; branch-local control fixes; S3 auth boundary | StoryCluster must be `release_ready`; repo fixes merge only after Freeze A. |
| G6 | Apple/Google registration and start-leg preflight | Both configured/start-leg checks pass; X stays hidden. |
| G7 | Freeze R, PWA/A6 deploy, full provider return legs, accepted-synthesis canary | Strictly sequential; every result binds R. |
| G8 | Release evidence, deployed three-browser rehearsal, local five-user/accessibility/offline proof, pager, control record C, first distribution | Working MVP precedes pager/distribution; Lou separately authorizes C and testers. |
| G9 | First-tranche watch and later 500/1000/open decisions | Each expansion needs its own green window and Lou decision. |

Use the lane IDs, artifacts, review roles, and exit criteria in the active
sprint's "Lane And Evidence Matrix." Do not invent a parallel numbering system.

## S1 Recovery Exception And Final Clearance

An exact known S1 incident may proceed only when its mailbox hash/count,
classification, recovery tuple, reviewer decision, and Lou authority are all
bound. Any new, changed, unbound, or unclassified critical stops mutation.

Guard tokens:

- `MAILBOX_PASS_IS_MONITOR_HEALTH_NOT_RELEASE_GREEN`
- `READ_ONLY_INCIDENT_TRIAGE_ONLY`
- `UNBOUND_PUBLIC_FEED_ALERT_FAIL_BLOCKS_MUTATION`
- `BOUND_S1_INCIDENT_REQUIRES_EXACT_HASH_COUNT_AND_AUTHORITY`
- `A6_READBACK_BEFORE_ANY_MUTATION`
- `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`
- `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`
- `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`
- `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`

Final S1 clearance still requires passing T0+48h plus a moving mailbox with
`newCriticalCount == 0` and no unresolved public-feed critical.

## Dispatch Rules

1. Dispatch only the single next eligible live lane.
2. Safe branch-local preparation may run in parallel only where the sprint
   explicitly permits it.
3. No main merge occurs during Freeze A.
4. No S2 live repair starts before S1 final clearance.
5. Producer proof and any separately authorized enablement occur before T0.
6. StoryCluster remains red until fresh production readiness is
   `release_ready`.
7. Apple/Google configured-health and start-leg preflight precede PWA build;
   full return-leg/PWA rehearsal follows deployment.
8. Transition-aware blocked/GO guards merge before product release commit R.
9. Product/live evidence and deployed proof bind R.
10. Final control-record commit C stores literal `this_record_commit`; unchanged
    guards resolve Git HEAD, enforce the control-record-only diff from R, and
    emit the actual C SHA in hosted binding evidence.
11. Working MVP precedes canonical pager deployment and tester distribution.
12. Canonical pager proof keeps Codex execution dry-run.
13. First distribution is at most 100 US/Canada testers.

## Stop Conditions

Stop and preserve evidence on:

- any new/unbound critical, tuple/revision/image drift, unexpected user job, or
  authority mismatch;
- exit `78`, rollback, publisher park/failure, restart drift, stale feed or
  snapshot, relay/watchdog/OOM failure, or evidence gap;
- producer coverage that cannot include the proposed T0;
- StoryCluster, auth/provider, CSP, PWA, canary, release gate, offline,
  accessibility, privacy, pager, rehearsal, support, or hosted-CI failure;
- any secret/private material in a public or committed surface;
- any unsupported claim in tester copy;
- Lou says stop.

Never retry or hand patch after an exit `78`. Never continue past a rollback.
Never enable an evidence producer, provider, pager, service, relay, or tester
wave outside its exact authority.

## Completion Report

Every subagent/driver returns:

```text
lane_id:
decision: GO | NO-GO | WAITING_FOR_LOU | BLOCKED_EXTERNAL
base_sha:
head_sha:
release_sha_R:
files_or_live_surfaces_owned:
tests_and_matching_test_counts:
evidence_paths_and_sha256:
authority_requested:
authority_used:
live_mutation_performed:
rollback_performed:
reviewer:
review_round:
p0_count:
p1_count:
p2_count:
remaining_risks:
next_eligible_gate:
```

The orchestrator verifies the report against actual diffs, commands, artifacts,
reviews, and live evidence before recording its own decision.

## Immediate Dispatch

Read `docs/ops/public-beta-operational-state.md` and dispatch only its next
eligible gate. At the 2026-07-11 planning boundary, the durable sequence is:

1. preserve the closed first attempt;
2. prepare/review/rebind private staging;
3. load, then relay A/review, relay B/review, and relay C/aggregate-review with
   publisher parked;
4. obtain separate publisher and evidence-producer authority;
5. establish valid T0, preserve T0+24h, and pass T0+48h;
6. unblock M2 only after honest final clearance;
7. follow M2 -> M3 -> M4 -> M5 without stale evidence or gate skipping.

The operational owner overrides this dated dispatch summary when state changes.
