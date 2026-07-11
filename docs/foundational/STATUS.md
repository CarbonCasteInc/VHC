# TRINITY Implementation Status

> Status: Implementation Truth Ledger
> Owner: VHC Core Engineering
> Last Reviewed: 2026-07-11
> Depends On: docs/foundational/trinity_project_brief.md, docs/foundational/TRINITY_Season0_SoT.md, docs/foundational/System_Architecture.md, docs/CANON_MAP.md, docs/ops/public-beta-operational-state.md

**Version:** 0.9.17

## How To Read This File

This file records current implementation and drift. It does not redefine product
intent, behavior specs, architecture, or live operator evidence.

Use the documentation precedence in `docs/README.md`:

1. product intent and season scope;
2. normative specs;
3. architecture;
4. this implementation ledger;
5. operational runbooks;
6. non-authoritative plans and historical execution records.

Current public-beta operational truth lives in
`docs/ops/public-beta-operational-state.md`. Historical status detail through the
first supervised recovery attempt is preserved under
`docs/archive/public-beta-pre-recovery-2026-07-10/`.

## Executive Status

TRINITY's repository-side Functioning MVP is materially implemented, but the
Venn News public beta is not launch-ready.

The unclosed public-feed incident is classified as
`relay_rest_story_timeout_total_0_of_3_exit_78`. Repository remediation is
merged through `main@3c8907f056ee5e482ddd5cec55ea2b32d6d04c5e`, including
concurrent bounded relay fanout, exact signed readback for all four critical
publication routes, preserved `2/3` quorum, bounded exit-69 availability-total
handling, secret-safe alert dedupe, and reviewed recovery control.

The exact relay image and executable tuple received independent review and the
original scoped Lou binding. Supervised load attempt 001 then correctly stopped
at read-only prestate because the reviewed remote staging base was shared mode
`0775` with unrelated entries. No image transfer/load, relay, publisher, service,
provider, pager, monitor, Gmail, or other live mutation occurred.

Current decision: `NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE`.

A fresh private-staging load/supervision envelope, independent review, and new
exact binding are required before another attempt. A/B/C, separate publisher
recovery, immediate evidence, T0+24h, and T0+48h remain incomplete. S1A/S1B are
red, S2 is blocked, and all later launch-enablement work is ineligible.

## Product Scope Remains Unchanged

The foundational vision remains the local-first TRINITY civic operating system:
LUMA identity/trust, VENN/HERMES information/discourse/docs/action, and GWC
economic/governance rails.

The current launch envelope is intentionally narrower: a Venn News Web PWA that
supports a usable feed, clustered story identity, accepted-current synthesis,
frame/reframe point stance, deterministic story discussion, persistent personal
state, and aggregate-only public signal.

The public beta does not claim production-attestation/Silver, verified-human
identity, one-human-one-vote, Sybil resistance, cryptographic residency, public
WSS mesh `release_ready`, full production-app readiness, native App Store
readiness, a private support SLA, or pager-backed 24/7 operations.

## Current Layer Summary

| Layer | Repository capability | Live/release posture |
| --- | --- | --- |
| LUMA | Public-beta beta-local identity, AssuranceEnvelope, stable device/session compartments, signed-write policy, namespace guards, and forbidden-claim gates are implemented. | Public-beta only; production attestation/Silver remains deferred. |
| GWC | Core contracts and Sepolia deployment exist. | Partial; XP-first product posture remains current. |
| VENN analysis | End-to-end analysis and accepted `TopicSynthesisV2` contracts exist. | Live accepted-synthesis evidence remains blocked behind S1/S2 and the later canary. |
| HERMES messaging | E2EE messaging is implemented. | Partial production hardening remains. |
| HERMES forum | Threads, votes, deterministic news-story threads, moderation/report paths, and 240-character reply cap are implemented. | Manual release rehearsal remains. |
| HERMES docs | Collaborative editor foundation is wired and flag-gated. | Not a public-beta launch claim. |
| Civic Action Kit | UI, trust/XP/budget gates, local receipts, and feed-card support exist. | Outside the Venn News MVP launch path. |
| News Aggregator | Repo remediation and exact recovery controls are merged. | Live red: attempt 001 stopped before load; publisher recovery and 48-hour proof have not started. |
| Discovery feed | Compact unified feed, preference/ranking behavior, storylines, deep links, fixture gates, and browser coverage exist. | Current public semantic/live gates remain blocked. |
| Delegation runtime | Store, hooks, scoped grants, controls, and budget keys exist. | High-impact actions remain human-approved. |
| Linked social | Substrate, notification ingestion, and feed cards exist. | Broader OAuth/social ingestion is deferred. |
| Public beta compliance | Policy routes, public support intake, minimum private escalation protocol, and trusted beta operator guards exist. | This is not legal approval or live release clearance. |

## Active Public-Beta Program

### S0-S1 Repository Work

The S1 recovery implementation chain is merged through PRs #759-#769. The
reviewed final S1 recovery revision is `3c8907f0`.

Implemented invariants include:

- raw story, latest-index, hot-index, and synthesis-lifecycle writes retain
  `2/3` relay quorum;
- timeout means unacknowledged, not provably unpublished;
- readback verifies the exact signed record before retry;
- only fully unacknowledged availability-total exhaustion reaches restartable
  exit `69`;
- HTTP errors, backpressure, conflicts, validation failures, partial quorum,
  tampering, and unknown states remain fail-closed at exit `78`;
- alert fingerprints use semantic state rather than volatile age/window values;
- email and evidence remain readable and secret-safe;
- relay replacement is serial A then B then C, with current-relay-only rollback;
- publisher recovery is a separate attended authority gate.

