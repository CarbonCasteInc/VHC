# Public Beta Documentation Alignment Audit - 2026-07-11

> Status: Completed repository documentation audit
> Owner: VHC Core Engineering + VHC Launch Ops
> Last Reviewed: 2026-07-11
> Depends On: `docs/foundational/trinity_project_brief.md`, `docs/foundational/TRINITY_Season0_SoT.md`, `docs/foundational/System_Architecture.md`, `docs/foundational/STATUS.md`, `docs/ops/public-beta-operational-state.md`

## Verdict

The active documentation now reflects the latest preserved operational
evidence without changing the foundational product vision.

One compact owner records changing public-beta truth:
`docs/ops/public-beta-operational-state.md`. Status, runbooks, launch control,
closeout, onboarding, and orchestration route through it instead of each
maintaining a competing incident diary.

Current decision: `NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE`.

No A6, relay, publisher, service, Gmail, provider, pager, DNS, Cloudflare,
tester, or production-data mutation was performed by this audit.

## Evidence Basis

The audit binds the following preserved facts:

| Field | Evidence-backed value |
| --- | --- |
| S1 recovery revision | `3c8907f056ee5e482ddd5cec55ea2b32d6d04c5e` |
| Immutable relay image | `sha256:cb44eb9e94c1716311efc0d80c672d2b031018e6fc94bfcb7b23d96d20cee763` |
| Single-session capture SHA-256 | `8250dde3d1d1c34bd638f669355d4237fda085568da78df60a6bff69e2aa97d0` |
| Reviewed file-index SHA-256 | `fff0e17ee8fb31d9032d9ef9afd91eed53037dc36de774c22e20130a1cb26c6c` |
| Executable supplement SHA-256 | `b69e298ceec1d6074cf18ba3c81775f64a5e77a7776dd7a946e1a7fc78e1513d` |
| Executable packet SHA-256 | `f4c83bb7853716da5b90a9424645168ab26e46b358f151d9eac56f2dcc407101` |
| Static validation SHA-256 | `ae41483fa0f974951bc6f010bc86a84eb25da7aa0448940806ce08dc0247a697` |
| Execution binding SHA-256 | `2185ca8aafc67c6752b869c66e945b7e39971e09f259b2df152c13c23097cf4f` |
| Original authorization SHA-256 | `c3962a489afbf33e004a289e81d008bf570271b796f2432fef2f867e4ac9d020` |
| Attempt 001 result | exit `78` at `read_only_remote_prestate` |
| Attempt 001 reason | `remote_staging_unexpected_content` |
| Attempt record SHA-256 | `018def645678cbbeefff20f3da97038c6c4709435e7583d9a7241f691ec3e2f7` |
| Attempt evidence-index SHA-256 | `758f6a97a85708e5ec1f06d7675736a8f8f7b40ac2d3e6352a6a8a49fd6bf5ec` |
| Live mutation in attempt 001 | none |
| Latest mailbox snapshot observed | `2026-07-11T05:02:14.679Z`; SHA-256 `ddaea453e14a6b13329971a946facf020d522c64772fe5a35864f70be71990ad` |
| Mailbox result at that instant | monitor `pass`; 1 critical, `public_feed_alert_fail` |

The latest mailbox and A6 observations remain moving evidence. Their dated
values are recorded as history, never as permission or proof of unchanged live
state.

## Findings And Corrections

| Finding | Risk | Correction |
| --- | --- | --- |
| Several active documents stopped at the pre-tuple or pre-attempt state. | A new operator could incorrectly start relay A or treat S1B as ready. | Current status, launch control, recovery packet, handoff, and checklist now bind attempt 001 and the new private-staging gate. |
| Runbooks mixed healthy configuration, historical recovery, and current state. | Historical green evidence could be mistaken for live health. | Healthy contracts remain in runbooks; moving truth routes to the operational-state owner. |
| Status and closeout had grown into long incident histories. | Onboarding required reconstructing chronology before finding the active gate. | Replaced them with lean implementation and release-claim ledgers; archived the full pre-attempt snapshots. |
| Dated reports used “current” in their titles or prose. | Search results could outrank current control documents. | Added `docs/reports/README.md`, archived the superseded 2026-07-08 audit, and made the docs index explicit about evidence windows. |
| Guard tests pinned superseded prose and revision `297d1bb4`. | Documentation could not be simplified without preserving stale claims. | Guards now require the operational-state owner link and durable safety boundaries without copying moving revision, hash, mailbox, decision, or next-gate values into planning documents. |
| The archive had no automated historical marker rule. | Archived text could silently regain operational authority. | Docs governance now requires `Document Role: Historical`, `Archived:`, and `Superseded By:` markers. |

## Current Reading Path

New agents and developers should read, in order:

1. `docs/foundational/trinity_project_brief.md` - product purpose;
2. `docs/foundational/TRINITY_Season0_SoT.md` - Season 0 scope;
3. `docs/foundational/System_Architecture.md` - target contracts;
4. `docs/foundational/STATUS.md` - implementation and drift;
5. `docs/ops/public-beta-operational-state.md` - current decision and next gate;
6. `docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md` - active
   working-MVP outcome and dependency map;
7. `docs/ops/news-aggregator-production-service.md` - exact publisher procedure;
8. `docs/ops/public-beta-launch-readiness-closeout.md` - release evidence and claim boundary;
9. `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md` - executable
   non-authoritative delegation and operator-gate companion.

Use `docs/CANON_MAP.md` for domain ownership. Use `docs/archive/` only to
reconstruct prior decisions.

