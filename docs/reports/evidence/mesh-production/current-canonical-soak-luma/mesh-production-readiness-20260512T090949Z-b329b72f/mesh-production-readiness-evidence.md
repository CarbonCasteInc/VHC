# Mesh Production Readiness Evidence Packet

- Run ID: `mesh-production-readiness-20260512T090949Z-b329b72f`
- Status: `release_ready`
- Commit: `0372b64e14f2ddf31ab2cfd5e87fdd7dbb92ac59`
- Dirty: `false`
- Schema epoch: `post_luma_m0b`
- LUMA profile: `none`
- Report: `./.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/mesh-production-readiness-report.json`
- LUMA coverage report: `./supporting-evidence/luma-gated-write-coverage/mesh-luma-gated-write-coverage-report.json`

## Source Reports

| Gate | Gate status | Source report status | Command | Copied report |
|---|---|---|---|---|
| topology | pass | review_required | `pnpm test:mesh:topology-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/topology/mesh-production-readiness-report.json` |
| signed_peer_config | pass | review_required | `pnpm test:mesh:signed-peer-config-canary` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/signed_peer_config/mesh-production-readiness-report.json` |
| deployed_wss | pass | review_required | `pnpm test:mesh:deployed-wss-peer-config` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/deployed_wss/mesh-production-readiness-report.json` |
| state_resolution | pass | review_required | `pnpm test:mesh:state-resolution-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/state_resolution/mesh-production-readiness-report.json` |
| disconnect | pass | review_required | `pnpm test:mesh:disconnect-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/disconnect/mesh-production-readiness-report.json` |
| partition | pass | review_required | `pnpm test:mesh:partition-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/partition/mesh-production-readiness-report.json` |
| read_repair | pass | review_required | `pnpm test:mesh:read-repair-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/read_repair/mesh-production-readiness-report.json` |
| soak | pass | review_required | `pnpm test:mesh:soak` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/soak/mesh-production-readiness-report.json` |
| peer_config_rollback | pass | review_required | `pnpm test:mesh:peer-config-rollback-drill` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/peer_config_rollback/mesh-production-readiness-report.json` |
| clock_skew | pass | review_required | `pnpm test:mesh:clock-skew-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/clock_skew/mesh-production-readiness-report.json` |
| conflict | pass | review_required | `pnpm test:mesh:conflict-drills` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/conflict/mesh-production-readiness-report.json` |
| evidence_scrub | pass | pass | `pnpm check:mesh-evidence-scrub -- --source-dir .tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f` | `.tmp/mesh-production-readiness/mesh-production-readiness-20260512T090949Z-b329b72f/source-reports/evidence_scrub/mesh-production-readiness-report.json` |

## Release-Ready Blockers

| Blocker | Command / future gate | Reason |
|---|---|---|


## Allowed Claims

- The Mesh production-readiness aggregate is release_ready for Mesh transport readiness only: release_readiness_blockers is empty, canonical 1800000ms soak is satisfied, public WSS deployment proof passed, durable LUMA reader-path coverage passed for the five required Mesh user-write classes, and evidence scrub passed.
- Existing implemented Mesh proof commands can be rerun and aggregated into one evidence packet with source reports, copied artifacts, current commit metadata, dirty state, and explicit release blockers.
- The local non-LUMA Mesh clock-skew/auth-window matrix source gate passed for applicable mesh surfaces.
- The local non-LUMA Mesh conflict/protocol fixture source gate passed for applicable synthetic rows.

## Forbidden Claims

- The full app is test-group ready.
- The production app canary passed.
- Downstream app surfaces were observed end-to-end.
- LUMA profile gates or LUMA gate behavior passed through the production app canary.
- LUMA-gated production write authorization, custody, signer, or auth behavior is proven beyond durable LUMA reader-path coverage.
- Public WSS conflict, partition/heal, clock-skew, rollback, or soak behavior is production-proven by the public WSS proof alone.
- The separate production app canary cleared downstream full-app readiness.
