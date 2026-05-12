# MVP Public Beta Release Candidate Packet

Date: 2026-05-12
Created at: 2026-05-12T22:49:14Z
Branch: `coord/mvp-public-beta-rc-packet-v1`
Frozen baseline commit: `4c3fd64478e36e86f9bf8a8d9fd787865390b13b`
Node: `v20.20.0`
pnpm: `9.7.1`
Packet status: release-candidate evidence packet, pending human/operator approvals.

Dynamic run ids, generated-at timestamps, and current branch-head commit checks live in the generated reports listed below. This committed note records the stable release-candidate claim boundary and the report paths a reviewer should inspect after rerunning the evidence matrix on the final commit.

## Release Candidate Verdict

The Web PWA is an MVP public-beta release candidate for the implemented scope, with deterministic MVP gates, source health, and LUMA public-beta readiness passing; Mesh production readiness and full-app/test-group readiness remain separate unfinished gates.

This packet does not make Mesh `release_ready`, does not pass production app canary, does not claim downstream production app observation, and does not record legal/commercial approval.

## Evidence Matrix

| Evidence | Command | Result | Report or note |
| --- | --- | --- | --- |
| Public beta launch closeout | `pnpm check:public-beta-launch-closeout` | PASS | `docs/ops/public-beta-launch-readiness-closeout.md` |
| MVP release gates | `pnpm check:mvp-release-gates` | PASS, 14/14 gates | `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` |
| MVP consolidated closeout | `pnpm check:mvp-closeout` | PASS | `.tmp/mvp-closeout/latest/mvp-closeout-report.json` |
| Launch content snapshot | `pnpm check:launch-content-snapshot` | PASS | `.tmp/launch-content-snapshot/latest/launch-content-snapshot-report.json` |
| Public beta compliance | `pnpm check:public-beta-compliance` | PASS | `tools/scripts/check-public-beta-compliance.mjs` |
| LUMA public-beta MVP readiness | `pnpm check:luma:mvp-production-readiness` | PASS | `.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json` |
| LUMA mesh reader-path coverage | `pnpm test:mesh:luma-gated-write-coverage -- --mode local-e2e` | PASS | `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json` |
| Mesh aggregate boundary | `VH_MESH_SOAK_DURATION_MS=1800000 VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT=.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json pnpm check:mesh:production-readiness` | Command completed; report remains `review_required` | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Production app canary boundary | `pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` | EXPECTED BLOCKED, nonzero, `mesh_not_release_ready` | `.tmp/production-app-canary/latest/production-app-canary-report.json` |
| Documentation governance | `pnpm docs:check` | PASS | local command output |
| E2E package typecheck | `pnpm --filter @vh/e2e typecheck` | PASS | local command output |
| Public namespace leaks | `pnpm check:public-namespace-leaks` | PASS | local command output |
| Whitespace diff check | `git diff --check origin/main...HEAD` | PASS | local command output |
| Diff coverage guard | `node tools/scripts/check-diff-coverage.mjs` | PASS | local command output |

## Source Health

Report path: `services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`

- `readinessStatus`: `ready`
- `releaseEvidence.status`: `pass`
- `releaseEvidence.recentWindowRunCount`: `5`
- `releaseEvidence.recentReadyRunCount`: `5`
- `releaseEvidence.recentReviewRunCount`: `0`
- `releaseEvidence.recentBlockedRunCount`: `0`
- Source disposition: `28` keep, `0` watch, `0` remove
- Release evidence reasons: none

Claim boundary: source health passed the complete 5/5 ready release evidence window. This packet does not relax source-health thresholds and does not remove, suppress, or admit sources by fiat.

## LUMA Public Beta MVP

Report path: `.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json`

- `status`: `pass`
- `profile`: `public-beta`
- `blockers`: none

Claim boundary: LUMA public-beta is MVP-production-ready as a fail-closed beta-local identity and signed-write layer. This packet does not claim LUMA Silver, verified-human identity, one-human-one-vote, Sybil resistance, cryptographic residency, or production attestation.

## Mesh Boundary

Report path: `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`

- `status`: `review_required`
- `schema_epoch`: `post_luma_m0b`
- `luma_profile`: `none`
- LUMA gated write coverage status: `pass`
- Release-readiness blockers:
  - `public-wss-deployment-proof`
  - `required-write-class-sample-floors`

Claim boundary: Mesh is tracked separately and remains `review_required`. Public WSS proof and required write/resource sample floors are not satisfied by this packet. The Mesh command completing does not convert this packet into a Mesh `release_ready` claim.

## Production App Canary Boundary

Report path: `.tmp/production-app-canary/latest/production-app-canary-report.json`

- `status`: `blocked`
- `reason`: `mesh_not_release_ready`
- Downstream observation: `not_run`
- Downstream reason: `prerequisites_blocked`

