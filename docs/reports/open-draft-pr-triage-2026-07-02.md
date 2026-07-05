# Open PR Triage - 2026-07-02

> Status: Triage Only
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-05
> Current main reviewed: `25df495e`

This note re-triages old open PRs without resuming their branches. It is
repo-side bookkeeping only; it does not change live Scope A/A6 behavior, relay
quorum semantics, publisher state, alert state, retention, compaction, or any
release claim.

The 2026-07-05 pass expands the 2026-07-02 draft-only review to all stale open
PRs left after the Scope A recovery work through #710. It used current GitHub PR
metadata, `git merge-tree --write-tree origin/main origin/<branch>`, and
`git diff --shortstat origin/main...origin/<branch>` against `main@6e0d3efd`.
After #711 merged, PRs #631, #629, #544, #524, #516, and #512 were closed with
comments pointing back to this triage record. PR #525 remains open because it is
clean, additive historical documentation rather than a conflicting release
claim.

| PR | Branch | Disposition | Recommendation |
| --- | --- | --- | --- |
| #631 Stabilize public analysis frame pipeline | `coord/mvp-analysis-frame-pipeline-reliability-v1` | Superseded and conflict-heavy. The branch targets `coord/mvp-production-grade-distribution-ready-v1`, not `main`; it is 261 commits behind and 135 ahead of `main`, with a three-dot diff of 240 files, 59,973 insertions, and 1,718 deletions. It predates #703-#710, outage #3, exit-69 handling, the first-tick ingest cap, and the current alert/test-fire packet. `merge-tree` reports conflicts across public-feed, relay, synthesis, and docs surfaces. | Closed 2026-07-05 after #711. Do not refresh wholesale and do not use it as release evidence. |
| #629 MVP public beta go/no-go approval hold | `coord/mvp-public-beta-go-no-go-v1` | Superseded and conflicting. It is 261 commits behind `main`, edits only the 2026-05-13 launch-control packet, and conflicts in both the `.md` and `.json` report. The packet predates the Scope A outage ledger, #706 recovery behavior, alert-delivery gating, heap-retainer gate, and the current residual-risk claim boundary. | Closed 2026-07-05 after #711. Replace with a new go/no-go packet only after alert receipt is proven, the heap retainer is named or bounded, and the evidence window is rerun on the intended release commit. |
| #544 Align docs after report intake admin merge | `coord/docs-alignment-after-report-intake` | Superseded and conflicting. It is 458 commits behind `main`, conflicts in roadmap/spec docs, and predates the current canon-map and Scope A/LUMA alignment work. | Closed 2026-07-05 after #711. If a maintainer identifies a still-missing report-intake row, cherry-pick that row into a new focused docs PR from current `main`. |
| #525 Document VHC automation teardown retrospective | `coord/vhc-automation-retrospective` | Still valid as historical documentation, but not release-blocking. It is one additive docs commit, 509 commits behind `main`, and `merge-tree` is clean. The content is an April retrospective on retired local Codex automations; it does not prove current unattended Scope A behavior. | Safe to merge as historical docs after ordinary docs validation, or close if the audit trail is no longer needed. Do not count it toward distribution-readiness evidence. |
| #524 Wire bundle synthesis daemon spine | `coord/bundle-synthesis-spine` | Superseded by later merged bundle-synthesis work and out of current Scope A. PR #528 and later hardening already put the current bundle-synthesis surfaces on `main`; this branch is 509 commits behind and conflicts in bundle prompt, synthesis adapter, daemon, and worker files. It also belongs to Scope B/product synthesis behavior, which remains explicitly gated outside this recovery arc. | Closed 2026-07-05 after #711. Reopen later from current `main` only under a Scope B authorization packet. Do not resume during the current Scope A reliability/detection window. |
| #516 Move related links into publish-time bundle enrichment | `coord/related-links-publish-enrichment` | Still a recognizable follow-up theme, but this branch is stale and conflicting. It is 544 commits behind `main` and conflicts in `newsRuntime.ts`, daemon files, and tests. Current `main` already has `StoryBundle.related_links`, runtime propagation, UI handling, and later bundle-synthesis machinery; docs still name ledger-driven `primary_sources` / `related_links` enrichment as a future focused follow-up. | Closed 2026-07-05 after #711. Recreate the remaining ledger-driven enrichment slice from current `main` only after the Scope A unattended-run gates are green. |
| #512 fix: recover source health from stale retries | `coord/source-health-recovered-retry-fix` | Superseded by later source-health policy work and conflicting. It is 550 commits behind `main`, conflicts in `feedRegistry.test.ts` and `sourceHealthReport.ts`, and current `main` already carries later source-health policy/versioning, liveness reporting, and stabilization commits. | Closed 2026-07-05 after #711. If a fresh recovered-retry defect appears, rebuild it against the current source-health policy and release-evidence windows instead of resurrecting this branch. |

## Release-Governance Effect

None of these PRs should be merged into the current distribution-readiness
line as-is. #525 is the only clean additive branch, but it is historical
documentation and not a readiness dependency. The others either contradict,
conflict with, or predate the current Scope A recovery posture.

For a constrained public-beta release claim, the old PR stack should therefore
be treated as non-authoritative. The release path needs fresh artifacts from the
intended release commit after:

1. real alert delivery is configured, test-fired, received, and enabled;
2. post-recovery heap summaries name or bound the retainer without retention or
   compaction guesses;
3. the sustained evidence window passes; and
4. a new go/no-go packet explicitly records the residual A6 single-host risk and
   the Scope B/LUMA claim boundaries.