## Archived Material

`docs/archive/public-beta-pre-recovery-2026-07-10/` preserves the full
pre-attempt versions of:

- implementation status;
- public-beta launch closeout;
- state-of-play handoff;
- next-phase orchestration checklist; and
- the superseded 2026-07-08 documentation audit.

Its `reports/` subdirectory also preserves the superseded May public-beta
release packet bundle and the June/July Phase 5 launch, stability, watch,
recovery, driver, and readiness reports. Their original GO/live/current wording
is intentionally retained behind explicit historical banners.

Compatibility paths for status, closeout, handoff, and checklist now contain
lean current versions, so existing tools and links do not become ambiguous.

## Foundational Vision Check

The audit did not alter the project brief, architecture contracts, or the
Season 0 product thesis. The target remains a unified civic product combining:

- a usable news/topic feed;
- evidence-backed synthesis and frame/reframe analysis;
- stance on specific frame/reframe points;
- persistent discussion and aggregate civic metadata;
- local-first identity/privacy boundaries; and
- guarded links to civic action and economic rails.

The controlled Venn News Web PWA beta remains a narrow proving surface for that
larger vision. Beta-local LUMA semantics must not be advertised as LUMA Silver,
verified-human identity, one-human-one-vote, Sybil resistance, or production
mesh readiness.

The only Season 0 edit replaces a stale live-incident paragraph with a timeless
capability statement and current-doc pointer. Product scope and defaults are
unchanged.

## Remaining Operational Work

Documentation alignment does not make S1 green. The immediate sequence remains:

1. select a private current-user-owned, non-symlink, mode-`0700` staging root;
2. regenerate affected load/supervision artifacts and hashes;
3. obtain independent subsequent review and a new exact Lou binding;
4. refresh moving mailbox and read-only A6 prestate;
5. load and immutably verify the image;
6. execute relay A/review, relay B/review, and relay C/aggregate-review with the
   publisher parked;
7. obtain separate publisher authority and run the controller sequence;
8. preserve immediate, T0+24h, and passing T0+48h evidence;
9. unblock S2 only after the final S1 gate passes.

This documentation-alignment merge advances `main`. Because the existing executable recovery
tuple is revision-bound, do not merge this documentation change before recovery
unless Lou explicitly accepts rebuilding/reviewing the affected tuple.

## Validation Record

The current combined alignment and MVP-sprint package passed these commands in
the isolated worktree:

| Command | Result |
| --- | --- |
| `corepack pnpm@9.7.1 install --frozen-lockfile` | lockfile-exact install passed |
| `corepack pnpm@9.7.1 docs:check` | 175 Markdown files passed governance/link/authority/archive checks |
| `corepack pnpm@9.7.1 check:public-beta-next-phase-sprint` | 12/12 outcome, sequencing, ownership, routing, and archive guards passed |
| `corepack pnpm@9.7.1 check:public-beta-launch-control` | blocked-packet validation plus 16/16 transition and adverse-state tests passed |
| `corepack pnpm@9.7.1 check:public-beta-launch-closeout` | 24 MVP gates, 11 launch-content items, and 13 command surfaces passed |
| `corepack pnpm@9.7.1 check:beta-session-runsheet` | 6/6 tests passed |
| `corepack pnpm@9.7.1 check:public-beta-compliance` | policy/support/private-escalation checks passed |
| `corepack pnpm@9.7.1 check:luma-identity-lifecycle` | passed |
| `corepack pnpm@9.7.1 check:luma-multidevice-stubs` | fail-closed stubs passed |
| `corepack pnpm@9.7.1 check:luma-wallet-binding` | passed |
| release-claim-boundary validation from `check:luma:mvp-production-readiness` | passed; the full harness remains live-evidence/clean-worktree gated |
| `corepack pnpm@9.7.1 check:public-beta-distribution-packet` | blocked-packet validation plus 15/15 transition, exact-envelope, and immutable-evidence tests passed |
| `corepack pnpm@9.7.1 check:release-readiness-operator-packets` | 4/4 tests passed |
| `corepack pnpm@9.7.1 check:vhc-incident-response` | 61/61 tests plus the 28-file contract checker passed |
| focused feed accessibility Vitest run | 82/82 tests passed |
| `corepack pnpm@9.7.1 check:public-beta-s1-recovery-control-plane` with compact test reporter | dependency build plus the full control-plane suite passed |
| `git diff --check` | passed |

The host used Node `v23.10.0`; the repository declares `>=20 <23`, so pnpm
emitted an engine warning. No test failed or skipped because of that warning.

## Post-Audit Hosted Validation Note

Draft PR #770 later passed hosted Quality Guard but failed Test & Build at
224/225 S1 recovery-control tests. The failing race test uses a one-second
finalization wait; the controller starts that deadline before private staging
preparation, so an unlucky second boundary can leave zero commit attempts and
no raced final artifact. Repeated local execution reproduced the timing
failure. The production default is longer, but the deadline semantic and test
must be permanently corrected before the eventual product release commit.

This hosted result does not change the audit's documentation findings or the
zero-live-mutation record. It does mean PR #770 is not merge-ready, independently
of the revision-bound rule that already keeps it draft until S1 closure.

The later MVP completion sprint moved the full 2026-07-08 outline,
post-attempt-001 checklist, and detailed handoff into
`docs/archive/public-beta-pre-mvp-completion-2026-07-11/`; their original paths
are now compact routers. Current onboarding therefore has one operational owner,
one active outcome sprint, and one compact orchestration companion.