Repo completion is not deployment or recovery proof.

### Current Live Gate

`docs/ops/public-beta-operational-state.md` is the current owner for live state.
At this review:

- `FINAL_REV` and the original exact tuple are reviewed;
- load supervision attempt 001 exited `78` before mutation;
- the original fixed staging base is not eligible for retry;
- a new private staging envelope and new exact binding are required;
- relay A has not started;
- publisher T0 does not exist;
- the dated mailbox snapshot observed during this audit contained a public-feed
  critical and must be refreshed before every gate.

Durable gate rules:

- `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`
- `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`
- `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`
- `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`

### S2-S12

After S1 closes honestly:

1. S2 repairs StoryCluster headline-soak credential/endpoint evidence.
2. S3 deploys the auth boundary and durable nonce store.
3. S4/S5 register and rehearse Apple and Google; X stays hidden.
4. S6/S7 deploy and read back the PWA origin and eventual release commit.
5. S8 proves accepted synthesis through a live canary.
6. S9 regenerates release evidence on the intended release commit.
7. S10 completes three-browser persistence, convergence, and privacy rehearsal.
8. S11 records Lou's distribution decision for the first tranche of at most 100
   testers.
9. S12 monitors each tranche before any expansion.

The executable release sequence is guarded by
`docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md` and
`pnpm check:public-beta-next-phase-sprint`.

## Release Evidence State

Existing evidence packets predate the current S1 revision and must not be reused
as release proof. A future release claim requires fresh evidence on the intended
release commit, including:

- source health and StoryCluster correctness;
- public feed analysis/frame reliability;
- mixed composition and lifecycle accountability across configured peers;
- fresh RSS-to-product propagation;
- pagination/refresh and point-stance convergence;
- LUMA public-beta readiness;
- bounded Mesh/app claims;
- launch control, distribution, operator packets, compliance, docs, and the
  beta-session runsheet.

Current command surfaces include:

- `pnpm check:public-beta-s1-recovery-control-plane`
- `pnpm check:public-beta-launch-control`
- `pnpm check:public-beta-distribution-packet`
- `pnpm check:public-beta-launch-closeout`
- `pnpm check:public-beta-next-phase-sprint`
- `pnpm check:beta-session-runsheet`
- `pnpm check:mvp-release-gates`
- `pnpm check:mvp-closeout`
- `pnpm check:public-beta-compliance`
- `pnpm docs:check`

The public-beta launch closeout is
`docs/ops/public-beta-launch-readiness-closeout.md`.

## Guarded Identity And Privacy Invariants

These concise rows are intentionally retained because release and LUMA guards
consume them:

| Surface | Current invariant |
| --- | --- |
| Identity lifecycle | `signOut()` preserves device-bound compartments; `resetIdentity()` rotates them. `revokeSession()` is a deprecated compatibility shim. |
| Multi-device identity linking | Deferred and disabled; app stubs fail closed; no fake linked-device state is written. |
| Wallet binding lifecycle | Sign-out preserves the non-custodial wallet binding; reset clears it; no private key or signer is persisted. |
| Public mesh secrecy | OAuth tokens, private keys, raw identity/proof/contact data, and local vote intent are forbidden from public namespaces and committed evidence. |
| Support | Public issues remain public-safe stubs; sensitive details use the minimum private escalation protocol outside the public issue. |
| Human authority | Lou owns release, incident, rollback, provider-account, and tester-wave decisions; technical execution never broadens that authority. |

## Active Risks And Drift

| Risk | Current handling |
| --- | --- |
| Stale or contradictory docs | Current state has one stable owner; prior status/checklist/handoff/closeout snapshots are archived. |
| Shared A6 staging base | Hard stop; replace with a reviewed private per-run root, never chmod/reuse/clean the shared tree. |
| Publisher remains parked | No inference from relay readiness; complete separate controller recovery and elapsed evidence. |
| StoryCluster credential/endpoint | S2 remains blocked until S1 T0+48h closure. |
| Single-host relay topology | `2/3` protects logical write integrity, not A6 host-failure tolerance. Do not claim independent failure domains. |
| Relay memory driver | Historical verdict remains off-graph-likely; no retention/compaction/eviction action is authorized without new evidence. |
| Release packet drift | Regenerate on the eventual release commit; fixture-only and stale artifacts never substitute for live proof. |

## Immediate Next Work

1. Preserve attempt 001 unchanged.
2. Generate and review a private-staging load/supervision envelope.
3. Obtain a new exact binding.
4. Resume at image load, not relay A.
5. Complete A/review/B/review/C/review.
6. Obtain separate publisher authority and run controller recovery.
7. Preserve immediate, T0+24h, and passing T0+48h evidence.
8. Mark S1A/S1B green and unblock S2 only after the final gate passes.

Do not merge a later commit into the tuple-sensitive recovery line unless the
team explicitly accepts rebuilding and re-reviewing the revision-bound tuple.

## References

- `docs/foundational/trinity_project_brief.md`
- `docs/foundational/TRINITY_Season0_SoT.md`
- `docs/foundational/System_Architecture.md`
- `docs/specs/spec-news-aggregator-v0.md`
- `docs/ops/public-beta-operational-state.md`
- `docs/ops/news-aggregator-production-service.md`
- `docs/ops/public-beta-launch-readiness-closeout.md`
- `docs/ops/public-beta-launch-control-2026-07-09.md`
- `docs/ops/public-beta-distribution-packet-2026-07-09.md`
- `docs/ops/BETA_SESSION_RUNSHEET.md`
