# MVP Public Beta Launch Control Packet

Date: 2026-05-13
Created at: 2026-05-13T01:51:53Z
Branch: `coord/mvp-public-beta-launch-control-v1`
Release-control commit: `9eb58154a321ee202095cfdb7d02fce67fb4cab3`
Release-control base: `origin/main` after PR #627 merge
RC packet: `docs/reports/mvp-public-beta-release-candidate-2026-05-12.md`
Node: `v20.20.0`
pnpm: `9.7.1`
Repo dirty state during engineering evidence: clean

Verification timing: the deterministic MVP/LUMA/Mesh evidence matrix was rerun on the clean release-control commit before this docs-only launch-control packet was added. After the packet edit, the docs/diff checks were rerun against the branch diff.

## Final Status

`hold_external_approval_pending`

Engineering evidence passed on the release-control commit for the implemented Web PWA MVP public-beta scope. Launch is held because release-owner approval, external/legal disposition, launch-copy approval, support/private-escalation ownership, and rollback ownership have not been supplied in this repo packet. Do not infer signoff from green engineering evidence.

Status may move to `go_for_public_beta_launch` only when every required approval/owner field below is approved, assigned, or explicitly marked `not_required` by the release owner.

## Evidence Summary

| Evidence | Command | Result | Report or note |
| --- | --- | --- | --- |
| Public beta launch closeout | `pnpm check:public-beta-launch-closeout` | PASS | `docs/ops/public-beta-launch-readiness-closeout.md` |
| MVP release gates | `pnpm check:mvp-release-gates` | PASS, 14/14 gates | `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` |
| MVP consolidated closeout | `pnpm check:mvp-closeout` | PASS | `.tmp/mvp-closeout/latest/mvp-closeout-report.json` |
| Launch content snapshot | `pnpm check:launch-content-snapshot` | PASS | `.tmp/launch-content-snapshot/latest/launch-content-snapshot-report.json` |
| Public beta compliance | `pnpm check:public-beta-compliance` | PASS | `tools/scripts/check-public-beta-compliance.mjs` |
| LUMA public-beta MVP readiness | `pnpm check:luma:mvp-production-readiness` | PASS | `.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json` |
| Source health | `pnpm check:news-sources:health` | READY; release evidence PASS; 5/5 ready window; 28 keep, 0 watch, 0 remove | `services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json` |
| Documentation governance | `pnpm docs:check` | PASS | local command output |
| Whitespace diff check | `git diff --check origin/main...HEAD` | PASS before and after packet edit | local command output |
| Diff coverage guard | `node tools/scripts/check-diff-coverage.mjs` | PASS, no coverage-eligible source files changed | local command output |
| Public namespace leaks | `pnpm check:public-namespace-leaks` | PASS | local command output |
| LUMA mesh reader-path coverage | `pnpm test:mesh:luma-gated-write-coverage -- --mode local-e2e` | PASS | `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json` |
| Mesh aggregate boundary | `VH_MESH_SOAK_DURATION_MS=1800000 VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT=.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json pnpm check:mesh:production-readiness` | Command exited 0; report remains `review_required` | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Production app canary boundary | `pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` | EXPECTED BLOCKED, exit 1, `mesh_not_release_ready` | `.tmp/production-app-canary/latest/production-app-canary-report.json` |
| Local product-loop rehearsal | `pnpm live:stack:up:analysis-stub`; `pnpm test:live:five-user-engagement`; `pnpm live:stack:down` | PASS; stack down PASS; five-user test 6.2m | local command output |

## Engineering Evidence Details

| Area | Status |
| --- | --- |
| MVP release gates | `overallStatus: pass`; 14 gates, 14 pass, failing gates `[]` |
| MVP closeout | `status: pass`; blockers `[]` |
| Source health | `readinessStatus: ready`; `releaseEvidence.status: pass`; `recentWindowRunCount: 5`; `recentReadyRunCount: 5`; `recentReviewRunCount: 0`; `recentBlockedRunCount: 0`; `keepSourceCount: 28`; `watchSourceCount: 0`; `removeSourceCount: 0`; `reasonCounts: {}` |
| LUMA public-beta MVP | `status: pass`; `profile: public-beta`; blockers `[]` |
| Mesh LUMA coverage | `status: pass`; `schema_epoch: post_luma_m0b`; `luma_profile: e2e`; failures `[]` |
| Mesh readiness | `status: review_required`; `schema_epoch: post_luma_m0b`; `luma_profile: none`; blockers `public-wss-deployment-proof`, `required-write-class-sample-floors` |
| Canonical Mesh soak | 30-minute duration satisfied; `soak_gate: pass`; `terminal_failures: 0`; `duplicate_canonical_writes: 0`; `repair_events: 0`; Mesh still remains `review_required` because sample floors are not satisfied |
| Production app canary | `status: blocked`; `reason: mesh_not_release_ready`; downstream observation `not_run`; downstream reason `prerequisites_blocked` |
| Launch rehearsal | PASS against local `analysis-stub` stack; five beta-local users exercised feed/detail/stance/thread activity and aggregate readback |

