# Functioning MVP Lane Repo Closeout - 2026-07-07

> Status: Repo-side lanes A-F complete, follow-up hardening merged; release
>   remains operator-gated on live evidence
> Owner: VHC Core Engineering + VHC Launch Ops
> Current main: `eb53af67dc46764e4d8afe1c5f932c771fe5a4c8`
> Depends On: `docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md`,
>   `docs/ops/public-beta-launch-readiness-closeout.md`,
>   `docs/archive/public-beta-pre-recovery-2026-07-10/reports/phase5-scope-a-post-slice0-current-state-2026-07-06.md`

## Verdict

The repo-side implementation of every product lane in the Functioning MVP lane
slice plan (Lanes A-F) is complete, reviewed, and passing its gates on `main`.
The initial-release loop — read an accepted summary, engage the accepted-current
bias/framing table with persisted stance, register or sign in through the
account shell, bind a beta-local LUMA identity to the account, and participate
in an aggregate district/office sentiment view — is built and test-covered in
the repository.

Release itself stays operator-gated. The remaining work is not product-lane repo
code: it is live evidence regeneration at the release commit, the
operator-owned Scope A canary that turns accepted synthesis on for A6, source
health release-window recovery after pruning/remediating `ap-topnews`, live
provider registration and callback-boundary deployment, and the manual
multi-client rehearsal. Those are enumerated below and must not be shortcut.

## 2026-07-08 State Alignment Addendum

This report was originally written at `main@d5ddd89e`. Since then:

- #737 merged the final MVP vote/identity readiness hardening and produced the
  first `check:luma:mvp-production-readiness` pass in the release evidence
  packet at `1a83434b0d33278369791891ba9212fcc6b859f6`.
- #738 merged deferred hardening across mesh-read authentication, vote queue
  behavior, auth-callback form_post routing, redaction, vault salvage, and
  system-writer signing/validation guardrails.
- #741 closed #740 by extending the default-off
  `VH_GUN_REJECT_UNMARKED_SYSTEM_RECORDS` enforcement branch to every migrated
  system-writer read class.
- #742 closed #739 by preserving newer VaultV2 top-level compartments and
  unknown closed-compartment fields on old-bundle writes, sourced only from the
  authenticated stored vault.
- #745 closed #743 by giving civic representative snapshot writes the same
  non-validating durability readback pattern used by district aggregates while
  keeping consumer reads fail-closed and signature-validating.

