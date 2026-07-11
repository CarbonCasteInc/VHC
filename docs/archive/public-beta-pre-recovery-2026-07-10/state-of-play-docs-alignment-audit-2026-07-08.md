# State Of Play And Docs Alignment Audit - 2026-07-08

> Document Role: Historical documentation audit (non-authoritative)
> Archived: 2026-07-11
> Superseded By: `docs/reports/public-beta-docs-alignment-audit-2026-07-11.md`
> Status: Current-state documentation audit
> Owner: VHC Core Engineering + VHC Launch Ops
> Reviewed Against: `main@eb53af67dc46764e4d8afe1c5f932c771fe5a4c8`

## Verdict

The repository is ahead of the last current-state docs. The Functioning MVP
product lanes and the follow-up hardening issues are merged; no open PRs
remain. The remaining blockers are live/operator evidence, not known repo-side
MVP code gaps.

The most important alignment rule is now:

- **Repo truth:** current `main` is `eb53af67` after #745.
- **Latest release evidence packet:** still stamped at `1a83434b`, not current
  `main`.
- **Live A6 proof:** still only proven at `main@47ba218d` unless an operator
  provides a newer A6 readback.

Docs must not collapse those three states into one claim.

## Current Repository State

Recent merge chain on `main`:

| PR | Merge commit | State impact |
| --- | --- | --- |
| #728 | `74002031` | Accepted-current synthesis read model and votability gating |
| #729 | `f3fcc535` | Auth-callback boundary and sign-in schema/vault foundations |
| #730 | `2425ee18` | Vote admission, persistence, and aggregate-engagement hardening |
| #732 | `7c28d4e9` | Constituency proof plus district/office aggregate mapping |
| #734 | `41e985d1` | Browser sign-in flow, account UI, and LUMA binding |
| #735 | `d5ddd89e` | Account/sign-in telemetry redaction scan |
| #736 | `eaa64c62` | Functioning MVP lane repo closeout |
| #737 | `1a83434b` | Final MVP vote/identity readiness hardening |
| #738 | `1e3bb05d` | Deferred hardening across mesh-read auth, vote queue, auth-callback, redaction, vault, and system-writer guardrails |
| #741 | `158b4352` | #740: reject-unmarked mode spans all migrated system-writer readers |
| #742 | `ce07ccae` | #739: VaultV2 old-bundle writes preserve authenticated newer-bundle data |
| #744 | `347d2018` | Watch-closure restart baseline |
| #745 | `eb53af67` | #743: civic representative snapshot durability readback matches district pattern |

GitHub state at audit time:

- Open PRs: none.
- Open issues: #178, #277, #279 only.
- #739, #740, and #743 are closed by #742, #741, and #745 respectively.

Workspace state:

- Branch for this audit: `codex/docs-state-alignment-2026-07-08`.
- The two local operator readiness docs named
  `DISTRIBUTION_READINESS_GOAL_2026-07-05.md` and
  `DISTRIBUTION_READINESS_SLICES_2026-07-05.md` remain untracked and
  intentionally unmodified. They are not referenced here as committed
  `docs/...` paths because CI correctly does not have them.

## Current Evidence State

Latest local evidence packet readback:

| Artifact | Commit | Status |
| --- | --- | --- |
| `.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json` | `1a83434b0d33278369791891ba9212fcc6b859f6` | `pass` |
| `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json` | generated before current `main` | `pass` |
| `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` | `1a83434b0d33278369791891ba9212fcc6b859f6` | `fail` |
| `.tmp/mvp-closeout/latest/mvp-closeout-report.json` | `1a83434b0d33278369791891ba9212fcc6b859f6` | `blocked` |
| `.tmp/release-evidence-pipeline/latest/release-evidence-pipeline-report.json` | packet over the above artifacts | `blocked` |

The release pipeline blockers are:

- `source_health_command_exit_1`;
- `mvp_release_gates_command_exit_1`;
- `mvp_closeout_command_exit_1`;
- `mvp_closeout_status_blocked`.

The MVP release-gate failures in the latest packet are:

- `source_health`;
- `public_feed_analysis_frame_reliability`;
- `public_feed_composition_freshness`;
- `public_feed_lifecycle_accountability`;
- `public_feed_fresh_propagation`;
- `public_feed_pagination_refresh`;
- `stance_aggregate_decay_public_mesh`.

The source-health root is `ap-topnews`: it is escalated to
`remove_from_starter_surface` with reasons `feed_links_unavailable`,
`feed_non_xml_payload`, and `watchlist_escalated_by_history`. The release
window has `0/5` ready runs in the latest source-health artifact.

The public-feed failures are live/operator-boundary failures: accepted synthesis
is now repo-capable, but accepted synthesis is not yet operator-enabled/proven
on live A6.

## Docs Alignment Findings

| Area | Finding | Remediation |
| --- | --- | --- |
| Implementation truth ledger | `STATUS.md` still described repo state as post-#723 / `main@47ba218d`. | Updated to current repo `main@eb53af67`, while preserving A6 live proof as `main@47ba218d`. |
| MVP closeout | Closeout still said LUMA readiness was blocked by `repo_dirty` and `mesh_luma_coverage`. | Added 2026-07-08 addendum: #737 cleared those; current blockers are source health and public-feed/accepted-synthesis evidence. |
| MVP slice plan | Plan text still said no OAuth/PKCE callback service existed. | Marked that as original-plan context and recorded `services/auth-callback` as the repo implementation, with provider registration/deployment still operator-owned. |
| LUMA spec | VaultV2 interface and storage semantics did not include sign-in session or the old-bundle write preservation rule. | Updated §11 with current optional compartments and forward-compatible write semantics sourced only from authenticated stored data. |
| LUMA roadmap | Current implementation addendum predates the July account/vault/system-writer hardening. | Updated addendum and changelog to 0.20. |
| Auth callback ops | Decision record predates Apple `form_post` multi-origin/cancel handling. | Added form_post return-leg behavior and origin-bound routing notes. |
| Canon routing | Canon map review dates pointed readers to older status/spec reviews. | Updated review dates for `STATUS.md`, Scope A status routing, and LUMA service spec. |

## Current Release Boundary

Repo-side MVP code is merged. A functioning initial-release claim still requires:

1. Source-health operator action for `ap-topnews` plus a clean configured
   release window.
2. Operator-owned accepted-synthesis enablement/canary on A6, or a narrower
   release envelope that does not claim accepted-current public live synthesis.
3. Live provider registration and deployment of `services/auth-callback`
   outside A6.
4. Manual multi-browser rehearsal against the intended deployed surfaces.
5. Fresh evidence regeneration on the intended release commit, not reuse of the
   `1a83434b` packet.

No current doc should claim:

- production-attestation/Silver;
- verified-human or one-human-one-vote;
- cryptographic residency;
- public WSS mesh `release_ready`;
- full production app readiness;
- custom pager/PWA cutover;
- Codex live production execution;
- heap-retainer diagnosis or memory remediation authorization.

## Files Updated By This Audit

- `docs/foundational/STATUS.md`
- `docs/reports/functioning-mvp-lane-repo-closeout-2026-07-07.md`
- `docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md`
- `docs/specs/spec-luma-service-v0.md`
- `docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md`
- `docs/ops/account-provider-callback-boundary.md`
- `docs/CANON_MAP.md`
- `docs/archive/public-beta-pre-recovery-2026-07-10/state-of-play-docs-alignment-audit-2026-07-08.md`