## Release Copy

Allowed launch copy:

- "Web PWA MVP public beta candidate for the implemented scope."
- "MVP release gates passed."
- "Source health passed the complete release evidence window."
- "LUMA public-beta is MVP-production-ready as a fail-closed beta-local identity and signed-write layer."
- "Local analysis-stub five-user feed/detail/stance/thread rehearsal passed."
- "Mesh production readiness remains separate and is currently review_required."

Forbidden launch copy:

- Mesh `release_ready`.
- Production app canary pass.
- Downstream production app surfaces observed end to end.
- Full production app readiness.
- Test-group readiness.
- Legal or commercial approval unless explicitly recorded.
- Production-grade live headline freshness unless StoryCluster production readiness separately says `release_ready`.
- LUMA Silver, verified-human identity, one-human-one-vote, Sybil resistance, or production attestation.
- Public WSS proof satisfied unless the Mesh report says so.
- Mesh sample floors satisfied unless the Mesh report says so.
- Native App Store or TestFlight readiness.
- Private support desk or SLA unless externally provisioned.

## Approval Table

| Approval or owner | Name, team, or reference | Approval status | Timestamp | Notes |
| --- | --- | --- | --- | --- |
| Release owner | Pending | `pending` | Pending | Required before public launch. |
| External/legal approval | Pending | `pending` | Pending | This packet records no legal, commercial, or external distribution approval. |
| Launch copy approval | Pending | `pending` | Pending | Only the bounded copy above is allowed until approved by the release owner. |
| Support intake owner | Pending | `pending` | Pending | Public issue intake path exists through the Web PWA `/support` surface and VHC public beta GitHub Issue Form; owner assignment is pending. |
| Private escalation owner | Pending | `pending` | Pending | Private escalation channel/reference remains outside repo automation and must be supplied before launch. |
| Rollback owner | Pending | `pending` | Pending | Owner assignment is pending. Engineering rollback path is documented below but is not an owner signoff. |

## Support And Escalation

Public intake path: Web PWA `/support` surface linked to the VHC public beta GitHub Issue Form.

Private escalation path: pending release-owner/operator confirmation. Do not claim a private support desk, SLA, legal intake, or staffed escalation channel until the release owner records the external reference.

Minimum expected escalation classes before launch:

- deletion, correction, copyright, attribution, abuse, safety, account, and access issues that cannot safely remain in a public GitHub issue;
- engineering incidents that invalidate any deterministic gate in this packet;
- launch-copy or public-claim issues that imply a forbidden claim.

## Rollback Path

Rollback owner: pending.

Rollback triggers:

- any deterministic evidence rerun fails before launch;
- launch copy includes a forbidden claim;
- required approval is rejected or remains pending for the intended distribution path;
- support/escalation or rollback ownership remains unassigned;
- a public-beta incident requires halting distribution or correcting public claims.

Engineering rollback path:

- hold or withdraw public launch copy;
- keep the Web PWA at the last approved public-beta candidate state;
- revert or supersede this launch-control packet if it records an incorrect approval or claim boundary;
- keep Mesh production readiness, production app canary, full-app readiness, test-group readiness, native readiness, and legal/commercial approval as separate gates.

## Runtime And Scope Boundaries

This launch-control branch adds no runtime changes.

The merged RC history includes one narrow tested runtime readback fix in `packages/gun-client/src/aggregateAdapters.ts` for nested LUMA signed-write envelope relation pointers. That fix belongs to PR #627 and is part of the release-control base.

This packet makes no changes to:

- app runtime;
- relay runtime;
- Mesh readiness implementation;
- production app canary implementation;
- LUMA runtime, schema, custody, envelope, signed-write, provider, identifier, or identity-vault surfaces;
- source-health thresholds or source registry;
- aggregate adapter runtime.

## Go/No-Go Rule

`go_for_public_beta_launch` requires all of the following:

- deterministic evidence matrix passes;
- MVP closeout status is `pass`;
- source health is `ready` with release evidence `pass`;
- LUMA MVP readiness is `pass`;
- public-beta launch closeout is `pass`;
- launch copy has no forbidden claims;
- required human/operator/legal approvals are approved or explicitly `not_required`;
- support intake, private escalation, and rollback owners are assigned.

`hold_external_approval_pending` applies when engineering evidence passes but any required approval, owner, or launch-copy field remains pending.

`blocked_engineering_evidence` applies if any deterministic release gate fails.

Current decision: `hold_external_approval_pending`.