Claim boundary: the production app canary did not pass. Downstream production app surfaces were not observed end to end because the Mesh prerequisite is still blocked.

## Supplemental Launch Rehearsal

The release copy may say the local product loop was rehearsed only because this packet ran the release-like local stack lane:

| Evidence | Command | Result |
| --- | --- | --- |
| Start local analysis-stub stack | `pnpm live:stack:up:analysis-stub` | PASS |
| Five-user engagement rehearsal | `pnpm test:live:five-user-engagement` | PASS |
| Stop local stack | `pnpm live:stack:down` | PASS |

The rehearsal exercised five isolated beta-local users across feed rendering, accepted synthesis detail, point stance writes, aggregate readback, and story-thread discussion against the local analysis-stub stack. This is not production app canary evidence, does not prove production downstream observation, and does not replace deterministic gates.

Launch rehearsal findings fixed in this release-candidate branch:

- Local stack startup now exports the deterministic E2E system-writer identity into the news daemon and E2E browser environment, so system-authored fixture/stub stories use the same LUMA writer contract the reader expects.
- The live mesh synthesis prefilter now resolves the deterministic E2E system-writer pin before classifying records, so valid system-written LUMA records are not rejected as `missing-pin`.
- The five-user live test now fails closed if a beta-local identity was not actually published before feed/detail/stance activity starts.
- The aggregate voter reader now hydrates nested LUMA signed-write envelope relation pointers before strict parsing, so relay-persisted aggregate voter rows are not dropped when Gun returns nested envelope fields as references.

These fixes do not change Mesh readiness gates, production app canary implementation, source-health thresholds, source registry policy, relay runtime, or LUMA runtime/schema/custody/envelope/signed-write/provider/identifier/identity-vault surfaces.

## Allowed Claims

- "MVP public-beta release gates passed for the implemented MVP scope."
- "Source health passed the complete release evidence window."
- "LUMA public-beta is MVP-production-ready as a fail-closed beta-local identity and signed-write layer."
- "The Web PWA is a public beta candidate for the documented implemented scope."
- "Mesh is tracked separately and is currently review_required unless its own report says release_ready."
- "The local analysis-stub five-user rehearsal passed for the Web PWA feed/detail/stance/thread loop."

## Forbidden Claims

- Mesh `release_ready`.
- Production app canary pass.
- Downstream production app surfaces observed end to end.
- Full production app readiness.
- Test-group readiness.
- Legal or commercial approval unless externally recorded.
- Production-grade live headline freshness unless StoryCluster production readiness separately says `release_ready`.
- LUMA Silver, verified-human identity, one-human-one-vote, Sybil resistance, or production attestation.
- Public WSS proof satisfied unless the Mesh report says so.
- Mesh sample floors satisfied unless the Mesh report says so.
- Native App Store or TestFlight readiness.

## Launch Copy Boundaries

Allowed launch copy can describe the Web PWA as an MVP public-beta release candidate for the implemented scope with deterministic MVP gates, source health, LUMA public-beta MVP readiness, curated launch-content fallback, public policy/support surfaces, audited correction/moderation/report remediation paths, and trusted beta operator gates.

Launch copy must not imply production-grade live headline freshness, Mesh `release_ready`, production app canary pass, downstream production app observation, full app readiness, test-group readiness, legal/commercial approval, native App Store/TestFlight readiness, or production-grade LUMA/Silver/verified-human claims.

## Release Owner Handoff

| Item | Status |
| --- | --- |
| Release owner | Pending |
| Signoff date | Pending |
| External/legal approval status | Pending; outside repo automation |
| Launch copy approval | Pending |
| Support issue intake path | Public beta GitHub support issue intake, plus private escalation path when needed |
| Private escalation path | Pending external operator confirmation |
| Rollback contact/path | Pending release owner assignment |

Known hold conditions:

- Any rerun of `pnpm check:public-beta-launch-closeout`, `pnpm check:mvp-release-gates`, `pnpm check:mvp-closeout`, source health, public-beta compliance, or LUMA MVP readiness fails on the release commit.
- Launch copy makes any forbidden claim above.
- Required external/operator/legal approval is missing for the intended distribution path.
- The release owner needs production app canary pass, Mesh `release_ready`, full-app readiness, test-group readiness, native App Store/TestFlight readiness, or production-grade live headline freshness for the intended launch claim.
- The local five-user product-loop rehearsal fails and launch copy still claims the feed/detail/stance/thread loop was exercised.

Next operator actions:

- Rerun the deterministic evidence matrix on the final release commit.
- Preserve generated report paths listed in this packet for reviewer inspection.
- Obtain release owner and external/legal approval if required by the launch process.
- Publish only the bounded Web PWA MVP public-beta claims listed above.
- Keep Mesh production readiness, production app canary downstream observation, full-app readiness, and test-group readiness as separate unfinished gates.
