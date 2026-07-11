# Public Beta Current-State Handoff

> Status: Active onboarding router
> Compatibility Path: retained from 2026-07-10; operationally refreshed 2026-07-11
> Owner: VHC Launch Ops + VHC Core Engineering
> Human authority: Lou
> Technical executor: Codex
> Current S1 revision: `3c8907f056ee5e482ddd5cec55ea2b32d6d04c5e`

This is a non-authoritative onboarding aid. Do not maintain a second incident
diary here. Current evidence, exact hashes, and the next eligible gate live in
`docs/ops/public-beta-operational-state.md`.

The full pre-attempt handoff is archived at
`docs/archive/public-beta-pre-recovery-2026-07-10/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md`.

## Read In This Order

1. `docs/foundational/STATUS.md` - implementation and drift;
2. `docs/ops/public-beta-operational-state.md` - current decision and hashes;
3. `docs/ops/news-aggregator-production-service.md` - publisher procedure;
4. `docs/ops/public-beta-launch-readiness-closeout.md` - release claim boundary;
5. `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md` - active
   delegated sequence.

## One-Screen Verdict

The repository-side S1 recovery is built, merged, reviewed, and bound to the
original exact tuple. The live recovery is not complete.

Current decision: `NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE`.

Attempt 001 closed with exit `78` at read-only remote prestate because of
`remote_staging_unexpected_content`. The shared mode-`0775` staging base had
unrelated entries. No transfer or `docker load`, relay A/B/C, publisher,
service, checkout, provider, pager, Gmail, monitor, or production-data mutation
occurred.

The Original Lou binding applied only to the stopped exact attempt. Do not
retry, chmod, clean, reuse, redirect, or hand patch its staging tree.

## What Is And Is Not Complete

| Gate | State |
| --- | --- |
| PRs #759-#769 and S1 repo remediation | complete |
| Exact image/packet/binding review | complete for the original tuple |
| Attempt 001 | closed safely before mutation |
| New private-staging envelope | missing |
| Independent subsequent review | missing |
| New exact Lou binding | missing |
| Image transfer/load/immutable verification | not started |
| Relay A/review, B/review, C/review | not started |
| Separate publisher recovery | not authorized or started |
| Immediate, T0+24h, T0+48h evidence | missing; T0 does not exist |
| S1A/S1B | red |
| S2-S12 | blocked; T0+48h and mailbox clearance are mandatory first |

## Exact Next Gate

1. Preserve attempt 001 unchanged.
2. Select a private current-user-owned, non-symlink, mode-`0700`, non-shared
   staging root.
3. Regenerate every affected load/supervision artifact and hash.
4. Require independent subsequent review of that exact envelope.
5. Obtain a new exact Lou binding.
6. Re-read the moving mailbox and read-only A6 prestate before every gate.
7. Stop on any unbound drift or secret-bearing output.

The mailbox snapshot recorded in a dated doc is incident history once a newer
artifact exists. Monitor `status: pass` means the monitor ran; it is not release
clearance.

## Remaining S1 Sequence

After the new load gate passes:

1. stage, transfer, checksum, load, and immutably verify the relay image;
2. execute A, independently accept A, then B/review, then C/review;
3. keep the publisher parked throughout A/B/C;
4. stop for separate attended publisher authority;
5. use the exact controller sequence in
   `docs/ops/news-aggregator-production-service.md`;
6. preserve immediate recovery evidence, T0+24h, and passing T0+48h closure;
7. mark S1A/S1B green and unblock S2 only after the final gate passes.

Any exit `78` stops without retry or hand patch. Any rollback restores only the
current relay, stops the sequence, leaves S1 red, and requires a fresh tuple.

Durable boundaries:

- `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`
- `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`
- `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`
- `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`

## Product And Authority Boundary

The target remains a controlled Venn News Web PWA public beta for US/Canada,
with Apple and Google first, X hidden, and an initial tranche of at most 100
testers. S1 completion makes S2 eligible; it does not make the beta ready.

Lou owns incident, rollback, release, provider-account, external-approval, and
tester-wave decisions. Codex may perform repo/evidence work and only a separately
authorized exact live action. Subagents may prepare, inspect, test, and review;
they do not mutate A6, services, relays, Gmail, DNS, providers, pager,
distribution, or production data.

No raw secret, private provider response, relay token, host-private environment,
story body, identity proof, or private support detail belongs in chat, docs,
commits, PRs, issues, or release artifacts.
