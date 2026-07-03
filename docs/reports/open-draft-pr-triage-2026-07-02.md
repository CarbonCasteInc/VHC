# Open Draft PR Triage - 2026-07-02

> Status: Triage Only
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-02

This note re-triages old open draft PRs without resuming their branches. It is
repo-side bookkeeping only; it does not change live Scope A/A6 behavior.

| PR | Branch | Disposition | Recommendation |
| --- | --- | --- | --- |
| #631 Stabilize public analysis frame pipeline | `coord/mvp-analysis-frame-pipeline-reliability-v1` | Superseded/conflicts with current claims posture. The branch predates outage #2 recovery, #691-#694 relay diagnostics/stagger, and the current Scope A raw-only/driver-evidence gate; it touches broad relay, feed, synthesis, and public-read surfaces. | Close or split after a fresh roadmap review. Do not refresh wholesale. |
| #629 MVP public beta go/no-go approval hold | `coord/mvp-public-beta-go-no-go-v1` | Superseded. The launch-control packet predates the current Scope A outage ledger and LUMA forbidden-claims/profile gate posture. | Close; replace with a new approval packet only after current Scope A driver evidence and LUMA claim gates are incorporated. |
| #544 Align docs after report intake admin merge | `coord/docs-alignment-after-report-intake` | Superseded by later docs-alignment work and current Scope A/LUMA docs. | Close unless a maintainer identifies a still-missing report-intake doc row; if so, cherry-pick that row into a new focused docs PR. |
| #524 Wire bundle synthesis daemon spine | `coord/bundle-synthesis-spine` | Still conceptually valid as Scope B, but out of window. It introduces accepted/topic synthesis behavior and daemon publication surfaces while the current program explicitly holds Scope B and verifier/profile promotion work. | Keep parked or close-and-reopen later from current `main` under a Scope B authorization packet. Do not resume during the current Scope A/LUMA window. |

Non-draft open PRs from the same era should be separately reviewed before any
merge attempt; this note covers only old drafts.