No open PRs remain after those merges. The open GitHub issue set is older
backlog only (#178, #277, #279).

The stale blocker statement below is superseded: `repo_dirty` and
`mesh_luma_coverage` were cleared by the #737 evidence refresh. The current
latest evidence packet is still from `1a83434b`, not from current
`main@eb53af67`, and its consolidated release status remains `blocked` because
`source_health`, `public_feed_analysis_frame_reliability`,
`public_feed_composition_freshness`, `public_feed_lifecycle_accountability`,
`public_feed_fresh_propagation`, `public_feed_pagination_refresh`, and
`stance_aggregate_decay_public_mesh` are failing live/operator evidence gates.
The source-health root in the latest packet is `ap-topnews` escalated to
`remove_from_starter_surface` with the configured release window still at
`0/5` ready runs. The public-feed failures are the expected live A6 boundary:
accepted synthesis is repo-capable but not yet operator-enabled/proven on A6.

## Lane Completion

| Lane | Scope | PR | State |
| --- | --- | --- | --- |
| A - Accepted summary/framing table | Slices A1, A2 (A3 operator-owned) | #728 | Merged |
| B - Stance/vote persistence + engagement | Slices B1-B4 | #730 | Merged |
| C - Account and sign-in shell | Slices C0-C3 (phase 1 + phase 2) | #729, #734 | Merged |
| D - LUMA public-beta identity binding | Slices D1-D3 | #727, #735 | Merged |
| E - Constituency and representative mapping | Slices E1-E4 | #732 | Merged |
| Gate reconciliation | discovery + telemetry-redaction fixes | #726, #731, #733 | Merged |

### Lane A - Accepted Summary And Framing Table

- Story detail joins the full accepted-current record set, including the
  epoch-scoped node and the corrections record, before anything is votable.
- A single exported read model expresses all seven states
  (`loading | acceptedCurrentSynthesis | pending | retryable_failure |
  terminal_unavailable | suppressed_by_correction | invalid`); `invalid` is
  observable rather than collapsing into `pending`.
- The live hydration path is held to the same fail-closed system-writer
  validation as pull reads.
- Vote controls render only in accepted-synthesis persisted-point-id mode; no
  legacy text-derived or analysis-fallback path can enable voting.

### Lane B - Stance/Vote Persistence And Aggregate Engagement

- Vote admission issues denial receipts (missing/expired identity, invalid
  proof, non-current synthesis, missing point id, budget/policy, write-queue
  failure) with reason-only telemetry that carries no proof material.
- Durable local intent is part of the admission contract; last-write-wins is
  enforced on enqueue; projection emits terminal telemetry on every outcome
  (no silent success).
- Eye/Lightbulb accounting stays on the active non-neutral stance-count basis
  under the Season 0 cap.

### Lane C - Account And Sign-In Shell

- A dedicated OAuth callback/token-exchange boundary service
  (`services/auth-callback`) performs PKCE-bound, server-side code exchange for
  Apple/Google/X and returns only a non-secret session payload; it deploys
  outside A6.
- The browser flow completes PKCE against that boundary; a sign-in provider
  schema distinct from the linked-social enum and a dedicated identity-vault
  compartment hold session material vault-locally.
- Sign-in binds to a beta-local LUMA identity on the current device; a new
  device gets a fresh principal (never a silent merge); Reset Identity clears
  and re-binds. Provider subjects/labels are never written to public records or
  joined with a LUMA public id.

### Lane D - LUMA Public-Beta Identity Binding

- Provider identity/token material and region codes are banned from public
  namespace records and telemetry, with a co-publication ban against LUMA
  public ids; the runtime topology guard and the static lint agree.
- The account/sign-in surfaces are enrolled in the telemetry-redaction scan.

### Lane E - Constituency And Representative Mapping

- Representative lookup uses the active district hash; the direct trust-score
  gate was migrated off the forbidden comparison path via `scoreFromEnvelope`.
- A district/office aggregate read model publishes aggregate-only records under
  a k-anonymity topology carve-out (`cohortSize >= 100`) whose runtime guard
  matches the lint (deep person-identifier / sensitive-key / provider-key
  rejection); below-threshold cohorts are withheld.

## Repo-Side Gate Status

All of the following pass:

- `docs:check`, `git diff --check`
- `check:luma-forbidden-claims`, `check:luma-telemetry-redaction`
- `check:luma-signed-write-surface`, `check:luma-aggregate-voter-v1`
- `check:luma-topic-synthesis-system-v1`,
  `check:luma-topic-engagement-summary-system-v1`
- `check:luma-civic-reps-system-v1`, `check:district-aggregate-thresholds`
- `check:public-namespace-leaks`, `check:public-beta-compliance`
- `check:public-beta-launch-closeout` (19 MVP gates, 11 launch-content items,
  6 command surfaces)
- `check:luma-provider-surface`, `check:luma-identity-lifecycle`,
  `check:luma-multidevice-stubs`
- `check:vhc-incident-response` (unchanged; the non-waivable PR #722 gate and
  the A6/pager/executor boundaries were not touched by any lane)
- `check:account-identity-controls` (8/8 sign-in e2e, verified on the Lane C
  branch)

At `main@d5ddd89e`, the lane-local gates listed above were green. At
`main@eb53af67`, merge-time CI for #738/#741/#742/#745 was green and the
specialized LUMA/system-writer/vault/civic gates introduced by those PRs passed
on their branches and in merge validation.

The latest local evidence packet records
`check:luma:mvp-production-readiness = pass` at
`1a83434b0d33278369791891ba9212fcc6b859f6`. A release owner must rerun it on
the intended release commit after any further docs/code merges; do not treat
the older packet as current-commit release proof.

## Remaining Operator-Owned Steps (not repo code)

These stay owned by Launch Ops and are deliberately outside this repo work,
consistent with the plan's Hard Operational Boundaries:

- **Scope A canary (Slice A3).** Enabling accepted synthesis on A6 is an
  operator canary packet, not a product-lane PR. Preconditions: the 48-hour
  proof target passed, a separate attended soak plus updated runbook entry per
  STATUS.md, and explicit acknowledgement that the touch ends the 14-day
  unattended evidence window. No product-lane code sets `VH_BUNDLE_SYNTHESIS_*`
  on A6.
- **Source-health operator decision.** `ap-topnews` is escalated to removal in
  the latest source-health packet. Prune/remediate the source per
  `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`, then let the configured release
  window accumulate clean runs.
- **Mesh/release evidence regeneration** at the release commit on a clean tree,
  including the LUMA coverage report path passed into the mesh readiness step.
- **Provider registration + callback deployment.** Apple/Google/X developer
  app registration (Apple has the longest lead time and a server-held signed
  client secret) and deploying `services/auth-callback` outside A6, per
  `docs/ops/account-provider-callback-boundary.md`. Then the live per-provider
  sign-in rehearsal and the browser-bundle secret scan.
- **Manual 3-browser rehearsal** and the strict live matrix per
  `docs/ops/BETA_SESSION_RUNSHEET.md` (Slice F2): distinct identities, shared
  accepted-current table, cross-client convergence, reload persistence, and the
  privacy-leak spot-check.
- **Release packet** (Slice F3): record the release commit, deployed Web PWA
  target, deployed callback target, live A6 state or non-touch boundary,
  coverage/evidence, known limitations and forbidden claims, and rollback.

## Non-Negotiable Boundaries Preserved

- No live A6 mutation originated from any product lane.
- No pager cutover and no Codex live execution; the executor stays dry-run and
  the non-waivable adversarial verification of PR #722 against the incident
  response v2 plan's Security Architecture remains a prerequisite to any pager
  cutover or Codex-live decision.
- No memory remediation ahead of the post-recovery heap-summary pair.
- Copy across all new surfaces stays within beta-local continuity/recovery
  framing; no verified-human, one-human-one-vote, Sybil-resistance, or
  residency claim was introduced.
