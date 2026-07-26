# Public Beta Operational State

> Status: Current Operational Truth
> Owner: VHC Launch Ops + VHC Core Engineering
> Last Reviewed: 2026-07-25
> Depends On: docs/foundational/STATUS.md, docs/plans/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md, docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md, docs/ops/public-beta-launch-readiness-closeout.md

## Current Verdict

`NO_GO_BLOCKED_EXTERNAL_LOST_CUSTODY`

Recovery disposition:
`RESTORE_EXACT_OR_AUTHORIZE_FRESH_SUCCESSOR`

The governed public-beta recovery is stopped at G0. Required active-authority
artifacts that were bound to exact absolute paths under `/private/tmp` are no
longer present. The durable archive and its manifests remain useful
disaster-recovery evidence, but their own custody contract says they are not
active authority. They must not be copied back, promoted, or used to
reconstruct missing history without a new owner decision and independent
custody/tuple review.

This is a custody failure, not a failed product vision and not evidence that
the incident recovered. It does not make any historical GO, NO_GO, refusal, or
receipt invalid. It prevents the exact governed chain from advancing.

## State Separation

| Surface | Current state | What may be claimed |
| --- | --- | --- |
| Repository safety baseline | `main@db8cf5b853f79863e3ba8a94bec000137bd0c075` after #772, #773, and #771 | The three bounded repository safety corrections are merged and hosted-green. |
| Governed recovery authority | `BLOCKED_EXTERNAL` at G0 | No Gate P protocol continuation, Gate R C003 implementation, protected install, or live recovery is authorized. |
| Durable disaster evidence | Present in a git-ignored local evidence store; non-authoritative | Evidence may be preserved and reviewed. It may not silently replace the missing originals. |
| Live A6 state | No July 25 live readback was authorized or performed by this correction sequence | The July 10 readback is historical context, not confirmed-current live truth. |
| S1A / S1B | `NO_GO` | Neither incident lane is green. Immediate recovery, 24-hour evidence, and 48-hour evidence remain unproven. |
| S2 and launch work | `BLOCKED` | No credential repair, provider work, deployment, canary, rehearsal, distribution, or tester wave may start. |

The documentation-only successor based on the safety baseline does not itself
change any row in this table.

## What Has Been Completed

- PR #763 and PR #769 remain immutable repository/recovery history.
- The volatile July 16/17 evidence set was copied to a durable git-ignored
  location and its core archive/manifest hashes were verified before the
  original active paths disappeared.
- Three consecutive G0 revalidations recorded `BLOCKED_EXTERNAL`; they found the
  same required originals absent and kept restoration, reconstruction, repo
  recovery implementation, protected installation, and live mutation false.
- PR #772 guarantees the publisher recovery controller gets a first
  finalization attempt after private staging while retaining exact-state
  checks and fail-closed parking.
- PR #773 confines the freshness monitor OpenAI secret to the one direct Node
  preflight process; the no-preflight and dependency-build paths receive no
  key.
- PR #771 bounds pager response headers and body under one deadline, caps the
  health body, adds an outer job timeout, and fails closed if GitHub status
  output cannot be published.
- Each safety PR received exact-head independent review and green hosted CI
  before merge. None was deployed or manually dispatched.

These completions improve repository safety. They do not restore custody,
create recovery authority, install C003, recover A6, or satisfy a soak.

## What Remains Outstanding

| Gate | Required outcome | Current state |
| --- | --- | --- |
| G0 | Exact originals restored and stable-loaded, or a newly authorized successor with fresh custody | `BLOCKED_EXTERNAL` |
| Gate P | Protocol-v17 closed through the complete reviewed checker chain | Not started from a valid current authority |
| Gate R | Remaining C003 design and repository implementation independently green | Blocked by Gate P |
| Gate I | Protected runtime installed under a new exact, time-bound owner confirmation and independently read back | Blocked by Gate R |
| Gate L | Fresh live packet, separate owner confirmation, serial relay A/B/C, then publisher recovery | Blocked by Gate I |
| S1A / S1B | Immediate, 24-hour, and 48-hour evidence green | Not proven |
| S2 | Explicitly unblocked only after S1A/S1B green | Blocked |
| Gate M | Public-beta MVP completion and first tester tranche | Blocked by S2 |

## Required Owner Decision

The next valid action is one of these two mutually exclusive custody paths:

1. `RESTORE_EXACT`: an external custodian restores the exact original
   active-authority paths and bytes. A fresh stable-load and independent
   tuple/custody review must prove identity before protocol work resumes.
2. `AUTHORIZE_FRESH_SUCCESSOR`: Lou explicitly authorizes a new successor
   mission with new paths, exact bindings, chronology, role separation,
   all-false initial authority, and independent review. Disaster copies may be
   inputs to that new mission only to the extent the new authority expressly
   permits.

Do not infer either choice from this document, the safety PR merges, passing
tests, the old goal prompt, or the existence of disaster copies.

## Execution Order After Custody Is Valid

The order remains:

1. evidence durability and G0 custody proof;
2. Gate P protocol-v17 closure;
3. Gate R C003 implementation and hostile/E2E review;
4. Gate I protected runtime installation under fresh install-only authority;
5. Gate L fresh live recovery under separate live-only authority;
6. immediate, 24-hour, and 48-hour S1A/S1B evidence;
7. explicit `S2=UNBLOCKED`;
8. Gate M public-beta MVP completion.

No gate may borrow authority from another. Repository merge authority is not
installation authority; installation authority is not live-recovery authority;
live-recovery authority is not launch or tester-distribution authority.

## Prohibited Until The Named Gate

- No silent archive restoration or history reconstruction.
- No workflow dispatch, real-key monitor preflight, protected installation,
  A6 mutation, relay or publisher action, pager deployment/test-fire, provider
  change, origin deployment, tester invitation, or launch claim.
- No weakening of `2/3` quorum, serial A/B/C order, rollback, freshness,
  secret, provenance, review, single-use authority, exclusive-write, or soak
  requirements.
- No claim that an absent artifact exists, a dated readback is current, or a
  green repository test proves live recovery.

## Document Routing

This file owns current public-beta operational decision truth. The July 8 audit,
July 9 checklist/packets, July 10 handoff, and earlier Scope A reports remain
historical evidence and procedural context. Where their current-state prose
conflicts with this file, this file wins. Product intent and normative behavior
still follow the precedence contract in `docs/README.md`.
